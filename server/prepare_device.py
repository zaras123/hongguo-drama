"""Prepare an already rooted Android device; no emulator installation or root bypass."""
import argparse
import json
import lzma
import shlex
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

VERSION = "16.7.19"
ARCHES = {"arm64-v8a": "arm64", "armeabi-v7a": "arm", "x86_64": "x86_64", "x86": "x86"}


def prepare(adb, device):
    def call(*args, allow_failure=False):
        result = subprocess.run([adb, "-s", device, *args], capture_output=True, text=True,
                                timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode and not allow_failure:
            raise RuntimeError("ADB 操作失败，请检查设备授权和连接")
        return result.stdout.strip()
    if "package:com.phoenix.read" not in call("shell", "pm", "list", "packages", "com.phoenix.read"):
        raise RuntimeError("设备未安装红果 App，请先 #红果安装App APK路径")
    architecture = ARCHES.get(call("shell", "getprop", "ro.product.cpu.abi"))
    if not architecture:
        raise RuntimeError("设备 CPU 架构暂不支持自动准备 Frida")
    direct_root = "uid=0" in call("shell", "id")
    if not direct_root and "uid=0" not in call("shell", "su", "-c", "id", allow_failure=True):
        raise RuntimeError("设备需要已有 root 权限，请在模拟器设置中开启 root 后重试")
    if call("shell", "pidof", "frida-server", allow_failure=True):
        version = call("shell", "/data/local/tmp/frida-server", "--version", allow_failure=True)
        if version != VERSION:
            raise RuntimeError("已有 frida-server 版本不符，请先处理设备上的旧服务")
        call("forward", "tcp:27042", "tcp:27042")
        return
    print(json.dumps({"progress": "正在下载匹配设备架构的 Frida 16.7.19"}), flush=True)
    url = "https://github.com/frida/frida/releases/download/" + VERSION + "/frida-server-" + VERSION + "-android-" + architecture + ".xz"
    with tempfile.TemporaryDirectory(prefix="hg-frida-") as temporary:
        binary = Path(temporary) / "frida-server"
        with urlopen(Request(url, headers={"User-Agent": "hongguo-yunzai"}), timeout=60) as response:
            binary.write_bytes(lzma.decompress(response.read()))
        call("push", str(binary), "/data/local/tmp/frida-server")
    call("shell", "chmod", "755", "/data/local/tmp/frida-server")
    command = "nohup /data/local/tmp/frida-server >/dev/null 2>&1 &"
    if direct_root:
        call("shell", command)
    else:
        call("shell", "su -c " + shlex.quote(command))
    time.sleep(2)
    if not call("shell", "pidof", "frida-server", allow_failure=True):
        raise RuntimeError("frida-server 未启动，请检查 root 权限和设备架构")
    call("forward", "tcp:27042", "tcp:27042")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", required=True)
    parser.add_argument("--device", required=True)
    args = parser.parse_args()
    try:
        prepare(args.adb, args.device)
        print(json.dumps({"progress": "设备已准备，请发送 #红果启动"}), flush=True)
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "设备准备失败，请检查网络、root 和设备状态"}), flush=True)
        sys.exit(1)
