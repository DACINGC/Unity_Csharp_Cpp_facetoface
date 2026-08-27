#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""面试 MD 文档查看器 —— 本地服务端（仅用 Python 标准库，零依赖）。

用法:
    python mdviewer.py                # 默认端口 8765，默认根目录为脚本所在目录（含 面试知识整理/*.md 与 note、笔记 下的 txt）
    python mdviewer.py --port 9000    # 指定端口
    python mdviewer.py --root D:/docs # 指定文档根目录
    python mdviewer.py --no-browser   # 不自动打开浏览器
    python mdviewer.py --daemon       # 后台分离进程启动（关闭控制台不影响服务，start_viewer.bat 默认走此模式）

提供九个接口:
    GET  /                      -> 返回前端页面 md_viewer/index.html
    GET  /api/index             -> JSON 文件列表 + 标题树 + 章节编号映射（sections，带 mtime 缓存）
    GET  /api/file?path=..      -> JSON 文件内容（path 为相对根目录的路径，防路径穿越）
    GET  /api/search?q=..       -> JSON 全文搜索结果（文件 + 命中行 + 最近小节锚点）
    GET  /api/service/status    -> JSON 服务状态（pid/端口/运行时长/文档目录等，兼作前端探活）
    POST /api/save              -> 保存文件（JSON body: {path, content}，按原编码回写，写前备份 .bak）
    POST /api/open              -> 在系统文件管理器中定位文件（JSON body: {path}，仅本机）
    POST /api/service/restart   -> 重启服务：派生分离的新进程接管端口后，当前进程退出
    POST /api/service/shutdown  -> 关闭服务：应答后优雅退出进程

后台模式说明:
    --daemon  父进程派生一个带 --child 标记的分离子进程后立刻退出；子进程无控制台窗口，
              关闭任何控制台都不会终止服务。子进程绑定端口成功后自动打开浏览器。
    --child   内部标记（勿手动使用）：分离的服务进程；绑定端口时若被旧进程占用会重试约 15 秒，
              并写入 mdviewer.pid / mdviewer.log 便于排查。
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP_NAME = "面试 MD 文档查看器"
APP_VERSION = "1.1.0"
DEFAULT_PORT = 8765
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = SCRIPT_DIR
PID_FILE = os.path.join(SCRIPT_DIR, "mdviewer.pid")
LOG_FILE = os.path.join(SCRIPT_DIR, "mdviewer.log")

_START_TIME = time.time()  # 进程启动时间（用于运行时长统计）
_PORT = DEFAULT_PORT       # 实际监听端口（main 中更新）
_DETACHED = False          # 是否为 --child 分离服务进程
_HTTPD = None              # 全局 HTTPServer 实例（供 shutdown/restart 使用）

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)")
FENCE_RE = re.compile(r"^```(\w*)\s*$")


def read_text_enc(path):
    """读取文件并返回 (内容, 编码)。编码顺序：BOM 嗅探 → UTF-8 → GBK → latin-1。
    newline="" 保持原始换行符（\\r\\n / \\n），保证编辑保存后行尾不变。"""
    try:
        with open(path, "rb") as f:
            head = f.read(3)
    except OSError:
        return "", "utf-8"
    if head.startswith(b"\xef\xbb\xbf"):
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            return f.read(), "utf-8-sig"
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                return f.read(), enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return "", "utf-8"


def read_text(path):
    """按 UTF-8 -> GBK -> latin-1 顺序尝试读取，避免 Windows 记事本 ANSI 文件乱码。"""
    return read_text_enc(path)[0]


def slugify(text):
    """把标题文本转成可用于锚点的字符串（保留中文与数字字母，其余转连字符）。"""
    text = re.sub(r"[`*_~>#]", "", text).strip()
    text = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "section"


def extract_headings(text):
    """提取 md 文本中的 # ~ #### 标题，返回 [{level, text, number, anchor}]。"""
    headings = []
    used = set()
    for line in text.splitlines():
        m = HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        raw = m.group(2).strip()
        # 去掉行内强调标记（保留 #，如 "C#"），得到干净的标题文本
        text_clean = re.sub(r"[`*_~>]", "", raw).strip()
        num_m = NUMBER_RE.match(text_clean)
        number = num_m.group(1) if num_m else ""
        if number:
            # 编号单独存到 number 字段，正文不再重复带编号
            text_clean = text_clean[len(number):].strip()
        anchor = number if number else slugify(text_clean)
        base, i = anchor, 2
        while anchor in used:
            anchor = f"{base}-{i}"
            i += 1
        used.add(anchor)
        headings.append({"level": level, "text": text_clean,
                         "number": number, "anchor": anchor})
    return headings


