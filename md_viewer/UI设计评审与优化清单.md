# UI 设计评审与优化清单（md_viewer「面试 · 知识库」）

> 评审对象：`md_viewer/index.html`（单文件前端）+ `renderer.js` + `mdviewer.py`
> 结论先行：先删冗余/装饰设计，再按 P0/P1/P2 做优化升级。

## 一、可删除的无用设计（减负清单）

### A. 重复入口（同一功能多个按钮，删到只剩一个）

| 删除 | 理由 | 保留 |
| --- | --- | --- |
| 侧栏工具栏三按钮：side-search / side-share / side-theme（整行 .side-toolbar） | 搜索=顶栏搜索框+Ctrl+K；分享=顶栏「分享」按钮；主题=工具轨「◐」按钮。整行删除可省一条工具栏高度 | 顶栏搜索框、顶栏「分享」、工具轨主题按钮 |
| 「空间」导航区（全部笔记 / 面试知识库） | 与文件列表顶部筛选栏功能重复：全部笔记=「全部」，面试知识库=「MD」。nav-count 数字可并进 filter-bar | 文件筛选栏（全部/MD/TXT） |
| copy-btn（复制文件名） | 「分享」按钮已能复制链接，复制文件名价值极低 | 分享按钮 |

### B. 纯装饰/静态元素（无任何信息量或功能）

- 侧栏头部 workspace-head（头像「淅」+「淅J洇的个人空间」+「本地知识库·仅自己可见」）
- 「空间」标题右侧的死箭头「⌄」
- 顶栏 `.sync-state`「● 本地模式」（永远静态，服务状态已由电源按钮面板承载）
- 顶栏右侧 `.user-avatar` 头像
- 页面上下文栏 `.context-pills`（MD 文档 / N 个知识点）与 `#meta-title`
- 文件列表每行尾部 `.file-state` 小圆点
- 侧栏底部 aside-foot 说明条（与「?」快捷键弹层重复）
- 工具轨 logo 上残留的 title 文案

### C. 死代码（有 CSS 无使用）

- `.toc-intro` / `.toc-intro-label` / `.toc-intro-text` 三个类
- 删除上述元素后对应的 CSS 规则一并清理

## 二、可优化的设计点（现有功能升级）

1. 目录滚动跟随（scroll-spy）+ 阅读进度条
2. 文档内查找（Ctrl+F）
3. 分享链接带小节锚点（`?path=…&anchor=…`）
4. 文档历史（pushState/popstate，浏览器前进/后退）
5. 掌握度标记交互：右键清除、marks 带时间戳
6. 间隔重复复习（SM-2/艾宾浩斯）
7. 答题模式（闪卡）：抽题显示题目、快捷键自动标记
8. 最近打开列表
9. 文件变更自动感知（mtime 探活提示刷新）
10. 编辑分栏实时预览 + 新建/重命名/删除接口
11. 搜索升级：拼音首字母、模糊容错、搜索历史、范围切换、多关键词
12. 文件列表：目录分组折叠、排序
13. TOC 树折叠
14. 性能：会话内缓存文档内容
15. 移动端（≤700px 工具轨隐藏）加「⋯」溢出菜单收纳主题/抽题/打印/帮助
16. 快捷键扩展：Alt+←/→ 切文件、R 抽题

## 三、可添加的新功能设计点（从 0 到 1）

1. 图片支持（`![]()` + 本地相对路径图片）
2. 代码语法高亮（自写轻量 tokenizer，保持零依赖）
3. Mermaid 流程图（引入 mermaid.js，放弃零依赖时可选）
4. 双链 `[[文档名]]` / `[[§编号]]` + 反向链接面板
5. 全局标签（front-matter）聚合
6. 学习仪表盘（学习日历热力图、连续打卡、各文件进度排行）
7. 合并导出（全部文档 → 单个 HTML/PDF，附目录页）
8. .bak 备份 diff 视图与回滚
9. 复习题索引刷题进度（§ 引用访问检测）

## 四、实施优先级

| 优先级 | 事项 | 状态 |
| --- | --- | --- |
| P0 | 删除 A/B/C 冗余装饰与死代码；scroll-spy；分享带锚点；pushState 历史；文档内查找 | ✅ 已实施 |
| P1 | 间隔重复复习；答题模式；最近打开；自动变更感知；图片支持；语法高亮 | 待实施 |
| P2 | 学习仪表盘；合并导出；双链；编辑分栏+新建/重命名；Mermaid；.bak diff | 待实施 |

## P0 实施记录

已完成（`md_viewer/index.html` + `README.md` + `test_app.js` + `test_render.js`）：

- **删除**：侧栏工具栏三按钮（side-search/side-share/side-theme）、「空间」导航区（nav-all/nav-kb + 死箭头）、workspace-head（头像/空间名/副标题）、`.sync-state`「● 本地模式」、`.user-avatar` 头像、`.page-context` 上下文栏（meta-title/pills）、文件行 `.file-state` 圆点、`copy-btn` 复制文件名、`aside-foot` 说明条、rail logo title 残留文案；死 CSS `.toc-intro` 系列与所有关联响应式/打印规则
- **新增**：
  - 滚动跟随：目录自动高亮当前小节（`.toc-link.active`），正文顶部 2px 阅读进度条（`#read-progress`）
  - 分享带锚点：`shareCurrent()` 生成 `?path=…&anchor=…`（取当前滚动小节）
  - 文档历史：`pushState`/`popstate` + 200 条上限 + 重复合并 + 刷新后按 URL 兜底恢复；目录/文内锚点点击也写入历史（小节级后退）
  - 文档内查找：面包屑「查找」按钮 + Ctrl+F / F3 / Shift+F3 / Enter / Shift+Enter / Esc；`mark.find-term` 高亮与计数，与全局搜索高亮（`.hl-term`）互不干扰；编辑态不拦截（走浏览器原生查找）
- **测试**：`test_render.js`、`test_app.js` 全部通过；嵌套列表用例改为渲染器直测夹具（原用例引用的笔记原文已改版）；`test_app.js` 移除已删元素的「空间计数」断言

## 后续增量

- **当前文档学习进度**：面包屑栏新增 `#file-progress`（进度条 + ✓/◔/✕ 计数 + 百分比 + title 提示），`updateFileProgress()` 在打开文档与 `cycleMark` 标记后刷新；无标题的 txt 自动隐藏；≤700px 隐藏进度条仅留计数；`test_app.js` 增加 0/55 与 1/55 两条断言
- **未复习定位**：面包屑「▸ 未复习」按钮 `jumpToNextUnmarked()`——按标题顺序（文档从上到下）定位当前文档第一个未标记知识点并闪烁高亮；全部标记时 toast 提示；配合 ○ 标记形成连续复习流；`test_app.js` 增加定位提示与全部标记提示两条断言


