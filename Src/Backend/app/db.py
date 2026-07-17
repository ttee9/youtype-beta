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

# Posts at or above this cosine similarity are treated as saying "the same
# thing" for both search matching and community moderation — an Allow/Block
# vote on one of them is cast on all of them.
SIMILARITY_THRESHOLD = 0.78

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

    # create_all only creates missing tables; it won't add columns to a
    # "posts" table that already existed before voting was introduced.
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS upvotes INTEGER NOT NULL DEFAULT 0"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS downvotes INTEGER NOT NULL DEFAULT 0"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'"))
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
            )
        )
        session.commit()


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


def fetch_posts_admin(*, query: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Return posts regardless of status, optionally filtered by a text
    substring. Admin/dev tooling only — unlike fetch_posts, this doesn't
    filter to status == "active"."""
    with session_scope() as session:
        q = session.query(Post)
        if query:
            q = q.filter(Post.text.ilike(f"%{query}%"))
        rows = q.order_by(Post.created_at.desc()).limit(limit).all()
        return [
            {
                "id": r.id,
                "text": r.text,
                "location": r.location,
                "created_at": r.created_at,
                "upvotes": r.upvotes,
                "downvotes": r.downvotes,
                "status": r.status,
            }
            for r in rows
        ]


def set_post_status(*, post_id: str, status: str) -> Optional[Dict[str, Any]]:
    """Directly override a post's status. Admin/dev tooling only — bypasses
    the vote-threshold logic in cast_vote(), so it doesn't touch vote
    tallies and can be re-flipped by a later vote if the threshold is
    already met.
    """
    with session_scope() as session:
        post = session.get(Post, post_id)
        if post is None:
            return None
        post.status = status
        session.commit()
        return {
            "id": post.id,
            "text": post.text,
            "location": post.location,
            "created_at": post.created_at,
            "upvotes": post.upvotes,
            "downvotes": post.downvotes,
            "status": post.status,
        }


def cast_vote(*, post_id: str, ip_hash: str, value: int) -> Optional[Dict[str, Any]]:
    """Record an Allow(1)/Block(-1) vote from a given ip_hash on a post and
    every other active post similar enough to count as the same statement.

    Each ip_hash has at most one vote per post; casting again with a
    different value switches it (and switches it on every similar post this
    ip_hash already voted on, so a single switch stays consistent across the
    cluster). Returns None if the post doesn't exist.
    """
    with session_scope() as session:
        post = session.get(Post, post_id)
        if post is None:
            return None

        affected_ids = [post_id]
        if post.embedding is not None:
            similar = (
                session.query(Post.id)
                .filter(Post.embedding.isnot(None))
                .filter(Post.id != post_id)
                .filter(Post.status == "active")
                .filter((1 - Post.embedding.cosine_distance(post.embedding)) >= SIMILARITY_THRESHOLD)
                .all()
            )
            affected_ids.extend(row.id for row in similar)

        existing_votes = {
            row.post_id: row
            for row in session.query(Vote).filter(
                Vote.post_id.in_(affected_ids), Vote.ip_hash == ip_hash
            )
        }
        already_voted = post_id in existing_votes

        for pid in affected_ids:
            existing = existing_votes.get(pid)
            if existing is None:
                session.add(Vote(post_id=pid, ip_hash=ip_hash, value=value))
            elif existing.value != value:
                existing.value = value
        session.flush()

        result: Optional[Dict[str, Any]] = None
        for pid in affected_ids:
            p = session.get(Post, pid)
            allow_votes = (
                session.query(func.count())
                .filter(Vote.post_id == pid, Vote.value == 1)
                .scalar()
            )
            block_votes = (
                session.query(func.count())
                .filter(Vote.post_id == pid, Vote.value == -1)
                .scalar()
            )
            total_votes = allow_votes + block_votes

            p.upvotes = allow_votes
            p.downvotes = block_votes
            # Status is a pure function of the current tallies, recomputed on
            # every vote — a post can move back to active if the ratio drops
            # below the threshold again (e.g. votes get switched), not just
            # toward blocked.
            if total_votes >= BLOCK_MIN_VOTES and block_votes / total_votes >= BLOCK_VOTE_RATIO:
                p.status = "blocked"
            else:
                p.status = "active"

            if pid == post_id:
                result = {
                    "allow_votes": allow_votes,
                    "block_votes": block_votes,
                    "total_votes": total_votes,
                    "status": p.status,
                    "user_vote": value,
                    "already_voted": already_voted,
                    "affected_count": len(affected_ids),
                }

        session.commit()
        return result
