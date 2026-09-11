import os
import sys

# Ensure current backend directory is in sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

# Also ensure parent directory is in sys.path if needed
PARENT_DIR = os.path.dirname(CURRENT_DIR)
if PARENT_DIR not in sys.path:
    sys.path.append(PARENT_DIR)

import main

# Base FastAPI ASGI instance
_fastapi_app = main.app

# WSGI compatibility layer for platforms (like Render default) that run 'gunicorn app:app'
try:
    from a2wsgi import ASGIMiddleware
    _wsgi_app = ASGIMiddleware(_fastapi_app)
except ImportError:
    _wsgi_app = None

class UniversalApp:
    """
    Exposes an application callable that dynamically responds to both:
    1. ASGI requests (e.g. Uvicorn: scope, receive, send)
    2. WSGI requests (e.g. standard Gunicorn without UvicornWorker: environ, start_response)
    """
    def __init__(self, asgi_app, wsgi_app):
        self._asgi_app = asgi_app
        self._wsgi_app = wsgi_app

    def __call__(self, *args, **kwargs):
        # WSGI signature: app(environ, start_response)
        if len(args) == 2 and callable(args[1]) and self._wsgi_app is not None:
            return self._wsgi_app(*args, **kwargs)
        # ASGI signature: app(scope, receive, send)
        return self._asgi_app(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._asgi_app, name)

if _wsgi_app is not None:
    app = UniversalApp(_fastapi_app, _wsgi_app)
else:
    app = _fastapi_app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
