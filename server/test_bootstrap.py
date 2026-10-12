import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = {name: b"fixture" for name in bootstrap.FILES}
        self.files["config.example.json"] = b'{}'
        self.tree = {"tree": [{"type": "blob", "path": name, "sha": hashlib.sha1(
            b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}
            for name, data in self.files.items()]}

    def fetch(self, url):
        if "git/trees/" in url:
            return json.dumps(self.tree).encode()
        name = url.split(bootstrap.REVISION + "/", 1)[1]
        return self.files[name]

    def install(self, fetch=None, result=0):
        with patch.object(bootstrap.sys, "version_info", (3, 12)), \
             patch.object(bootstrap, "fetch", side_effect=fetch or self.fetch), \
             patch.object(bootstrap, "progress"), \
             patch.object(bootstrap.subprocess, "run", return_value=SimpleNamespace(returncode=result)):
            bootstrap.install(self.root)

    def test_verified_install_preserves_existing_account_config(self):
        upstream = self.root / "upstream"
        upstream.mkdir()
        config = upstream / "config.json"
        config.write_bytes(b'{"session":"keep-private"}')
        self.install()
        self.assertEqual(config.read_bytes(), b'{"session":"keep-private"}')
        self.assertEqual(json.loads((self.root / "ready.json").read_text())["revision"], bootstrap.REVISION)
        for name, data in self.files.items():
            self.assertEqual((upstream / name).read_bytes(), data)
        self.install(fetch=lambda url: self.fail("Complete pinned install should not download again"))
        self.assertEqual(config.read_bytes(), b'{"session":"keep-private"}')

    def test_hash_mismatch_never_replaces_existing_runtime(self):
        upstream = self.root / "upstream"
        upstream.mkdir()
        existing = upstream / "server.py"
        existing.write_bytes(b"old")
        self.files["server.py"] = b"tampered"
        with self.assertRaisesRegex(RuntimeError, "verification failed"):
            self.install()
        self.assertEqual(existing.read_bytes(), b"old")
        self.assertFalse((self.root / "installed.json").exists())
        self.assertFalse((self.root / "ready.json").exists())

    def test_failed_environment_never_marks_ready(self):
        with self.assertRaises(RuntimeError):
            self.install(result=1)
        self.assertFalse((self.root / "ready.json").exists())
        self.assertTrue((self.root / "upstream" / "config.json").is_file())


if __name__ == "__main__":
    unittest.main()
