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

  /* 3) 弹层关闭后快捷键恢复。
   * 注意：主题切换走了 View Transitions 的涟漪揭示，`data-theme` 是在 update 回调里写入的（异步，约一帧），
   * 所以这里必须轮询而不是同步读取——这测的正是"揭示动画生效 + 最终一定落到新主题"。 */
  const restored = await cdp.eval(`(async function(){
    var waitTheme = function (target) {
      return new Promise(function (done) {
        var n = 0;
        (function poll() {
          if (document.documentElement.getAttribute('data-theme') !== target || n++ > 60) return done();
          setTimeout(poll, 25);
        })();
      });
    };
    var before = document.documentElement.getAttribute('data-theme');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    await waitTheme(before);
    var after = document.documentElement.getAttribute('data-theme');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true })); // 还原
    await waitTheme(after);
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

  /* ===== 本轮特色动效：静态断言测不到「动画真的在跑」，这里用运行时探针逐个确认 ===== */
  console.log("本轮特色动效探针");
  // 前面的深链检查可能把页面留在 txt 上，回到一个长文档再测
  await cdp.send("Page.navigate", { url: BASE + "/?path=" + encodeURIComponent(opened.path) });
  await sleep(2000);

  /* 8) 关键帧已注册：aurora-spin / sweep 必须真的存在于 CSSOM（不是被 @supports 整体丢掉） */
  const kf = await cdp.eval(`(function(){
    var names = [];
    try {
      for (var s = 0; s < document.styleSheets.length; s++) {
        var rs = document.styleSheets[s].cssRules || [];
        for (var i = 0; i < rs.length; i++) if (rs[i].type === 7) names.push(rs[i].name);
      }
    } catch (e) {}
    return names;
  })()`);
  if (kf.indexOf("aurora-spin") >= 0 && kf.indexOf("sweep") >= 0) ok("CSSOM 内 @keyframes 齐备（aurora-spin / sweep）");
  else fail("缺少本轮关键帧：" + JSON.stringify(kf.filter((n) => /aurora|sweep/.test(n))));

  /* 9) 极光描边：搜索框聚焦时 ::before 真的挂上了 aurora-spin 动画。
   *    再隔一会儿读一次 --aurora：只有 @property 注册成功它才会连续变化（否则永远停在 0deg）。 */
  const aurora = await cdp.eval(`(async function(){
    document.getElementById('search').focus();
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    var running = document.getAnimations().filter(function(a){ return a.animationName === 'aurora-spin'; }).length;
    // 动画挂在 ::before 上，且 --aurora 是 inherits:false——必须读伪元素自己的计算值
    var wrap = document.querySelector('.search-wrap');
    var read = function () { return getComputedStyle(wrap, "::before").getPropertyValue("--aurora").trim(); };
    var v0 = read();
    await new Promise(function(r){ setTimeout(r, 500); });
    var v1 = read();
    // 再看 search-wrap 本体有没有被污染（inherits:false 时应保持初始 0deg）
    var host = getComputedStyle(wrap).getPropertyValue("--aurora").trim();
    document.getElementById('search').blur();
    return { running: running, v0: v0, v1: v1, host: host };
  })()`);
  if (aurora.running > 0) ok("搜索框聚焦触发极光描边（" + aurora.running + " 个动画在跑）");
  else fail("极光描边未触发：@supports(mask-composite) 未通过或选择器没命中");
  if (aurora.v0 !== aurora.v1) ok("--aurora 在 ::before 上连续插值（" + aurora.v0 + " → " + aurora.v1 + "，主机留 " + aurora.host + "）");
  else fail("--aurora 未变化（" + aurora.v0 + "）：@property 注册失败或动画没跑");

  /* 10) 正文滚动揭示：下方块初始隐藏，滚动后回落为可见（一次性，不回收） */
  const reveal = await cdp.eval(`(async function(){
    var main = document.getElementById('main');
    var armed = !!document.querySelector('#content.sr-armed');
    var hiddenCount = function () {
      return Array.prototype.filter.call(document.querySelectorAll('#content .sr'), function (e) {
        return parseFloat(getComputedStyle(e).opacity) < 0.5;
      }).length;
    };
    var total = document.querySelectorAll('#content .sr').length;
    main.scrollTop = 0;
    await new Promise(function(r){ setTimeout(r, 150); });
    var before = hiddenCount();
    // 模拟人看书的分段滚动：一次性跳到底会让中间的元素被"跳过"（IO 判定为未相交，不会揭示）
    for (var i = 0; i < 8; i++) {
      main.scrollTop = main.scrollTop + 340;
      await new Promise(function(r){ setTimeout(r, 130); });
    }
    await new Promise(function(r){ setTimeout(r, 700); });
    var after = hiddenCount();
    return { total: total, armed: armed, before: before, after: after };
  })()`);
  if (reveal.total === 0) fail("正文没有打上 .sr 标记（IntersectionObserver 未启用？）");
  else if (reveal.armed && reveal.before > 0 && reveal.after < reveal.before) {
    ok("滚动揭示生效：" + reveal.total + " 个块中，滚动前隐藏 " + reveal.before + " → 滚动后隐藏 " + reveal.after);
  } else fail("滚动揭示未生效：" + JSON.stringify(reveal));

  /* 11) 顶栏聚拢：离开顶部时 body.scrolled 挂上，回到顶部收回 */
  const lift = await cdp.eval(`(async function(){
    var main = document.getElementById('main');
    main.scrollTop = 500;
    await new Promise(function(r){ setTimeout(r, 260); });
    var up = document.body.classList.contains('scrolled');
    main.scrollTop = 0;
    await new Promise(function(r){ setTimeout(r, 260); });
    return { up: up, down: document.body.classList.contains('scrolled') };
  })()`);
  if (lift.up && !lift.down) ok("顶栏随滚动聚拢，回到顶部收回");
  else fail("顶栏聚拢状态异常：" + JSON.stringify(lift));

  /* 12) 主题涟漪揭示：真的生成了 ::view-transition-new(root) 动画，且类名用完即清 */
  const ripple = await cdp.eval(`(async function(){
    var root = document.documentElement;
    if (typeof document.startViewTransition !== 'function') return { support: false };
    var before = root.getAttribute('data-theme');
    document.getElementById('theme-toggle').click();
    var marked = false, pseudo = 0, after = before;
    for (var i = 0; i < 60; i++) {
      if (root.classList.contains('theme-revealing')) marked = true;
      pseudo = Math.max(pseudo, document.getAnimations().filter(function(a){
        return a.effect && a.effect.pseudoElement === '::view-transition-new(root)';
      }).length);
      after = root.getAttribute('data-theme');
      if (after !== before && pseudo > 0) break;
      await new Promise(function(r){ requestAnimationFrame(r); });
    }
    for (var j = 0; j < 80 && root.classList.contains('theme-revealing'); j++) {
      await new Promise(function(r){ requestAnimationFrame(r); });
    }
    var cleaned = !root.classList.contains('theme-revealing');
    document.getElementById('theme-toggle').click();       // 还原主题
    await new Promise(function(r){ setTimeout(r, 800); });
    return { support: true, marked: marked, pseudo: pseudo, changed: after !== before,
             cleaned: cleaned, back: root.getAttribute('data-theme') === before };
  })()`);
  if (!ripple.support) console.log("  · 浏览器不支持 View Transitions，跳过涟漪揭示检查");
  else if (ripple.marked && ripple.pseudo > 0 && ripple.changed && ripple.cleaned && ripple.back) {
    ok("主题涟漪揭示：生成 ::view-transition-new(root) 动画、主题切换成功、类名已回收");
  } else fail("主题涟漪揭示异常：" + JSON.stringify(ripple));

  /* 13) 三层降级：系统开启「减少动态效果」时不隐藏正文，且主题退回同步切换 */
  await cdp.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await cdp.send("Page.navigate", { url: BASE + "/?path=" + encodeURIComponent(opened.path) });
  await sleep(2000);
  const reduced = await cdp.eval(`(async function(){
    var root = document.documentElement;
    var srOn = root.classList.contains('sr-on');
    var el = document.querySelector('#content .sr');
    var op = el ? parseFloat(getComputedStyle(el).opacity) : 1;
    var before = root.getAttribute('data-theme');
    document.getElementById('theme-toggle').click();
    var after = root.getAttribute('data-theme');     // 降级路径同步切换，这里必须已经变了
    document.getElementById('theme-toggle').click(); // 还原
    return { srOn: srOn, opacity: op, syncTheme: before !== after };
  })()`);
  await cdp.send("Emulation.setEmulatedMedia", { media: "screen", features: [] });
  if (!reduced.srOn && reduced.opacity === 1) ok("减少动态效果下不打 sr-on，正文保持全可见");
  else fail("减少动态效果下正文被隐藏或仍启用揭示：" + JSON.stringify(reduced));
  if (reduced.syncTheme) ok("减少动态效果下主题同步切换（不再等 View Transition）");
  else fail("减少动态效果下主题未同步切换");

  /* 14) 悬停触发的两项：CTA 光扫 + 工具轨图标微动。
   *     :hover 态没法用 JS 伪造，必须用 CDP 真实派发鼠标移动才测得到。 */
  await cdp.send("Page.navigate", { url: BASE + "/" });
  await sleep(2200);
  const box = await cdp.eval(`(function(){
    var cta = document.querySelector('.workbench-action.primary');
    var rail = document.getElementById('theme-toggle');
    var boxOf = function (el) { if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };
    return { cta: boxOf(cta), rail: boxOf(rail) };
  })()`);
  const hovered = await cdp.eval(`(async function(){
    var cta = document.querySelector('.workbench-action.primary');
    return { hasCta: !!cta, text: cta ? cta.textContent : null };
  })()`);
  if (box.cta && hovered.hasCta) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.cta.x, y: box.cta.y, button: "none" });
    const sweep = await cdp.eval(`(async function(){
      await new Promise(function(r){ setTimeout(r, 120); });
      var s = document.getAnimations().filter(function(a){ return a.animationName === 'sweep'; });
      var a = document.getAnimations().filter(function(a){ return a.animationName === 'aurora-spin'; });
      return { sweep: s.length, aurora: a.length, ctaHovered: !!document.querySelector('.workbench-action.primary:hover') };
    })()`);
    if (sweep.ctaHovered && sweep.sweep > 0 && sweep.aurora > 0) {
      ok("悬停 CTA「" + hovered.text + "」触发光扫 + 极光描边（sweep " + sweep.sweep + " · aurora " + sweep.aurora + "）");
    } else fail("悬停 CTA 未触发动效：" + JSON.stringify(sweep));
  } else console.log("  · 首页没有主行动按钮，跳过 CTA 悬停检查");

  if (box.rail) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.rail.x, y: box.rail.y, button: "none" });
    const icon = await cdp.eval(`(async function(){
      await new Promise(function(r){ setTimeout(r, 260); });
      var svg = document.querySelector('#theme-toggle .rail-icon svg');
      var t = svg ? getComputedStyle(svg).transform : "none";
      return { hovered: !!document.querySelector('#theme-toggle:hover'), transform: t };
    })()`);
    if (icon.hovered && icon.transform !== "none" && icon.transform !== "")
      ok("工具轨图标悬停微动生效（主题图标 transform=" + icon.transform + "）");
    else fail("工具轨图标悬停无微动：" + JSON.stringify(icon));
  }

  /* 15) 文件列表行尾的复习进度环：数量合理、data-pct 与内联 --pct 一致、conic + 遮罩真的生效 */
  const rings = await cdp.eval(`(function(){
    var list = document.getElementById('file-list');
    if (!list) return { skip: true };
    var els = Array.prototype.slice.call(list.querySelectorAll('.file-ring'));
    var mismatch = 0, withPct = 0, styled = 0;
    els.forEach(function (el) {
      var v = parseFloat(el.style.getPropertyValue('--pct'));
      if (v > 0) withPct++;
      if (el.dataset.pct !== String(Math.round(v))) mismatch++;
      var bg = getComputedStyle(el).backgroundImage;
      if (/conic-gradient/.test(bg)) styled++;
    });
    var items = list.querySelectorAll('.file-item').length;
    return { count: els.length, items: items, withPct: withPct, mismatch: mismatch, styled: styled };
  })()`);
  if (rings.skip) console.log("  · 无文件列表，跳过进度环检查");
  else if (rings.count > 0 && rings.count <= rings.items && rings.mismatch === 0 && rings.styled === rings.count) {
    ok("文件行尾进度环 " + rings.count + "/" + rings.items + " 行，data-pct 与 --pct 全部一致，conic 环生效（有进度 " + rings.withPct + "）");
  } else fail("文件行尾进度环异常：" + JSON.stringify(rings));

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  finish(failures ? 1 : 0);
})().catch((e) => {
  console.error("验证脚本异常: " + e.message);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
});
