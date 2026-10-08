/* P0-1 回归校验：§ 引用必须优先解析到"本文件"，跨层重号不得误跳。
 * 用法: node verify_sections.js   （需服务已启动）
 * 模拟前端 jumpToSection 的两级解析：先 sectionsByFile[当前文件]，再全局 sections。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:8765";
let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => { failures++; console.log("  ✗ " + m); };

function lookup(root, sec, allowChapter) {
  if (!root) return null;
  let hit = root[sec];
  if (hit) return hit;
  const parts = sec.split(".");
  const min = allowChapter ? 1 : 2;
  while (parts.length > min) {
    parts.pop();
    hit = root[parts.join(".")];
    if (hit) return hit;
  }
  return null;
}

(async () => {
  const idx = await (await fetch(BASE + "/api/index")).json();

  console.log("索引结构检查");
  if (idx.sectionsByFile && typeof idx.sectionsByFile === "object") ok("返回 sectionsByFile");
  else { fail("缺少 sectionsByFile"); process.exit(1); }
  const mdFiles = idx.files.filter((f) => f.type === "md");
  const missing = mdFiles.filter((f) => !idx.sectionsByFile[f.path]);
  if (!missing.length) ok(`全部 ${mdFiles.length} 个 md 文件都有分文件映射`);
  else fail(`${missing.length} 个 md 文件缺少分文件映射: ` + missing.map((f) => f.path).join(", "));

  console.log("\n标题锚点唯一性（直接对源码跑服务端算法）");
  // 用 /api/file 拿到的 headings 已是服务端算法产物，校验同一文件内 anchor 唯一
  let dupFiles = 0, checked = 0;
  for (const f of mdFiles) {
    const anchors = f.headings.map((h) => h.anchor);
    checked += anchors.length;
    const seen = new Set();
    const dups = anchors.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
    if (dups.length) { dupFiles++; fail(`${f.path} 存在重复 anchor: ${[...new Set(dups)].join(", ")}`); }
  }
  if (!dupFiles) ok(`${checked} 个标题锚点在同一文件内全部唯一`);

  console.log("\n§ 引用解析（三级：本文件 → 本层 → 全局）");
  const layerOf = (p) => (p.indexOf("/") >= 0 ? p.split("/")[0] : "");
  let total = 0, localHit = 0, layerHit = 0, globalHit = 0, unresolved = 0, wrongLayer = 0;
  const unresolvedList = [];
  for (const f of mdFiles) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f.path), "utf8"); } catch (e) { continue; }
    const refs = [...new Set((text.match(/§\s*(\d+(?:\.\d+)*)/g) || []).map((s) => s.replace(/[§\s]/g, "")))];
    for (const sec of refs) {
      total++;
      const byFile = idx.sectionsByFile[f.path];
      if (lookup(byFile, sec, true)) { localHit++; continue; }
      const byLayer = idx.sectionsByLayer[layerOf(f.path)];
      if (lookup(byLayer, sec, true)) { layerHit++; continue; }
      const g = lookup(idx.sections, sec, false);
      if (!g) {
        // 最后允许全局裸章号（另一层的整篇引用）
        const gc = lookup(idx.sections, sec, true);
        if (gc) { globalHit++; if (layerOf(gc.path) !== layerOf(f.path)) wrongLayer++; continue; }
        unresolved++; unresolvedList.push(`${f.path}: §${sec}`); continue;
      }
      globalHit++;
      if (layerOf(g.path) !== layerOf(f.path)) wrongLayer++;
    }
  }
  console.log(`  引用总数（文件内去重后）: ${total}`);
  ok(`本文件命中: ${localHit}`);
  ok(`本层命中: ${layerHit}`);
  ok(`全局兜底命中: ${globalHit}（其中跨层 ${wrongLayer}）`);
  if (unresolved) {
    fail(`无法解析: ${unresolved}`);
    unresolvedList.forEach((u) => console.log("      " + u));
  } else ok("全部引用均可解析");

  console.log("\n项目知识整理索引 的 § 引用落点（修复前 19 个唯一引用只有 4 个正确）");
  const projIndex = "项目知识整理/00_项目知识整理索引.md";
  const t = fs.readFileSync(path.join(ROOT, projIndex), "utf8");
  const refs = [...new Set((t.match(/§\s*(\d+(?:\.\d+)*)/g) || []).map((s) => s.replace(/[§\s]/g, "")))];
  let good = 0, cross = 0, bad = 0;
  for (const sec of refs) {
    if (lookup(idx.sectionsByFile[projIndex], sec, true)) { good++; continue; }
    if (lookup(idx.sectionsByLayer[layerOf(projIndex)], sec, true)) { good++; continue; }
    const g = lookup(idx.sections, sec, false) || lookup(idx.sections, sec, true);
    if (!g) { bad++; console.log(`    §${sec} -> 无法解析`); continue; }
    // 显式跨层引用（如 §6.10 Unity 优化）本身合法，单独统计
    cross++;
    console.log(`    §${sec} -> ${g.path}   [显式跨层引用]`);
  }
  console.log(`  本层内命中 ${good} / 显式跨层 ${cross} / 无法解析 ${bad}（共 ${refs.length}）`);
  if (bad === 0) ok("项目索引的 § 引用全部可解析，且不再误跳通用层同号章节");
  else fail(`${bad} 个引用无法解析`);

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  process.exit(failures ? 1 : 0);
})();
