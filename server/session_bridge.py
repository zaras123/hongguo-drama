"""Management routes for an existing zhangbaio/hongguo API process."""
import copy
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qsl, urlsplit

import requests
from fastapi import HTTPException, Request


class SessionManager:
    def __init__(self, upstream, config_path, token, http=requests, runner=subprocess.run):
        if not token or len(token) < 16:
            raise ValueError("Set a dedicated HONGGUO_SESSION_TOKEN of at least 16 characters")
        self.upstream = upstream
        self.path = Path(config_path)
        self.token = token
        self.http = http
        self.runner = runner
        self.lock = threading.Lock()
        self.synced_at = None

    def authorize(self, request):
        supplied = request.headers.get("x-session-token", "")
        if not secrets.compare_digest(supplied.encode("utf-8"), self.token.encode("utf-8")):
            raise HTTPException(401, "Invalid session management token")

    def signer(self):
        servers = self.upstream.SIGN_SERVERS
        if len(servers) != 1:
            raise HTTPException(409, "Login sync requires exactly one SIGN_SERVER for the logged-in device")
        return servers[0].rstrip("/")

    def health(self):
        try:
            response = self.http.get(self.signer() + "/", timeout=5)
            return response.status_code == 200 and response.json().get("ready") is True
        except Exception:
            return False

    def status(self):
        headers = self.upstream.CFG.get("session_headers", {})
        query = self.upstream.CFG.get("base_query", {})
        present = all(headers.get(k) and not str(headers[k]).startswith("<")
                      for k in ("cookie", "x-tt-token"))
        device = all(query.get(k) and not str(query[k]).startswith("<")
                     for k in ("iid", "device_id"))
        return {
            "credentials_present": present, "device_present": device,
            "signer_ready": self.health(), "synced_at": self.synced_at,
            "account_verified": False,
            "state": "session_available" if present and device else "login_required",
            "message": "Session presence is not proof of account login; confirm identity in the App.",
        }

    def start(self):
        adb = os.environ.get("ADB")
        device = os.environ.get("ADB_DEVICE")
        if not adb or not device:
            raise HTTPException(409, "Set ADB and ADB_DEVICE on the API host, or open the App on the signing device manually")
        try:
            result = self.runner([adb, "-s", device, "shell", "monkey", "-p",
                                  "com.phoenix.read", "-c",
                                  "android.intent.category.LAUNCHER", "1"],
                                 capture_output=True, text=True, timeout=25,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode != 0 or "Events injected: 1" not in result.stdout:
                raise HTTPException(503, "Unable to launch App; check ADB device and App installation")
        except (OSError, subprocess.TimeoutExpired):
            raise HTTPException(503, "ADB unavailable or timed out") from None
        return {"state": "awaiting_app_login", "message": "Complete login in the App, then sync the session."}

    def capture_config(self, data):
        if not isinstance(data, dict) or data.get("error"):
            raise HTTPException(502, "Signing service did not capture an App request")
        parsed = urlsplit(str(data.get("url", "")))
        if parsed.scheme != "https" or parsed.hostname != self.upstream.CFG["api_host"]:
            raise HTTPException(422, "Captured request host differs from config.json api_host")
        query = dict(parse_qsl(parsed.query))
        raw_headers = data.get("headers")
        if not isinstance(raw_headers, dict):
            raise HTTPException(422, "Captured request has no headers")
        headers = {str(k).lower(): str(v).strip().strip("[]") for k, v in raw_headers.items()}
        required_q = ("device_id", "iid", "aid", "version_code", "version_name")
        required_h = ("cookie", "x-tt-token", "user-agent")
        if any(not query.get(k) or query[k].startswith("<") for k in required_q):
            raise HTTPException(422, "Missing captured device parameters; open a video in the App and sync again")
        if any(not headers.get(k) or headers[k].startswith("<") for k in required_h):
            raise HTTPException(422, "No complete App session captured; finish login and retry")
        cfg = copy.deepcopy(self.upstream.CFG)
        # Do not mix identity fields from a previous device with this capture.
        cfg["base_query"] = {k: query[k] for k in set(cfg["base_query"]) | set(required_q)
                             | {"cdid", "klink_egdi", "update_version_code"} if k in query}
        allowed_headers = set(required_h) | {"x-tt-store-region", "x-tt-store-region-src",
                                            "passport-sdk-version", "sdk-version"}
        cfg["session_headers"] = {k: headers[k] for k in allowed_headers if k in headers}
        return cfg

    def persist(self, cfg):
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".session-", dir=self.path.parent)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(cfg, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def sync(self):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(409, "Session sync already in progress")
        try:
            if getattr(self.upstream, "_pool", None):
                raise HTTPException(409, "Disable DEVICE_POOL_SIZE; account sessions require a single device")
            try:
                response = self.http.get(self.signer() + "/grab", timeout=55)
                response.raise_for_status()
                cfg = self.capture_config(response.json())
            except (requests.RequestException, ValueError):
                raise HTTPException(502, "Session capture failed; check signing service and open the App") from None
            # Share upstream's refresh lock so its automatic refresh cannot overwrite a sync.
            with self.upstream._refresh_lock:
                try:
                    self.persist(cfg)
                except OSError:
                    raise HTTPException(500, "Cannot save config.json; check server directory permissions") from None
                self.upstream.CFG = cfg
                self.upstream._last_refresh = time.time()
                self.synced_at = int(time.time())
            return self.status()
        finally:
            self.lock.release()


def install_routes(app, upstream, config_path, token):
    manager = SessionManager(upstream, config_path, token)

    @app.get("/admin/session")
    def status(request: Request):
        manager.authorize(request)
        return manager.status()

    @app.post("/admin/session/start")
    def start(request: Request):
        manager.authorize(request)
        return manager.start()

    @app.post("/admin/session/sync")
    def sync(request: Request):
        manager.authorize(request)
        return manager.sync()

    return manager