def file_title(content, fallback):
    """取第一个 # 一级标题作为文件标题。"""
    for line in content.splitlines():
        m = HEADING_RE.match(line)
        if m and len(m.group(1)) == 1:
            return re.sub(r"[`*_~>]", "", m.group(2)).strip()
    return fallback


def build_index(root):
    """扫描根目录下所有 .md / .txt，构建前端所需的索引。"""
    files = []
    sections = {}  # 章节编号 -> {path, anchor}，重复编号首现优先
    for rel in iter_docs(root):
        full = os.path.join(root, rel)
        ext = os.path.splitext(rel)[1].lower()
        content = read_text(full)
        if ext == ".md":
            headings = extract_headings(content)
            for h in headings:
                if h["number"] and h["number"] not in sections:
                    sections[h["number"]] = {"path": rel, "anchor": h["anchor"]}
            files.append({
                "type": "md",
                "path": rel,
                "name": os.path.basename(full),
                "title": file_title(content, os.path.basename(full)),
                "headings": headings,
            })
        else:
            files.append({
                "type": "txt",
                "path": rel,
                "name": os.path.basename(full),
                "title": os.path.basename(full),
                "headings": [],
            })
    files.sort(key=lambda f: (f["type"] != "md", f["path"]))
    return {"files": files, "sections": sections}


# ---------- 索引缓存：文件数 + 最大 mtime 做失效签名，避免每次请求全量重读 ----------
_index_lock = threading.Lock()
_index_cache = {"sig": None, "data": None}


def index_signature(root):
    """轻量签名：仅遍历目录统计文件数与最新修改时间，不读取文件内容。"""
    n = 0
    mt = 0.0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in (".md", ".txt"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
            if rel.startswith("md_viewer/") or rel == "README.md":
                continue
            n += 1
            try:
                mt = max(mt, os.path.getmtime(os.path.join(dirpath, fn)))
            except OSError:
                pass
    return (n, mt)


def get_index(root):
    with _index_lock:
        sig = index_signature(root)
        if _index_cache["sig"] != sig:
            _index_cache["sig"] = sig
            _index_cache["data"] = build_index(root)
        return _index_cache["data"]


def iter_docs(root):
    """遍历根目录下所有 .md / .txt 的相对路径（跳过工具自身文件）。"""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in sorted(filenames):
            ext = os.path.splitext(fn)[1].lower()
            if ext not in (".md", ".txt"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
            if rel.startswith("md_viewer/") or rel == "README.md":
                continue
            yield rel


def search_text(root, query, per_file=5, max_files=30):
    """全文搜索：返回 [{path,name,type,title,matches:[{line,text,anchor}]}]。

    - 大小写不敏感；命中行带行号与"该行所属的最近小节锚点"（md 才有）。
    - 每文件最多 per_file 个命中，最多 max_files 个文件，避免结果过大。
    """
    q = query.strip().lower()
    if not q:
        return []
    results = []
    for rel in iter_docs(root):
        full = os.path.join(root, rel)
        content = read_text(full)
        if q not in content.lower():
            continue
        ext = os.path.splitext(rel)[1].lower()
        is_md = ext == ".md"
        matches = []
        anchor = ""  # 当前行所属的最近小节锚点
        for idx, line in enumerate(content.splitlines(), 1):
            if is_md:
                m = HEADING_RE.match(line)
                if m:
                    clean = re.sub(r"[`*_~>]", "", m.group(2)).strip()
                    num_m = NUMBER_RE.match(clean)
                    anchor = num_m.group(1) if num_m else slugify(clean)
            if q in line.lower():
                matches.append({"line": idx, "text": line.strip()[:200], "anchor": anchor})
                if len(matches) >= per_file:
                    break
        if matches:
            results.append({
                "path": rel,
                "name": os.path.basename(full),
                "type": "md" if is_md else "txt",
                "title": file_title(content, os.path.basename(full)) if is_md else os.path.basename(full),
                "matches": matches,
            })
            if len(results) >= max_files:
                break
    return results


# ---------- 服务控制：状态 / 重启 / 关闭 / 分离进程 ----------
def service_info():
    """服务状态（兼作前端探活接口）。"""
    return {
        "ok": True,
        "app": APP_NAME,
        "version": APP_VERSION,
        "pid": os.getpid(),
        "port": _PORT,
        "root": ViewerHandler.root,
        "url": f"http://127.0.0.1:{_PORT}",
        "python": sys.executable,
        "platform": sys.platform,
        "detached": _DETACHED,
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(_START_TIME)),
        "uptime_sec": round(max(0.0, time.time() - _START_TIME), 1),
    }


def write_pid_file():
    """记录当前服务进程号与端口，便于外部脚本查看/管理。"""
    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": _PORT,
                       "started_at": int(_START_TIME)}, f, ensure_ascii=False)
    except OSError:
        pass


