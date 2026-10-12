"""Offline service fixture for managed process lifecycle tests."""
from types import SimpleNamespace
import threading
from fastapi import FastAPI

app = FastAPI()
H = SimpleNamespace(CFG={"api_host": "api.example.com", "base_query": {}, "session_headers": {}},
                    SIGN_SERVERS=["http://127.0.0.1:1"], _refresh_lock=threading.Lock())
