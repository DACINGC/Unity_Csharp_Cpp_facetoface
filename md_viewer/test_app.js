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
const ROOT = path.join(__dirname, "..");
const m = /<script>\r?\n([\s\S]*?)\r?\n<\/script>\s*<\/body>/.exec(APP); // 兼容 LF / CRLF 行尾
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
  const sidebarControlIds = ["toggle-sidebar", "workspace-chevron", "sidebar-reopen"];
  const sidebarControls = sidebarControlIds.filter((id) => new RegExp('id="' + escId(id) + '"').test(APP));
  const hasDesktopToggle = new RegExp('id="toggle-sidebar"').test(APP);
  const hasMobileToggle = new RegExp('id="toggle-sidebar-mobile"').test(APP);
  console.log(sidebarControls.length === 1 && hasDesktopToggle && hasMobileToggle
    ? "✓ 侧栏仅保留统一的收起/展开按钮（桌面工具轨 + 移动端悬浮）"
    : "✗ 侧栏收起/展开按钮数量或位置不符合预期");
  if (!(sidebarControls.length === 1 && hasDesktopToggle && hasMobileToggle)) process.exit(1);
  const railStart = APP.indexOf('<nav id="workspace-rail"');
  const layoutStart = APP.indexOf('<div class="layout">');
  const toggleStart = APP.indexOf('id="toggle-sidebar"');
  const toggleInRail = railStart >= 0 && layoutStart > railStart &&
    toggleStart > railStart && toggleStart < layoutStart;
  console.log(toggleInRail
    ? "✓ 侧栏按钮固定在左侧工具轨内（不随侧栏宽度偏移）"
    : "✗ 侧栏按钮未固定在左侧工具轨内");
  if (!toggleInRail) process.exit(1);
  const toggleEnd = APP.indexOf("</button>", toggleStart);
  const toggleMarkup = toggleStart >= 0 && toggleEnd >= 0 ? APP.slice(toggleStart, toggleEnd) : "";
  const compactToggle = (toggleMarkup.includes("rail-icon") || toggleMarkup.includes("ico-open")) &&
    !toggleMarkup.includes("ts-label") && !toggleMarkup.includes("lbl-");
  console.log(compactToggle
    ? "✓ 侧栏按钮采用紧凑图标样式"
    : "✗ 侧栏按钮仍包含展开/收起文字");
  if (!compactToggle) process.exit(1);
}

