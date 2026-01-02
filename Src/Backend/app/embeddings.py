import os
from typing import List
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EMBED_MODEL = "text-embedding-3-small"

def embed_text(text: str) -> List[float]:
    text = text.strip()
    if not text:
        return []
    resp = client.embeddings.create(
        model=EMBED_MODEL,
        input=text,
    )
    return resp.data[0].embedding
