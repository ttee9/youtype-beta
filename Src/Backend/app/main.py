from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4
import os

from fastapi import FastAPI, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from typing import Union

from app.embeddings import embed_text
from app.moderation import is_low_quality, moderate
from app.db import init_db, insert_post, fetch_posts, find_similar_posts

load_dotenv()

# Rate limiting setup
limiter = Limiter(key_func=get_remote_address)

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
    text: str
    similarity: float
    created_at: str


class TrendPoint(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class PostOut(BaseModel):
    id: str
    text: str
    location: Optional[str] = None
    created_at: str


class PostsResponse(BaseModel):
    count: int
    posts: List[PostOut]


class SubmittedPost(BaseModel):
    """The post created by this /submit call."""
    id: str
    text: str
    created_at: str
    similarity: float = 1.0


class AllowedResponse(BaseModel):
    status: Literal["allowed"] = "allowed"
    theme_label: Optional[str] = None
    submitted_post: SubmittedPost
    similar_count: int
    similarity_threshold: float
    trend_7d: List[TrendPoint]
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

@app.post("/submit", response_model=Union[AllowedResponse, RejectedResponse])
@limiter.limit("10/minute")  # Rate limit: 10 submissions per minute per IP
async def submit(request: Request, payload: SubmitRequest = Body(...)):
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

    # 2) Save the post (submission is now real)
    post_id = str(uuid4())
    created_at = _now_utc().isoformat()
    record = {
        "id": post_id,
        "text": payload.text.strip(),
        "location": (payload.location or "").strip() or None,
        "created_at": created_at,
        "embedding": embedding,
    }

    # Persist to Postgres
    insert_post(post=record)

    # 3) Find similar posts via pgvector cosine similarity
    threshold = 0.78
    scored_posts = find_similar_posts(
        query_embedding=record["embedding"],
        threshold=threshold,
        exclude_id=record["id"],
    )

    # 4) Trend over last 7 days
    today = _now_utc().date()
    buckets: Dict[str, int] = {}
    for i in range(7):
        d = (today - timedelta(days=(6 - i))).isoformat()
        buckets[d] = 0

    for p in scored_posts:
        dt = datetime.fromisoformat(p["created_at"])
        d = dt.date().isoformat()
        if d in buckets:
            buckets[d] += 1

    trend = [TrendPoint(date=d, count=buckets[d]) for d in sorted(buckets.keys())]

    # 5) Common phrasing (MVP placeholder)
    common_phrases = [
        "rent is too high",
        "unaffordable housing",
        "cost of living is rising",
        "prices keep going up",
    ]

    # 6) Examples (top 5)
    examples = [
        Example(
            text=p["text"],
            similarity=round(p["similarity"], 2),
            created_at=p["created_at"],
        )
        for p in scored_posts[:5]
    ]

    theme_label = "Semantic theme (MVP)"

    return AllowedResponse(
        theme_label=theme_label,
        submitted_post=SubmittedPost(
            id=record["id"],
            text=record["text"],
            created_at=record["created_at"],
            similarity=1.0,
        ),
        similar_count=len(scored_posts) + 1,  # Include the submitted post itself in the count
        similarity_threshold=threshold,
        trend_7d=trend,
        common_phrases=common_phrases,
        examples=examples,
    )


@app.post("/post")
@limiter.limit("20/minute")  # Rate limit: 20 posts per minute per IP
async def post_only(request: Request, payload: PostOnlyRequest = Body(...)):
    """Persist text without embeddings/analysis (useful for simple posting)."""
    reason = is_low_quality(payload.text)
    if reason:
        return {"status": "rejected", "reason": reason}

    try:
        allowed, reason = moderate(payload.text)
    except RuntimeError:
        return {"status": "rejected", "reason": "Moderation service unavailable. Please try again later."}
    if not allowed:
        return {"status": "rejected", "reason": reason}

    post_id = str(uuid4())
    created_at = _now_utc().isoformat()
    record = {
        "id": post_id,
        "text": payload.text.strip(),
        "location": (payload.location or "").strip() or None,
        "created_at": created_at,
        "embedding": [],
    }
    insert_post(post=record)
    return {"status": "ok", "id": post_id, "created_at": created_at}