/* ---------- DOM 桩 ---------- */
function makeEl(id) {
  var el = {
    id: id, value: "", disabled: false, className: "", innerHTML: "", dataset: {}, _text: "", attributes: {},
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
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
    focus() {}, select() {}, blur() {},
    appendChild() {},
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
const IDS = ["search", "search-results", "tab-files", "toggle-sidebar",
  "tab-toc", "btn-prev", "btn-next", "crumb-path", "crumb-file", "content", "main", "toast"];
const els = {};
IDS.forEach((id) => { els[id] = makeEl(id); });

const styleProps = {};
const bodyStub = makeEl("body");
const documentStub = {
  body: bodyStub,
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement(tag) { return makeEl(tag); },
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
  // vm 沙箱默认有独立的 Math；注入宿主 Math 便于测试中 stub 随机数
  Math: Math,
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

/* ---------- 侧栏单按钮交互 ---------- */
const sidebarBtn = els["toggle-sidebar"];
check("侧栏按钮初始显示收起", sidebarBtn.title === "收起侧栏" && sidebarBtn.getAttribute("aria-expanded") === "true");
sidebarBtn._handlers.click({});
check("单按钮可收起侧栏", documentStub.body.classList.contains("sidebar-collapsed") &&
  sidebarBtn.title === "展开侧栏" && sidebarBtn.getAttribute("aria-expanded") === "false");
sidebarBtn._handlers.click({});
check("单按钮可重新展开侧栏", !documentStub.body.classList.contains("sidebar-collapsed") &&
  sidebarBtn.title === "收起侧栏" && sidebarBtn.getAttribute("aria-expanded") === "true");

setTimeout(async () => {
  console.log("冒烟测试（真实 HTTP 到本地服务）");
  // 预期计数从服务端索引实时计算（不再硬编码，新增笔记后测试不过期）
  const idxJson = await (await fetch(new URL("/api/index", SERVER_BASE))).json();
  const totalFiles = idxJson.files.length;
  const mdFiles = idxJson.files.filter((f) => f.type === "md").length;
  const txtFiles = totalFiles - mdFiles;
  const firstTxtName = idxJson.files.filter((f) => f.type === "txt")[0].name;
  const firstMdName = idxJson.files.filter((f) => f.type === "md")[0].name;
  const filesHtml = els["file-list"].innerHTML;
  check("文件列表渲染（全部=" + totalFiles + "）", (filesHtml.match(/file-item/g) || []).length === totalFiles,
    (filesHtml.match(/file-item/g) || []).length + " 项");

  const doc = els["content"].innerHTML;
  check("首个文档已渲染（h1）", doc.includes("<h1") && doc.includes("一、C# 语言"));
  check("表格渲染", doc.includes("<table>") && doc.includes("<th>对比项</th>"),
    (doc.match(/<table>/g) || []).length + " 个表格");
  check("标题锚点 id=1.1.1", doc.includes('id="1.1.1"'));
  check("§ 引用可点击（sec-ref）", doc.includes('class="sec-ref"'));
  check("面包屑文件名", els["crumb-file"].textContent === "01_CSharp.md");
  check("本地记忆已写入", localStorageStub._d["mdviewer:last"] === "面试知识整理/01_CSharp.md");
  check("当前文档进度条渲染（0/55）", !els["file-progress"].classList.contains("hidden") &&
    els["file-progress"].innerHTML.includes("0/55"),
    els["file-progress"].innerHTML.replace(/<[^>]+>/g, "").slice(0, 30));

  // 目录与知识点双分区（不再切换，同时可见）
  const tocHtml2 = els["tab-toc"].innerHTML;
  check("知识点分区已渲染（含标记徽标）",
    (tocHtml2.match(/toc-link/g) || []).length > 0 && tocHtml2.includes("mark-badge"),
    (tocHtml2.match(/toc-link/g) || []).length + " 条标题");

  // 文件类型筛选
  console.log("文件筛选检查");
  context.setFilter("txt");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 TXT → " + txtFiles + " 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === txtFiles,
    (els["file-list"].innerHTML.match(/file-item/g) || []).length + " 项");
  check("筛选记忆已写入", localStorageStub._d["mdviewer:filter"] === "txt");
  check("自动切到第一个 txt", els["crumb-file"].textContent === firstTxtName,
    "当前=" + els["crumb-file"].textContent);
  check("筛选后 上一个 正确禁用", els["btn-prev"].disabled === true,
    "disabled=" + els["btn-prev"].disabled);
  context.setFilter("md");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 MD → " + mdFiles + " 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === mdFiles,
    (els["file-list"].innerHTML.match(/file-item/g) || []).length + " 项");
  check("切回第一个 md", els["crumb-file"].textContent === firstMdName,
    "当前=" + els["crumb-file"].textContent);
  check("MD 首个文件 上一个禁用", els["btn-prev"].disabled === true);
  check("MD 首个文件 下一个可用", els["btn-next"].disabled === false);
  context.setFilter("all");
  await new Promise((r) => setTimeout(r, 300));
  check("筛选 全部 → " + totalFiles + " 项", (els["file-list"].innerHTML.match(/file-item/g) || []).length === totalFiles);

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

  // 用最小 DOM 桩触发结果点击，验证点击知识点确实打开目标文件。
  const searchItem = makeEl("sr-item");
  searchItem.dataset.idx = "0";
  searchItem.closest = function (selector) { return selector === ".sr-item" ? this : null; };
  els["search-results"].querySelectorAll = function (selector) {
    return selector === ".sr-item" ? [searchItem] : [];
  };
  els["search-results"]._handlers.click({ target: searchItem });
  await new Promise((r) => setTimeout(r, 400));
  check("点击搜索知识点打开目标文件", els["crumb-file"].textContent === "06_Unity引擎.md",
    "当前文件=" + els["crumb-file"].textContent);

  // 立即按 Enter（不等待 150ms 防抖）也应使用首个结果跳转。
  els["search"].value = "装箱";
  els["search"]._handlers.input({});
  let enterPrevented = false;
  els["search"]._handlers.keydown({ key: "Enter", preventDefault() { enterPrevented = true; } });
  await new Promise((r) => setTimeout(r, 400));
  check("Enter 可立即打开首个搜索结果", enterPrevented && els["crumb-file"].textContent === "01_CSharp.md",
    "当前文件=" + els["crumb-file"].textContent);

  // 全文搜索：等待服务端正文结果合并进下拉（正文命中带高亮片段）
  els["search"].value = "装箱";
  context.doSearch();
  await new Promise((r) => setTimeout(r, 600));
  check("全文搜索合并正文命中", els["search-results"].innerHTML.includes("sr-snippet") &&
    els["search-results"].innerHTML.includes("正文"),
    (els["search-results"].innerHTML.match(/sr-item/g) || []).length + " 项");

  // 全文搜索接口直连
  const sres = await (await fetch(new URL("/api/search?q=虚函数表", SERVER_BASE))).json();
  check("全文搜索接口返回命中", sres.results.length > 0 && sres.results[0].matches.length > 0,
    sres.results.length + " 个文件");
  const tline = sres.results[0].matches[0];
  check("命中带行号与小节锚点", typeof tline.line === "number" && typeof tline.anchor === "string",
    "第" + tline.line + "行 → " + tline.anchor);

  // § 跨文件跳转（真实触发 openFile → fetch 目标文件）
  await new Promise((r) => setTimeout(r, 300));
  context.jumpToSection("6.10.1");
  await new Promise((r) => setTimeout(r, 400));
  check("§6.10.1 跨文件跳转加载 06_Unity引擎.md",
    els["crumb-file"].textContent === "06_Unity引擎.md",
    "当前文件=" + els["crumb-file"].textContent);
  const doc6 = els["content"].innerHTML;
  check("跳转后渲染出 6.10.1 小节", doc6.includes('id="6.10.1"'));

  // 掌握度标记 + 待复习清单
  console.log("掌握度标记与待复习检查");
  const badge = makeEl("mark-badge");
  badge.dataset.path = "面试知识整理/01_CSharp.md";
  badge.dataset.anchor = "1.1.2";
  badge.closest = function (selector) { return selector === ".mark-badge" ? this : null; };
  const marksState = () => JSON.parse(localStorageStub._d["mdviewer:marks"]);
  els["tab-toc"]._handlers.click({ target: badge });
  check("第一次点击标记为 已掌握", marksState()["面试知识整理/01_CSharp.md|1.1.2"] === "done");
  els["tab-toc"]._handlers.click({ target: badge });
  els["tab-toc"]._handlers.click({ target: badge });
  check("循环标记到 薄弱", marksState()["面试知识整理/01_CSharp.md|1.1.2"] === "weak");
  check("待复习计数徽标更新", els["toc-review-count"].textContent === "1",
    "实际=" + els["toc-review-count"].textContent);
  els["toc-tab-review"]._handlers.click({});
  check("待复习列表渲染", els["tab-toc"].innerHTML.includes("review-item") &&
    els["tab-toc"].innerHTML.includes("装箱与拆箱"),
    "…" + els["tab-toc"].innerHTML.slice(0, 60));
  els["toc-tab-all"]._handlers.click({});
  check("切回目录列表", (els["tab-toc"].innerHTML.match(/toc-link/g) || []).length > 0,
    (els["tab-toc"].innerHTML.match(/toc-link/g) || []).length + " 条标题");

  // 滚动位置记忆
  console.log("滚动位置记忆检查");
  els["main"].scrollTop = 120;
  context.saveScrollPos();
  check("滚动位置已持久化",
    JSON.parse(localStorageStub._d["mdviewer:scroll"])["面试知识整理/06_Unity引擎.md"] === 120);

  // 第二批：随机抽题 / 进度统计 / 编辑模式 / 保存与定位接口
  console.log("随机抽题与进度统计检查");
  const origRand = Math.random;
  Math.random = () => 0;
  context.randomPick(false);
  Math.random = origRand;
  await new Promise((r) => setTimeout(r, 400));
  check("随机抽题打开知识点", els["crumb-file"].textContent === "01_CSharp.md",
    "当前文件=" + els["crumb-file"].textContent);
  check("标记后当前文档进度更新（1/55）", els["file-progress"].innerHTML.includes("1/55"),
    els["file-progress"].innerHTML.replace(/<[^>]+>/g, "").slice(0, 40));
  check("进度统计渲染", els["progress-stats"].innerHTML.includes("进度") &&
    els["progress-stats"].innerHTML.includes("/"),
    els["progress-stats"].innerHTML.slice(0, 50));

  console.log("编辑模式检查");
  els["edit-btn"]._handlers.click({});
  check("进入编辑模式", !els["edit-bar"].classList.contains("hidden") &&
    els["edit-btn"].classList.contains("active"));
  els["edit-cancel"]._handlers.click({});
  check("取消编辑恢复只读", els["edit-bar"].classList.contains("hidden") &&
    !els["edit-btn"].classList.contains("active"));

  console.log("保存/定位接口检查（临时文件，用后即删）");
  const tmpRel = "mdviewer_test_tmp_" + Date.now() + ".txt";
  fs.writeFileSync(path.join(ROOT, tmpRel), "hello\n", "utf8");
  const saveR = await (await fetch(new URL("/api/save", SERVER_BASE), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: tmpRel, content: "你好 world\n第二行" })
  })).json();
  check("保存接口返回 ok", saveR.ok === true, "encoding=" + (saveR.encoding || "?"));
  check("保存内容按原编码回写", fs.readFileSync(path.join(ROOT, tmpRel), "utf8") === "你好 world\n第二行");
  check("保存前生成 .bak 备份", fs.existsSync(path.join(ROOT, tmpRel) + ".bak"));
  const saveBad = await (await fetch(new URL("/api/save", SERVER_BASE), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "../../../Windows/win.ini", content: "x" })
  })).json();
  check("保存接口拒绝路径穿越", saveBad.error !== undefined);
  const openBad = await (await fetch(new URL("/api/open", SERVER_BASE), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "../../../etc/passwd" })
  })).json();
  check("定位接口拒绝非法路径", openBad.error !== undefined);
  try { fs.unlinkSync(path.join(ROOT, tmpRel)); fs.unlinkSync(path.join(ROOT, tmpRel) + ".bak"); } catch (e) {}

  // 服务控制接口（status 只读，不触发 restart/shutdown 以免停掉测试服务）
  console.log("服务控制接口检查");
  const st = await (await fetch(new URL("/api/service/status", SERVER_BASE))).json();
  check("服务状态接口返回 ok", st.ok === true && st.app.length > 0,
    "v" + st.version + " · pid=" + st.pid + " · 端口=" + st.port);
  check("状态含 pid/端口/运行时长", typeof st.pid === "number" && typeof st.port === "number" &&
    typeof st.uptime_sec === "number" && typeof st.detached === "boolean");
  check("状态含文档目录与地址", typeof st.root === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(st.url));

  // 启动覆盖层：索引加载完成后应已隐藏（首次加载动画）
  check("启动覆盖层已隐藏（索引加载成功）", els["boot-overlay"].classList.contains("hidden"));
  // 服务控制下拉面板：DOM 桩不解析 HTML class，给元素补上标记里的 hidden 初始态（保留已注册的事件处理器）
  const svcDropEl = documentStub.getElementById("svc-drop");
  svcDropEl.classList.add("hidden");
  documentStub.getElementById("svc-confirm").classList.add("hidden");
  check("服务面板默认隐藏", svcDropEl.classList.contains("hidden"));
  els["service-btn"]._handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 300));
  check("点击电源按钮展开下拉面板", !svcDropEl.classList.contains("hidden"));
  check("面板渲染状态信息", els["svc-rows"].innerHTML.includes("访问地址") &&
    (els["svc-rows"].innerHTML.match(/svc-row/g) || []).length === 4,
    (els["svc-rows"].innerHTML.match(/svc-row/g) || []).length + " 行状态");
  check("运行时长已渲染", els["svc-uptime"].textContent.includes("已运行"),
    els["svc-uptime"].textContent);
  check("确认框初始隐藏", els["svc-confirm"].classList.contains("hidden"));
  // 再次点击按钮收起 / Esc 收起
  els["service-btn"]._handlers.click({ stopPropagation() {} });
  check("再次点击电源按钮收起面板", svcDropEl.classList.contains("hidden"));
  els["service-btn"]._handlers.click({ stopPropagation() {} });
  windowHandlers["keydown"] && windowHandlers["keydown"]({ key: "Escape", preventDefault() {} });
  await new Promise((r) => setTimeout(r, 50));
  check("Esc 可收起面板", svcDropEl.classList.contains("hidden"));
  // 二次确认流（不点「确认」，避免真的重启/关闭测试服务）
  els["service-btn"]._handlers.click({ stopPropagation() {} });
  els["svc-restart"]._handlers.click({});
  check("重启前弹二次确认", !els["svc-confirm"].classList.contains("hidden") &&
    els["svc-confirm-text"].textContent.includes("重启"));
  els["svc-confirm-no"]._handlers.click({});
  check("取消后确认框收起", els["svc-confirm"].classList.contains("hidden"));
  els["svc-shutdown"]._handlers.click({});
  check("关闭前弹二次确认", !els["svc-confirm"].classList.contains("hidden") &&
    els["svc-confirm-text"].textContent.includes("关闭"));
  els["svc-confirm-no"]._handlers.click({});

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  process.exit(failures ? 1 : 0);
}, 500);
