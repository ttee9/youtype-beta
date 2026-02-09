from __future__ import annotations

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

import math
from app.embeddings import embed_text
from app.moderation import is_low_quality, moderate
from app.db import init_db, insert_post, fetch_posts  # <-- add

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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# NOTE: We persist posts to SQLite. Avoid relying on in-memory state for anything
# you want to survive server restarts.


@app.on_event("startup")
def _startup() -> None:
    init_db()


class SubmitRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=200)


class PostOnlyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=200)


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

def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _simple_moderation(text: str) -> Optional[RejectedResponse]:
    """
    MVP moderation placeholder:
    - Reject if empty-ish
    - Reject if it contains obvious spammy patterns
    Replace with LLM moderation later.
    """
    t = text.strip().lower()
    if len(t) < 5:
        return RejectedResponse(reason="Please enter at least 5 characters.")
    if "http://" in t or "https://" in t:
        return RejectedResponse(reason="Links are not allowed in the MVP.", policy_category="spam")
    return None


def _tokenize(s: str) -> set[str]:
    # Tiny tokenizer for MVP similarity; embeddings come later
    keep = "".join(ch.lower() if ch.isalnum() else " " for ch in s)
    toks = [w for w in keep.split() if len(w) >= 3]
    return set(toks)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


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

    allowed, reason = moderate(payload.text)
    if not allowed:
        return {"status": "rejected", "reason": reason}

    embedding = embed_text(payload.text)

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

    # Persist to SQLite
    insert_post(post=record)

    # 3) "Similarity" (MVP): Jaccard on tokens
    query_embedding = record["embedding"]
    threshold = 0.78  # good starting point

    scored = []

    # Compare against persisted history (so similarity survives restarts)
    history = fetch_posts(limit=500)
    for p in history:
        if p["id"] == record["id"]:
            continue  # don't compare the post to itself

        sim = cosine_similarity(query_embedding, p.get("embedding") or [])
        print("sim:", sim, "text:", p["text"][:50])

        if sim >= threshold:
            scored.append((sim, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    
    # 4) Trend over last 7 days
    today = _now_utc().date()
    buckets: Dict[str, int] = {}
    for i in range(7):
        d = (today - timedelta(days=(6 - i))).isoformat()
        buckets[d] = 0

    for sim, p in scored:
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
            similarity=round(sim, 2),
            created_at=p["created_at"],
        )
        for sim, p in scored[:5]
    ]

    theme_label = "Semantic theme (MVP)"  # You'll replace this with LLM labeling later

    return AllowedResponse(
        theme_label=theme_label,
        submitted_post=SubmittedPost(
            id=record["id"],
            text=record["text"],
            created_at=record["created_at"],
            similarity=1.0,
        ),
        similar_count=len(scored) + 1,  # Include the submitted post itself in the count
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

    allowed, reason = moderate(payload.text)
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
