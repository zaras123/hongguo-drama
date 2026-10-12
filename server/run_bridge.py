"""Run the upstream API with session management routes; never log credentials."""
import argparse
import importlib
import os
from pathlib import Path
import sys

from session_bridge import install_routes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    token = os.environ.get("HONGGUO_SESSION_TOKEN", "")
    if len(token) < 16:
        parser.error("Set HONGGUO_SESSION_TOKEN (at least 16 characters)")
    root = args.upstream.resolve()
    if not (root / "server.py").is_file() or not (root / "config.json").is_file():
        parser.error("Upstream directory must contain server.py and config.json")
    if not os.environ.get("SIGN_SERVER"):
        parser.error("Set SIGN_SERVER to the logged-in device's signing service")
    if os.environ.get("DEVICE_POOL_SIZE", "0") != "0":
        parser.error("Use DEVICE_POOL_SIZE=0 for account sessions")
    sys.path.insert(0, str(root))
    server = importlib.import_module("server")
    install_routes(server.app, server.H, root / "config.json", token)
    import uvicorn
    uvicorn.run(server.app, host=args.host, port=args.port, access_log=False)


if __name__ == "__main__":
    main()
