from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from typing import Union

import math
from app.embeddings import embed_text
from app.moderation import is_low_quality, moderate
from app.db import init_db, insert_post, fetch_posts  # <-- add

app = FastAPI(title="Semantic Theme MVP API")

# Allow your Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- In-memory store (MVP). Replace with Postgres later.
POSTS: List[Dict[str, Any]] = []


@app.on_event("startup")
def _startup() -> None:
    init_db()


class SubmitRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=200)


class Example(BaseModel):
    text: str
    similarity: float
    created_at: str


class TrendPoint(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class AllowedResponse(BaseModel):
    status: Literal["allowed"] = "allowed"
    theme_label: Optional[str] = None
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
def get_posts():
    """Return all stored posts (persisted)."""
    posts = fetch_posts(limit=500)
    return {"count": len(posts), "posts": posts}

@app.post("/submit", response_model=Union[AllowedResponse, RejectedResponse])
def submit(payload: SubmitRequest):
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

    # Optional: keep in-memory behavior for similarity in this request
    POSTS.append(record)

    # 3) "Similarity" (MVP): Jaccard on tokens
    query_embedding = record["embedding"]
    threshold = 0.78  # good starting point

    scored = []

    for p in POSTS:
        if p["id"] == record["id"]:
            continue  # don't compare the post to itself

        sim = cosine_similarity(query_embedding, p["embedding"])
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

    theme_label = "Semantic theme (MVP)"  # You’ll replace this with LLM labeling later

    return AllowedResponse(
        theme_label=theme_label,
        similar_count=len(scored),
        similarity_threshold=threshold,
        trend_7d=trend,
        common_phrases=common_phrases,
        examples=examples,
    )
