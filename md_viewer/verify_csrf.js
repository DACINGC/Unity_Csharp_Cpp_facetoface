/* CSRF 防护验证（P2-1）：只测"应当被拒"的路径 + 一条"应当放行"的对照。
 * 不调用 /api/service/shutdown 与 restart（会造成服务中断），只测 /api/save。
 * 用法: node md_viewer/verify_csrf.js   （需服务已启动）
 */
"use strict";
const BASE = "http://127.0.0.1:8765";
let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => { failures++; console.log("  ✗ " + m); };

async function post(headers, body) {
  const r = await fetch(BASE + "/api/save", { method: "POST", headers, body });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async () => {
  console.log("CSRF 防护检查（写接口 /api/save）");

  // 1) 合法：本机同端口 Origin + JSON Content-Type
  const good = await post(
    { "Content-Type": "application/json", "Origin": BASE },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (good.status !== 403) ok(`本机同源请求放行（status=${good.status}，404 表示已通过校验进入业务逻辑）`);
  else fail(`本机同源请求被误拒：${JSON.stringify(good.body)}`);

  // 2) 跨站 Origin → 403
  const evil = await post(
    { "Content-Type": "application/json", "Origin": "http://evil.example.com" },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (evil.status === 403) ok("跨站 Origin 被拒（403）");
  else fail(`跨站 Origin 未被拒（status=${evil.status}）`);

  // 3) 无 Origin/Referer → 403
  const none = await post(
    { "Content-Type": "application/json" },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (none.status === 403) ok("缺少 Origin/Referer 被拒（403）");
  else fail(`缺少 Origin 未被拒（status=${none.status}）`);

  // 4) 表单式 Content-Type（跨站表单的典型形态）→ 403
  const form = await post(
    { "Content-Type": "application/x-www-form-urlencoded", "Origin": "http://evil.example.com" },
    "path=x&content=y");
  if (form.status === 403) ok("跨站表单提交被拒（403）");
  else fail(`跨站表单未被拒（status=${form.status}）`);

  // 5) text/plain（可绕过 CORS 预检的简单请求）→ 403
  const plain = await post(
    { "Content-Type": "text/plain", "Origin": "http://evil.example.com" },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (plain.status === 403) ok("text/plain 简单请求被拒（403）");
  else fail(`text/plain 未被拒（status=${plain.status}）`);

  // 6) 本机但端口不符 → 403
  const wrongPort = await post(
    { "Content-Type": "application/json", "Origin": "http://127.0.0.1:9999" },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (wrongPort.status === 403) ok("本机但端口不匹配被拒（403）");
  else fail(`端口不匹配未被拒（status=${wrongPort.status}）`);

  // 7) 只带 Referer 也应放行（老式请求无 Origin）
  const refOnly = await post(
    { "Content-Type": "application/json", "Referer": BASE + "/?path=x" },
    JSON.stringify({ path: "不存在.md", content: "x" }));
  if (refOnly.status !== 403) ok("仅 Referer 同源时放行");
  else fail(`仅 Referer 被误拒：${JSON.stringify(refOnly.body)}`);

  console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过 ✔");
  // 不用 process.exit()：fetch(undici) 的句柄仍在收尾，强退会触发 libuv 断言崩溃
  process.exitCode = failures ? 1 : 0;
})();
