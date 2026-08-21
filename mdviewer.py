#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""面试 MD 文档查看器 —— 本地服务端（仅用 Python 标准库，零依赖）。

用法:
    python mdviewer.py                # 默认端口 8765，默认根目录为脚本所在目录（含 面试知识整理/*.md 与 note、笔记 下的 txt）
    python mdviewer.py --port 9000    # 指定端口
    python mdviewer.py --root D:/docs # 指定文档根目录
    python mdviewer.py --no-browser   # 不自动打开浏览器

提供六个接口:
    GET  /                  -> 返回前端页面 md_viewer/index.html
    GET  /api/index         -> JSON 文件列表 + 标题树 + 章节编号映射（sections，带 mtime 缓存）
    GET  /api/file?path=..  -> JSON 文件内容（path 为相对根目录的路径，防路径穿越）
    GET  /api/search?q=..   -> JSON 全文搜索结果（文件 + 命中行 + 最近小节锚点）
    POST /api/save          -> 保存文件（JSON body: {path, content}，按原编码回写，写前备份 .bak）
    POST /api/open          -> 在系统文件管理器中定位文件（JSON body: {path}，仅本机）
"""

import argparse
import json
import os
import re
import shutil
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP_NAME = "面试 MD 文档查看器"
DEFAULT_PORT = 8765
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = SCRIPT_DIR

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


class ViewerHandler(BaseHTTPRequestHandler):
    root = DEFAULT_ROOT

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
    ap = argparse.ArgumentParser(description=APP_NAME)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}）")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="文档根目录（默认：脚本所在目录，含 面试知识整理 下的 md 与 note、笔记 下的 txt）")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
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

    ViewerHandler.root = root
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), ViewerHandler)
    except OSError as exc:
        print(f"[错误] 无法监听端口 {args.port}: {exc}")
        print(f"        请换一个端口重试，例如: python {os.path.basename(__file__)} --port 9000")
        sys.exit(1)

    url = f"http://127.0.0.1:{args.port}"
    print(f"{APP_NAME} 已启动")
    print(f"  文档目录: {root}")
    print(f"  访问地址: {url}")
    print(f"  按 Ctrl+C 退出")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
        httpd.server_close()


if __name__ == "__main__":
    main()