def remove_pid_file():
    """删除 PID 文件——仅当文件记录的是本进程时才删。

    重启时新进程可能已先写入自己的 PID，旧进程退出清理不能误删。"""
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            owner = json.load(f)
        if int(owner.get("pid", -1)) != os.getpid():
            return
        os.remove(PID_FILE)
    except (OSError, ValueError, TypeError):
        pass


def spawn_detached_child(port, root, open_browser=False):
    """派生一个与控制台完全分离的新服务进程（Windows 无窗口；关闭控制台不影响它）。

    子进程带 --child 标记：绑定端口时若被当前（旧）进程占用会自动重试，
    从而实现「先起新进程、再退旧进程」的平滑重启。
    """
    cmd = [sys.executable, os.path.abspath(__file__),
           "--port", str(port), "--root", root, "--child"]
    if not open_browser:
        cmd.append("--no-browser")
    try:
        log = open(LOG_FILE, "ab")  # 子进程输出进日志，避免无窗口时报错丢失
    except OSError:
        log = subprocess.DEVNULL
    kwargs = dict(cwd=SCRIPT_DIR, stdin=subprocess.DEVNULL,
                  stdout=log, stderr=subprocess.STDOUT, close_fds=True)
    if sys.platform == "win32":
        # DETACHED_PROCESS：不关联任何控制台（无窗口、控制台关闭不受影响）
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS
                                   | subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    finally:
        if log is not subprocess.DEVNULL:
            try:
                log.close()
            except OSError:
                pass
    return proc


def schedule_shutdown(delay=0.6):
    """延迟关闭 HTTP 服务（须在 serve_forever 线程之外调用）。"""
    def _later():
        time.sleep(delay)
        if _HTTPD is not None:
            _HTTPD.shutdown()
    threading.Thread(target=_later, daemon=True).start()


def probe_running_service(port):
    """探测端口上是否已有本服务在运行；是则返回其状态 dict，否则 None。"""
    try:
        with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/service/status", timeout=1.2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and data.get("ok") and data.get("app") == APP_NAME:
                return data
    except Exception:
        pass
    return None


def port_in_use(port):
    """仅检测端口是否被监听（用于区分「旧版本服务/其他程序占用」）。"""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


class ViewerHTTPServer(ThreadingHTTPServer):
    """在 Windows 上禁用 SO_REUSEADDR。

    Windows 的 SO_REUSEADDR 允许两个进程同时绑定同一端口（静默双实例），
    会让「端口占用检测 / 重启接管 / 防重复启动」全部失效；
    禁用后端口被占用时绑定会抛 WSAEADDRINUSE(10048)，
    --child 的绑定重试因此能可靠等待旧进程释放端口。
    非 Windows 平台保留默认值，容忍 TIME_WAIT 场景下的快速重启。
    """
    allow_reuse_address = False if sys.platform == "win32" else True


