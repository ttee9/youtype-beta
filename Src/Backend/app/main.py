import hashlib
import hmac
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4
import os

from fastapi import FastAPI, HTTPException, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from typing import Union

from app.embeddings import embed_text
from app.moderation import is_low_quality, moderate
from app.db import (
    cast_vote,
    get_vote,
    init_db,
    insert_post,
    fetch_posts,
    find_similar_posts,
    fetch_posts_admin,
    set_post_status,
    SIMILARITY_THRESHOLD,
)

load_dotenv()


def get_client_ip(request: Request) -> str:
    """Real client IP, not the reverse proxy's.

    Railway/Render (and similar PaaS) terminate the connection at their own
    edge and forward to this app, so request.client.host is the proxy's
    address rather than the visitor's — and can vary per-request, making
    every hit look like a new visitor. Their edge sets X-Forwarded-For to
    the actual client IP, so prefer that when present.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


def require_admin(request: Request) -> None:
    """Gate /admin/* routes behind a shared-secret header.

    ADMIN_TOKEN must be set in the environment; unset means the routes are
    unreachable (fail closed) rather than open. Comparison is constant-time
    to avoid leaking the token via response-timing.
    """
    token = os.getenv("ADMIN_TOKEN")
    supplied = request.headers.get("x-admin-token", "")
    if not token or not hmac.compare_digest(supplied, token):
        raise HTTPException(status_code=401, detail="Unauthorized")


# Rate limiting setup — moving-window prevents burst (all 10 tokens at once).
# Note: memory:// storage is per-process; use Redis for multi-worker deployments.
limiter = Limiter(key_func=get_client_ip, strategy="moving-window")

app = FastAPI(title="YouType API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS configuration with environment variables
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
origins_list = [origin.strip() for origin in allowed_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins_list,
    allow_origin_regex=r"https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def _startup() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY environment variable is not set")
    if not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL environment variable is not set")
    init_db()


class SubmitRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=200)


class PostOnlyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=200)


SubmitRequest.model_rebuild()
PostOnlyRequest.model_rebuild()


class Example(BaseModel):
    id: str
    text: str
    similarity: float
    created_at: str
    upvotes: int = 0
    downvotes: int = 0


class TrendPoint(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class PostOut(BaseModel):
    id: str
    text: str
    location: Optional[str] = None
    created_at: str
    upvotes: int = 0
    downvotes: int = 0


class VoteRequest(BaseModel):
    value: Literal[1, -1]  # 1 = Allow, -1 = Block


class VoteResponse(BaseModel):
    allow_votes: int
    block_votes: int
    total_votes: int
    status: Literal["active", "blocked"]
    user_vote: Literal[1, -1]
    already_voted: bool
    affected_count: int = 1


class AdminPostOut(BaseModel):
    id: str
    text: str
    location: Optional[str] = None
    created_at: str
    upvotes: int = 0
    downvotes: int = 0
    status: Literal["active", "blocked"]


class AdminPostsResponse(BaseModel):
    count: int
    posts: List[AdminPostOut]


class AdminStatusRequest(BaseModel):
    status: Literal["active", "blocked"]


class PostsResponse(BaseModel):
    count: int
    posts: List[PostOut]


class TopMatch(BaseModel):
    """The closest existing post to a /submit query, if any — this is what
    the Allow/Block moderation widget votes on. Search itself never creates
    a post; there's simply nothing to vote on when there's no match."""
    id: str
    text: str
    created_at: str
    similarity: float
    allow_votes: int = 0
    block_votes: int = 0
    status: Literal["active", "blocked"] = "active"
    user_vote: Optional[Literal[1, -1]] = None


class AllowedResponse(BaseModel):
    status: Literal["allowed"] = "allowed"
    top_match: Optional[TopMatch] = None
    similar_count: int
    similarity_threshold: float
    trend: List[TrendPoint]
    trend_granularity: Literal["day", "week", "month"]
    common_phrases: List[str]
    examples: List[Example]


class RejectedResponse(BaseModel):
    status: Literal["rejected"] = "rejected"
    reason: str
    policy_category: Optional[str] = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/health")
def health():
    return {"ok": True}

@app.get("/posts")
def get_posts() -> PostsResponse:
    """Return all stored posts (persisted)."""
    posts = fetch_posts(limit=500)
    return {"count": len(posts), "posts": posts}


@app.get("/posts/{post_id}")
def get_post(post_id: str):
    posts = fetch_posts(limit=500)
    for p in posts:
        if p["id"] == post_id:
            return p
    return {"error": "not_found"}


@app.delete("/posts/{post_id}")
def delete_post(post_id: str):
    # Minimal MVP: we don't implement delete at DB layer yet.
    # (We'll add it when needed; leaving endpoint stubbed avoids breaking clients.)
    return {"ok": False, "error": "not_implemented"}


@app.post("/posts/{post_id}/vote", response_model=VoteResponse)
@limiter.limit("30/minute")
def vote_post(request: Request, post_id: str, payload: VoteRequest = Body(...)):
    """Cast an Allow/Block vote. Each IP holds at most one vote per post;
    casting again with a different value switches it. The vote is applied
    to this post and every other active post similar enough (see
    SIMILARITY_THRESHOLD) to count as the same statement.

    A post is blocked (hidden from feeds and similarity search) once it has
    at least BLOCK_MIN_VOTES total votes and at least BLOCK_VOTE_RATIO of
    them are Block votes. This is the community-moderation mechanism
    replacing fixed content rules.
    """
    ip = get_client_ip(request)
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()
    result = cast_vote(post_id=post_id, ip_hash=ip_hash, value=payload.value)
    if result is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return result


@app.get("/admin/posts", response_model=AdminPostsResponse)
@limiter.limit("20/minute")
def admin_list_posts(request: Request, q: Optional[str] = None, limit: int = 50):
    """List posts regardless of status, optionally filtered by a text
    substring — dev tooling for finding a post to toggle, since the public
    /posts endpoint hides blocked posts."""
    require_admin(request)
    posts = fetch_posts_admin(query=q, limit=min(max(limit, 1), 200))
    return {"count": len(posts), "posts": posts}


@app.patch("/admin/posts/{post_id}/status", response_model=AdminPostOut)
@limiter.limit("30/minute")
def admin_set_post_status(request: Request, post_id: str, payload: AdminStatusRequest = Body(...)):
    """Directly set a post's active/blocked status, bypassing the vote
    threshold — dev tooling to test moderation states without collecting
    real votes. Note this is a manual override: if the post's existing vote
    ratio already meets the block threshold, a subsequent vote on it (or a
    cascaded vote from a similar post) can flip it back to blocked."""
    require_admin(request)
    post = set_post_status(post_id=post_id, status=payload.status)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return post

@app.post("/submit", response_model=Union[AllowedResponse, RejectedResponse])
@limiter.limit("6/minute")  # ~1 per 10 seconds; moving-window enforces spacing
async def submit(request: Request, payload: SubmitRequest = Body(...)):
    """Search for existing posts similar to payload.text. Read-only — this
    never creates a post; use /post to actually add text to the corpus."""
    # 1) Moderation
    reason = is_low_quality(payload.text)
    if reason:
        return {"status": "rejected", "reason": reason}

    try:
        allowed, reason = await moderate(payload.text)
    except RuntimeError:
        return {"status": "rejected", "reason": "Moderation service unavailable. Please try again later."}
    if not allowed:
        return {"status": "rejected", "reason": reason}

    try:
        embedding = await embed_text(payload.text)
    except RuntimeError:
        return {"status": "rejected", "reason": "Analysis service unavailable. Please try again later."}

    # 2) Find similar posts via pgvector cosine similarity
    threshold = SIMILARITY_THRESHOLD
    scored_posts = find_similar_posts(
        query_embedding=embedding,
        threshold=threshold,
        exclude_id="",
    )

    # 3) Adaptive trend — granularity depends on how far back similar posts go
    today = _now_utc().date()

    post_dates: List[date] = []
    for p in scored_posts:
        try:
            post_dates.append(datetime.fromisoformat(p["created_at"]).date())
        except (ValueError, KeyError):
            pass

    oldest = min(post_dates) if post_dates else today
    span_days = (today - oldest).days

    buckets: Dict[str, int] = {}
    granularity: str

    if span_days <= 30:
        granularity = "day"
        num_buckets = max(7, span_days + 1)
        for i in range(num_buckets):
            buckets[(today - timedelta(days=(num_buckets - 1 - i))).isoformat()] = 0
        for pd in post_dates:
            key = pd.isoformat()
            if key in buckets:
                buckets[key] += 1

    elif span_days <= 365:
        granularity = "week"
        num_weeks = min(16, span_days // 7 + 2)
        week_start_today = today - timedelta(days=today.weekday())  # Monday of current week
        for i in range(num_weeks):
            ws = week_start_today - timedelta(weeks=(num_weeks - 1 - i))
            buckets[ws.isoformat()] = 0
        for pd in post_dates:
            ws = (pd - timedelta(days=pd.weekday())).isoformat()
            if ws in buckets:
                buckets[ws] += 1

    else:
        granularity = "month"
        num_months = min(24, span_days // 30 + 2)
        total_months_today = today.year * 12 + (today.month - 1)
        for i in range(num_months):
            tm = total_months_today - (num_months - 1 - i)
            y, m0 = divmod(tm, 12)
            buckets[date(y, m0 + 1, 1).isoformat()] = 0
        for pd in post_dates:
            key = date(pd.year, pd.month, 1).isoformat()
            if key in buckets:
                buckets[key] += 1

    trend = [TrendPoint(date=d, count=buckets[d]) for d in sorted(buckets.keys())]

    # 4) Common phrasing (MVP placeholder)
    common_phrases = [
        "rent is too high",
        "unaffordable housing",
        "cost of living is rising",
        "prices keep going up",
    ]

    # 5) Examples (top 5)
    examples = [
        Example(
            id=p["id"],
            text=p["text"],
            similarity=round(p["similarity"], 2),
            created_at=p["created_at"],
            upvotes=p.get("upvotes", 0),
            downvotes=p.get("downvotes", 0),
        )
        for p in scored_posts[:5]
    ]

    # 6) The closest existing post (if any) is what Allow/Block votes attach to.
    top_match: Optional[TopMatch] = None
    if scored_posts:
        best = scored_posts[0]
        ip = get_client_ip(request)
        ip_hash = hashlib.sha256(ip.encode()).hexdigest()
        top_match = TopMatch(
            id=best["id"],
            text=best["text"],
            created_at=best["created_at"],
            similarity=round(best["similarity"], 2),
            allow_votes=best.get("upvotes", 0),
            block_votes=best.get("downvotes", 0),
            status="active",
            user_vote=get_vote(post_id=best["id"], ip_hash=ip_hash),
        )

    return AllowedResponse(
        top_match=top_match,
        similar_count=len(scored_posts),
        similarity_threshold=threshold,
        trend=trend,
        trend_granularity=granularity,
        common_phrases=common_phrases,
        examples=examples,
    )


@app.post("/post")
@limiter.limit("12/minute")  # ~1 per 5 seconds; moving-window enforces spacing
async def post_only(request: Request, payload: PostOnlyRequest = Body(...)):
    """Persist text (with its embedding) into the searchable corpus."""
    reason = is_low_quality(payload.text)
    if reason:
        return {"status": "rejected", "reason": reason}

    try:
        allowed, reason = await moderate(payload.text)
    except RuntimeError:
        return {"status": "rejected", "reason": "Moderation service unavailable. Please try again later."}
    if not allowed:
        return {"status": "rejected", "reason": reason}

    try:
        embedding = await embed_text(payload.text)
    except RuntimeError:
        return {"status": "rejected", "reason": "Analysis service unavailable. Please try again later."}

    post_id = str(uuid4())
    created_at = _now_utc().isoformat()
    record = {
        "id": post_id,
        "text": payload.text.strip(),
        "location": (payload.location or "").strip() or None,
        "created_at": created_at,
        "embedding": embedding,
    }
    try:
        insert_post(post=record)
    except Exception:
        return {"status": "rejected", "reason": "Could not save your submission. Please try again."}
    return {"status": "ok", "id": post_id, "created_at": created_at}
