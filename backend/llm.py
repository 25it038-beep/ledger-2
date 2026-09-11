"""
Optional NVIDIA LLM integration for the Digital Identity System.

Features:
- Reads API key from NVIDIA_API_KEY env var (never hardcoded)
- Simple in-memory cache for faster repeated requests
- POST /api/llm endpoint that accepts a message and returns the model's response
- Graceful fallback when no key is configured
- Does not depend on LLM for news fetching – used only for optional chat/copilot features
"""

import os
import time
import requests
from typing import List, Dict, Any, Optional
from functools import lru_cache

# Cache: last 8 requests keyed by (model, last_message_content)
# size limited; disabled if cache_size <= 0
_CACHE_SIZE = 8

# Model can be overridden via env: NVIDIA_MODEL
DEFAULT_MODEL = os.getenv("NVIDIA_MODEL", "meta/llama-3.2-90b-vision-instruct")

# Endpoint
INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"


def _get_nv_api_key() -> Optional[str]:
    return os.getenv("NVIDIA_API_KEY")


def _is_configured() -> bool:
    return _get_nv_api_key() is not None


def _cached_call(model: str, payload: Dict[str, Any]) -> Optional[Dict]:
    """
    Very small LRU-like cache to avoid repeat calls with same payload.
    We manually manage because we need to include timestamp for freshness.
    """
    key = (model, payload.get("messages", [{}])[-1].get("content", "") if payload.get("messages") else "")
    # We'll just use a simple dict cache with TTL
    cache_attr = "_llm_cache"
    if not hasattr(llm, cache_attr):
        setattr(llm, cache_attr, {})
    cache = getattr(llm, cache_attr)
    ckey = (model, str(payload.get("messages")))
    now = time.time()
    if ckey in cache:
        resp, ts = cache[ckey]
        if now - ts < 300:  # 5 min cache TTL
            return resp
    return None


def _set_cached(model: str, payload: Dict[str, Any], response: Dict) -> None:
    cache_attr = "_llm_cache"
    if not hasattr(llm, cache_attr):
        setattr(llm, cache_attr, {})
    cache = getattr(llm, cache_attr)
    ckey = (model, str(payload.get("messages")))
    # keep only last CACHE_SIZE entries
    if len(cache) >= _CACHE_SIZE:
        # remove oldest
        oldest = next(iter(cache))
        del cache[oldest]
    cache[ckey] = (response, time.time())


def call_llm(messages: List[Dict[str, str]], model: str = DEFAULT_MODEL, temperature: float = 0.2, max_tokens: int = 128) -> Optional[Dict[str, Any]]:
    """
    Call NVIDIA LLM with the given message list.
    Returns the assistant reply dict or None if not configured/error.
    """
    if not _is_configured():
        return None

    # Check cache
    cached = _cached_call(model, {"messages": messages, "temperature": temperature, "max_tokens": max_tokens})
    if cached:
        return cached

    api_key = _get_nv_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    payload = {
        "messages": messages,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": 1,
        "stream": False,
    }

    try:
        resp = requests.post(INVOKE_URL, headers=headers, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # Extract assistant message
        choices = data.get("choices", [])
        if choices and len(choices) > 0:
            reply = choices[0].get("message", {}).get("content", "")
            result = {"reply": reply, "raw": data}
            _set_cached(model, payload, result)
            return result
        return None
    except Exception as e:
        print(f"[LLM] Request failed: {e}")
        return None


# Cache wrapper module attribute (just to hold dict)
_llm_cache = {}  # pragma: no cover


def get_llm_cache() -> dict:
    """Utility for debugging/cache inspection."""
    return _llm_cache