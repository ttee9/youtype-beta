from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import Column, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, Mapped, mapped_column

DB_PATH = os.getenv("DB_PATH", "app.db")
DB_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DB_URL, future=True)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    # store embeddings as JSON text (simple + portable)
    embedding_json: Mapped[str] = mapped_column(Text, nullable=False)


def init_db() -> None:
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
                embedding_json=json.dumps(post.get("embedding", [])),
            )
        )
        session.commit()


def fetch_posts(*, limit: int = 500) -> List[Dict[str, Any]]:
    with session_scope() as session:
        rows = (
            session.query(Post)
            .order_by(Post.created_at.desc())
            .limit(limit)
            .all()
        )

        posts: List[Dict[str, Any]] = []
        for r in rows:
            posts.append(
                {
                    "id": r.id,
                    "text": r.text,
                    "location": r.location,
                    "created_at": r.created_at,
                    "embedding": json.loads(r.embedding_json) if r.embedding_json else [],
                }
            )
        return posts