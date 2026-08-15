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

const files = fs.readdirSync(NOTES).filter((f) => f.endsWith(".md")).sort();
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
  const expFences = count(text, /^```/gm) / 2;
  const expHeadings = count(text, /^(#{1,4})\s/gm);
  const expSecRefs = count(text, /§\d+(?:\.\d+)+/g);

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
let total = 0, unresolvable = 0;
for (const fn of files) {
  let text = fs.readFileSync(path.join(NOTES, fn), "utf8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const refs = text.match(/§\d+(?:\.\d+)+/g) || [];
  total += refs.length;
  for (const ref of refs) {
    const hit = resolveSec(ref.slice(1));
    if (!hit) { unresolvable++; fail(`${fn}: §${ref.slice(1)} 无法解析`); }
  }
}
if (unresolvable === 0) ok(`全部 ${total} 处 § 引用均可解析（${Object.keys(sections).length} 个章节编号可跳转）`);
else fail(`${unresolvable}/${total} 处 § 引用无法解析`);

/* ---------- 嵌套列表（01 的 设计 条目） ---------- */
console.log("\n嵌套列表检查");
const csharp = fs.readFileSync(path.join(NOTES, "01_CSharp.md"), "utf8");
const csharpHtml = R.renderMarkdown(csharp);
if (csharpHtml.includes("<strong>设计</strong>：桶（Bucket）数组 + 条目（Entry）数组。<ul><li>桶数组")) {
  ok("嵌套列表渲染正确（<li> 内含 <ul>）");
} else fail("嵌套列表渲染异常");

console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
process.exit(failures ? 1 : 0);
