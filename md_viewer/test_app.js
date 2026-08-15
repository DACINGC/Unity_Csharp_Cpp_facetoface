/* 前端应用冒烟测试（Node VM + DOM 桩 + 真实 HTTP）
 * 用法: node md_viewer/test_app.js   （需先启动 python mdviewer.py）
 * 验证: 页面脚本可启动、文件列表渲染 25 项、首个文档正确渲染、
 *       全局搜索出结果、§ 跨文件跳转触发加载目标文件
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = /<script>\n([\s\S]*?)\n<\/script>\s*<\/body>/.exec(APP);
if (!m) { console.error("无法提取应用脚本"); process.exit(1); }
const APP_JS = m[1];

/* ---------- 静态校验：JS 中 $("id") 引用的元素必须存在于 HTML ---------- */
{
  const usedIds = new Set();
  const refRe = /\$\("([^"]+)"\)/g;
  let mm;
  while ((mm = refRe.exec(APP_JS))) usedIds.add(mm[1]);
  const escId = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const missing = [...usedIds].filter((id) => !new RegExp('id="' + escId(id) + '"').test(APP));
  console.log(missing.length
    ? "✗ JS 引用了不存在的元素 id: " + missing.join(", ")
    : "✓ JS 引用的全部元素 id 均存在于 HTML（" + usedIds.size + " 个）");
  if (missing.length) process.exit(1);
}

/* ---------- DOM 桩 ---------- */
function makeEl(id) {
  var el = {
    id: id, value: "", disabled: false, className: "", innerHTML: "", dataset: {}, _text: "",
    _handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else { f ? this._s.add(c) : this._s.delete(c); }
      },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
    focus() {}, select() {}, blur() {},
    getBoundingClientRect() { return { width: 480, left: 0, right: 480, top: 0, bottom: 0 }; },
    parentElement: null,
    get offsetWidth() { return 0; }
  };
  // 真实 DOM 的 textContent 赋值会强制转为字符串
  Object.defineProperty(el, "textContent", {
    get: function () { return this._text; },
    set: function (v) { this._text = String(v); }
  });
  return el;
}
const IDS = ["search", "search-results", "tab-files",
  "tab-toc", "btn-prev", "btn-next", "crumb-path", "crumb-file", "content", "main", "toast"];
const els = {};
IDS.forEach((id) => { els[id] = makeEl(id); });

const styleProps = {};
const documentStub = {
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  querySelectorAll() { return []; },
  addEventListener() {},
  documentElement: {
    setAttribute() {}, getAttribute() { return null; },
    style: { setProperty(k, v) { styleProps[k] = v; } }
  }
};
const windowHandlers = {};
const localStorageStub = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }
};

/* ---------- VM 环境 ---------- */
const SERVER_BASE = process.env.MDVIEWER_URL || "http://127.0.0.1:8765";
const context = {
  document: documentStub,
  localStorage: localStorageStub,
  // 浏览器中相对路径可用，Node 的 fetch 需要绝对 URL，这里补一个 base
  fetch: (u, o) => globalThis.fetch(new URL(u, SERVER_BASE), o),
  requestAnimationFrame(fn) { queueMicrotask(fn); },
  setTimeout, clearTimeout, console,
  window: {
    addEventListener(ev, fn) { windowHandlers[ev] = fn; },
    removeEventListener(ev) { delete windowHandlers[ev]; }
  }
};
vm.createContext(context);

vm.runInContext(fs.readFileSync(path.join(__dirname, "renderer.js"), "utf8"),
  context, { filename: "renderer.js" });
// 浏览器中 window 即全局对象；桩里 window 是独立对象，需补回全局别名
context.Renderer = context.window.Renderer;
vm.runInContext(APP_JS, context, { filename: "app.js" });

/* ---------- 断言 ---------- */
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ✓ " + name + (extra ? "  (" + extra + ")" : ""));
  else { failures++; console.log("  ✗ " + name); }
}

