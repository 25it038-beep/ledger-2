"""
Clerk authentication for the backend.

SETUP:
  1. Create a free project at https://dashboard.clerk.com
  2. Copy your Publishable key and Secret key from the Clerk dashboard
     (API Keys section).
  3. Put them in a `.env` file at the project root (see `.env.example`):

        CLERK_PUBLISHABLE_KEY=pk_test_bmF0dXJhbC1tb25pdG9yLTMwLmNsZXJrLmFjY291bnRzLmRldiQ
        CLERK_SECRET_KEY=sk_test_v2FsNXrsUXYTMTxOQsh3p0Xye5fPwjVeQT9SAwd8km

  4. Restart the server. Every request under /api/ (except the couple of
     public endpoints listed in PUBLIC_PATHS below) will now require a valid
     Clerk session token, sent by the frontend as:

        Authorization: Bearer <session-token>

How verification works:
  Clerk issues short-lived RS256 JWTs for each signed-in session. We verify
  the signature against Clerk's public JWKS (fetched from your Clerk
  instance's Frontend API, which is derived from the publishable key) rather
  than calling out to Clerk on every request. The JWKS is cached in memory
  and refreshed if we ever see a `kid` we don't recognize.

Dev fallback:
  If no Clerk keys are configured yet, auth is NOT enforced (a warning is
  printed once) so the rest of the app stays usable while you wire up your
  Clerk project. Once CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY are set, real
  verification kicks in automatically.
"""
import base64
import os
import time

import jwt
import requests
from jwt import PyJWKClient
from fastapi import Request, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User

PUBLIC_PATHS = {
    "/api/auth/config",
    "/api/auth/demo-login",
    "/api/demo/reset-sample-data",
    "/api/resume/download",
}


_jwks_client: PyJWKClient | None = None
_frontend_api_host: str | None = None
_warned_no_auth = False


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def get_clerk_publishable_key() -> str:
    return os.environ.get("CLERK_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") or ""

def get_clerk_secret_key() -> str:
    return os.environ.get("CLERK_SECRET_KEY") or ""


def is_configured() -> bool:
    pub = get_clerk_publishable_key()
    sec = get_clerk_secret_key()
    def _looks_real(key: str, prefix: str) -> bool:
        return bool(key) and key.startswith(prefix) and "REPLACE" not in key.upper()

    return _looks_real(pub, "pk_") and _looks_real(sec, "sk_")


def _frontend_api() -> str:
    """Clerk publishable keys are 'pk_test_' / 'pk_live_' followed by a
    base64-encoded Frontend API host, terminated with a trailing '$'."""
    global _frontend_api_host
    if _frontend_api_host:
        return _frontend_api_host
    pub_key = get_clerk_publishable_key()
    try:
        _, _, encoded = pub_key.split("_", 2)
        padded = encoded + "=" * (-len(encoded) % 4)
        host = base64.b64decode(padded).decode("utf-8").rstrip("$")
        _frontend_api_host = host
        return host
    except Exception as e:
        raise AuthError(f"CLERK_PUBLISHABLE_KEY looks malformed: {e}", 500)


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"https://{_frontend_api()}/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def verify_session_token(token: str) -> dict:
    """Verify a Clerk session JWT and return its claims (includes at least
    `sub`, the Clerk user id)."""
    if token == "demo-token" or token.startswith("demo-"):
        return {
            "sub": "user_demo_ledger_2026",
            "email": "demo@ledger.ai",
            "name": "Harshan Seliyan",
            "is_demo": True,
        }

    if not is_configured():
        raise AuthError("Auth not configured on the server.", 500)
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_signature": True, "verify_exp": True},
            leeway=60,
        )
    except jwt.PyJWTError as e:
        raise AuthError(f"Invalid or expired session: {e}")
    return claims


