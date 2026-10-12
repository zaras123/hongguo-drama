"""Install the pinned runtime only, preserving account files and existing settings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

REVISION = "5f8a58d10f48954bc9b6a58c9cd6418bf499feb9"
FILES = ["hongguo.py", "server.py", "sign_server.py", "apikeys.py", "devicepool.py",
         "downloader.py", "safeguards.py", "offline_dl.py", "config.example.json",
         "frida/oracle.js", "frida/offline_decrypt.py", "frida/unwrap_spade.py",
         "frida/oracle.py", "frida/decutil.py", "frida/extract_keybox_pairs.py",
         "web/index.html", "web/admin.html", "README.md", "DEPLOY.md"]


def progress(message):
    print(json.dumps({"progress": message}), flush=True)


def fetch(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "hongguo-yunzai-installer"}), timeout=40) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise RuntimeError("GitHub download failed; check network and retry") from None
            time.sleep(attempt + 1)


def install(root):
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    upstream = root / "upstream"
    manifest_file = root / "installed.json"
    if not manifest_file.exists():
        progress("正在获取固定版本的上游运行文件")
        tree = json.loads(fetch("https://api.github.com/repos/zhangbaio/hongguo/git/trees/" + REVISION + "?recursive=1"))
        entries = {row["path"]: row for row in tree["tree"] if row["type"] == "blob"}
        with tempfile.TemporaryDirectory(prefix=".install-", dir=root) as temporary:
            stage = Path(temporary)
            for name in FILES:
                data = fetch("https://raw.githubusercontent.com/zhangbaio/hongguo/" + REVISION + "/" + name)
                actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                if name not in entries or actual != entries[name]["sha"]:
                    raise RuntimeError("Upstream file verification failed: " + name)
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            upstream.mkdir(exist_ok=True, mode=0o700)
            for name in FILES:
                target = upstream / name
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage / name, target)
        manifest_file.write_text(json.dumps({"revision": REVISION}), encoding="utf-8")
    if not (upstream / "config.json").exists():
        shutil.copyfile(upstream / "config.example.json", upstream / "config.json")
        os.chmod(upstream / "config.json", 0o600)
    venv = root / "venv"
    python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
               "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    if not python.exists():
        progress("正在创建插件专用 Python 环境")
        if subprocess.run([sys.executable, "-m", "venv", str(venv)], timeout=120, **options).returncode:
            raise RuntimeError("Cannot create Python venv; install python3-venv if needed")
    progress("正在安装运行依赖；首次安装可能需要几分钟")
    requirements = Path(__file__).with_name("requirements-managed.txt")
    if subprocess.run([str(python), "-m", "pip", "install", "-r", str(requirements)],
                      timeout=600, **options).returncode:
        raise RuntimeError("Dependency installation failed; check package index/network and retry")
    progress("正在检查 Python 模块导入")
    env = {**os.environ, "SIGN_SERVER": "http://127.0.0.1:18781", "DEVICE_POOL_SIZE": "0"}
    result = subprocess.run([str(python), "-c", "import server; import frida"],
                            cwd=upstream, env=env, timeout=30, **options)
    if result.returncode:
        raise RuntimeError("Runtime import check failed; check upstream dependencies")
    (root / "ready.json").write_text(json.dumps({"revision": REVISION}), encoding="utf-8")
    progress("安装完成，账号配置已保留")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    try:
        install(args.root.resolve())
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Installation failed; check Python, disk and network"}), flush=True)
        sys.exit(1)
