"""Offline service fixture for managed process lifecycle tests."""
from types import SimpleNamespace
import threading
from fastapi import FastAPI

app = FastAPI()
H = SimpleNamespace(CFG={"api_host": "api.example.com", "base_query": {}, "session_headers": {}},
                    SIGN_SERVERS=["http://127.0.0.1:1"], _refresh_lock=threading.Lock())

@app.get("/")
def index():
    return {"service": "fixture"}

if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")), access_log=False)