setTimeout(async () => {
  console.log("冒烟测试（真实 HTTP 到本地服务）");
  const filesHtml = els["file-list"].innerHTML;
  check("文件列表渲染（全部=25）", (filesHtml.match(/file-item/g) || []).length === 25,
    (filesHtml.match(/file-item/g) || []).length + " 项");

  const doc = els["content"].innerHTML;
  check("首个文档已渲染（h1）", doc.includes("<h1") && doc.includes("一、C# 语言"));
  check("表格渲染", doc.includes("<table>") && doc.includes("<th>对比项</th>"),
    (doc.match(/<table>/g) || []).length + " 个表格");
  check("标题锚点 id=1.1.1", doc.includes('id="1.1.1"'));
  check("§ 引用可点击（sec-ref）", doc.includes('class="sec-ref"'));
  check("面包屑文件名", els["crumb-file"].textContent === "01_CSharp.md");
  check("本地记忆已写入", localStorageStub._d["mdviewer:last"] === "面试知识整理/01_CSharp.md");

  // 目录与知识点双分区（不再切换，同时可见）
  const tocHtml2 = els["tab-toc"].innerHTML;
  check("知识点分区已渲染", tocHtml2.includes("知识点") && (tocHtml2.match(/toc-link/g) || []).length > 0,
    (tocHtml2.match(/toc-link/g) || []).length + " 条标题");
  check("空间计数 全部=25", els["nav-count-all"].textContent === "25",
    "实际=" + els["nav-count-all"].textContent);
  check("空间计数 面试知识库=10", els["nav-count-kb"].textContent === "10",
    "实际=" + els["nav-count-kb"].textContent);

  // 文件类型筛选
  console.log("文件筛选检查");
  context.setFilter("txt");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 TXT → 15 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === 15,
    (els["file-list"].innerHTML.match(/file-item/g) || []).length + " 项");
  check("筛选记忆已写入", localStorageStub._d["mdviewer:filter"] === "txt");
  check("自动切到第一个 txt", els["crumb-file"].textContent === "C#.txt",
    "当前=" + els["crumb-file"].textContent);
  check("筛选后 上一个 正确禁用", els["btn-prev"].disabled === true,
    "disabled=" + els["btn-prev"].disabled);
  context.setFilter("md");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 MD → 10 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === 10,
    (els["file-list"].innerHTML.match(/file-item/g) || []).length + " 项");
  check("切回第一个 md", els["crumb-file"].textContent === "01_CSharp.md",
    "当前=" + els["crumb-file"].textContent);
  check("MD 首个文件 上一个禁用", els["btn-prev"].disabled === true);
  check("MD 首个文件 下一个可用", els["btn-next"].disabled === false);
  context.setFilter("all");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 全部 → 25 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === 25);

  // 侧栏宽度拖拽
  console.log("侧栏宽度拖拽检查");
  els["sidebar"].parentElement = { getBoundingClientRect: () => ({ width: 1600 }) };
  const pd = els["resizer"]._handlers["pointerdown"];
  pd({ clientX: 400, preventDefault() {} });
  windowHandlers["pointermove"]({ clientX: 700 }); // 向右拖 300px
  check("拖动后 --sidebar-w=780px", styleProps["--sidebar-w"] === "780px",
    "实际=" + styleProps["--sidebar-w"]);
  check("宽度已持久化", localStorageStub._d["mdviewer:sidebar-w"] === "780",
    "实际=" + localStorageStub._d["mdviewer:sidebar-w"]);
  windowHandlers["pointermove"]({ clientX: 5000 }); // 超出上限 → 钳制到 900
  check("宽度上限钳制 900px", styleProps["--sidebar-w"] === "900px",
    "实际=" + styleProps["--sidebar-w"]);
  windowHandlers["pointerup"]({});

  // 目录 / 知识点 两列宽度拖拽
  console.log("两列宽度拖拽检查");
  els["side-split"].getBoundingClientRect = () => ({ width: 480 });
  els["col-files"].getBoundingClientRect = () => ({ width: 260 }); // 起始 ≈54%
  const pdCol = els["col-resizer"]._handlers["pointerdown"];
  pdCol({ clientX: 100, preventDefault() {} });
  windowHandlers["pointermove"]({ clientX: 130 }); // 右移 30px → ≈60%
  check("拖动后 --col-split=60%", styleProps["--col-split"] === "60%",
    "实际=" + styleProps["--col-split"]);
  check("两列比例已持久化", localStorageStub._d["mdviewer:col-split"] === "60",
    "实际=" + localStorageStub._d["mdviewer:col-split"]);
  windowHandlers["pointermove"]({ clientX: 5000 }); // 超出上限 → 钳制到 72%
  check("两列比例上限钳制 72%", styleProps["--col-split"] === "72%",
    "实际=" + styleProps["--col-split"]);
  windowHandlers["pointerup"]({});

  // 全局搜索
  els["search"].value = "装箱";
  context.doSearch();
  check("搜索『装箱』出结果", els["search-results"].innerHTML.includes("装箱"),
    els["search-results"].innerHTML.replace(/<[^>]+>/g, "").slice(0, 40) + "…");
  els["search"].value = "6.10.1";
  context.doSearch();
  check("搜索编号『6.10.1』出结果", (els["search-results"].innerHTML.match(/sr-item/g) || []).length > 0);

  // § 跨文件跳转（真实触发 openFile → fetch 目标文件）
  await new Promise((r) => setTimeout(r, 300));
  context.jumpToSection("6.10.1");
  await new Promise((r) => setTimeout(r, 400));
  check("§6.10.1 跨文件跳转加载 06_Unity引擎.md",
    els["crumb-file"].textContent === "06_Unity引擎.md",
    "当前文件=" + els["crumb-file"].textContent);
  const doc6 = els["content"].innerHTML;
  check("跳转后渲染出 6.10.1 小节", doc6.includes('id="6.10.1"'));

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  process.exit(failures ? 1 : 0);
}, 500);
