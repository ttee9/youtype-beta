import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

from dotenv import load_dotenv
from sqlalchemy import Float, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, Mapped, mapped_column
from pgvector.sqlalchemy import Vector

load_dotenv()

EMBEDDING_DIM = 1536  # text-embedding-3-small

engine = create_engine(os.getenv("DATABASE_URL", ""), future=True)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)


def init_db() -> None:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    # Add new columns to existing tables if they don't exist yet
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS latitude FLOAT"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS longitude FLOAT"))
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
                latitude=post.get("latitude"),
                longitude=post.get("longitude"),
                created_at=post["created_at"],
                embedding=post.get("embedding") or None,
            )
        )
        session.commit()


def find_similar_posts(
    *, query_embedding: List[float], threshold: float, exclude_id: str, limit: int = 500
) -> List[Dict[str, Any]]:
    """Return posts with cosine similarity >= threshold, ordered by similarity desc."""
    with session_scope() as session:
        results = (
            session.query(
                Post,
                (1 - Post.embedding.cosine_distance(query_embedding)).label("similarity"),
            )
            .filter(Post.embedding.isnot(None))
            .filter(Post.id != exclude_id)
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
                "latitude": row.Post.latitude,
                "longitude": row.Post.longitude,
                "created_at": row.Post.created_at,
                "similarity": float(row.similarity),
            }
            for row in results
        ]


def fetch_posts(*, limit: int = 500) -> List[Dict[str, Any]]:
    """Return recent posts (for /posts endpoint)."""
    with session_scope() as session:
        rows = (
            session.query(Post)
            .order_by(Post.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "location": r.location,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "created_at": r.created_at,
            }
            for r in rows
        ]
