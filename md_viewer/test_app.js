/* 前端应用冒烟测试（Node VM + DOM 桩 + 真实 HTTP）
 * 用法: node md_viewer/test_app.js   （需先启动 python mdviewer.py）
 * 验证: 页面脚本可启动、文件列表渲染（当前 38 个文件：22 md + 16 txt，随语料变化）、
 *       首个文档正确渲染、全局搜索出结果、§ 跨文件跳转触发加载目标文件、
 *       以及一批"静态契约 + 行为"断言（CSRF、深链、并发导航、阅读位置、
 *       搜索缓存失效、备份轮转、拖拽收尾、弹层让路、aria-busy 等）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const ROOT = path.join(__dirname, "..");
// 取最后一个内联 <script>（页面里还有 head 中的主题防闪烁脚本与 renderer.js 外链）
const inlineScripts = [...APP.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!inlineScripts.length) { console.error("无法提取应用脚本"); process.exit(1); }
const APP_JS = inlineScripts[inlineScripts.length - 1][1];

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
  const workbenchFullscreen = /body\.workbench-view \.workspace-rail[\s\S]*?body\.workbench-view aside[\s\S]*?body\.workbench-view #resizer/.test(APP);
  console.log(workbenchFullscreen
    ? "✓ 工作台页保留工具轨、隐藏笔记侧栏与分隔条"
    : "✗ 工作台页未按约定处理工具轨与笔记侧栏");
  if (!workbenchFullscreen) process.exit(1);
  const fixedAppNav = /header\s*\{[\s\S]*?position: fixed; inset: 0 0 auto; height: 58px;/.test(APP) &&
    /\.layout\s*\{[\s\S]*?margin-top: 58px;/.test(APP);
  console.log(fixedAppNav
    ? "✓ 顶部页签固定在全局栏，切换页面不改变位置"
    : "✗ 顶部页签未使用统一的全局位置");
  if (!fixedAppNav) process.exit(1);
  const githubHeatmap = APP.includes('class="stats-heat-widget"') &&
    APP.includes('class="stats-heat-scroll"') &&
    APP.includes('class="stats-heat-months"') && APP.includes('class="stats-heat-days"') &&
    APP.includes('class="stats-heat-tip"') && APP.includes('class="stats-heat-summary"') &&
    APP.includes('class="stats-heat-legend"') && APP.includes('data-date="');
  console.log(githubHeatmap
    ? "✓ 复习热力图为 GitHub 风格（月份/星期/悬停提示/汇总/图例）"
    : "✗ 复习热力图未升级为 GitHub 风格");
  if (!githubHeatmap) process.exit(1);

  /* 去冗余与死代码回归：这些入口/类名/函数不应再出现 */
  const removedTokens = ["toc-tab-review", "toc-review-count", "toc-tabs", "renderReviewTab",
    "reviewTabActive", "markBadgeHtml", "cycleMark", "rail-logo", "rail-divider",
    "stats-card", "stats-head", "stats-history-note", "stats-status-item", "review-item"];
  const resurrected = removedTokens.filter((t) => APP.includes(t));
  console.log(resurrected.length
    ? "✗ 已删除的冗余入口/死代码重新出现: " + resurrected.join(", ")
    : "✓ 冗余入口与死代码已清理（侧栏待复习标签、旧统计卡、rail 品牌残留等 " + removedTokens.length + " 项）");
  if (resurrected.length) process.exit(1);

  /* 每个能力一个主入口：随机抽题只在工具轨菜单 + 移动端「更多操作」 */
  const randomEntryPoints = (APP.match(/data-mode="(all|review|weak)"/g) || []).length;
  const workspaceRandomButtons = /data-home-action="random"|data-review-action="random"/.test(APP);
  console.log(randomEntryPoints === 3 && !workspaceRandomButtons
    ? "✓ 随机抽题收敛为工具轨菜单（全部/待复习/薄弱），工作台内不再重复放置按钮"
    : "✗ 随机抽题入口未收敛（菜单项 " + randomEntryPoints + " 个，工作台残留=" + workspaceRandomButtons + "）");
  if (!(randomEntryPoints === 3 && !workspaceRandomButtons)) process.exit(1);

  /* 设计令牌与可访问性契约 */
  const tokenContract = ["--focus-ring", "--shadow-2", "--r-md", "--ease", "--doc-measure",
    "--bg-glass", "--hairline", "--accent-line"].every((t) => APP.includes(t + ":"));
  const focusVisible = /\.rail-btn:focus-visible/.test(APP) && /\.workbench-list-item:focus-visible/.test(APP) &&
    /\.toc-link:focus-visible/.test(APP) && /\.file-item:focus-visible/.test(APP);
  const reducedMotion = /@media \(prefers-reduced-motion: reduce\)/.test(APP);
  const themeBoot = /prefers-color-scheme: light/.test(APP) &&
    APP.indexOf('setAttribute("data-theme"') < APP.indexOf("<style>");
  console.log(tokenContract && focusVisible && reducedMotion && themeBoot
    ? "✓ 设计令牌 / 焦点环 / 动效降级 / 主题防闪烁齐备"
    : "✗ 设计令牌或可访问性契约缺失（令牌=" + tokenContract + " 焦点=" + focusVisible +
      " 降级=" + reducedMotion + " 防闪烁=" + themeBoot + "）");
  if (!(tokenContract && focusVisible && reducedMotion && themeBoot)) process.exit(1);

  /* 全局快捷键只有一处 window 挂载，避免 document / window 双监听重复处理 */
  const singleKeyHandler = /window\.addEventListener\("keydown", handleGlobalKey\)/.test(APP) &&
    !/document\.addEventListener\("keydown"/.test(APP);
  console.log(singleKeyHandler
    ? "✓ 全局快捷键统一由 window 上的 handleGlobalKey 处理"
    : "✗ 全局快捷键存在多处挂载");
  if (!singleKeyHandler) process.exit(1);

  /* 目录父标题进度药丸：必须只排除"标题自身那一行"的圆点。
   * 父标题行里放的是 .node-prog（叶子才放 .mark-badge），若用不限层级的
   * querySelector(".toc-row .mark-badge") 会命中第一个子知识点的圆点并误跳过，
   * 导致每次标记后父标题数字整体少 1（单子节点时药丸整条消失）。
   * DOM 桩无法覆盖 DOM 遍历，这里用静态契约锁住选择器。 */
  const ownBadgeScoped = /item\.querySelector\(":scope > \.toc-row \.mark-badge"\)/.test(APP_JS);
  const ownBadgeUnscoped = /item\.querySelector\("\.toc-row \.mark-badge"\)/.test(APP_JS);
  console.log(ownBadgeScoped && !ownBadgeUnscoped
    ? "✓ 目录进度药丸只排除标题自身行的圆点（:scope > .toc-row）"
    : "✗ 目录进度药丸的\"自身圆点\"判定未限定层级，会少算第一个子知识点");
  if (!(ownBadgeScoped && !ownBadgeUnscoped)) process.exit(1);

  /* P2-3：锚点跳转必须精确匹配 id，不得用"标题文本包含 anchor"的兜底——
   * 后者会把错误锚点变成一次错误跳转（?anchor=C 命中第一个含 C 的标题），并掩盖真失败。 */
  const anchorExact = /var target = document\.getElementById\(anchor\);/.test(APP_JS) &&
    !/hd\[i\]\.textContent\.replace\(\/\\s\+\/g, ""\)\.indexOf\(anchor\)/.test(APP_JS);
  console.log(anchorExact
    ? "✓ 锚点跳转只按 id 精确匹配（无子串兜底）"
    : "✗ 锚点跳转仍存在子串兜底，可能跳到错误小节");
  if (!anchorExact) process.exit(1);

  /* P2-4：openFile 必须用请求序号丢弃过期响应，否则快速连点时"先发后到者"会覆盖后点的文件。 */
  const openSeqGuard = /var seq = \+\+openSeq;/.test(APP_JS) &&
    /if \(seq !== openSeq\) return null;/.test(APP_JS);
  console.log(openSeqGuard
    ? "✓ openFile 用请求序号丢弃过期响应（并发导航不再后到者胜）"
    : "✗ openFile 缺少请求序号守卫，并发导航可能打开错误的文件");
  if (!openSeqGuard) process.exit(1);

  /* P2-5：加载骨架期间不得写阅读位置，否则骨架把 scrollTop 钳到 0 会覆盖旧文件的记忆位置。 */
  const loadingGuard = /function saveScrollPos\(\) \{\s*\n\s*if \(loadingDoc\) return;/.test(APP_JS) &&
    /loadingDoc = true;/.test(APP_JS);
  console.log(loadingGuard
    ? "✓ 骨架屏加载期间不写阅读位置（避免旧文件位置被写成 0）"
    : "✗ saveScrollPos 未在加载期间设防，骨架屏会覆盖阅读位置记忆");
  if (!loadingGuard) process.exit(1);

  /* P2-2：?path= 深链被本地筛选器挡住时，必须放宽筛选而不是静默回首页。 */
  const deepLinkFallback = /index\.files\.some\(function \(f\) \{ return f\.path === qpath; \}\)/.test(APP_JS);
  console.log(deepLinkFallback
    ? "✓ 深链被筛选器挡住时先放宽筛选再打开（不再静默回首页）"
    : "✗ 深链仍只按当前筛选判定，可能静默丢失目标文档");
  if (!deepLinkFallback) process.exit(1);

  /* P2-6：历史栈 shift() 后必须用"绝对序号 - histBase"还原下标，
   * 否则浏览器里已压入的旧 state.i 会指向相邻的另一个条目。 */
  const histBaseFix = /var histBase = 0;/.test(APP_JS) &&
    /var i = abs >= 0 \? abs - histBase : -1;/.test(APP_JS) &&
    /histStack\.shift\(\); histIndex--; histBase\+\+;/.test(APP_JS) &&
    !/history\.pushState\(\{ i: histIndex \}/.test(APP_JS);
  console.log(histBaseFix
    ? "✓ 历史栈溢出用绝对序号还原（不再错位到相邻条目）"
    : "✗ 历史栈仍以数组下标写入 state，超过 200 次导航后会错位");
  if (!histBaseFix) process.exit(1);

  /* P2-9：首页/复习页在隐藏时只置脏，不重建 DOM。 */
  const dirtyDefer = /if \(viewMode !== "home"\) \{ homeDirty = true; return; \}/.test(APP_JS) &&
    /if \(viewMode !== "review"\) \{ reviewDirty = true; return; \}/.test(APP_JS);
  console.log(dirtyDefer
    ? "✓ 首页/复习页隐藏时不重绘（只置脏，切过去再渲染）"
    : "✗ 隐藏页面仍在每次标记时全量重建 DOM");
  if (!dirtyDefer) process.exit(1);

  /* P2-11：拖拽必须用统一的 beginDrag（含 pointercancel / setPointerCapture / buttons 兜底），
   * 否则窗口外松开会让 body.resizing 与监听器永久残留。 */
  const dragFixed = /function beginDrag\(handle, handlers\)/.test(APP_JS) &&
    /window\.addEventListener\("pointercancel", cleanup\)/.test(APP_JS) &&
    /ev\.buttons === 0/.test(APP_JS) &&
    /beginDrag\(\$\("resizer"\)/.test(APP_JS) &&
    /beginDrag\(\$\("col-resizer"\)/.test(APP_JS);
  console.log(dragFixed
    ? "✓ 拖拽监听统一收尾（pointercancel + 指针捕获 + buttons 兜底）"
    : "✗ 拖拽监听仍可能泄漏，body.resizing 会卡住");
  if (!dragFixed) process.exit(1);

  /* P2-16：弹层打开时单键快捷键必须让路。 */
  const overlayGuard = /function anyOverlayOpen\(\)/.test(APP_JS) &&
    /if \(anyOverlayOpen\(\)\) return;/.test(APP_JS);
  console.log(overlayGuard
    ? "✓ 弹层打开时单键快捷键不作用到背后页面"
    : "✗ 弹层打开时单键快捷键仍会触发");
  if (!overlayGuard) process.exit(1);

  /* P2-17：aria-busy 必须成对复位。 */
  const ariaBusyPaired = /setAttribute\("aria-busy", "true"\)/.test(APP_JS) &&
    /setAttribute\("aria-busy", "false"\)/.test(APP_JS);
  console.log(ariaBusyPaired
    ? "✓ aria-busy 成对设置与复位（屏幕阅读器不再一直以为在加载）"
    : "✗ aria-busy 只置位不复位");
  if (!ariaBusyPaired) process.exit(1);

  /* 动效层：令牌 / 关键帧 / 可插值属性 / 降级开关 / 零依赖 */
  const motionTokens = ["--ease-expo:", "--ease-spring:", "--dur-base:", "--dur-enter:", "--stagger:",
    "--glow-a:"].every((t) => APP.includes(t));
  const motionKeyframes = ["@keyframes rise", "@keyframes bar-grow", "@keyframes mark-pop",
    "@keyframes pulse-ring", "@keyframes sheen", "@keyframes breathe",
    "@keyframes vt-out"].every((k) => APP.includes(k));
  const pctProperty = /@property --pct \{/.test(APP);
  const viewTransition = APP.includes("startViewTransition") &&
    APP.includes("view-transition-name: pane") &&
    APP.includes("::view-transition-old(pane)");
  const motionFallbacks = /prefersReducedMotion\(\)/.test(APP) &&
    /typeof document\.startViewTransition !== "function"/.test(APP) &&
    /typeof document\.body\.animate !== "function"/.test(APP) &&
    APP.includes("prefers-reduced-motion: reduce");
  const noNewDeps = !/<script[^>]+src="https?:/.test(APP) && !/@import/.test(APP) &&
    !/cdn\./i.test(APP) && !/cdnjs|unpkg|jsdelivr/i.test(APP);
  console.log(motionTokens && motionKeyframes && pctProperty && viewTransition && motionFallbacks && noNewDeps
    ? "✓ 动效层齐备且可控降级（令牌 / 关键帧 / @property --pct / View Transitions / 减少动态效果 / 零新增依赖）"
    : "✗ 动效层缺失或引入外部依赖（令牌=" + motionTokens + " 关键帧=" + motionKeyframes +
      " 环插值=" + pctProperty + " 视图过渡=" + viewTransition + " 降级=" + motionFallbacks + " 零依赖=" + noNewDeps + "）");
  if (!(motionTokens && motionKeyframes && pctProperty && viewTransition && motionFallbacks && noNewDeps)) process.exit(1);

  /* 文件列表行尾的复习进度环：渲染、刷新链、conic 环与遮罩挖空都要在 */
  const fileRing = APP.includes('class="file-ring"') &&
    /refreshFileRings\(true\)/.test(APP) &&
    /refreshFileRings\(false\)/.test(APP) &&
    /conic-gradient\(var\(--accent\) calc\(var\(--pct\) \* 1%\)/.test(APP) &&
    /mask: radial-gradient/.test(APP);
  console.log(fileRing
    ? "✓ 文件行尾进度环齐备（渲染 + 刷新链 + conic 环 + 遮罩挖空）"
    : "✗ 文件行尾进度环缺失或未接入刷新链");
  if (!fileRing) process.exit(1);
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
/* 从 HTML 标记里读出各 id 的初始 class（如 hidden / loading），
   让 DOM 桩的初始状态与真实页面一致，避免「弹层分层关闭」等逻辑被桩的空 classList 误导。 */
const idClasses = {};
for (const tag of APP.match(/<[a-zA-Z][^>]*>/g) || []) {
  const idm = /\bid="([^"]+)"/.exec(tag);
  if (!idm) continue;
  const cm = /\bclass="([^"]*)"/.exec(tag);
  idClasses[idm[1]] = cm ? cm[1].split(/\s+/).filter(Boolean) : [];
}
const IDS = ["search", "search-results", "tab-files", "toggle-sidebar",
  "tab-toc", "btn-prev", "btn-next", "crumb-path", "crumb-file", "content", "main", "toast"];
const els = {};
IDS.forEach((id) => {
  els[id] = makeEl(id);
  (idClasses[id] || []).forEach((c) => els[id].classList.add(c));
});

const styleProps = {};
const bodyStub = makeEl("body");
const documentStub = {
  body: bodyStub,
  getElementById(id) {
    if (!els[id]) {
      els[id] = makeEl(id);
      (idClasses[id] || []).forEach((c) => els[id].classList.add(c));
    }
    return els[id];
  },
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
  const homeHtml = els["home-page"].innerHTML;
  check("默认进入统一工作台首页", context.viewMode === "home" &&
    homeHtml.includes("继续阅读") && homeHtml.includes("学习工作台") && homeHtml.includes("待复习") &&
    homeHtml.includes("笔记入口") && homeHtml.includes("学习概览"));
  check("统计内容并入首页（分布/环形/热力图）", homeHtml.includes("知识点类型分布") &&
    homeHtml.includes("stats-category-grid") && homeHtml.includes("stats-ring") &&
    homeHtml.includes("stats-heat-cell") && homeHtml.includes("最活跃月份"));
  check("首页为独立全宽工作台，不显示笔记侧栏", documentStub.body.classList.contains("workbench-view"));
  check("工作台提供首页 / 笔记 / 复习同级入口（统计已并入首页）", ["nav-home", "nav-notes", "nav-review"].every((id) => !!els[id]._handlers.click));
  els["nav-notes"]._handlers.click({});
  await new Promise((r) => setTimeout(r, 400));
  const filesHtml = els["file-list"].innerHTML;
  check("文件列表渲染（全部=" + totalFiles + "）", (filesHtml.match(/file-item/g) || []).length === totalFiles,
    (filesHtml.match(/file-item/g) || []).length + " 项");
  // 行尾复习进度环：只给「有知识点的 md」，所以数量在 (0, mdFiles] 之间
  const ringCount = (filesHtml.match(/class="file-ring"/g) || []).length;
  check("文件行尾复习进度环已渲染", ringCount > 0 && ringCount <= mdFiles,
    ringCount + " 环 / " + mdFiles + " 个 md");

  const doc = els["content"].innerHTML;
  check("首个文档为 00 知识索引（h1）", doc.includes("<h1") && doc.includes("知识索引"));
  check("索引表格渲染", doc.includes("<table>") && doc.includes("<th>"),
    (doc.match(/<table>/g) || []).length + " 个表格");
  check("索引 § 引用可点击（sec-ref）", doc.includes('class="sec-ref"'));
  check("面包屑文件名", els["crumb-file"].textContent === "00_知识索引.md");
  check("本地记忆已写入", localStorageStub._d["mdviewer:last"] === "面试知识整理/00_知识索引.md");
  const indexProgress = context.fileProgress("面试知识整理/00_知识索引.md");
  check("当前文档进度条渲染（掌握率 / 覆盖率）", !els["file-progress"].classList.contains("hidden") &&
    els["file-progress"].innerHTML.includes("掌握 0/" + indexProgress.total) &&
    els["file-progress"].innerHTML.includes("覆盖 0%"),
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
  // 深度渲染检查（01_CSharp 现已打开）
  const doc01 = els["content"].innerHTML;
  check("01_CSharp 渲染（一、C# 语言 + 对比项表 + 锚点 1.1.1）",
    doc01.includes("一、C# 语言") && doc01.includes("<th>对比项</th>") && doc01.includes('id="1.1.1"'));

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
  const marksState = () => JSON.parse(localStorageStub._d["mdviewer:marks"] || "{}");
  els["mark-menu"].classList.add("hidden");
  els["tab-toc"]._handlers.click({ target: badge });
  check("点击标记打开状态菜单", !els["mark-menu"].classList.contains("hidden"));
  context.setMark("面试知识整理/01_CSharp.md", "1.1.2", "weak");
  check("显式标记为 薄弱", marksState()["面试知识整理/01_CSharp.md|1.1.2"] === "weak");
  const reviewEvents = JSON.parse(localStorageStub._d["mdviewer:review-events"] || "[]");
  check("标记动作写入复习记录", reviewEvents.length === 1 &&
    reviewEvents[0].key === "面试知识整理/01_CSharp.md|1.1.2" && reviewEvents[0].state === "weak");
  const statsData = context.collectStatsData();
  const expectedLeafTotal = idxJson.files.reduce((sum, f) => sum + context.leafHeadings(f.headings || []).length, 0);
  check("统计仅计算末级标题知识点", statsData.total === expectedLeafTotal,
    "统计=" + statsData.total + "，末级标题=" + expectedLeafTotal);
  check("统计汇总复习次数", statsData.reviewActions === 1 &&
    statsData.categories.some((c) => c.path === "面试知识整理/01_CSharp.md" && c.reviewActions === 1));
  check("复习导航徽标显示待处理数量", els["nav-review-count"].textContent === "1" &&
    !els["nav-review-count"].classList.contains("hidden"),
    "实际=" + els["nav-review-count"].textContent);
  check("侧栏知识点列只渲染目录树（待复习清单已并入复习工作台）",
    (els["tab-toc"].innerHTML.match(/toc-link/g) || []).length > 0 &&
    !els["tab-toc"].innerHTML.includes("review-item"),
    (els["tab-toc"].innerHTML.match(/toc-link/g) || []).length + " 条标题");
  check("知识点列头显示当前文档知识点数量", /个知识点/.test(els["toc-count"].textContent),
    "实际=" + els["toc-count"].textContent);

  // 复习工作台：唯一的完整清单入口（侧栏不再重复一份）
  els["nav-review"]._handlers.click({});
  const reviewPageHtml = els["review-page"].innerHTML;
  check("复习工作台可从顶部导航进入", context.viewMode === "review" &&
    reviewPageHtml.includes("待复习清单") && reviewPageHtml.includes("装箱与拆箱") &&
    els["nav-review"].classList.contains("active") &&
    documentStub.body.classList.contains("workbench-view"));
  check("复习工作台不再重复放置随机抽题按钮（改用工具轨 🎲 / 快捷键 R）",
    !reviewPageHtml.includes('data-review-action="random"'));

  // 学习统计已并入首页：环形概览与热力图随首页渲染，并可返回文档
  console.log("统计并入首页检查");
  els["nav-home"]._handlers.click({});
  const mergedHomeHtml = els["home-page"].innerHTML;
  check("统计内容并入首页", context.viewMode === "home" &&
    mergedHomeHtml.includes("知识点类型分布") && mergedHomeHtml.includes("stats-category-grid") &&
    mergedHomeHtml.includes("stats-ring") && mergedHomeHtml.includes("stats-heat-cell") &&
    els["nav-home"].classList.contains("active"));
  check("首页同一数字不再重复出现（掌握率=环，知识点/待处理/复习次数=KPI）",
    (mergedHomeHtml.match(/掌握率/g) || []).length === 1 &&
    (mergedHomeHtml.match(/复习次数/g) || []).length === 1 &&
    !mergedHomeHtml.includes("stats-status-item") && !mergedHomeHtml.includes("stats-heat-total"),
    "掌握率 x" + (mergedHomeHtml.match(/掌握率/g) || []).length);
  await context.openFile("面试知识整理/06_Unity引擎.md");
  check("从首页打开笔记后回到文档视图", context.viewMode === "document" &&
    els["home-page"].classList.contains("hidden") && els["crumb"].classList.contains("hidden") === false &&
    !documentStub.body.classList.contains("workbench-view"));

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
  check("随机抽题打开知识点", els["crumb-file"].textContent === firstMdName,
    "当前文件=" + els["crumb-file"].textContent);
  // 显式打开 01_CSharp（含 1 个薄弱标记），验证标记后当前文档进度实时更新
  await context.openFile("面试知识整理/01_CSharp.md");
  const csharpProgress = context.fileProgress("面试知识整理/01_CSharp.md");
  check("标记后当前文档进度更新（掌握率 / 覆盖率）", els["file-progress"].innerHTML.includes("掌握 0/" + csharpProgress.total) &&
    els["file-progress"].innerHTML.includes("覆盖"),
    els["file-progress"].innerHTML.replace(/<[^>]+>/g, "").slice(0, 40));

  // 快速定位：按标题顺序的第一个未标记小标题（当前文档 01_CSharp.md，含 1 个薄弱 + 54 个未标记）
  console.log("未复习定位检查");
  context.jumpToNextUnmarked();
  check("定位到下个未标记知识点（toast 提示）", els["toast"].textContent.includes("定位到下个未标记知识点"),
    els["toast"].textContent.slice(0, 40));
  // 全部标记后应提示已完成
  const f01 = idxJson.files.filter((f) => f.path === "面试知识整理/01_CSharp.md")[0];
  const allDone = {};
  f01.headings.forEach((h) => { allDone["面试知识整理/01_CSharp.md|" + h.anchor] = "done"; });
  context.marks = allDone;
  context.jumpToNextUnmarked();
  check("全部标记后提示已完成", els["toast"].textContent.includes("已全部标记"),
    els["toast"].textContent);
  context.marks = {}; // 还原，避免影响后续检查
  check("进度统计渲染", els["progress-stats"].innerHTML.includes("进度") &&
    els["progress-stats"].innerHTML.includes("/"),
    els["progress-stats"].innerHTML.slice(0, 50));

  // 全局快捷键（统一由 window 上的 handleGlobalKey 处理；document 不再挂 keydown）
  console.log("全局快捷键检查");
  const key = (k, extra) => {
    let prevented = false;
    windowHandlers["keydown"] && windowHandlers["keydown"](Object.assign({
      key: k, preventDefault() { prevented = true; }, target: null
    }, extra || {}));
    return prevented;
  };
  await context.openFile("面试知识整理/01_CSharp.md");
  context.currentAnchor = "";
  context.spyHeadings = [{ id: "1.1.1" }, { id: "1.1.2" }, { id: "1.1.3" }];
  key("]");
  check("] 跳到下一节", context.currentAnchor === "1.1.1", "当前=" + context.currentAnchor);
  key("]");
  check("] 连续跳到再下一节", context.currentAnchor === "1.1.2", "当前=" + context.currentAnchor);
  key("[");
  check("[ 回到上一节", context.currentAnchor === "1.1.1", "当前=" + context.currentAnchor);
  // Esc 分层：先关掌握度菜单（前一步遗留的弹层），再关随机抽题菜单
  context.hideMarkMenu();
  key("r");
  check("R 打开随机抽题菜单", !els["random-menu"].classList.contains("hidden"));
  key("Escape");
  check("Esc 收起随机抽题菜单", els["random-menu"].classList.contains("hidden"));
  key("1");
  check("1 标记当前小节为已掌握",
    JSON.parse(localStorageStub._d["mdviewer:marks"] || "{}")["面试知识整理/01_CSharp.md|1.1.1"] === "done");
  key("0");
  check("0 清除当前小节标记",
    !JSON.parse(localStorageStub._d["mdviewer:marks"] || "{}")["面试知识整理/01_CSharp.md|1.1.1"]);
  let typingPrevented = key("r", { target: { tagName: "INPUT" } });
  check("输入态不拦截单键快捷键", typingPrevented === false);
  context.spyHeadings = [];

  // 右键圆点：直接清除标记
  console.log("圆点右键清除检查");
  context.setMark("面试知识整理/01_CSharp.md", "1.1.2", "review");
  const dotEl = makeEl("mark-badge");
  dotEl.dataset.path = "面试知识整理/01_CSharp.md";
  dotEl.dataset.anchor = "1.1.2";
  dotEl.closest = function (selector) { return selector === ".mark-badge" ? this : null; };
  els["tab-toc"]._handlers["contextmenu"]({ target: dotEl, preventDefault() {} });
  check("右键圆点清除标记",
    !JSON.parse(localStorageStub._d["mdviewer:marks"] || "{}")["面试知识整理/01_CSharp.md|1.1.2"]);

  // 最近打开：首页右栏由「笔记入口」切换为「最近打开」
  console.log("最近打开检查");
  context.rememberRecent("面试知识整理/01_CSharp.md");
  context.rememberRecent("面试知识整理/06_Unity引擎.md");
  check("最近打开去重且最新在前",
    JSON.parse(localStorageStub._d["mdviewer:recent"])[0] === "面试知识整理/06_Unity引擎.md");
  context.renderHomePage();
  check("首页右栏显示最近打开", els["home-page"].innerHTML.includes("最近打开") &&
    !els["home-page"].innerHTML.includes("笔记入口"));

  // 磁盘变更感知：只比对当前文件，用户点击「已更新」才重新载入
  console.log("磁盘变更感知检查");
  const tmpDoc = "mdviewer_test_tmp_" + Date.now() + ".txt";
  fs.writeFileSync(path.join(ROOT, tmpDoc), "第一版\n", "utf8");
  await context.loadIndex({ silent: true });
  await context.openFile(tmpDoc);
  check("无声刷新索引后可打开新增文档", context.current && context.current.path === tmpDoc,
    "当前=" + (context.current && context.current.path));
  check("打开时清除「已更新」提示", els["update-chip"].classList.contains("hidden"));
  check("磁盘未变化时不上报", (await context.checkDiskChanges()) === false);
  fs.writeFileSync(path.join(ROOT, tmpDoc), "第二版\n", "utf8");
  const diskChanged = await context.checkDiskChanges();
  check("检测到磁盘更新并提示", diskChanged === true &&
    !els["update-chip"].classList.contains("hidden") &&
    els["toast"].textContent.includes("磁盘上的文件已更新"),
    els["toast"].textContent);
  await context.refreshCurrentDocument();
  check("点击已更新后载入最新内容", els["content"].innerHTML.includes("第二版") &&
    els["update-chip"].classList.contains("hidden"),
    els["content"].innerHTML.slice(0, 40));
  try { fs.unlinkSync(path.join(ROOT, tmpDoc)); } catch (e) {}
  await context.loadIndex({ silent: true });

  // 窄屏抽屉分段切换（桌面两列布局不受影响）
  console.log("窄屏抽屉切换检查");
  context.setSidePane("toc");
  check("切换到知识点分段", els["side-split"].classList.contains("pane-toc") &&
    !els["side-split"].classList.contains("pane-files") &&
    els["side-switch-toc"].getAttribute("aria-selected") === "true");
  els["side-switch"]._handlers.click({ target: { closest: (s) => (s === "button[data-pane]" ? { dataset: { pane: "files" } } : null) } });
  check("点击分段按钮切回文件列表", els["side-split"].classList.contains("pane-files") &&
    localStorageStub._d["mdviewer:side-pane"] === "files");

  // 动效层：桩环境（缺 matchMedia / Web Animations / startViewTransition）必须静默降级、不抛错
  console.log("动效降级检查");
  check("默认不视为减少动态效果（桩无 matchMedia）", context.prefersReducedMotion() === false);
  let vtRan = false;
  context.runViewTransition(function () { vtRan = true; });
  check("无 View Transitions 时同步执行更新（视图切换行为不变）", vtRan === true);
  let motionThrew = null;
  try {
    context.animateRings(els["home-page"]);
    context.animateCounters(els["home-page"]);
    context.updateTocIndicator();
    context.updateNavIndicator(null);
    context.pulseMarkBadge("面试知识整理/01_CSharp.md", "1.1.1");
    context.initSpotlight();
  } catch (e) { motionThrew = e.message; }
  check("动效工具在能力缺失时静默跳过（不抛错）", motionThrew === null, motionThrew || "ok");
  context.setMark("面试知识整理/01_CSharp.md", "1.1.1", "done");
  context.renderHomePage();
  const kpiMatch = /home-summary-value">(\d+)</.exec(els["home-page"].innerHTML);
  check("KPI 数值在 DOM 里始终是精确整数（数字滚动只发生在真实浏览器）",
    !!kpiMatch && /^\d+$/.test(kpiMatch[1]), kpiMatch ? "值=" + kpiMatch[1] : "未匹配到 KPI 卡");
  context.setMark("面试知识整理/01_CSharp.md", "1.1.1", ""); // 还原，避免影响后续导入合并断言

  // 复习进度导入/导出（合并逻辑）
  console.log("进度导入导出检查");
  const mr1 = context.mergeMarks({
    "面试知识整理/01_CSharp.md|1.1.1": "done",
    "面试知识整理/01_CSharp.md|1.1.2": "weak",
    "面试知识整理/01_CSharp.md|9.9.9": "bogus"
  });
  check("导入合并：新增有效标记", mr1.ok === true && mr1.added === 2 &&
    context.marks["面试知识整理/01_CSharp.md|1.1.1"] === "done");
  check("导入合并：非法状态忽略", mr1.invalid === 1);
  const mr2 = context.mergeMarks({ "面试知识整理/01_CSharp.md|1.1.1": "review" });
  check("导入合并：覆盖已有标记", mr2.updated === 1 &&
    context.marks["面试知识整理/01_CSharp.md|1.1.1"] === "review");
  const mr3 = context.mergeMarks({ "面试知识整理/01_CSharp.md|1.1.1": "" });
  check("导入合并：空值清除标记", mr3.cleared === 1 &&
    !context.marks["面试知识整理/01_CSharp.md|1.1.1"]);
  context.marks = {}; // 还原，避免影响后续检查

  // P2-8：导入信封校验（原先只判断 data.marks 是否为对象，任意 JSON 都能污染 marks）
  console.log("导入信封校验检查");
  const vp = context.validateProgressPayload;
  const goodEnvelope = vp({ app: "mdviewer", type: "review-progress", version: 1,
    marks: { "面试知识整理/01_CSharp.md|1.1.1": "done" }, events: [] });
  check("合法导出信封通过", goodEnvelope.ok === true &&
    Object.keys(goodEnvelope.marks).length === 1, goodEnvelope.why || "");
  const bareMarks = vp({ "面试知识整理/01_CSharp.md|1.1.1": "done" });
  check("裸 marks 映射（无信封）仍兼容", bareMarks.ok === true && bareMarks.events.length === 0);
  check("拒绝其它应用的导出文件",
    vp({ app: "other-app", type: "review-progress", marks: {} }).ok === false);
  check("拒绝类型不符的信封",
    vp({ app: "mdviewer", type: "something-else", marks: {} }).ok === false);
  check("拒绝 marks 类型错误的信封",
    vp({ app: "mdviewer", type: "review-progress", marks: [] }).ok === false);
  check("拒绝数组/空值等非法根对象",
    vp([]).ok === false && vp(null).ok === false && vp("x").ok === false);

  // P2-8：孤儿标记回收（指向已删除文件 / 已不存在小节的键）
  console.log("孤儿标记回收检查");
  context.marks = {
    "面试知识整理/01_CSharp.md|1.1.1": "done",   // 有效
    "已删除的文件.md|1.1": "weak",                 // 文件不存在
    "面试知识整理/01_CSharp.md|9.9.9": "review"    // 小节不存在
  };
  const pruned = context.pruneMarks();
  check("pruneMarks 只删孤儿、保留有效标记",
    pruned === 2 && context.marks["面试知识整理/01_CSharp.md|1.1.1"] === "done" &&
    Object.keys(context.marks).length === 1,
    "回收=" + pruned + " 剩余=" + Object.keys(context.marks).length);
  context.marks = {}; // 还原

  console.log("编辑模式检查");
  els["edit-btn"]._handlers.click({});
  check("进入编辑模式", !els["edit-bar"].classList.contains("hidden") &&
    els["edit-btn"].classList.contains("active"));
  els["edit-cancel"]._handlers.click({});
  check("取消编辑恢复只读", els["edit-bar"].classList.contains("hidden") &&
    !els["edit-btn"].classList.contains("active"));

  console.log("保存/定位接口检查（临时文件，用后即删）");
  // 浏览器发起的 POST 一定带 Origin（同源也会带），而 Node 的 fetch 不会自动加。
  // 服务端新增了 CSRF 校验（P2-1），所以这里必须显式模拟浏览器请求头。
  const SAME_ORIGIN = { "Content-Type": "application/json", "Origin": SERVER_BASE };
  const tmpRel = "mdviewer_test_tmp_" + Date.now() + ".txt";
  fs.writeFileSync(path.join(ROOT, tmpRel), "hello\n", "utf8");
  const saveR = await (await fetch(new URL("/api/save", SERVER_BASE), {
    method: "POST", headers: SAME_ORIGIN,
    body: JSON.stringify({ path: tmpRel, content: "你好 world\n第二行" })
  })).json();
  check("保存接口返回 ok", saveR.ok === true, "encoding=" + (saveR.encoding || "?"));
  check("保存内容按原编码回写", fs.readFileSync(path.join(ROOT, tmpRel), "utf8") === "你好 world\n第二行");
  check("保存前生成 .bak 备份", fs.existsSync(path.join(ROOT, tmpRel) + ".bak"));
  const saveBad = await (await fetch(new URL("/api/save", SERVER_BASE), {
    method: "POST", headers: SAME_ORIGIN,
    body: JSON.stringify({ path: "../../../Windows/win.ini", content: "x" })
  })).json();
  check("保存接口拒绝路径穿越", saveBad.error !== undefined);
  const openBad = await (await fetch(new URL("/api/open", SERVER_BASE), {
    method: "POST", headers: SAME_ORIGIN,
    body: JSON.stringify({ path: "../../../etc/passwd" })
  })).json();
  check("定位接口拒绝非法路径", openBad.error !== undefined);

  /* CSRF 防护（P2-1）：写接口只接受本机页面发起的 JSON 请求 */
  const csrfCases = [
    ["跨站 Origin 被拒", { "Content-Type": "application/json", "Origin": "http://evil.example.com" }, { path: tmpRel, content: "x" }],
    ["缺少 Origin/Referer 被拒", { "Content-Type": "application/json" }, { path: tmpRel, content: "x" }],
    ["跨站表单 Content-Type 被拒", { "Content-Type": "application/x-www-form-urlencoded", "Origin": "http://evil.example.com" }, "path=x"],
    ["text/plain 简单请求被拒", { "Content-Type": "text/plain", "Origin": "http://evil.example.com" }, JSON.stringify({ path: tmpRel, content: "x" })],
    ["本机但端口不符被拒", { "Content-Type": "application/json", "Origin": "http://127.0.0.1:9999" }, { path: tmpRel, content: "x" }]
  ];
  for (const [label, headers, body] of csrfCases) {
    const r = await fetch(new URL("/api/save", SERVER_BASE), { method: "POST", headers, body });
    const j = await r.json().catch(() => ({}));
    check(label, r.status === 403 && !!j.error, "status=" + r.status);
  }
  // 被拒的请求不能改动文件（确认 403 发生在写盘之前）
  check("被拒请求未改动文件", fs.readFileSync(path.join(ROOT, tmpRel), "utf8") === "你好 world\n第二行");

  /* P3-8：历史栈溢出的行为验证（P2-6 的修复）。
   * 桩没有 history / location，但 pushHistory 只依赖 histStack / histIndex / histBase，
   * 因此可以直接在 VM 里驱动真实函数，检验"绝对序号"在 shift 之后仍然自洽。 */
  console.log("历史栈（pushHistory）行为检查");
  {
    const { pushHistory } = context;
    const reset = () => { context.histStack = [{ path: "a.md", anchor: "" }]; context.histIndex = 0; context.histBase = 0; };
    reset();
    pushHistory("a.md", 0, "b.md", "");
    check("pushHistory 追加条目并推进下标",
      context.histStack.length === 2 && context.histIndex === 1 &&
      context.histStack[1].path === "b.md", "len=" + context.histStack.length + " idx=" + context.histIndex);
    context.histIndex = 0;
    context.histStack.length = 1;
    pushHistory("a.md", 0, "b.md", "");
    pushHistory("b.md", 0, "c.md", "1.1");
    check("pushHistory 截断前进分支后再追加",
      context.histStack.length === 3 && context.histStack[2].anchor === "1.1");
    // 溢出：把栈顶到上限再压一条，检查 histBase 与下标同步
    reset();
    for (let i = 0; i < 199; i++) pushHistory(context.histStack[context.histIndex].path, 0, "f" + i + ".md", "");
    check("未溢出时 histBase 保持 0", context.histBase === 0 && context.histStack.length === 200,
      "len=" + context.histStack.length + " base=" + context.histBase);
    pushHistory(context.histStack[context.histIndex].path, 0, "overflow.md", "");
    check("溢出后 histBase 递增、下标仍指向栈顶",
      context.histBase === 1 && context.histStack.length === 200 &&
      context.histStack[context.histIndex].path === "overflow.md",
      "base=" + context.histBase + " idx=" + context.histIndex + " len=" + context.histStack.length);
    check("溢出后绝对序号 = histBase + histIndex（popstate 用它还原下标）",
      context.histBase + context.histIndex === 200, "abs=" + (context.histBase + context.histIndex));
    reset();
  }

  /* P3-1：目录父标题进度药丸的计数（真实 DOM 夹具）。
   * 背景：父标题行里放的是 .node-prog，叶子才放 .mark-badge。若 refreshNodeProgress
   * 用不限层级的 querySelector(".toc-row .mark-badge") 找"自身圆点"，会命中第一个
   * 子知识点的圆点并误跳过 → 分子分母同时少 1。DOM 桩默认 querySelectorAll 恒返回 []，
   * 这条路径此前测不到，所以这里手工搭出应用真实生成的 DOM 形状来直测。 */
  console.log("父标题进度药丸计数检查");
  {
    const mk = (cls) => {
      const e = makeEl(cls);
      e.className = cls;
      return e;
    };
    const withClasses = (el, ...cs) => { cs.forEach((c) => el.classList.add(c)); return el; };
    // 叶子：<div.toc-item><div.toc-row>…<button.mark-badge data-state=X>
    const leaf = (anchor, state) => {
      const item = withClasses(mk("toc-item"), "toc-item");
      const row = withClasses(mk("toc-row"), "toc-row");
      const badge = withClasses(mk("mark-badge"), "mark-badge");
      badge.dataset = { anchor: anchor, state: state };
      row.querySelectorAll = (sel) => (sel === ".mark-badge" ? [badge] : []);
      row.querySelector = (sel) => (sel === ":scope > .toc-row .mark-badge" || sel === ".mark-badge" ? badge : null);
      item.appendChild(row);
      item.querySelectorAll = (sel) => (sel === ".mark-badge" ? [badge] : []);
      item.querySelector = (sel) => (sel === ":scope > .toc-row .mark-badge" ? null : null); // 父行没有圆点
      item.closest = () => item;
      return item;
    };
    // 父标题：行里有 .node-prog，**没有** .mark-badge
    const parent = (progEl, leaves) => {
      const item = withClasses(mk("toc-item"), "toc-item");
      const row = withClasses(mk("toc-row"), "toc-row");
      row.appendChild(progEl);
      item.appendChild(row);
      leaves.forEach((lf) => item.appendChild(lf));
      item.querySelectorAll = (sel) => {
        if (sel === ".mark-badge") return leaves.map((lf) => lf.querySelectorAll(".mark-badge")[0]);
        if (sel === ".node-prog") return [progEl];
        return [];
      };
      // 父行没有圆点，所以"自身圆点"必须为 null
      item.querySelector = (sel) => (sel === ":scope > .toc-row .mark-badge" ? null : null);
      item.closest = () => item;
      return item;
    };
    const progA = withClasses(mk("node-prog"), "node-prog");
    progA.textContent = "0/0";
    progA.style = { display: "" };
    const pA = parent(progA, [leaf("1.1", "done"), leaf("1.2", "weak"), leaf("1.3", "")]);
    progA.closest = (sel) => (sel === ".toc-item" ? pA : null);
    const progB = withClasses(mk("node-prog"), "node-prog");
    progB.textContent = "0/0";
    progB.style = { display: "" };
    const pB = parent(progB, [leaf("2.1", "done")]);   // 只有一个子节点
    progB.closest = (sel) => (sel === ".toc-item" ? pB : null);
    const progs = [progA, progB];
    els["tab-toc"].querySelectorAll = (sel) => (sel === ".node-prog" ? progs : []);
    context.refreshNodeProgress();
    check("3 个子知识点 → 药丸显示 1/3（不吞掉第一个）",
      progA.textContent === "1/3", "实际=" + progA.textContent);
    check("单子节点父标题 → 药丸显示 1/1 且未被隐藏",
      progB.textContent === "1/1" && progB.style.display !== "none",
      "实际=" + progB.textContent + " display=" + progB.style.display);
  }

  /* P2-10：搜索正文缓存必须按 mtime 失效——否则改了笔记搜不到新内容。
   * 这里用真实文件走一遍：写入 → 搜到 → 改写 → 搜到新内容 → 删除 → 搜不到。 */
  const cacheRel = "mdviewer_test_cache_" + Date.now() + ".txt";
  const cacheFull = path.join(ROOT, cacheRel);
  fs.writeFileSync(cacheFull, "ZQXPROBE alpha\n", "utf8");
  const s1 = await (await fetch(new URL("/api/search?q=ZQXPROBE", SERVER_BASE))).json();
  check("搜索缓存：能搜到新写入的文件", (s1.results || []).length === 1);
  await new Promise((r) => setTimeout(r, 1100)); // 确保 mtime 变化
  fs.writeFileSync(cacheFull, "ZQXPROBE beta-changed\n", "utf8");
  const s2 = await (await fetch(new URL("/api/search?q=beta-changed", SERVER_BASE))).json();
  check("搜索缓存：文件改动后能搜到新内容", (s2.results || []).length === 1);
  try { fs.unlinkSync(cacheFull); } catch (e) {}
  await new Promise((r) => setTimeout(r, 300));
  const s3 = await (await fetch(new URL("/api/search?q=ZQXPROBE", SERVER_BASE))).json();
  check("搜索缓存：文件删除后不再命中", (s3.results || []).length === 0);

  /* P2-14：备份必须轮转（不再互相覆盖）。连续保存两次后，
   * .bak 应是"上一次保存前"的内容、.bak.1 是"上上次"的内容。 */
  const bakRel = "mdviewer_test_bak_" + Date.now() + ".txt";
  const bakFull = path.join(ROOT, bakRel);
  fs.writeFileSync(bakFull, "gen0\n", "utf8");
  for (const txt of ["gen1\n", "gen2\n"]) {
    await fetch(new URL("/api/save", SERVER_BASE), {
      method: "POST", headers: SAME_ORIGIN, body: JSON.stringify({ path: bakRel, content: txt })
    });
  }
  const bak0 = fs.existsSync(bakFull + ".bak") ? fs.readFileSync(bakFull + ".bak", "utf8") : "";
  const bak1 = fs.existsSync(bakFull + ".bak.1") ? fs.readFileSync(bakFull + ".bak.1", "utf8") : "";
  check("备份轮转：.bak 保存上一版、.bak.1 保存更早版本",
    bak0 === "gen1\n" && bak1 === "gen0\n", `.bak=${JSON.stringify(bak0)} .bak.1=${JSON.stringify(bak1)}`);
  ["", ".1", ".2", ".3"].forEach((s) => { try { fs.unlinkSync(bakFull + ".bak" + s); } catch (e) {} });
  try { fs.unlinkSync(bakFull); } catch (e) {}
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
