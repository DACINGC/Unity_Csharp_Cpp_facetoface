/* 面试笔记查看器 —— Markdown 渲染器（纯函数，无 DOM 依赖，可在 Node 中测试）
 *
 * 覆盖语法：标题(#~####) / 表格 / 围栏代码块 / 加粗 / 斜体 / 行内代码 /
 *           无序有序列表(含嵌套) / 引用块 / 分隔线 / 段落
 * 特殊处理：HTML 实体感知转义（保留 &lt; &gt; &amp; 等已有实体，转义裸 < >）；
 *           §编号 自动转为可点击的跨文件跳转链接（class="sec-ref" data-sec）。
 */
"use strict";

(function (global) {
  /** HTML 转义：& 仅在不属于已有实体时转义 */
  function esc(text, preserveEntities) {
    var re = preserveEntities === false
      ? /[&<>"]/g
      : /&(?:[a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)?|[<>"]/g;
    return String(text).replace(re, function (m) {
      if (m === "&") return "&amp;";
      if (m === "<") return "&lt;";
      if (m === ">") return "&gt;";
      if (m === '"') return "&quot;";
      return m; // 完整实体，原样保留
    });
  }

  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function slugify(text) {
    var s = String(text).replace(/[`*_~>]/g, "").trim();
    s = s.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    return s || "section";
  }

  /* ---------------- 行内 ---------------- */

  function renderInline(text) {
    var codes = [];
    // 1. 先提取行内代码并转义，防止其中的 * _ § 被后续规则误处理
    text = String(text).replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push("<code>" + esc(c) + "</code>");
      return "\uE000" + (codes.length - 1) + "\uE001";
    });
    // 2. 转义其余 HTML（保留已有实体）
    var html = esc(text);
    // 3. 加粗 / 斜体
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[\s(（【>])\*([^*\n]+)\*(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    html = html.replace(/(^|[\s(（【>])_([^_\n]+)_(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    // 4. §编号 -> 可点击的跨文件跳转链接
    html = html.replace(/§(\d+(?:\.\d+)+)/g, '<a class="sec-ref" tabindex="0" data-sec="$1">§$1</a>');
    // 5. 还原行内代码
    html = html.replace(/\uE000(\d+)\uE001/g, function (m, i) { return codes[+i]; });
    return html;
  }

  /* ---------------- 块级 ---------------- */

  function renderTable(rows) {
    function cells(row) {
      return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")
        .map(function (c) { return renderInline(c.trim()); });
    }
    var header = cells(rows[0]);
    var body = rows.slice(2).map(cells);
    var html = '<div class="table-wrap"><table><thead><tr>';
    header.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    body.forEach(function (r) {
      html += "<tr>";
      r.forEach(function (c) { html += "<td>" + c + "</td>"; });
      html += "</tr>";
    });
    return html + "</tbody></table></div>";
  }

  function buildListHtml(items, idx) {
    var ordered = items[idx].ordered;
    var html = "<" + (ordered ? "ol" : "ul") + ">";
    var base = items[idx].indent;
    var j = idx;
    while (j < items.length && items[j].indent >= base) {
      if (items[j].indent === base) {
        html += "<li>" + renderInline(items[j].content);
        if (j + 1 < items.length && items[j + 1].indent > base) {
          var sub = buildListHtml(items, j + 1);
          html += sub.html;
          j = sub.next; // 递归已消费到 sub.next，不能再次 j++
        } else {
          j++;
        }
        html += "</li>";
      } else {
        var sub2 = buildListHtml(items, j);
        html += sub2.html;
        j = sub2.next;
      }
    }
    return { html: html + "</" + (ordered ? "ol" : "ul") + ">", next: j };
  }

  function isSeparatorRow(l) { return /^\|?[\s:|-]+\|?\s*$/.test(l.trim()); }
  function isListLine(l) { return /^(\s*)([-*+]|\d+[.)])\s+/.test(l); }

  function renderMarkdown(md) {
    var lines = md.split(/\r\n|\r|\n/);
    var out = [];
    var n = lines.length;
    var i = 0;

    while (i < n) {
      var line = lines[i];
      var t = line.trim();

      if (t === "") { i++; continue; }

      // 围栏代码块 ```lang
      if (/^```/.test(t)) {
        var lang = t.slice(3).trim();
        var buf = [];
        i++;
        while (i < n && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++; // 跳过收尾 ```
        out.push("<pre><code" + (lang ? ' class="language-' + esc(lang) + '"' : "") + ">" +
          esc(buf.join("\n")) + "</code></pre>");
        continue;
      }

      // 表格：以 | 开头且下一行是分隔行
      if (/^\|/.test(t) && i + 1 < n && isSeparatorRow(lines[i + 1])) {
        var rows = [];
        while (i < n && /^\|/.test(lines[i].trim())) { rows.push(lines[i]); i++; }
        out.push(renderTable(rows));
        continue;
      }

      // 标题
      var hm = /^(#{1,4})\s+(.+)$/.exec(t);
      if (hm) {
        var level = hm[1].length;
        var raw = hm[2];
        var clean = raw.replace(/[`*_~>]/g, "").trim();
        var numM = /^(\d+(?:\.\d+)*)/.exec(clean);
        var anchor = numM ? numM[1] : slugify(clean);
        out.push("<h" + level + ' id="' + escAttr(anchor) + '">' + renderInline(raw) + "</h" + level + ">");
        i++;
        continue;
      }

      // 引用块
      if (/^>\s?/.test(t)) {
        var bq = [];
        while (i < n && /^>/.test(lines[i].trim())) {
          bq.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + renderInline(bq.join(" ")) + "</blockquote>");
        continue;
      }

      // 列表（含嵌套）
      if (isListLine(line)) {
        var items = [];
        var startIndent = /^(\s*)/.exec(line)[1].length;
        while (i < n) {
          var l2 = lines[i];
          if (l2.trim() === "") {
            if (i + 1 < n && isListLine(lines[i + 1]) && /^(\s*)/.exec(lines[i + 1])[1].length >= startIndent) {
              i++;
              continue;
            }
            break;
          }
          var m2 = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l2);
          if (m2 && m2[1].length >= startIndent) {
            items.push({ indent: m2[1].length, ordered: /^\d+[.)]/.test(m2[2]), content: m2[3] });
            i++;
          } else {
            break;
          }
        }
        out.push(buildListHtml(items, 0).html);
        continue;
      }

      // 分隔线
      if (/^([-*_])\s*(\1\s*){2,}$/.test(t)) { out.push("<hr>"); i++; continue; }

      // 普通段落
      var para = [];
      while (i < n) {
        var p = lines[i], pt = p.trim();
        if (pt === "") break;
        if (/^(#{1,4})\s/.test(pt)) break;
        if (/^```/.test(pt)) break;
        if (/^>/.test(pt)) break;
        if (/^([-*_])\s*(\1\s*){2,}$/.test(pt)) break;
        if (/^\|/.test(pt) && i + 1 < n && isSeparatorRow(lines[i + 1])) break;
        if (isListLine(p)) break;
        para.push(p);
        i++;
      }
      out.push("<p>" + para.map(renderInline).join("<br>") + "</p>");
    }
    return out.join("\n");
  }

  var api = {
    esc: esc,
    escAttr: escAttr,
    slugify: slugify,
    renderInline: renderInline,
    renderMarkdown: renderMarkdown
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Renderer = api;
})(typeof window !== "undefined" ? window : globalThis);
