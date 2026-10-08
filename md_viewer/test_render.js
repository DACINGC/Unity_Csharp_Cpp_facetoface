/* 渲染器与跳转逻辑回归测试（Node.js，无需安装任何依赖）
 * 用法: node md_viewer/test_render.js
 * 覆盖:
 *   1. 10 个真实 md 文档逐文件渲染，校验 表格/代码块/标题/§引用 数量与源码一致
 *   2. HTML 转义正确性：源码中的裸 < >（如 List<T>、GetComponent<T>()）必须被转义
 *   3. 跨文件 § 引用可解析性：全文所有 §x.y.z 都能在章节索引中定位（精确或最长前缀）
 *   4. 标题锚点 id 齐全
 */
"use strict";

const fs = require("fs");
const path = require("path");
const R = require("./renderer.js");

const ROOT = path.join(__dirname, "..");
const NOTES = path.join(ROOT, "面试知识整理");

/** 递归收集全部 md（与服务端 iter_docs 同口径：跳过 . 开头目录、md_viewer 与 README.md） */
function collectMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "md_viewer") continue;
      out.push(...collectMd(full));
    } else if (e.name.endsWith(".md") && e.name !== "README.md") {
      out.push(full);
    }
  }
  return out;
}

// 逐文件渲染校验仍只覆盖 面试知识整理/（首个文档的断言被 test_app.js 依赖）
const files = fs.readdirSync(NOTES).filter((f) => f.endsWith(".md")).sort();
// 章节索引必须覆盖全库：跨层引用（如 01_CSharp 里的 §8.9.1 → 项目知识整理）只靠本目录会误报
const allMd = collectMd(ROOT);
let failures = 0;

function fail(msg) { failures++; console.log("  ✗ " + msg); }
function ok(msg) { console.log("  ✓ " + msg); }

function count(hay, re) { const m = hay.match(re); return m ? m.length : 0; }

/* ---------- 构建章节索引（与服务端算法一致：编号前缀，首现优先） ---------- */
const sections = {};
const fileHeadings = {};
for (const fn of files) {
  let text = fs.readFileSync(path.join(NOTES, fn), "utf8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const heads = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const clean = m[2].replace(/[`*_~>]/g, "").trim();
    const nm = /^(\d+(?:\.\d+)*)/.exec(clean);
    const number = nm ? nm[1] : "";
    if (number && !(number in sections)) sections[number] = { file: fn, anchor: number };
    heads.push({ level: m[1].length, number, anchor: number || R.slugify(clean) });
  }
  fileHeadings[fn] = heads;
}

function resolveSec(sec) {
  let hit = sections[sec];
  if (!hit) {
    const parts = sec.split(".");
    while (parts.length > 1 && !hit) { parts.pop(); hit = sections[parts.join(".")]; }
  }
  // 裸章号兜底：§9 这类引用落到"第 9 篇文档"的首页标题（见下方 docChapters）
  if (!hit && /^\d+$/.test(sec) && docChapters[sec]) hit = docChapters[sec];
  return hit;
}

