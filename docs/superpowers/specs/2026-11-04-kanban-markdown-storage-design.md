# 看板改为 Markdown 文件存储 — 设计

日期：2026-11-04 · 状态：待确认 · 选定方案：A（单文件 Markdown，Obsidian Kanban 兼容）

## 为什么改

当前看板只存在浏览器 `localStorage` 的 `solomd.kanban.v1` 里：

- 不进 vault、不进 Git/AutoGit，换设备或清缓存就丢；
- 和笔记库完全脱节，不能在 Obsidian 里看，也不能被其他工具处理；
- 用户已经有真实数据，迁移不能丢。

## 目标

1. 一个看板 = vault 里一个 `.md` 文件，格式与 Obsidian Kanban 插件兼容。
2. 拖拽、增删列、增删卡片后写回同一个文件，AutoGit/GitHub 同步自然生效。
3. 现有 localStorage 看板一次性迁移成 `.md`，保留原项目、列、任务和顺序。
4. 普通 Markdown 编辑器仍然能读；未知 frontmatter、设置尾块、归档区不被破坏。

## 非目标（v1 不做）

- WIP 硬限制（只显示 `count/limit`，不阻止拖动）、泳道、标签选择器；
- 一卡一文件、卡片反链（后续可加"把卡片提升为笔记"）；
- 归档区 UI（只保证读写时不丢，保留原样）；
- 多窗口同时编辑同一看板的实时合并。

> 2026-11-04 追加：任务详情抽屉已实现——优先级 P0–P2、截止日期、验收清单、状态（列）切换；卡片行用 Tasks emoji 写优先级/日期，验收清单用缩进 `- [ ]` 行。

## 文件格式

````markdown
---
kanban-plugin: board
---

## Todo

- [ ] 第一张卡
- [ ] 带正文的卡
    正文第二行（4 空格或 tab 缩进，属于同一张卡）
- [x] 已完成的卡

## Doing

## Done

**Complete**
- [x] 完成列里的卡

***

## Archive
- [x] 归档卡

%% kanban:settings
{"kanban-plugin":"board"}
%%
````

规则：

- frontmatter 里有 `kanban-plugin` 即视为看板；新建时写 `kanban-plugin: board`。
- `##` 是列；`- [ ]` / `- [x]` 是卡片；缩进的后续行属于上一张卡的正文。
- `**Complete**` 标记完成列；卡片移入完成列时自动写成 `[x]`。
- `***` 之后的 `## Archive` 是归档区，v1 原样保留。
- `%% kanban:settings ... %%` 原样保留在文件末尾，v1 不解析。
- frontmatter 其他键、第一列之前的正文、列内非卡片行都原样保留。
- 换行符（LF/CRLF）与 BOM 按原文件保留；新建文件用 UTF-8 无 BOM + LF。

## 解析与写回

新增 `app/src/lib/kanban-markdown.ts`：

```ts
parseBoardMarkdown(text: string): MarkdownBoard
serializeBoardMarkdown(board: MarkdownBoard): string
createBoardMarkdown(name: string, lanes: string[]): string
```

`MarkdownBoard` 保留：

- `frontmatterRaw`（含 `---` 定界符，原样写回）
- `preamble`（第一列之前的正文）
- `lanes: { title, items: Array<BoardCard | RawBlock> }[]`
- `archiveRaw`、`footerRaw`、`eol`、`bom`

卡片没有稳定 ID，按"列 + 顺序"识别；拖拽时从旧位置删除、插入新位置，再整体序列化。重名卡片不影响操作，但外部并发编辑是文件级冲突。

解析器按行扫描，识别 ``` / ~~~ 代码块并在其中忽略 `##` 与 `- [ ]`；不使用整段正则。

## 界面与入口

- 工作区索引已经读取每篇笔记的 frontmatter；用它筛出 `kanban-plugin` 存在的文件。
- 侧栏"看板"改为看板文件列表 + "新建看板"；新建时选择名称和初始列，写入 `boards/<slug>.md` 并打开。
- 打开带 `kanban-plugin` 的文件时，默认进入看板视图；顶栏提供"看板 / Markdown"切换，选择按文件记在内存里。
- `KanbanView` 从"全局单例"改为"绑定当前文件"：读取当前 tab 的 `content`，修改后标记 dirty，保存复用现有 `saveTab`，所以 AutoGit、外部修改检测、编码处理都走现有链路。
- 目录固定为 workspace 根下的 `boards/`（v1 不提供自定义路径）。

## 迁移

启动时如果 `solomd.kanban.v1` 存在且尚未迁移：

1. 每个 project 生成一个 `boards/<安全文件名>.md`：列名做 `##`，任务做 `- [ ]`，`notes` 作为缩进正文。
2. 写一个迁移标记（settings 里的 `kanbanMigratedToMarkdown: true`），**保留** localStorage 原数据作为备份，不删除。
3. 完成弹 toast：已迁移 N 个看板，可在 `boards/` 查看。
4. 之后所有读写都走文件；`useKanbanStore` 不再作为数据源。

如果 `boards/` 已有同名文件，追加 `-2`、`-3`，不覆盖。

## 风险与处理

- **整文件重写**：拖一次卡会重写整个看板文件，Git diff 较大但可读；这是 Obsidian Kanban 的既有模式。
- **外部编辑冲突**：看板打开期间文件被 Obsidian/Git 改动，v1 以当前 tab 内容为准；保存前如果检测到磁盘 mtime 变化，提示"文件已被外部修改，覆盖/重新加载"。
- **未知内容丢失**：这是最大风险。解析器必须把 frontmatter、preamble、非卡片行、archive、settings footer 原样保留；用真实 Obsidian 文件做 round-trip 测试。
- **大看板性能**：v1 不做虚拟滚动；超过 ~500 张卡再优化。

## 测试

- `kanban-markdown.test.ts`：标准文件、CRLF、BOM、未知 frontmatter、设置尾块、归档区、缩进正文、嵌套清单、空列、重名卡片、代码块里的 `##`。
- round-trip：`parse -> serialize -> parse` 结构一致；`serialize` 幂等。
- 迁移：旧 localStorage blob -> N 个文件，列/任务/顺序/备注一致。
- UI 冒烟：打开看板文件、拖卡、增删列、保存、重开；在 Obsidian 里打开同一文件确认能识别。

## 已定的取舍

- 单文件而不是一卡一文件：优先 Obsidian 兼容和低迁移成本；卡片需要完整笔记时后续加"提升为笔记"。
- 文件绑定当前 tab，而不是全局看板视图：避免编辑器和看板各写一份。
- 自动迁移而不是弹窗询问：用户已有数据，迁移是预期行为；保留 localStorage 备份。
