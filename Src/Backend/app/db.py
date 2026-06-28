import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

from dotenv import load_dotenv
from sqlalchemy import Integer, String, Text, UniqueConstraint, create_engine, func, text
from sqlalchemy.orm import DeclarativeBase, Session, Mapped, mapped_column
from pgvector.sqlalchemy import Vector

load_dotenv()

EMBEDDING_DIM = 1536  # text-embedding-3-small

# Net downvotes (downvotes - upvotes) at which a post is auto-hidden from feeds.
DOWNVOTE_HIDE_THRESHOLD = 5

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
            )
        )
        session.commit()


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
    """Record or update a vote for a post from a given ip_hash, then recompute counts.

    Returns the updated {upvotes, downvotes, status} or None if the post doesn't exist.
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
        if existing is None:
            session.add(Vote(post_id=post_id, ip_hash=ip_hash, value=value))
        elif existing.value != value:
            existing.value = value
        session.flush()

        upvotes = (
            session.query(func.count())
            .filter(Vote.post_id == post_id, Vote.value == 1)
            .scalar()
        )
        downvotes = (
            session.query(func.count())
            .filter(Vote.post_id == post_id, Vote.value == -1)
            .scalar()
        )

        post.upvotes = upvotes
        post.downvotes = downvotes
        if downvotes - upvotes >= DOWNVOTE_HIDE_THRESHOLD:
            post.status = "hidden"

        session.commit()
        return {"upvotes": post.upvotes, "downvotes": post.downvotes, "status": post.status}