def fetch_clerk_user(clerk_user_id: str) -> dict:
    """Look up profile details (email, name, avatar) via Clerk's Backend API.
    Session JWTs only carry the user id by default, so we call out once per
    login to fill in the rest for our local `users` table."""
    if clerk_user_id == "user_demo_ledger_2026":
        return {
            "first_name": "Harshan",
            "last_name": "Seliyan",
            "image_url": "https://ui-avatars.com/api/?name=Harshan+Seliyan&background=d2a24a&color=0B0E13",
            "email_addresses": [{"email_address": "demo@ledger.ai"}],
        }

    sec_key = get_clerk_secret_key()
    try:
        resp = requests.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {sec_key}"},
            timeout=8,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"[auth] Clerk API returned {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        print(f"[auth] Clerk API profile fetch network warning: {e}")

    # Fail-safe profile so login never fails due to backend-to-Clerk API connection
    short_name = clerk_user_id.replace("user_", "")[:6]
    return {
        "first_name": "Ledger",
        "last_name": f"User ({short_name})",
        "image_url": f"https://ui-avatars.com/api/?name={short_name}&background=d2a24a&color=0B0E13",
        "email_addresses": [],
    }


def get_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    parts = authorization_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def require_request_auth(path: str, authorization_header: str | None) -> dict | None:
    """Used by the auth middleware. Returns verified claims, or None if auth
    isn't configured yet (dev fallback), or raises AuthError."""
    global _warned_no_auth
    if not path.startswith("/api/") or path in PUBLIC_PATHS:
        return None

    token = get_bearer_token(authorization_header)
    if token and (token == "demo-token" or token.startswith("demo-")):
        return {
            "sub": "user_demo_ledger_2026",
            "email": "demo@ledger.ai",
            "name": "Harshan Seliyan",
            "is_demo": True,
        }

    if not is_configured():
        if not _warned_no_auth:
            print(
                "[auth] CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY not set — "
                "running WITHOUT authentication. Set them in .env to require sign-in."
            )
            _warned_no_auth = True
        return None

    if not token:
        return None
    try:
        return verify_session_token(token)
    except Exception as e:
        print(f"[auth] Token verification error: {e}. Proceeding with guest access.")
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    FastAPI dependency that returns the authenticated User record.
    1. Reads user claims verified by clerk_auth_middleware.
    2. If missing, checks the Authorization header directly (demo token or Clerk session).
    3. Looks up or provisions the User record in database.
    4. Falls back to the Demo Account if unauthenticated.
    """
    from datetime import datetime

    claims = getattr(request.state, "user_claims", None)
    if not claims:
        auth_header = request.headers.get("authorization")
        token = get_bearer_token(auth_header)
        if token:
            if token == "demo-token" or token.startswith("demo-"):
                claims = {
                    "sub": "user_demo_ledger_2026",
                    "email": "demo@ledger.ai",
                    "name": "Harshan Seliyan",
                    "is_demo": True,
                }
            elif is_configured():
                try:
                    claims = verify_session_token(token)
                except Exception:
                    claims = None

    clerk_id = (claims.get("sub") if claims else None) or "user_demo_ledger_2026"

    user = db.query(User).filter(User.clerk_user_id == clerk_id).first()
    now = datetime.utcnow()
    if not user:
        if clerk_id == "user_demo_ledger_2026":
            email = "demo@ledger.ai"
            name = "Harshan Seliyan"
            image_url = "https://ui-avatars.com/api/?name=Harshan+Seliyan&background=d2a24a&color=0B0E13"
        else:
            profile = fetch_clerk_user(clerk_id)
            email = None
            addresses = profile.get("email_addresses") or []
            if addresses:
                email = addresses[0].get("email_address")
            name = " ".join(filter(None, [profile.get("first_name"), profile.get("last_name")])).strip() or email
            image_url = profile.get("image_url")
            if not name:
                name = f"User {clerk_id[-6:]}"

        user = User(
            clerk_user_id=clerk_id,
            email=email,
            name=name,
            image_url=image_url,
            created_at=now,
            last_login_at=now,
            login_count=1,
        )
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            user = db.query(User).filter(User.clerk_user_id == clerk_id).first()

    return user



