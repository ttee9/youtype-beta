import os
import re
from typing import Optional, Tuple
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Very lightweight PII patterns (MVP)
EMAIL_RE = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w+\b")
PHONE_RE = re.compile(r"\b(\+?\d{1,2}[\s-]?)?(\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b")
URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)

import re
from collections import Counter
from typing import Optional

WORD_RE = re.compile(r"[A-Za-z']+")

def is_low_quality(text: str) -> Optional[str]:
    t = text.strip()
    if len(t) < 10:
        return "Please write a bit more (at least 10 characters)."

    words = [w.lower() for w in WORD_RE.findall(t)]
    if len(words) < 3:
        return "Please write a complete thought (at least 3 words)."

    counts = Counter(words)
    unique = len(counts)

    # Too repetitive (e.g., "blah blah blah blah")
    most_common_word, freq = counts.most_common(1)[0]
    if freq / len(words) >= 0.6:
        return "Please avoid repeated filler words and write a real statement."

    # Too few unique words
    if unique <= 2:
        return "Please write a more specific statement."

    # Looks like keyboard mash / low alphabetic content
    letters = sum(c.isalpha() for c in t)
    if letters / max(1, len(t)) < 0.6:
        return "Please write a normal sentence (avoid random characters)."

    return None


def quick_rules(text: str) -> Optional[str]:
    t = text.strip()
    if len(t) < 3:
        return "Text is too short."
    if len(t) > 1000:
        return "Text is too long (max 1000 characters)."
    if URL_RE.search(t):
        return "Links aren’t allowed right now."
    if EMAIL_RE.search(t) or PHONE_RE.search(t):
        return "Please don’t share personal contact info."
    return None

def moderate(text: str) -> Tuple[bool, Optional[str]]:
    """
    Returns (allowed, reason_if_blocked)
    """
    # 1) Fast checks
    reason = quick_rules(text)
    if reason:
        return False, reason

    # 2) OpenAI Moderation
    try:
        resp = client.moderations.create(
            model="omni-moderation-latest",
            input=text
        )
        r = resp.results[0]
    except Exception as e:
        raise RuntimeError(f"Moderation request failed: {e}") from e

    if r.flagged:
        return False, "This content isn’t allowed."

    return True, None
