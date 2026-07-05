import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

from dotenv import load_dotenv
from sqlalchemy import Integer, String, Text, UniqueConstraint, create_engine, func, text
from sqlalchemy.orm import DeclarativeBase, Session, Mapped, mapped_column
from pgvector.sqlalchemy import Vector

load_dotenv()

EMBEDDING_DIM = 1536  # text-embedding-3-small

# A post is blocked once it has at least this many total Allow/Block votes
# and at least this fraction of them are Block votes.
BLOCK_MIN_VOTES = 20
BLOCK_VOTE_RATIO = 0.65

engine = create_engine(os.getenv("DATABASE_URL"), future=True)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    upvotes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    downvotes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active", server_default="active")
    submitter_ip_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("post_id", "ip_hash", name="uq_vote_post_ip"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    ip_hash: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)


def init_db() -> None:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)

    # create_all only creates missing tables; it won't add columns to a
    # "posts" table that already existed before voting was introduced.
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS upvotes INTEGER NOT NULL DEFAULT 0"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS downvotes INTEGER NOT NULL DEFAULT 0"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS submitter_ip_hash VARCHAR"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_posts_submitter_ip_hash ON posts (submitter_ip_hash)"))
        conn.commit()


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def insert_post(*, post: Dict[str, Any]) -> None:
    with session_scope() as session:
        session.add(
            Post(
                id=post["id"],
                text=post["text"],
                location=post.get("location"),
                created_at=post["created_at"],
                embedding=post.get("embedding") or None,
                submitter_ip_hash=post.get("submitter_ip_hash"),
            )
        )
        session.commit()


def find_own_post(*, ip_hash: str, text: str) -> Optional[Dict[str, Any]]:
    """Find a post this same visitor previously submitted with this exact text.

    Used so re-running Search on unchanged text reuses the existing post
    (and its vote tally) instead of creating a duplicate occurrence.
    """
    with session_scope() as session:
        post = (
            session.query(Post)
            .filter(Post.submitter_ip_hash == ip_hash, Post.text == text)
            .order_by(Post.created_at.desc())
            .first()
        )
        if post is None:
            return None
        return {
            "id": post.id,
            "text": post.text,
            "created_at": post.created_at,
            "embedding": post.embedding,
            "upvotes": post.upvotes,
            "downvotes": post.downvotes,
            "status": post.status,
        }


def get_vote(*, post_id: str, ip_hash: str) -> Optional[int]:
    """Return the vote value this ip_hash already cast on this post, if any."""
    with session_scope() as session:
        vote = (
            session.query(Vote)
            .filter(Vote.post_id == post_id, Vote.ip_hash == ip_hash)
            .one_or_none()
        )
        return vote.value if vote else None


def find_similar_posts(
    *, query_embedding: List[float], threshold: float, exclude_id: str, limit: int = 500
) -> List[Dict[str, Any]]:
    """Return active posts with cosine similarity >= threshold, ordered by similarity desc."""
    with session_scope() as session:
        results = (
            session.query(
                Post,
                (1 - Post.embedding.cosine_distance(query_embedding)).label("similarity"),
            )
            .filter(Post.embedding.isnot(None))
            .filter(Post.id != exclude_id)
            .filter(Post.status == "active")
            .filter((1 - Post.embedding.cosine_distance(query_embedding)) >= threshold)
            .order_by(Post.embedding.cosine_distance(query_embedding))
            .limit(limit)
            .all()
        )
        return [
            {
                "id": row.Post.id,
                "text": row.Post.text,
                "location": row.Post.location,
                "created_at": row.Post.created_at,
                "similarity": float(row.similarity),
                "upvotes": row.Post.upvotes,
                "downvotes": row.Post.downvotes,
            }
            for row in results
        ]


def fetch_posts(*, limit: int = 500) -> List[Dict[str, Any]]:
    """Return recent active posts (for /posts endpoint)."""
    with session_scope() as session:
        rows = (
            session.query(Post)
            .filter(Post.status == "active")
            .order_by(Post.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "location": r.location,
                "created_at": r.created_at,
                "upvotes": r.upvotes,
                "downvotes": r.downvotes,
            }
            for r in rows
        ]


def cast_vote(*, post_id: str, ip_hash: str, value: int) -> Optional[Dict[str, Any]]:
    """Record a single Allow(1)/Block(-1) vote for a post from a given ip_hash.

    Each ip_hash may vote on a post exactly once; a repeat attempt does not
    change the recorded vote and is reported back via `already_voted`.
    Returns None if the post doesn't exist.
    """
    with session_scope() as session:
        post = session.get(Post, post_id)
        if post is None:
            return None

        existing = (
            session.query(Vote)
            .filter(Vote.post_id == post_id, Vote.ip_hash == ip_hash)
            .one_or_none()
        )
        already_voted = existing is not None
        if not already_voted:
            session.add(Vote(post_id=post_id, ip_hash=ip_hash, value=value))
            session.flush()

        allow_votes = (
            session.query(func.count())
            .filter(Vote.post_id == post_id, Vote.value == 1)
            .scalar()
        )
        block_votes = (
            session.query(func.count())
            .filter(Vote.post_id == post_id, Vote.value == -1)
            .scalar()
        )
        total_votes = allow_votes + block_votes

        post.upvotes = allow_votes
        post.downvotes = block_votes
        # Blocking is one-way: once a post is blocked it stays blocked, even
        # if later Allow votes would bring the ratio back down.
        if (
            post.status == "active"
            and total_votes >= BLOCK_MIN_VOTES
            and block_votes / total_votes >= BLOCK_VOTE_RATIO
        ):
            post.status = "blocked"

        session.commit()
        return {
            "allow_votes": allow_votes,
            "block_votes": block_votes,
            "total_votes": total_votes,
            "status": post.status,
            "user_vote": existing.value if already_voted else value,
            "already_voted": already_voted,
        }
