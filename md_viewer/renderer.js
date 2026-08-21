/* 面试笔记查看器 —— Markdown 渲染器（纯函数，无 DOM 依赖，可在 Node 中测试）
 *
 * 覆盖语法：标题(#~####) / 表格 / 围栏代码块 / 加粗 / 斜体 / 删除线 / 行内代码 /
 *           链接（外部 #锚点 跨文件 .md#锚点） / 任务列表 - [x] / 折叠块 <details> /
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

  /* 行内渲染核心：代码 / 转义 / 加粗 / 斜体 / 删除线 / §编号。
   * plain=true 用于链接标签文本的二次渲染：不提取/还原代码、不转 §（避免嵌套 <a>），
   * 已由外层提取的代码占位符原样保留，留给外层统一还原。 */
  function renderInlineText(text, plain) {
    var codes = [];
    if (!plain) {
      text = String(text).replace(/`([^`\n]+)`/g, function (m, c) {
        codes.push("<code>" + esc(c) + "</code>");
        return "\uE000" + (codes.length - 1) + "\uE001";
      });
    }
    var html = esc(text);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[\s(（【>])\*([^*\n]+)\*(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    html = html.replace(/(^|[\s(（【>])_([^_\n]+)_(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    if (!plain) {
      html = html.replace(/§(\d+(?:\.\d+)+)/g, '<a class="sec-ref" tabindex="0" data-sec="$1">§$1</a>');
      html = html.replace(/\uE000(\d+)\uE001/g, function (m, i) { return codes[+i]; });
    }
    return html;
  }

  /* 链接分类：
   *   #锚点        -> 同文件内跳转（data-anchor-link）
   *   *.md / *.txt -> 跨文件跳转（data-file-link + data-anchor-link）
   *   其余          -> 外部链接（新标签打开） */
  function linkHref(url) {
    var u = String(url).trim();
    if (u.charAt(0) === "#") {
      return { href: "#" + escAttr(u), attrs: ' data-anchor-link="' + escAttr(u.slice(1)) + '"' };
    }
    if (/\.(md|txt)(?:#[^)]*)?$/i.test(u)) {
      var parts = u.split("#");
      return {
        href: "?path=" + encodeURIComponent(parts[0]) + (parts[1] ? "#" + parts[1] : ""),
        attrs: ' data-file-link="' + escAttr(parts[0]) + '" data-anchor-link="' + escAttr(parts[1] || "") + '"'
      };
    }
    return { href: escAttr(u), attrs: ' target="_blank" rel="noopener"' };
  }

  function renderInline(text) {
    var codes = [];
    // 1. 先提取行内代码并转义，防止其中的 * _ § [ ] 被后续规则误处理
    text = String(text).replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push("<code>" + esc(c) + "</code>");
      return "\uE000" + (codes.length - 1) + "\uE001";
    });
    // 2. 提取 [label](url) 链接（label 内不允许嵌套 []，url 不含空格与 )）
    var links = [];
    text = text.replace(/\[([^\[\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (m, label, url) {
      links.push({ label: label, url: url });
      return "\uE002" + (links.length - 1) + "\uE003";
    });
    // 3. 转义其余 HTML（保留已有实体）
    var html = esc(text);
    // 4. 加粗 / 斜体 / 删除线
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[\s(（【>])\*([^*\n]+)\*(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    html = html.replace(/(^|[\s(（【>])_([^_\n]+)_(?=$|[\s)）】<.,;:!?，。；：！？、])/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    // 5. §编号 -> 可点击的跨文件跳转链接
    html = html.replace(/§(\d+(?:\.\d+)+)/g, '<a class="sec-ref" tabindex="0" data-sec="$1">§$1</a>');
    // 6. 还原链接（标签文本再走一次行内核心渲染，支持其中的加粗/代码）
    html = html.replace(/\uE002(\d+)\uE003/g, function (m, i) {
      var l = links[+i];
      if (!l) return m;
      var t = linkHref(l.url);
      return '<a href="' + t.href + '"' + t.attrs + ">" + renderInlineText(l.label, true) + "</a>";
    });
    // 7. 还原行内代码
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
        var liPrefix = items[j].checkbox === null ? "" :
          '<input type="checkbox" class="task-box" disabled' + (items[j].checkbox ? " checked" : "") + "> ";
        html += "<li>" + liPrefix + renderInline(items[j].content);
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

      // 折叠块 <details>（可配合 <summary>，内容整体递归渲染为 Markdown）
      if (t === "<details>" || t === "<details open>") {
        var isOpen = t === "<details open>";
        var dbuf = [];
        i++;
        while (i < n && lines[i].trim() !== "</details>") { dbuf.push(lines[i]); i++; }
        i++; // 跳过 </details>
        var summary = "";
        var fi = 0;
        while (fi < dbuf.length && dbuf[fi].trim() === "") fi++;
        var sm = fi < dbuf.length ? /^\s*<summary>(.*)<\/summary>\s*$/.exec(dbuf[fi].trim()) : null;
        if (sm) { summary = renderInline(sm[1]); dbuf.splice(fi, 1); }
        out.push("<details" + (isOpen ? " open" : "") + ">" +
          (summary ? "<summary>" + summary + "</summary>" : "") +
          renderMarkdown(dbuf.join("\n")) + "</details>");
        continue;
      }

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
            // 任务列表：- [ ] / - [x]
            var content = m2[3];
            var cb = null;
            var cbM = /^\[([ xX])\]\s+(.*)$/.exec(content);
            if (cbM) { cb = cbM[1].toLowerCase() === "x"; content = cbM[2]; }
            items.push({ indent: m2[1].length, ordered: /^\d+[.)]/.test(m2[2]), content: content, checkbox: cb });
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
        if (pt === "<details>" || pt === "<details open>" || pt === "</details>") break;
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
