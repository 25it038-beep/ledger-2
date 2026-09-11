import os

# Use Uvicorn's asynchronous worker to serve FastAPI directly
worker_class = "uvicorn.workers.UvicornWorker"

# Render provides the port in the PORT environment variable (defaults to 10000 on Render)
port = os.environ.get("PORT", "10000")
bind = f"0.0.0.0:{port}"

# Concurrency & timeout settings
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
timeout = 120
keepalive = 5
