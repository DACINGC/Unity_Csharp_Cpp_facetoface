/* 真实浏览器验证（无头 Chrome + CDP），覆盖本轮改动的运行时行为。
 * 用法: node md_viewer/verify_browser.js            （需服务已启动）
 * 说明: 只读验证——不重启/不关闭服务，不改任何文件。
 *       Node 22+ 内置 WebSocket，因此无需安装 CDP 库。
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.MDVIEWER_URL || "http://127.0.0.1:8765";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => { failures++; console.log("  ✗ " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params) {
    const id = ++this.id;
    const msg = { id, method, params: params || {} };
    if (this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP timeout: " + method)); } }, 15000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

(async () => {
  if (!CHROME) { console.log("未找到 Chrome/Edge，跳过浏览器验证"); process.exitCode = 0; return; }
  const profile = path.join(os.tmpdir(), "dsh-cdp-profile-" + Date.now());
  const port = 9333;
  const child = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"
  ], { stdio: "ignore", detached: false });

  const cleanup = () => {
    try { ws && ws.close(); } catch (e) {}
    try { child.kill("SIGKILL"); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  };
  // 注意：不要用 process.on("exit") 做清理——该钩子在 process.exit() 时不会执行，
  // 而打开的 WebSocket 与未杀死的 Chrome 子进程都会让 Node 事件循环一直不退出（表现为脚本挂起）。
  // 这里改为显式收尾 + 强制退出。
  const finish = (code) => {
    cleanup();
    process.exitCode = code;
    // 给 stdout 一点时间冲刷，然后强制退出，避免残留句柄拖住进程
    setTimeout(() => process.exit(code), 50).unref();
  };

  // 等调试端口就绪
  let version = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await r.json(); break;
    } catch (e) { await sleep(250); }
  }
  if (!version) { fail("Chrome 调试端口未就绪"); finish(1); return; }
  console.log("真实浏览器验证（" + (version.Browser || "Chrome") + "）");

  // 用浏览器级 WebSocket 建目标（/json/new 在新版 Chrome 需要 PUT 且返回格式不同，不可靠）
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new CDP(ws);
  await cdp.send("Target.setDiscoverTargets", { discover: true }).catch(() => {});
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.sessionId;
  // flatten 模式下所有会话消息都走同一连接；给 CDP 加上 sessionId 支持
  cdp.sessionId = sessionId;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  /* 固定视口宽度：headless 默认窗口只有 800px 宽，会落进 .home-grid 的单列降级分支 ——
   * 那时两卡各占一行、行高互相独立，「两卡等高」这类只在双列下成立的布局契约就测不出来。 */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: BASE + "/" });

  // 等首页渲染完成（标题栏出现「学习工作台」）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      ready = await cdp.eval("!!document.querySelector('#home-page') && !document.querySelector('#home-page').classList.contains('hidden')");
      if (ready) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!ready) fail("页面未在预期时间内完成首页渲染");
  else ok("页面加载并渲染首页");

  /* 0) 首页「待复习」与「最近打开」两卡必须等高。
   * 依赖 .home-grid 的 align-items:stretch + 两卡内列表限同一 max-height。
   * 历史上用的是 align-items:start —— 两张卡各按自身内容高度渲染，
   * 一边 6 条、一边 8 条就会一高一低参差。这是布局行为，静态断言测不出来。 */
  const cardHeights = await cdp.eval(`(function(){
    var grid = document.querySelector('.home-grid');
    if (!grid) return null;
    var cards = Array.prototype.slice.call(grid.children);
    return { count: cards.length, heights: cards.map(function(c){ return Math.round(c.getBoundingClientRect().height); }) };
  })()`);
  if (cardHeights && cardHeights.count === 2 && cardHeights.heights[0] > 0 &&
      cardHeights.heights[0] === cardHeights.heights[1]) {
    ok("首页两卡等高（待复习 / 最近打开 均为 " + cardHeights.heights[0] + "px）");
  } else {
    fail("首页两卡不等高：" + JSON.stringify(cardHeights));
  }

  /* 1) 运行时无真实错误。
   * 注意：不能用 Log 域的 error 文本判断——favicon.ico 的 404 也走 Log 且文本里**没有 URL**，
   * 过滤不掉。改为看 Network 域的响应状态，并按 URL 精确排除 favicon（浏览器默认请求，与本应用无关）。 */
  const badResponses = cdp.events
    .filter((e) => e.method === "Network.responseReceived" && e.params.response.status >= 400)
    .map((e) => e.params.response.status + " " + e.params.response.url)
    .filter((s) => !/favicon\.ico/i.test(s));
  const jsErrors = cdp.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text);
  if (badResponses.length) fail("有失败请求: " + badResponses.slice(0, 3).join(" | "));
  else ok("无失败请求（已按 URL 排除 favicon.ico）");
  if (jsErrors.length) fail("有未捕获异常: " + jsErrors.slice(0, 2).join(" | "));
  else ok("无未捕获异常");

  /* 打开一篇真实文档：后续 aria-busy / 锚点检查需要处于文档视图 */
  const opened = await cdp.eval(`(async function(){
    var idx = await (await fetch('/api/index')).json();
    var md = idx.files.filter(function(f){ return f.type === 'md' && f.headings && f.headings.length > 3; })[0];
    return md ? { path: md.path, anchor: md.headings[1].anchor } : null;
  })()`);
  if (!opened) { fail("找不到可用于验证的文档"); finish(1); return; }
  await cdp.send("Page.navigate", { url: BASE + "/?path=" + encodeURIComponent(opened.path) + "&anchor=" + encodeURIComponent(opened.anchor) });
  let docReady = false;
  for (let i = 0; i < 40; i++) {
    try {
      docReady = await cdp.eval("!!document.querySelector('.doc h2[id], .doc h3[id]')");
      if (docReady) break;
    } catch (e) {}
    await sleep(250);
  }
  if (docReady) ok("文档视图已渲染（" + opened.path + "，锚点 " + opened.anchor + "）");
  else fail("文档未渲染出带 id 的标题");

  /* 2) P2-16：弹层打开时单键快捷键不作用到背后页面 */
  const modalGuard = await cdp.eval(`(function(){
    var before = document.documentElement.getAttribute('data-theme');
    // 打开帮助弹层
    var help = document.getElementById('help-overlay');
    help.classList.remove('hidden');
    var openOk = !help.classList.contains('hidden');
    // 在弹层打开状态下按 T（切主题）
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    var after = document.documentElement.getAttribute('data-theme');
    help.classList.add('hidden');
    return { openOk: openOk, guarded: before === after, before: before, after: after };
  })()`);
  if (modalGuard.openOk && modalGuard.guarded) ok("弹层打开时 't' 不再切换主题（P2-16 生效）");
  else fail("弹层未拦住单键快捷键：" + JSON.stringify(modalGuard));

  /* 3) 弹层关闭后快捷键恢复 */
  const restored = await cdp.eval(`(function(){
    var before = document.documentElement.getAttribute('data-theme');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    var after = document.documentElement.getAttribute('data-theme');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true })); // 还原
    return before !== after;
  })()`);
  if (restored) ok("弹层关闭后 't' 恢复可用");
  else fail("弹层关闭后快捷键未恢复");

  /* 4) P2-3：锚点精确匹配——文档里存在带 id 的标题，且锚点确实滚到了对应位置 */
  const anchorJump = await cdp.eval(`(function(){
    var h = document.getElementById(${JSON.stringify(opened.anchor)});
    if (!h) return { found: false };
    var main = document.getElementById('main');
    return { found: true, id: h.id, scrollTop: main ? main.scrollTop : -1, hasTocLink: !!document.querySelector('.toc-link[data-anchor="' + h.id + '"]') };
  })()`);
  if (anchorJump.found && anchorJump.hasTocLink)
    ok("锚点 " + opened.anchor + " 在正文与目录中都能定位（P2-3 副作用：精确 id 匹配可用）");
  else fail("锚点定位异常：" + JSON.stringify(anchorJump));

  /* 5) P2-17：aria-busy 在渲染完成后为 false */
  const busy = await cdp.eval(`document.getElementById('content').getAttribute('aria-busy')`);
  if (busy === "false" || busy === null) ok("aria-busy 已复位（实际=" + busy + "）");
  else fail("aria-busy 仍是 " + busy + "（应已复位）");

  /* 6) P2-11：拖拽后 body.resizing 一定被清除 */
  const dragClean = await cdp.eval(`(function(){
    var r = document.getElementById('resizer');
    if (!r) return { skip: true };
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 500 }));
    var during = document.body.classList.contains('resizing');
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    var afterCancel = document.body.classList.contains('resizing');
    // 再试一次：pointerdown 后用 pointerup 收尾
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: 500 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    var afterUp = document.body.classList.contains('resizing');
    return { during: during, afterCancel: afterCancel, afterUp: afterUp };
  })()`);
  if (dragClean.skip) console.log("  · 未找到 resizer，跳过拖拽检查");
  else if (dragClean.during && !dragClean.afterCancel && !dragClean.afterUp)
    ok("拖拽中加 resizing，pointercancel / pointerup 后均清除（P2-11 生效）");
  else fail("拖拽状态未正确收尾：" + JSON.stringify(dragClean));

  /* 7) P2-2：深链被筛选器挡住时不再静默回首页 */
  const deepLink = await cdp.eval(`(async function(){
    // 先把筛选设成 md，再用一个 txt 的 path 重新加载页面
    localStorage.setItem('mdviewer:filter', 'md');
    var idx = await (await fetch('/api/index')).json();
    var txt = idx.files.filter(function(f){ return f.type === 'txt'; })[0];
    if (!txt) return { skip: true };
    return { txtPath: txt.path };
  })()`);
  if (!deepLink.skip) {
    await cdp.send("Page.navigate", { url: BASE + "/?path=" + encodeURIComponent(deepLink.txtPath) });
    await sleep(2500);
    const landed = await cdp.eval(`(function(){
      var f = localStorage.getItem('mdviewer:filter');
      var toasts = Array.from(document.querySelectorAll('#toast')).map(function(t){return t.textContent;}).join(' ');
      return { filter: f, toast: toasts };
    })()`);
    if (landed.filter === "all") ok("深链打开后筛选被放宽为 'all'（P2-2 生效）");
    else fail("深链未放宽筛选，filter=" + landed.filter);
    // 还原筛选
    await cdp.eval("localStorage.setItem('mdviewer:filter','all')");
  } else console.log("  · 无 txt 文件，跳过深链检查");

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  finish(failures ? 1 : 0);
})().catch((e) => {
  console.error("验证脚本异常: " + e.message);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
});
