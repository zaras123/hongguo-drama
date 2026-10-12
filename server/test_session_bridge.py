import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from session_bridge import install_routes


class Reply:
    status_code = 200

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data

    def raise_for_status(self):
        pass


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "config.json"
        self.old = {"api_host": "api.example.com", "base_query": {"device_id": "old", "cdid": "stale"},
                    "session_headers": {"cookie": "old-cookie", "x-tt-token": "old-token"}}
        self.path.write_text(json.dumps(self.old))
        self.upstream = SimpleNamespace(CFG=self.old, SIGN_SERVERS=["http://localhost:8001"],
                                        _pool=None, _refresh_lock=threading.Lock(), _last_refresh=0)
        self.capture = {"url": "https://api.example.com/video?device_id=123&iid=456&aid=8662&version_code=73932&version_name=7.3.9.32",
                        "headers": {"Cookie": "sessionid=secret-cookie", "X-TT-Token": "[secret-token]",
                                    "User-Agent": "com.phoenix.read/73932"}}
        app = FastAPI()
        self.manager = install_routes(app, self.upstream, self.path, "management-secret")
        self.manager.http = SimpleNamespace(get=lambda url, **kwargs: Reply(
            self.capture if url.endswith("/grab") else {"ready": True}))
        self.client = TestClient(app)
        self.headers = {"X-Session-Token": "management-secret"}

    def test_auth_on_every_route(self):
        for method, route in [("GET", ""), ("POST", "/start"), ("POST", "/sync")]:
            result = self.client.request(method, "/admin/session" + route)
            self.assertEqual(result.status_code, 401)

    def test_status_does_not_claim_verified_login_or_expose_secrets(self):
        response = self.client.get("/admin/session", headers=self.headers)
        self.assertFalse(response.json()["account_verified"])
        self.assertNotIn("old-cookie", response.text)
        self.assertNotIn("old-token", response.text)

    def test_sync_updates_live_config_and_disk_without_stale_identity(self):
        response = self.client.post("/admin/session/sync", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        cfg = json.loads(self.path.read_text())
        self.assertEqual(cfg, self.upstream.CFG)
        self.assertEqual(cfg["session_headers"]["x-tt-token"], "secret-token")
        self.assertNotIn("cdid", cfg["base_query"])
        self.assertNotIn("secret-token", response.text)
        self.assertTrue(response.json()["synced_at"])

    def test_failed_capture_preserves_existing_config(self):
        self.capture["headers"].pop("X-TT-Token")
        response = self.client.post("/admin/session/sync", headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(json.loads(self.path.read_text()), self.old)
        self.assertIs(self.upstream.CFG, self.old)

    def test_write_failure_does_not_replace_live_session(self):
        with patch.object(self.manager, "persist", side_effect=OSError("secret-token")):
            response = self.client.post("/admin/session/sync", headers=self.headers)
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("secret-token", response.text)
        self.assertIs(self.upstream.CFG, self.old)

    def test_reject_wrong_host_and_concurrent_sync(self):
        self.capture["url"] = self.capture["url"].replace("api.example.com", "another.example.com")
        self.assertEqual(self.client.post("/admin/session/sync", headers=self.headers).status_code, 422)
        self.manager.lock.acquire()
        try:
            self.assertEqual(self.client.post("/admin/session/sync", headers=self.headers).status_code, 409)
        finally:
            self.manager.lock.release()

    def test_start_requires_device_and_uses_fixed_app(self):
        with patch.dict("os.environ", {"ADB": "", "ADB_DEVICE": ""}):
            self.assertEqual(self.client.post("/admin/session/start", headers=self.headers).status_code, 409)
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout="Events injected: 1")
        self.manager.runner = run
        with patch.dict("os.environ", {"ADB": "adb", "ADB_DEVICE": "emulator-5554"}):
            response = self.client.post("/admin/session/start", headers=self.headers)
        self.assertEqual(response.json()["state"], "awaiting_app_login")
        self.assertIn("com.phoenix.read", calls[0])

    def test_device_pool_cannot_use_account_session(self):
        self.upstream._pool = object()
        self.assertEqual(self.client.post("/admin/session/sync", headers=self.headers).status_code, 409)


if __name__ == "__main__":
    unittest.main()