/* ---------- 逐文件渲染校验 ---------- */
for (const fn of files) {
  let text = fs.readFileSync(path.join(NOTES, fn), "utf8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);

  // 期望值（与渲染器同规则）
  const expTables = (() => {
    let c = 0, i = 0;
    while (i < lines.length) {
      if (/^\|/.test(lines[i].trim()) && i + 1 < lines.length && /^\|?[\s:|-]+\|?\s*$/.test(lines[i + 1].trim())) { c++; while (i < lines.length && /^\|/.test(lines[i].trim())) i++; continue; }
      i++;
    }
    return c;
  })();
  // 期望代码块数：按围栏状态机统计开合配对，而不是 `数 ``` 再除以 2`。
  // 后者一旦围栏数不成对（例如行内出现 ``` 或正文里的示例围栏）就会算出小数，
  // 属于测试自身的缺陷（曾把 3 个块算成 2 个）。
  const expFences = (() => {
    let c = 0, open = false;
    for (const l of lines) {
      if (/^```/.test(l.trim())) { if (!open) c++; open = !open; }
    }
    return c;
  })();
  // 期望标题数：**排除代码围栏内**的 `#` 行。原实现直接数原文里的 `^#{1,4}\s`，
  // 笔记里一旦出现围栏内的注释标题（如 ```sh 里的 `# 注释`）就会误报——错的是测试不是渲染器。
  const expHeadings = (() => {
    let c = 0, open = false;
    for (const l of lines) {
      if (/^```/.test(l.trim())) { open = !open; continue; }
      if (!open && /^#{1,4}\s/.test(l)) c++;
    }
    return c;
  })();
  // 期望 § 链接数：与渲染器同规则 —— 代码围栏内的 § 不会转为链接
  const expSecRefs = count(text.replace(/```[\s\S]*?```/g, ""), /§\d+(?:\.\d+)+/g);

  const html = R.renderMarkdown(text);

  console.log(fn + ` (${lines.length} 行)`);
  const checks = [
    ["表格数", count(html, /<table>/g), expTables],
    ["代码块数", count(html, /<pre><code/g), expFences],
    ["标题数", count(html, /<h[1-4] /g), expHeadings],
    ["§引用链接数", count(html, /class="sec-ref"/g), expSecRefs],
  ];
  let fileOk = true;
  for (const [label, got, exp] of checks) {
    if (got === exp) ok(`${label}: ${got}`);
    else { fail(`${label}: 期望 ${exp}，实际 ${got}`); fileOk = false; }
  }

  // 转义检查：渲染结果中不允许出现未转义的裸 <（非标签、非实体）
  const stripped = html.replace(/&lt;/g, "").replace(/<[a-zA-Z/!][^>]*>/g, "");
  if (stripped.includes("<")) {
    const idx = stripped.indexOf("<");
    fail(`存在未转义的裸 < : ...${stripped.slice(Math.max(0, idx - 30), idx + 30)}...`);
    fileOk = false;
  } else ok("HTML 转义正确（无裸 <）");

  // P3-6：属性上下文检查。原来的"无裸 <"只看文本，看不见属性里被塞进引号或事件属性。
  const attrInjection = [];
  const attrRe = /\s(?:id|class|title|href|data-[a-z-]+|aria-[a-z-]+)="([^"]*)"/g;
  let am;
  while ((am = attrRe.exec(html)) !== null) {
    if (/["'<>]|^\s*javascript:/i.test(am[1])) attrInjection.push(am[1].slice(0, 40));
  }
  if (attrInjection.length) {
    fail(`属性值中出现未转义的引号/尖括号或危险 scheme：${attrInjection.slice(0, 3).join(" | ")}`);
    fileOk = false;
  } else ok("属性上下文转义正确（无引号闭合/危险 scheme）");
  // 只检查**真实标签内部**是否出现内联事件属性。
  // 注意：不能直接用 /\son\w+=/ 扫全文——正文里出现 "onerror=" 这类字样（本笔记讲安全时就有）
  // 会被误判为注入。所以先切出标签内的属性区，再看属性名是否为 on*。
  const eventAttrs = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let tm;
  while ((tm = tagRe.exec(html)) !== null) {
    const attrs = tm[2];
    for (const am2 of attrs.matchAll(/(^|\s)(on[a-z]+)\s*=/gi)) eventAttrs.push(tm[1] + " " + am2[2]);
  }
  if (eventAttrs.length) {
    fail(`渲染结果中出现内联事件属性：${[...new Set(eventAttrs)].slice(0, 3).join(", ")}`);
    fileOk = false;
  } else ok("无内联事件属性（on*）");

  // 标题锚点存在性
  let anchorMiss = 0;
  for (const h of fileHeadings[fn]) {
    if (h.number && !html.includes(`id="${h.anchor}"`)) anchorMiss++;
  }
  if (anchorMiss) { fail(`缺少 ${anchorMiss} 个标题锚点`); fileOk = false; }
  else ok("标题锚点齐全");

  if (fileOk) ok("→ 文件通过");
  else console.log("  → 文件未通过");
}

/* ---------- 全库 § 引用可解析性（含跨文件跳转） ---------- */
console.log("\n§ 引用可解析性检查");
// 索引重建为"全库"：上面的 fileHeadings 只登记了 面试知识整理/，
// 跨层引用（如 01_CSharp §8.9.1 → 项目知识整理/08）必须也能解析。
for (const k of Object.keys(sections)) delete sections[k];
for (const full of allMd) {
  let t = fs.readFileSync(full, "utf8");
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  for (const line of t.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const clean = m[2].replace(/[`*_~>]/g, "").trim();
    const nm = /^(\d+(?:\.\d+)*)/.exec(clean);
    if (nm && !(nm[1] in sections)) sections[nm[1]] = { file: path.relative(ROOT, full), anchor: nm[1] };
  }
}
console.log(`  索引覆盖全库 ${allMd.length} 个 md 文件，${Object.keys(sections).length} 个章节编号`);
// 文档级章号（与服务端 build_index 一致）：文件名前导序号 -> 该篇第一个标题，
// 用于解析 §9 这类"指向整篇"的裸章号引用。
const docChapters = {};
for (const full of allMd) {
  const nm = /^(\d+)_/.exec(path.basename(full));
  if (!nm || docChapters[String(parseInt(nm[1], 10))]) continue;
  let t = fs.readFileSync(full, "utf8");
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const first = /^(#{1,4})\s+(.+?)\s*$/m.exec(t);
  if (!first) continue;
  const clean = first[2].replace(/[`*_~>]/g, "").trim();
  const numM = /^(\d+(?:\.\d+)*)/.exec(clean);
  docChapters[String(parseInt(nm[1], 10))] = { anchor: numM ? numM[1] : null };
}
let total = 0, unresolvable = 0;
for (const full of allMd) {
  const fn = path.relative(ROOT, full);
  let text = fs.readFileSync(full, "utf8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const refs = text.match(/§\s*\d+(?:\.\d+)*/g) || [];
  total += refs.length;
  for (const ref of refs) {
    const hit = resolveSec(ref.replace(/[§\s]/g, ""));
    if (!hit) { unresolvable++; fail(`${fn}: ${ref} 无法解析`); }
  }
}
if (unresolvable === 0) ok(`全部 ${total} 处 § 引用均可解析（${Object.keys(sections).length} 个章节编号可跳转）`);
else fail(`${unresolvable}/${total} 处 § 引用无法解析`);

/* ---------- 链接 scheme 白名单（P2-7） ---------- */
console.log("\n链接 scheme 白名单检查");
const safeLinks = [
  ["https 链接放行", "[x](https://example.com/a)", 'href="https://example.com/a"'],
  ["http 链接放行", "[x](http://example.com)", 'href="http://example.com"'],
  ["mailto 放行", "[x](mailto:a@b.com)", 'href="mailto:a@b.com"'],
  ["tel 放行", "[x](tel:+8613800000000)", 'href="tel:+8613800000000"'],
  // 注意：以 .md/.txt 结尾的目标会被识别为"跨文件跳转"，走 data-file-link 而非普通 href
  ["相对路径（非 md）放行", "[x](images/a.png)", 'href="images/a.png"']
];
for (const [label, src, expect] of safeLinks) {
  const got = R.renderInline(src);
  if (got.includes(expect)) ok(label);
  else fail(`${label} 未放行: ${got}`);
}
const blockedLinks = [
  ["javascript: 被拦", "[x](javascript:alert(1))"],
  ["data:text/html 被拦", "[x](data:text/html;base64,PHNjcmlwdD4=)"],
  ["vbscript: 被拦", "[x](vbscript:msgbox)"],
  ["file: 被拦", "[x](file:///C:/Windows/win.ini)"]
];
for (const [label, src] of blockedLinks) {
  const got = R.renderInline(src);
  // 必须是不可点击的 span，且绝无 javascript:/data: 之类进入 href
  if (got.includes("<span") && got.includes("link-blocked") && !/href=/.test(got) &&
      !/javascript:/i.test(got) && !/data:text/i.test(got)) ok(label);
  else fail(`${label} 未拦下: ${got}`);
}

/* ---------- 嵌套列表（渲染器直测，不依赖笔记内容） ---------- */
console.log("\n嵌套列表检查");
const nestedHtml = R.renderMarkdown("**设计**：桶（Bucket）数组 + 条目（Entry）数组。\n- 桶数组：按哈希码索引\n  - 条目数组：键/值/哈希码/next\n  - 冲突链：next 串成链");
if (nestedHtml.includes("<p><strong>设计</strong>：桶（Bucket）数组 + 条目（Entry）数组。</p>") &&
    nestedHtml.includes("<li>桶数组：按哈希码索引<ul><li>条目数组：键/值/哈希码/next</li>")) {
  ok("嵌套列表渲染正确（<li> 内含 <ul>）");
} else fail("嵌套列表渲染异常: " + nestedHtml);

/* ---------- 新增语法：链接 / 删除线 / 任务列表 / 折叠块 ---------- */
console.log("\n新增语法检查");
const extLink = R.renderInline("[官方文档](https://example.com/a_b)");
if (extLink.includes('href="https://example.com/a_b"') && extLink.includes('target="_blank"')) ok("外部链接渲染");
else fail("外部链接未渲染: " + extLink);
const ancLink = R.renderInline("[回到 1.1.1](#1.1.1)");
if (ancLink.includes('data-anchor-link="1.1.1"')) ok("同文件锚点链接渲染");
else fail("同文件锚点链接未渲染: " + ancLink);
const fileLink = R.renderInline("[打开 C# 篇](01_CSharp.md#1.1.1)");
if (fileLink.includes('data-file-link="01_CSharp.md"') && fileLink.includes('data-anchor-link="1.1.1"')) ok("跨文件链接渲染");
else fail("跨文件链接未渲染: " + fileLink);
const codeInLink = R.renderInline("[`main` 函数](https://x.com)");
if (codeInLink.includes("<code>main</code>")) ok("链接标签内行内代码渲染");
else fail("链接标签内行内代码未渲染: " + codeInLink);
if (R.renderInline("~~旧内容~~").includes("<del>旧内容</del>")) ok("删除线渲染");
else fail("删除线未渲染");
const taskHtml = R.renderMarkdown("- [x] 已完成\n- [ ] 待办");
if ((taskHtml.match(/task-box/g) || []).length === 2 && taskHtml.includes('checked')) ok("任务列表渲染");
else fail("任务列表未渲染: " + taskHtml);
const detHtml = R.renderMarkdown("<details>\n<summary>题目</summary>\n答案在折叠内\n</details>");
if (detHtml.includes("<details>") && detHtml.includes("<summary>题目</summary>") &&
  detHtml.includes("<p>答案在折叠内</p>") && !detHtml.includes("&lt;details")) ok("折叠块渲染");
else fail("折叠块未渲染: " + detHtml);

/* ---------- 表格内转义竖线 \| ---------- */
console.log("\n表格转义竖线检查");
const escTableHtml = R.renderMarkdown(
  "| 距离 | 公式 | 适用 |\n| --- | --- | --- |\n" +
  "| 曼哈顿距离 | H = \\|x1-x2\\| + \\|y1-y2\\| | 四方向移动 |\n" +
  "| 对角距离 | dx = \\|x1-x2\\|，dy = \\|y1-y2\\|；H = 14×min(dx,dy) + 10×\\|dx-dy\\| | 八方向移动 |\n" +
  "| 双反斜杠 | a \\\\ b | 字面反斜杠 |");
const escTd = (escTableHtml.match(/<td>/g) || []).length;
if (escTd === 9 && escTableHtml.includes("H = |x1-x2| + |y1-y2|") &&
    escTableHtml.includes("10×|dx-dy|") && escTableHtml.includes("a \\ b") && !escTableHtml.includes("\\|")) {
  ok("表格内 \\| 转义正确（未拆列，渲染为字面 |；\\\\ 渲染为单个 \\）");
} else fail("表格转义竖线异常: " + escTableHtml);

console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
process.exit(failures ? 1 : 0);
