import os
from typing import List
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EMBED_MODEL = "text-embedding-3-small"

async def embed_text(text: str) -> List[float]:
    text = text.strip()
    if not text:
        return []
    try:
        resp = await client.embeddings.create(
            model=EMBED_MODEL,
            input=text,
        )
        return resp.data[0].embedding
    except Exception as e:
        raise RuntimeError(f"Embedding request failed: {e}") from e