class ViewerHandler(BaseHTTPRequestHandler):
    root = DEFAULT_ROOT

    def handle_error(self, request, client_address):
        """忽略浏览器常规断连（如关闭页面），避免这些噪音刷屏日志文件。"""
        _, exc, _ = sys.exc_info()
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)

    # ---- 工具 ----
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, content_type):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _safe_relpath(self, rel):
        """校验相对路径位于根目录内，返回绝对路径；非法返回 None。"""
        root_real = os.path.realpath(self.root)
        full = os.path.realpath(os.path.join(root_real, rel))
        if os.path.commonpath([root_real, full]) != root_real:
            return None
        return full

    # ---- 路由 ----
    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/" or parsed.path == "/index.html":
                self._serve_app()
            elif parsed.path == "/renderer.js":
                self._serve_asset("renderer.js", "application/javascript; charset=utf-8")
            elif parsed.path == "/api/index":
                self._send_json(get_index(self.root))
            elif parsed.path == "/api/search":
                q = parse_qs(parsed.query).get("q", [""])[0]
                self._send_json({"q": q, "results": search_text(self.root, q)})
            elif parsed.path == "/api/service/status":
                self._send_json(service_info())
            elif parsed.path == "/api/file":
                self._serve_file(parse_qs(parsed.query))
            else:
                self.send_error(404, "Not Found")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # 任何异常都给前端一个可读的错误，而不是断连
            try:
                self._send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)
            except Exception:
                pass

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/save":
                self._save_file()
            elif parsed.path == "/api/open":
                self._open_in_folder()
            elif parsed.path == "/api/service/restart":
                self._restart_service()
            elif parsed.path == "/api/service/shutdown":
                self._shutdown_service()
            else:
                self.send_error(404, "Not Found")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            try:
                self._send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)
            except Exception:
                pass

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    def _save_file(self):
        """保存文件：按原编码回写（保持行尾），写前覆盖式备份 .bak。"""
        payload = self._read_json_body()
        rel = str(payload.get("path", ""))
        content = payload.get("content")
        if not isinstance(content, str):
            self._send_json({"error": "缺少 content"}, 400)
            return
        full = self._safe_relpath(rel)
        if full is None:
            self._send_json({"error": "非法的路径"}, 400)
            return
        ext = os.path.splitext(full)[1].lower()
        if ext not in (".md", ".txt"):
            self._send_json({"error": "仅支持 .md / .txt 文件"}, 400)
            return
        if not os.path.isfile(full):
            self._send_json({"error": f"文件不存在: {rel}"}, 404)
            return
        _, enc = read_text_enc(full)
        try:
            shutil.copy2(full, full + ".bak")  # 写前备份
        except OSError:
            pass
        try:
            with open(full, "w", encoding=enc, newline="") as f:
                f.write(content)
        except UnicodeEncodeError:
            self._send_json(
                {"error": f"内容包含无法用原编码 {enc} 保存的字符，请先改源文件编码"}, 400)
            return
        self._send_json({"ok": True, "encoding": enc})

    def _open_in_folder(self):
        """在系统文件管理器中定位文件（仅本机使用）。"""
        payload = self._read_json_body()
        rel = str(payload.get("path", ""))
        full = self._safe_relpath(rel)
        if full is None or not os.path.exists(full):
            self._send_json({"error": "非法的路径"}, 400)
            return
        target = full if os.path.isdir(full) else os.path.dirname(full)
        try:
            if sys.platform == "win32":
                os.startfile(target)
            elif sys.platform == "darwin":
                import subprocess
                subprocess.Popen(["open", target])
            else:
                import subprocess
                subprocess.Popen(["xdg-open", target])
            self._send_json({"ok": True})
        except OSError as exc:
            self._send_json({"error": f"无法打开文件管理器: {exc}"}, 500)

    def _restart_service(self):
        """重启：先派生分离的新进程（它会等本进程释放端口后接管），应答后再退出本进程。"""
        global _PORT
        try:
            proc = spawn_detached_child(_PORT, self.root, open_browser=False)
        except OSError as exc:
            self._send_json({"error": f"无法派生新服务进程: {exc}"}, 500)
            return
        self._send_json({"ok": True, "old_pid": os.getpid(), "new_pid": proc.pid})
        schedule_shutdown(0.8)

    def _shutdown_service(self):
        """关闭：先应答前端，再优雅退出进程。"""
        self._send_json({"ok": True, "pid": os.getpid(), "message": "服务正在关闭"})
        schedule_shutdown(0.5)

    def _serve_asset(self, name, content_type):
        path = os.path.realpath(os.path.join(SCRIPT_DIR, "md_viewer", name))
        if os.path.commonpath([os.path.realpath(SCRIPT_DIR), path]) != os.path.realpath(SCRIPT_DIR):
            self._send_json({"error": "非法的路径"}, 400)
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                self._send_text(f.read(), content_type)
        except OSError:
            self._send_text("", content_type)

    def _serve_app(self):
        app = os.path.join(SCRIPT_DIR, "md_viewer", "index.html")
        try:
            with open(app, "r", encoding="utf-8") as f:
                self._send_text(f.read(), "text/html; charset=utf-8")
        except OSError:
            self._send_text("缺少前端文件 md_viewer/index.html", "text/plain; charset=utf-8")

    def _serve_file(self, query):
        rel = query.get("path", [""])[0]
        if not rel:
            self._send_json({"error": "缺少 path 参数"}, 400)
            return
        full = self._safe_relpath(rel)
        if full is None:
            self._send_json({"error": "非法的路径"}, 400)
            return
        if not os.path.isfile(full):
            self._send_json({"error": f"文件不存在: {rel}"}, 404)
            return
        ext = os.path.splitext(full)[1].lower()
        if ext not in (".md", ".txt"):
            self._send_json({"error": "仅支持 .md / .txt 文件"}, 400)
            return
        self._send_json({
            "path": rel,
            "name": os.path.basename(full),
            "type": "md" if ext == ".md" else "txt",
            "content": read_text(full),
        })

    # 静默访问日志
    def log_message(self, fmt, *args):
        if os.environ.get("MDVIEWER_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    global _PORT, _DETACHED, _HTTPD

    ap = argparse.ArgumentParser(description=APP_NAME)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}）")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="文档根目录（默认：脚本所在目录，含 面试知识整理 下的 md 与 note、笔记 下的 txt）")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--daemon", action="store_true",
                    help="后台模式：派生一个与控制台分离的服务进程后立刻退出（关闭控制台不影响服务）")
    ap.add_argument("--child", action="store_true",
                    help=argparse.SUPPRESS)  # 内部标记：分离的服务进程（由 --daemon / 重启接口派生）
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"[错误] 根目录不存在: {root}")
        sys.exit(1)

    # Windows 控制台输出 UTF-8，避免中文乱码
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    url = f"http://127.0.0.1:{args.port}"

    # ---- 后台模式：派生分离子进程后退出，服务不再依附任何控制台窗口 ----
    if args.daemon:
        running = probe_running_service(args.port)
        if running:
            print(f"{APP_NAME} 已在后台运行（PID {running.get('pid')}，端口 {args.port}）")
            print(f"  访问地址: {url}")
            if not args.no_browser:
                webbrowser.open(url)
            return
        if port_in_use(args.port):
            print(f"[错误] 端口 {args.port} 已被其他程序占用，请换端口: python {os.path.basename(__file__)} --daemon --port 9000")
            sys.exit(1)
        try:
            proc = spawn_detached_child(args.port, root, open_browser=not args.no_browser)
        except OSError as exc:
            print(f"[错误] 无法启动后台服务进程: {exc}")
            sys.exit(1)
        print(f"{APP_NAME} 已在后台启动（PID {proc.pid}）")
        print(f"  文档目录: {root}")
        print(f"  访问地址: {url}")
        print(f"  日志文件: {LOG_FILE}")
        print(f"  提示: 本窗口可直接关闭；在页面右上角「服务」菜单中可重启 / 关闭服务")
        return

    _PORT = args.port
    _DETACHED = bool(args.child)
    ViewerHandler.root = root

    # ---- 绑定端口：分离子进程（重启/守护场景）需等待旧进程释放端口，做有限重试 ----
    httpd = None
    last_exc = None
    attempts = 40 if args.child else 1  # 40 × 0.4s ≈ 16 秒
    for _ in range(attempts):
        try:
            httpd = ViewerHTTPServer(("127.0.0.1", args.port), ViewerHandler)
            break
        except OSError as exc:
            last_exc = exc
            time.sleep(0.4)
    if httpd is None:
        print(f"[错误] 无法监听端口 {args.port}: {last_exc}")
        print(f"        请换一个端口重试，例如: python {os.path.basename(__file__)} --port 9000")
        sys.exit(1)
    _HTTPD = httpd
    write_pid_file()

    print(f"{APP_NAME} 已启动" + ("（后台服务进程）" if args.child else ""))
    print(f"  文档目录: {root}")
    print(f"  访问地址: {url}")
    if not args.child:
        print(f"  按 Ctrl+C 退出（或在页面右上角「服务」菜单中关闭）")
    try:
        sys.stdout.flush()  # 后台进程 stdout 重定向到日志文件时是块缓冲，启动信息需立即落盘
    except Exception:
        pass
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
    finally:
        httpd.server_close()
        remove_pid_file()


if __name__ == "__main__":
    main()
