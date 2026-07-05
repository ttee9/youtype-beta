"""One-time reconciliation for votes cast before Allow/Block votes cascaded
to similar posts (see app.db.cast_vote).

Before that change, a vote only ever touched the single post it was cast
on, so two posts that say the same thing (e.g. "New York is really
expensive" / "New York is too expensive") can have diverged vote tallies
even though a vote on either one would now apply to both.

This script replays every existing vote in the order it was originally
cast and, for each one, fills in the vote it *would* have cascaded to on
that post's current similarity neighbors — but only where that ip_hash
hasn't already voted on the neighbor directly (a real, original vote
always wins over a backfilled one). It then recomputes each post's cached
upvotes/downvotes/status from the resulting vote rows, exactly as
cast_vote does.

Usage:
    python -m scripts.backfill_similar_post_votes            # dry run (default)
    python -m scripts.backfill_similar_post_votes --apply    # write changes
"""
import argparse
import sys

import numpy as np
from sqlalchemy import func

from app.db import BLOCK_MIN_VOTES, BLOCK_VOTE_RATIO, SIMILARITY_THRESHOLD, Post, Vote, session_scope


def build_neighbor_map(active_posts):
    """post_id -> set of other active post ids at/above SIMILARITY_THRESHOLD."""
    ids = [p.id for p in active_posts]
    if len(ids) < 2:
        return {pid: set() for pid in ids}

    mat = np.vstack([np.asarray(p.embedding, dtype=np.float64) for p in active_posts])
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    unit = mat / norms
    sims = unit @ unit.T

    neighbors = {}
    for i, pid in enumerate(ids):
        above = np.where(sims[i] >= SIMILARITY_THRESHOLD)[0]
        neighbors[pid] = {ids[j] for j in above if j != i}
    return neighbors


def reconcile(apply_changes: bool) -> None:
    with session_scope() as session:
        active_posts = (
            session.query(Post.id, Post.embedding)
            .filter(Post.embedding.isnot(None))
            .filter(Post.status == "active")
            .all()
        )
        neighbor_map = build_neighbor_map(active_posts)

        existing_votes = (
            session.query(Vote.id, Vote.post_id, Vote.ip_hash, Vote.value)
            .order_by(Vote.id.asc())
            .all()
        )

        # Seed with every real vote first — an original vote always outranks
        # a backfilled one for the same (post, ip_hash) pair.
        decided = {(v.post_id, v.ip_hash): v.value for v in existing_votes}
        to_insert: list[tuple[str, str, int]] = []

        for v in existing_votes:
            for pid in {v.post_id} | neighbor_map.get(v.post_id, set()):
                key = (pid, v.ip_hash)
                if key not in decided:
                    decided[key] = v.value
                    to_insert.append((pid, v.ip_hash, v.value))

        print(f"Active posts with embeddings: {len(active_posts)}")
        print(f"Existing vote rows:           {len(existing_votes)}")
        print(f"Backfilled vote rows to add:  {len(to_insert)}")

        if not apply_changes:
            print("\nDry run only — pass --apply to write these changes.")
            return

        for pid, ip_hash, value in to_insert:
            session.add(Vote(post_id=pid, ip_hash=ip_hash, value=value))
        session.flush()

        newly_blocked = []
        all_post_ids = [p.id for p in active_posts]
        for post_id in all_post_ids:
            p = session.get(Post, post_id)
            allow_votes = session.query(func.count()).filter(Vote.post_id == post_id, Vote.value == 1).scalar()
            block_votes = session.query(func.count()).filter(Vote.post_id == post_id, Vote.value == -1).scalar()
            total_votes = allow_votes + block_votes

            p.upvotes = allow_votes
            p.downvotes = block_votes
            if (
                p.status == "active"
                and total_votes >= BLOCK_MIN_VOTES
                and block_votes / total_votes >= BLOCK_VOTE_RATIO
            ):
                p.status = "blocked"
                newly_blocked.append(post_id)

        session.commit()
        print(f"Posts recomputed:             {len(all_post_ids)}")
        print(f"Posts newly blocked:          {len(newly_blocked)}")
        if newly_blocked:
            print("  " + ", ".join(newly_blocked))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes (default is dry run).")
    args = parser.parse_args()

    try:
        reconcile(apply_changes=args.apply)
    except Exception as exc:  # surface DB/connection errors plainly
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
