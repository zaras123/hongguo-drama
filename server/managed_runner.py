"""Own both service processes; pipe EOF also shuts them down when the Bot exits."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    settings = json.loads((root / "service.json").read_text(encoding="utf-8"))
    upstream = root / "upstream"
    env = {**os.environ, "SIGN_SERVER": settings["signServer"], "DEVICE_POOL_SIZE": "0",
           "HONGGUO_SESSION_TOKEN": settings["sessionToken"], "ADMIN_TOKEN": settings["adminToken"],
           "API_KEYS": settings["apiKey"], "APIKEYS_PATH": str(upstream / "apikeys.json"),
           "PYTHONUNBUFFERED": "1", "SIGN_PORT": str(settings["signPort"]),
           "ADB": settings["adbPath"], "ADB_DEVICE": settings["adbDevice"],
           "FRIDA_HOST": settings["fridaHost"], "FRIDA_BIN": settings["fridaBin"]}
    if settings.get("ffmpegDir"):
        env["PATH"] = settings["ffmpegDir"] + os.pathsep + env.get("PATH", "")
    children = []
    stopped = threading.Event()
    def control():
        try:
            for _ in sys.stdin:
                break
        finally:
            stopped.set()
    threading.Thread(target=control, daemon=True).start()
    # Children must not inherit the Bot control pipe, especially on Windows.
    options = {"cwd": upstream, "env": env, "stdin": subprocess.DEVNULL,
               "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
               "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    try:
        if settings["localSigner"]:
            children.append(("signer", subprocess.Popen([sys.executable, str(upstream / "sign_server.py")], **options)))
        bridge = Path(__file__).with_name("run_bridge.py")
        children.append(("api", subprocess.Popen([sys.executable, str(bridge), "--upstream", str(upstream),
                                                "--port", str(settings["port"])], **options)))
        while not stopped.wait(0.5):
            for role, process in children:
                if process.poll() is not None:
                    print(json.dumps({"role": role, "exitCode": process.returncode}), flush=True)
                    return 1
        return 0
    except OSError:
        print(json.dumps({"error": "launch_failed"}), flush=True)
        return 1
    finally:
        for _, process in children:
            if process.poll() is None:
                process.terminate()
        for _, process in children:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    sys.exit(main())
