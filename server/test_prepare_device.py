import io
import lzma
import shlex
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import prepare_device


class PrepareDeviceTests(unittest.TestCase):
    def check_branch(self, direct_root):
        calls = []
        pid_calls = 0

        def run(args, **kwargs):
            nonlocal pid_calls
            command = args[3:]
            calls.append(command)
            output = ""
            if command == ["shell", "pm", "list", "packages", "com.phoenix.read"]:
                output = "package:com.phoenix.read"
            elif command == ["shell", "getprop", "ro.product.cpu.abi"]:
                output = "arm64-v8a"
            elif command == ["shell", "id"]:
                output = "uid=0" if direct_root else "uid=2000"
            elif command == ["shell", "su", "-c", "id"]:
                output = "uid=0"
            elif command == ["shell", "pidof", "frida-server"]:
                pid_calls += 1
                output = "1234" if pid_calls > 1 else ""
            return SimpleNamespace(returncode=0, stdout=output)

        with patch.object(prepare_device.subprocess, "run", side_effect=run), \
             patch.object(prepare_device, "urlopen", return_value=io.BytesIO(lzma.compress(b"fixture"))), \
             patch.object(prepare_device.time, "sleep"), patch("builtins.print"):
            prepare_device.prepare("adb", "fixture-device")
        startup = next(item for item in calls if any("nohup" in arg for arg in item))
        remote = " ".join(startup[1:])
        if direct_root:
            self.assertTrue(remote.startswith("nohup /data/local/tmp/frida-server"))
        else:
            self.assertEqual(shlex.split(remote), ["su", "-c", "nohup /data/local/tmp/frida-server >/dev/null 2>&1 &"])
        self.assertIn(["forward", "tcp:27042", "tcp:27042"], calls)

    def test_adb_root_startup(self):
        self.check_branch(True)

    def test_su_startup_passes_complete_command_as_one_argument(self):
        self.check_branch(False)


if __name__ == "__main__":
    unittest.main()
