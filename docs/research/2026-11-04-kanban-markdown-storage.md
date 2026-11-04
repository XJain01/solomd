# Markdown 看板存储调研

> 调研日期：2026-11-04
> 范围：Obsidian Kanban、Logseq、SilverBullet、Obsidian Bases / Projects、Obsidian Tasks，以及 Focalboard / Vikunja / GitHub Projects 的对照。
> 版本基线：Obsidian Kanban **2.0.51**（2024-05-31）；Obsidian Tasks **8.6.0**（2026-10-16）；Obsidian **1.14.4 / 1.15.1**（Bases Kanban）；Logseq 文档 commit `628cdde`（2026-10-21）、看板插件 commit `76d8439`（2024-07-21）；SilverBullet **2.12.1**（2026-10-12）、看板插件 commit `80abe8b`（2024-09-01）；Obsidian Projects **1.17.4**（已停维护）。
> 方法：优先读官方文档、插件源码、格式定义和 release notes。Obsidian Kanban 没有单独的格式规范页，本文的格式结论以 2.0.51 的 parser/serializer 源码为准，不依赖博客转述。

## 结论摘要

- **单文件事实标准已经存在**：`kanban-plugin: board` 标记 + `##` 标题作列 + `- [ ]` 列表项作卡 + `***` / `## Archive` 归档 + `%% kanban:settings %%` 尾块，就是 Obsidian Kanban 2.0.51 的完整模型；但它没有稳定卡 ID，保存是整文件重写。
- **Logseq 没有内置看板布局**：官方 DB 版 Views 只有 Table / List / Gallery，`Group by` 是纵向分组；文件图的看板来自插件，数据仍是块树，拖拽通过 `moveBlock` 改变父子/兄弟关系。
- **SilverBullet 的看板是只读查询视图**：任务本体是页面里的 checklist 行，`kanban` 代码块只是用 query 结果渲染 jKanban；没有回写、没有稳定卡 ID。
- **一卡一笔记（Obsidian Bases 1.14+）把身份、重命名和合并交给文件系统**：这是合并粒度最好的 Markdown 方案，但卡片顺序由视图的 Sort 决定，1.14 没有原生的列内手动排序；已停维护的 Projects 插件则用数字 frontmatter 字段补上了手动顺序。
- **对 SoloMD**：当前代码已经不是纯 `localStorage`，而是 `boards/*.md` 单文件（commit `f166e777`），localStorage 仅作一次性迁移源；因此下一步的要点不是“选单文件还是数据库”，而是补稳定 ID、外部修改检测、列内排序与 Tasks 元数据兼容。

## 1. Obsidian Kanban：单文件、标题即列

### 1.1 文件布局

一个看板就是一个 `.md` 文件，没有附属数据库或索引文件。插件通过 frontmatter 里的 `kanban-plugin` 识别它是不是看板；同一文件在 Obsidian 里可以切换成普通 Markdown 视图。[格式入口 `parseMarkdown()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/parseMarkdown.ts#L167-L195)

### 1.2 精确语法

下面是一个符合 2.0.51 序列化器的完整示例。实际写回时，每个列末尾会补 3 个空行；这里为了可读只保留 1 个。

````markdown
---
kanban-plugin: board
---

## Backlog

- [ ] 写规格 #docs
- [ ] 调研 [[Obsidian Kanban]] @{2026-11-04}
- [ ] 带图片的卡
    ![[diagram.png]]

## Doing (3)

- [ ] 实现解析器

## Done

**Complete**
- [x] 完成初版

***

## Archive

- [x] 旧卡片

%% kanban:settings
```
{"kanban-plugin":"board","lane-width":272}
```
%%
````

各部分的来源和含义：

- **frontmatter 标记**：`kanban-plugin: board` 是当前值；旧值 `basic` 会被解析器映射成 `board`，用于兼容老看板。[`parseMarkdown()` L173-L183](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/parseMarkdown.ts#L173-L183)、[`frontmatterKey`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/common.ts#L9-L9)
- **列**：每个 heading 都是一个 lane；序列化器统一写成 `## 标题`。标题末尾的 `(3)` 是 WIP 上限，不是独立字段，解析后变成 `maxItems: 3`。[`laneToMd()` / `parseLaneTitle()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L403-L427)、[WIP 文档](https://github.com/community-archive/obsidian-kanban/blob/main/docs/How%20do%20I/Set%20a%20WIP%20Limit.md)
- **完成列**：`**Complete**` 是列内的一段普通文本，解析时设置 `shouldMarkItemsComplete: true`；它不是标题的一部分。[`astToUnhydratedBoard()` L255-L315](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L255-L315)
- **卡片**：`- [ ]` / `- [x]` 的列表项；4 个空格或 tab 缩进的后续行属于同一张卡。卡片正文按原始 Markdown 保存，可包含嵌套列表、图片、引用等。[`listItemToItemData()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L51-L111)
- **归档**：文件底部先写 `***`（thematic break），再写 `## Archive`，下面是归档卡。识别条件是“标题文本等于当前语言的 `Archive`，且前一个兄弟节点是 thematic break”。[`isArchiveLane()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L230-L238)、[`archiveToMd()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L429-L441)
- **设置尾块**：`%% kanban:settings` 开始一个 Obsidian 注释，里面是 fenced JSON，最后 `%%` 关闭。`kanban-plugin` 以及 `lane-width`、`date-format` 等设置都在这个 JSON 里；它在普通 Markdown 里不可见，但仍是文件文本。[`settingsToCodeblock()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/common.ts#L29-L39)

**本地化陷阱**：归档标题和完成标记不是硬编码英文，而是取插件 i18n 的 `Archive` / `Complete`。中文界面下分别是 `归档` / `完成`；英文解析器不会把 `## 归档` 当归档，反过来也一样。[`zh-cn.ts`](https://github.com/community-archive/obsidian-kanban/blob/main/src/lang/locale/zh-cn.ts)、[`list.ts` L267-L270](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L267-L270)

### 1.3 ID 与链接

- **没有默认卡 ID**。卡片身份就是“所在列 + 行号/顺序”；只有卡片第一行原本带 `^blockid` 时，序列化才保留它，编辑时也会把它剥掉再显示。[`addBlockId()` / `removeBlockId()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/helpers/parser.ts#L47-L58)
- **元数据**：标签是行内 `#tag`；日期默认 `@{YYYY-MM-DD}`、时间默认 `@@{HH:mm}`（trigger 可在设置改）；`key:: value` 行内字段在安装 Dataview 时会被解析并显示在卡片上，Tasks 字段在安装 Tasks 时解析；链接笔记的 frontmatter 可按 `metadata-keys` 显示。[`parseMarkdown()` 的扩展](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/parseMarkdown.ts#L65-L76)、[`inlineMetadata.ts`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/helpers/inlineMetadata.ts)、[`settingHelpers.ts`](https://github.com/community-archive/obsidian-kanban/blob/main/src/settingHelpers.ts)
- **卡内链接**支持 `[[wikilink]]`、`![[embed]]`、指向 `.md` 的普通 Markdown 链接；链接笔记的 frontmatter 可以按 `metadata-keys` 设置显示在卡片下方。[`getLinkedPageMetadata()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/common.ts#L102-L237)、[Linked page metadata 文档](https://github.com/community-archive/obsidian-kanban/blob/main/docs/Settings/Linked%20page%20metadata.md)
- **从卡建笔记**：命令 `New note from card` 会在指定文件夹按模板创建笔记，然后把卡片改成指向该笔记的链接；这是“单文件卡”与“笔记卡”之间的官方桥。[Create notes from cards](https://github.com/community-archive/obsidian-kanban/blob/main/docs/How%20do%20I/Create%20notes%20from%20cards.md)

### 1.4 排序与拖拽写回

- **顺序就是物理行序**。`boardToMd()` 按 `lane.children` 数组顺序逐行写 `- [ ]`，再按 `board.children` 顺序写各列；没有任何 `rank` / `order` 字段。[`boardToMd()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L443-L451)、[`laneToMd()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L407-L427)
- **拖拽写回是整文件重写**：状态更新后 `saveToDisk()` 调 `boardToMd()` 生成完整字符串，再交给 Obsidian 的 `requestSave()`；不是只改被移动的那一行。[`StateManager.saveToDisk()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/StateManager.ts#L99-L114)、[`KanbanView.requestSaveToDisk()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/KanbanView.tsx#L204-L211)
- **列内顺序**：拖到目标列时，插件把卡片插入目标列的指定位置；写回后目标列的行序就是新顺序。没有额外的排序字段。
- **完成语义**：普通列之间拖动只改列；拖进/拖出带 `**Complete**` 的列时，`maybeCompleteForMove()` 会切换完成字符（`[ ]` ↔ `[x]`），所以“Done 列”可以用这个标记表达，而不是只靠列名。[`maybeCompleteForMove()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/components/helpers.ts#L36-L80)

### 1.5 并发与合并

- **没有逐卡 diff/merge**。保存路径只有“内存 board → 整文件字符串 → 写盘”这一条；两个客户端同时改同一个 board，冲突粒度是整个文件，而不是单张卡。[`StateManager.saveToDisk()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/StateManager.ts#L99-L114)
- 插件监听 `vault.on('modify')`，但对“当前看板文件自身”没有逐卡重解析/合并逻辑；`notifyFileChange()` 只对 `manager.file !== file` 的其他看板刷新其链接笔记的元数据。[`main.ts` L529-L547](https://github.com/community-archive/obsidian-kanban/blob/main/src/main.ts#L529-L547)
- 结果取决于同步层（Obsidian Sync / iCloud / Git / Dropbox）：插件本身不解决冲突，只能保证“最后一次整文件写入”覆盖前一次。

### 1.6 工具支持与代价

- **支持**：Obsidian 内完整渲染与拖拽；Obsidian Tasks 从 Kanban 2.0.43 起集成（自动补全、日期显示在卡脚、重复任务、按 Tasks 日期排序）。[Tasks 的 Kanban 集成说明](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Other%20Plugins/Kanban%20Plugin.md)、[2.0.43 release](https://github.com/community-archive/obsidian-kanban/releases/tag/2.0.43)
- **只在 Obsidian 里是“看板”**：其他 Markdown 工具只能看到 heading + checklist；`%% kanban:settings %%` 对非 Obsidian 解析器只是普通文本。
- **不是自由格式笔记**：解析器只处理 heading 和 list；标题/列表之外的正文不会进入 board model，保存时会被丢弃。归档也只能在 Markdown 视图查看。[`astToUnhydratedBoard()`](https://github.com/community-archive/obsidian-kanban/blob/main/src/parsers/formats/list.ts#L240-L333)、[View a Kanban's archive](https://github.com/community-archive/obsidian-kanban/blob/main/docs/How%20do%20I/View%20a%20Kanban%27s%20archive.md)
- **维护风险**：仓库已迁到 `community-archive`，README 明确在寻找新维护者。[repo README](https://github.com/community-archive/obsidian-kanban#readme)

## 2. Logseq：块树是数据，board 是插件渲染

### 2.1 先纠正一个常见误解

截至本文检索的官方文档，**Logseq 没有内置 board 布局**。DB 版官方 Views 的视图类型只有 `Table`、`List`、`Gallery`；`Group by` 是把结果按属性纵向分组，不是横向看板列。[Logseq DB 文档 → Views](https://github.com/logseq/docs/blob/master/db-version.md)

文件图（Markdown/Org）里常见的“看板”来自社区插件 `logseq-kanban-plugin`：它把一个 `{{renderer ...}}` 宏渲染成 board，数据仍然是宏所在块的子块。[插件 README](https://github.com/benjypng/logseq-kanban-plugin#readme)

### 2.2 数据放在哪里

看板宏本身是普通块内容：

```markdown
- {{renderer :kanban_651a3832-a06f-4dee-8c77-bc15908765e8}}
  - Backlog
    - 卡片 A
    - 卡片 B
  - Doing
    - TODO 卡片 C
```

- **普通模式**：父块是列，子块是卡。
- **任务模式**：子块是任务，按 `TODO/DOING/DONE`（或默认 `LATER/NOW/DONE`）分列。
- **查询模式**：子块是 `{{query ...}}`，列由查询结果填充。

三种模式的入口在插件 `index.tsx` 的 `data_type` 分支里。[插件 `index.tsx` L115-L147](https://github.com/benjypng/logseq-kanban-plugin/blob/main/src/index.tsx#L115-L147)

列在文件图里不是属性，而是**块层级**：普通模式下父块就是列；状态来自 workflow marker。DB 图则把任务变成 `#Task` 节点，用内置的 `Status` property（默认 `Backlog`、`Todo`、`Doing`、`In Review`、`Done`、`Canceled`）表达状态。[Logseq DB 文档 → Tasks → Task Status](https://github.com/logseq/docs/blob/master/db-version.md)

任务本体使用 Logseq 的 workflow marker 和属性：

```markdown
- TODO 写规格
  DEADLINE: <2026-11-10 Tue>
  SCHEDULED: <2026-11-06 Fri>
```

`TODO/DOING/DONE`、`LATER/NOW/DONE` 是内置 workflow；`DEADLINE:` / `SCHEDULED:` 是 Org 风格的时间戳，文件图里也照写。[Logseq Tasks 文档](https://github.com/logseq/docs/blob/master/pages/Tasks.md)、[Logseq Properties 文档](https://github.com/logseq/docs/blob/master/pages/Properties.md)

### 2.3 拖拽写回

`/Kanban (DND)` 的拖拽实现调用 `logseq.Editor.moveBlock(sourceUUID, targetUUID, { before, children })`：把卡片块移动到目标列块之下，或移动到目标卡片之前/之后。它改的是**块树结构**，不是某个 `status` 字段。[插件 DND 源码 L40-L115](https://github.com/benjypng/logseq-kanban-plugin/blob/main/src/features/drag-and-drop/index.tsx#L40-L115)

### 2.4 身份、排序、限制

- **身份**：Logseq 内部用 block UUID；文件图里块引用写作 `((uuid))`，块可以用 `id::` 属性持久化。普通卡片不强制写 `id::`，所以“文件层面的稳定 ID”取决于是否引用过它。
- **排序**：兄弟块的顺序就是数组顺序；拖拽重排会重写这些块的父子/兄弟关系。
- **限制**：
  - 拖拽只覆盖普通父块列模式；任务/查询模式主要用于展示。
  - 查询只保证简单 query；README 明确说 advanced query 可能不工作。[README → Normal with Queries](https://github.com/benjypng/logseq-kanban-plugin#normal-with-queries)
  - 宏在 Logseq 之外没有意义；其他 Markdown 工具只看到一行 `{{renderer ...}}`。
  - 插件最后一次提交是 2024-07-21，维护活跃度低。
- **同步/合并**：文件图就是普通 Markdown/Org 文件，冲突粒度按页面/块，取决于 Git、iCloud 等外部同步；DB 图用 Logseq Sync / RTC，数据在 SQLite，不是 Markdown 合并。[Logseq DB 文档 → Sync](https://github.com/logseq/docs/blob/master/db-version.md)
- **DB 图的区别**：DB 图把数据放 SQLite，官方导出提供 SQLite / EDN；`Export as standard Markdown (no block properties)` 明确说明 Markdown 导出无法保留全部属性。[Logseq DB 文档 → Export and Import](https://github.com/logseq/docs/blob/master/db-version.md) 所以“Logseq 看板 = Markdown 文件”只适用于文件图，不适用于 DB 图。

## 3. SilverBullet：query widget，只读看板

### 3.1 任务语法

SilverBullet 的任务是页面里的列表项，默认 `* [ ]` / `* [x]`，也支持自定义状态（状态文本不能含 `:`）。属性用 `[key: value]`：

```markdown
* [TODO] 写规格 [deadline: "2026-11-10"] [priority: high] #docs
* [IN PROGRESS] 实现解析器 [assignee: Alice]
```

注意：默认的 `[ ]` / `[x]` 在索引里对应 `" "` / `"x"` 状态；如果看板列用 `TODO` / `DONE` 这种自定义状态，任务行也要写成 `[TODO]` / `[DONE]`，否则列匹配不上。

任务会被自动索引，可以用 Space Lua / Integrated Query 查询。[SilverBullet Task 文档](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Task.md)、[Task Management 指南](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Guide/Task%20Management.md)

### 3.2 看板代码块

`dandimrod/silverbullet-kanban` 用 fenced `kanban` 代码块配置一个只读 board：

````markdown
```kanban
query:
  task where page = @page.name
columns:
  - id: TODO
    title: To Do
  - id: IN PROGRESS
    title: Doing
  - id: DONE
    title: Done
```
````

- `query` 是 SilverBullet 的 live query；`task where ...` 取任务。
- `columns` 的 `id` 必须匹配任务的 `state` 值；不写 `columns` 时，列按查询结果里出现的 `state` 去重生成，顺序是首次出现顺序。[`mapResultsToBoards()`](https://github.com/dandimrod/silverbullet-kanban/blob/main/kanban.ts#L88-L107)
- `template` 可以把卡片渲染成自定义模板；`options` 直接透传给 jKanban。[插件 README](https://github.com/dandimrod/silverbullet-kanban#readme)

### 3.3 身份、排序、限制

- **卡身份**：`item.ref`，也就是“页面 + 位置”的引用，不是持久 ID；重排/插入后位置会变。[`kanban.ts` L102-L105](https://github.com/dandimrod/silverbullet-kanban/blob/main/kanban.ts#L102-L105)
- **元数据**：任务行内的标签 `#tag` 和 `[key: value]` 属性会被索引；`deadline`、`priority` 等键本身没有强制 schema，靠查询和模板消费。[SilverBullet Task 文档](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Task.md)
- **排序**：列顺序由 `columns` 配置或结果首次出现顺序决定；卡顺序就是 query 返回顺序。没有拖拽排序。
- **只读**：插件 README 的 TODO 明确写着 “Update, edit and add tasks directly from the kanban” 尚未做；源码只是构造 jKanban 的 `boards` 数据并渲染，没有回写逻辑。[README → TODO](https://github.com/dandimrod/silverbullet-kanban#todo)、[`kanban.ts` L70-L85](https://github.com/dandimrod/silverbullet-kanban/blob/main/kanban.ts#L70-L85)
- **同步/合并**：任务行属于页面文件，改状态是改那一行；board 代码块只保存 query/columns 配置，不保存卡状态，所以冲突粒度是页面而不是 board。[SilverBullet Task 文档](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Task.md)
- **依赖**：jKanban 从 jsDelivr CDN 拉取，不是随插件打包；离线/内网环境要注意。[README → Note](https://github.com/dandimrod/silverbullet-kanban#readme)
- **工具支持**：SilverBullet [2.12.1](https://github.com/silverbulletmd/silverbullet/releases/tag/2.12.1)；插件最后一次提交 2024-09-01，版本兼容性需自行验证。

## 4. 一卡一笔记：Obsidian Bases（以及已停维护的 Projects）

### 4.1 Bases 1.14+ 的原生 Kanban

Obsidian 1.14 给 Bases 增加了 `kanban` 布局：卡片是笔记，列是某个属性的取值，拖卡会改写该笔记的 frontmatter 属性。[Obsidian 1.14 changelog](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/)、[Bases Kanban 帮助页](https://help.obsidian.md/bases/views/kanban)

笔记示例：

```markdown
---
status: Doing
due: 2026-11-10
---
# 写规格

正文仍然是普通 Markdown。
```

Base 文件示例（`.base` 是 YAML）：

```yaml
views:
  - type: kanban
    name: Projects
    groupBy:
      property: note.status
      direction: ASC
    groupOrder:
      - Backlog
      - Doing
      - Done
```

`groupOrder` 控制列的显示顺序和可见性；不写就按 `groupBy` 自动排序。[Bases syntax → Views → groupOrder](https://help.obsidian.md/bases/syntax)

行为细节（官方帮助页）：

- 拖卡到另一列，**只更新该笔记的 grouped property**；不会移动文件，除非按 `file.folder` 分组。
- 没有该属性值的笔记进入 `None` 列。
- 只有 Markdown 笔记可以在列间拖动；按 `file.folder` 分组时，拖卡会移动文件到目标文件夹。
- 列的宽度、封面图、图片适配是视图设置，不写进笔记。
- 按 formula 或其他 file property 分组时，看板只读，不能拖卡或建笔记。

### 4.2 排序：Bases 的缺口

- **列顺序**：`groupOrder` 或 Group 菜单的 Manual 顺序，存在 `.base` 里。
- **列内顺序**：由视图的 Sort 决定，不是每张卡上的 rank。官方帮助页只承诺“拖到另一列会更新属性”，没有提供“拖动卡片在列内排序”的设置。[Bases Kanban 帮助页](https://help.obsidian.md/bases/views/kanban)、[Bases Views → Sort](https://help.obsidian.md/bases/views)
- 1.14 发布后，社区很快提出“列内手动排序并持久化到属性”的功能请求，说明原生行为确实是“只能改分组属性，不能改列内顺序”。[Obsidian 论坛 feature request](https://forum.obsidian.md/t/bases-kanban-manual-card-ordering-within-a-column-drag-and-drop-persisted-to-a-property/119092)

### 4.3 身份、重命名、合并

- **身份 = 文件路径**。卡片不是行，重命名/移动由 Obsidian 文件层处理；看板是 live view，不需要回写一个 board 文件。
- **合并粒度 = 单篇笔记**。把卡从 Doing 拖到 Done，只是改一篇笔记的 `status:` 一行；两个设备改不同卡片时，冲突范围是各自的笔记，而不是整个看板。
- **重命名/移动**：文件改名后，Bases 按新路径重新索引；指向它的 wikilink 由 Obsidian 的链接更新机制处理。按 `file.folder` 分组时，列就是文件夹，拖卡等于移动文件（1.14.2 起支持）。
- **代价**：卡片是“整篇笔记”，不是 checklist 行；轻量任务会显得重。没有单文件看板可复制/发送；需要 `.base` 视图文件或应用内视图配置。

### 4.4 前身：Obsidian Projects 的排序补丁

Projects 插件（1.17.4，2025-05 宣布停止维护，2025-07 从社区插件列表移除）同样把笔记当卡片，但补了 Bases 缺的“列内手动顺序”：

- 设计哲学是 “Leave no trace”：不往笔记里写插件专属 frontmatter；board 配置放在插件数据里。[Projects README → Design Philosophy](https://github.com/obsmd-projects/obsidian-projects#readme)
- 列由某个字符串字段分组；列顺序用 `columnSettings[column].weight`，卡顺序可以用 `columnSettings[column].records`（插件配置），也可以指定一个数字 frontmatter 字段作为 `orderSyncField`，拖拽时把列内序号写回该字段（`records.forEach` 里写 `i`）。[`getColumns()` / `applyCustomRecordOrder()`](https://github.com/obsmd-projects/obsidian-projects/blob/main/src/ui/views/Board/board.ts#L45-L170)、[`BoardView.svelte` L175-L200](https://github.com/obsmd-projects/obsidian-projects/blob/main/src/ui/views/Board/BoardView.svelte#L175-L200)
- 这说明“一卡一笔记 + 数字 order 字段”是可行的；代价是排序语义依赖插件/视图，而不是 Markdown 标准。

### 4.5 单文件 vs 一卡一文件

| 维度 | 单文件看板 | 一卡一文件 |
|---|---|---|
| 卡身份 | 行位置；可选 `^blockid` | 文件路径 |
| 排序 | 行序，拖拽即写回 | 视图 Sort；或额外 `order` 字段 |
| 合并冲突 | 整个文件 | 单篇笔记 |
| 重命名/移动 | 卡只是行，改名不影响身份 | 文件系统操作，链接需更新 |
| 工具支持 | Obsidian Kanban 完整；其他工具只读 | Obsidian Bases 1.14+；其他工具只读笔记 |
| 适用 | 轻量任务、单文件分享 | 卡片本身是笔记、需要双链/合并 |

### 4.6 其他 Markdown 工具：本次不作为格式样本

- **Dendron**：README 明确写 “maintenance only, active development has ceased”；没有 board 布局，无法提供列/排序的格式参考。[Dendron README](https://github.com/dendronhq/dendron#readme)
- **Foam**：本次检索未发现 board/kanban 视图或格式；它的核心是 VS Code 里的 Markdown 链接/wiki 工作流。[Foam README](https://github.com/foambubble/foam#readme)
- **Vimwiki**：Vim 里的个人 wiki，核心是链接与日记；本次检索未发现 board/kanban 视图。[Vimwiki README](https://github.com/vimwiki/vimwiki#readme)

它们说明一件事：**没有 board 层，就不需要解决“列/排序/卡身份”**；一旦要做 board，格式问题就无法回避。

## 5. Obsidian Tasks：看板应保持兼容的任务元数据

Obsidian Tasks 8.6.0 的 emoji 格式是目前 Obsidian 生态里最广泛兼容的任务行格式。[Tasks Emoji Format](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Reference/Task%20Formats/Tasks%20Emoji%20Format.md)

```markdown
- [ ] #task Has a created date ➕ 2023-04-13
- [ ] #task Has a scheduled date ⏳ 2023-04-14
- [ ] #task Has a start date 🛫 2023-04-15
- [ ] #task Has a due date 📅 2023-04-16
- [x] #task Has a done date ✅ 2023-04-17
- [-] #task Has a cancelled date ❌ 2023-04-18
- [ ] #task Lowest priority ⏬
- [ ] #task High priority ⏫
- [ ] #task Recurring 🔁 every day when done
- [ ] #task do this first 🆔 dcf64c
- [ ] #task do this after first ⛔ dcf64c,0h17ye
```

关键约定：

- **状态是 `[]` 里的单个字符**，不是列名。核心状态只有 `[ ]` 和 `[x]`；自定义状态如 `[/]`、`[-]`、`[?]` 需要主题/CSS 配合。[Tasks Statuses](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Statuses.md)
- **Status Type** 有 `TODO`、`IN_PROGRESS`、`ON_HOLD`、`DONE`、`CANCELLED`、`NON_TASK` 六种；Tasks 靠它决定“勾选时做什么”、是否写 done date、是否生成重复任务。未知字符按 `TODO` 处理。[Tasks Statuses → What's IN a Status](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Statuses.md)
- **全局过滤器可选**：设置成 `#task` 后，只有带 `#task` 的 checklist 才算任务；不设置则所有 checklist 都算。[Tasks Global Filter](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Global%20Filter.md)
- **Tasks 能识别 Kanban 文件**：可以用 `task.file.hasProperty('kanban-plugin')` 只查/排除看板文件；Kanban 2.0.43 起还支持 Tasks 自动补全、卡脚日期、重复任务和按日期排序。[Tasks → Obsidian Properties → Kanban plugin](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Obsidian%20Properties.md)、[Tasks → Kanban Plugin](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Other%20Plugins/Kanban%20Plugin.md)

对一个 Markdown 看板的直接约束：

- 卡片最好保持标准 `- [ ]` checklist 行；一旦改成自定义卡语法，Tasks、Dataview、其他 checklist 工具都看不到。
- 日期/优先级/依赖用 Tasks emoji 写在行内，不要只放 YAML；Tasks 扫描的是任务行，不是 frontmatter。
- 列名和 `[x]` 是两套语义：把卡拖到 “Done” 列不会自动打勾（除非该列带 `**Complete**` 标记）。如果既要看板列又要 Tasks 兼容，必须明确“列 → 状态字符”的映射，否则会出现“卡在 Done 列但 `[ ]` 未完成”的双真相。

## 6. DB 看板对照：Focalboard、Vikunja、GitHub Projects

### 6.1 Focalboard / Mattermost Boards

- 数据模型是 **board + block 树**：board 和 card 都是 block，服务端用 `BoardsAndBlocks` 批量读写。[`server/model/boards_and_blocks.go`](https://github.com/mattermost-community/focalboard/blob/main/server/model/boards_and_blocks.go)
- 存储是 SQL；桌面版把 server 打包起来跑 SQLite（README 明确说 standalone desktop “runs locally against SQLite”）。[Focalboard README](https://github.com/mattermost-community/focalboard#readme)
- 现状：README 顶部明确写着 “This repository is currently not maintained.”；这本身就是 DB 方案的一个风险样本。[Focalboard README](https://github.com/mattermost-community/focalboard#readme)

### 6.2 Vikunja

- 任务存数据库；Kanban 是项目的一种视图，任务是“桶（bucket）”里的记录。
- 桶有默认桶、Done 桶、WIP 上限、折叠状态；拖进 Done 桶会自动标记完成，从别处标记完成会自动进 Done 桶。[Vikunja Views → Kanban](https://vikunja.io/help/views/)
- 部分视图状态存在浏览器本地：列表/表格会记住排序、过滤、搜索和分页，折叠状态也按浏览器保存，不跟账号跨设备。[Vikunja Views → Remembered view settings](https://vikunja.io/help/views/)

### 6.3 GitHub Projects

- Board 是 issues / PRs 的一种视图；item 本体在 GitHub，不在仓库文件里。
- 支持 table / board / roadmap 三种布局、custom fields、automation、GraphQL API。[GitHub Docs → About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)
- 优点是跨仓库、权限、自动化、多人并发；缺点是离开 GitHub 就没有本地文件。

### 6.4 得失

| 维度 | Markdown 看板 | DB 看板 |
|---|---|---|
| 数据所有权 | 文件在用户磁盘，Git 可版本化 | 数据库/服务端 |
| 合并 | 单文件整文件，或一卡一文件 | 记录级/事务级 |
| 身份 | 行位置或文件路径 | 稳定主键 |
| 排序 | 行序 / 视图排序 | 显式 rank / bucket 位置 |
| 多人并发 | 依赖同步层，易冲突 | 原生并发控制、权限 |
| 查询/自动化 | 依赖插件/索引 | 服务端查询、API、Webhook |
| 长期可读 | 纯文本，工具消失仍可读 | 依赖 schema/应用 |

## 7. 对比表

| 方案 | 存储单元 | 卡身份 | 顺序来源 | 列语义 / 元数据 | 合并粒度 | 工具支持 | 主要代价 |
|---|---|---|---|---|---|---|---|
| Obsidian Kanban 2.0.51 | 单个 `.md` | 行位置；可选 `^blockid` | 行序 | `##` 标题 / `#tag`、`@{}`、`key::` | 整个文件 | Obsidian + Tasks 2.0.43+ | 无稳定 ID、整文件重写、非看板正文会丢 |
| Logseq 文件图 + 插件 | 块树（页面/日记） | block UUID（文件里需 `id::`） | 兄弟块顺序 | 父块或 TODO marker / `DEADLINE`、属性 | 块/页面 | Logseq + 插件 | 宏不可移植、拖拽仅普通模式、插件停更 |
| SilverBullet + kanban plug | 页面 checklist 行 | `page@pos` ref | query 顺序 | task `state` / `[key: value]` | 页面 | SilverBullet 2.x | 只读、无拖拽、位置身份 |
| Bases 1.14+ 一卡一笔记 | 每卡一个 `.md` + `.base` | 文件路径 | 视图 Sort；列顺序 `groupOrder` | 属性值 / frontmatter | 单篇笔记 | Obsidian 1.14+ | 无原生列内手动排序、卡片较重 |
| Projects 1.17.4（停维护） | 每卡一个 `.md` | 文件路径 | 插件配置或数字 `order` 字段 | 字符串字段 / frontmatter | 单篇笔记 | Obsidian（需 BRAT） | 已停维护、排序依赖插件 |
| Focalboard / Vikunja / GitHub Projects | DB 记录 | 主键 | rank / bucket / view | 字段 / bucket / schema | 记录/事务 | 各自客户端/API | 非本地文件、迁移/锁定风险 |

## 8. 对 SoloMD 的启示

### 8.1 现状核对：已经是单文件，不是纯 localStorage

工作区里的实现已经完成了一版迁移，和本文开头的前提不同（以下是调研时读到的实现；调研期间工作区还有未提交改动，行号可能漂移，以函数名为准）：

- `app/src/stores/kanban.ts` 顶部写明：每个 project 是 `<workspace>/boards/` 下的一个 `.md`，拖拽/编辑后 250ms debounce 写回；`solomd.kanban.v1` 只用于一次性迁移并保留备份。见 `app/src/stores/kanban.ts` 的 `load()` / `migrateLegacy()`。
- `app/src/lib/kanban-markdown.ts` 是专门的 parser/serializer，保留 frontmatter、preamble、archive、settings footer、CRLF/BOM；新建文件写 `kanban-plugin: board`。见 `app/src/lib/kanban-markdown.ts`。
- commit `f166e777` “feat(kanban): store boards as Obsidian-compatible markdown files” 已把这条路径落地；`f0b24988` 是 parser 的前一步。

因此，本文对 SoloMD 的价值不是“建议从 localStorage 迁出”，而是“在单文件已落地的前提下，下一版要补哪些格式/一致性缺口”。

### 8.2 与调研方案对照后暴露的硬约束

1. **稳定卡 ID 缺失**：调研时 `projectFromBoard()` 用 `task_${laneIndex}_${cardIndex}` 生成 ID；外部重排、插入、删除会让后续卡片 ID 整体漂移，编辑中的卡可能指向错卡。见 `app/src/stores/kanban.ts` 的 `projectFromBoard()`。这是单文件方案最大的 correctness 风险。
2. **只能列间拖，不能列内排序**：`KanbanView` 的 `onPointerUp` 只把目标列 ID 传给 `moveTask()`，没有目标位置；`lib/kanban.ts` 的 `moveTask()` 也只改 `columnId`。见 `app/src/components/KanbanView.vue` 的 `onPointerUp()`、`app/src/lib/kanban.ts` 的 `moveTask()`。
3. **整文件写回**：`persistNow()` 每次序列化整个 board 再 `write_file`；没有 diff/patch，也没有 mtime 冲突检测。外部编辑同一文件时，最后一次写覆盖前一次。见 `app/src/stores/kanban.ts` 的 `persistNow()` / `schedulePersist()`。
4. **只识别 `##` 列**：parser 的 `LANE_RE` 是 `/^##[ \t]+.../`；Obsidian Kanban 解析任意 heading，序列化统一成 `##`。如果用户在 Obsidian 里用 `#`/`###` 建列，SoloMD 打开会看不到列。见 `app/src/lib/kanban-markdown.ts` 的 `LANE_RE`。
5. **归档只认英文 `## Archive`**：parser 用 `/^##[ \t]+archive\b/i` 识别；中文 Obsidian 生成的 `## 归档` 会被当成普通列。`**Complete**` 也没有被赋予行为，只是作为 lane intro 原样保留。见 `app/src/lib/kanban-markdown.ts` 的 `parseBoardMarkdown()`。
6. **没有外部修改监听**：`load()` 只在挂载/切换 workspace 时调用；没有 `watch` 文件 mtime 或 vault 事件。这和第 3 条叠加，构成“开着 SoloMD 时用 Obsidian 改同一文件”的数据丢失场景。见 `app/src/stores/kanban.ts` 的 `load()`。

### 8.3 候选方向（只列取舍，不做最终设计）

**方向 A：继续单文件，补协议细节**

- 收益：与 Obsidian Kanban 双向兼容的成本最低；一个文件就是一个看板，复制/发送/Git diff 直观；现有 parser/serializer 可复用。
- 代价：要自己补稳定 ID（`^blockid` 或 HTML 注释）、列内排序、外部修改检测；整文件写入的冲突粒度不变。
- 未决：稳定 ID 是否要写进 Markdown（会污染卡片文本/被其他工具看到），还是只存在应用侧索引（则换设备丢失）。

**方向 B：一卡一笔记 + 视图文件**

- 收益：身份 = 文件路径；合并粒度 = 单卡；重命名/双链/附件天然；与 Obsidian Bases 1.14+ 的方向一致。
- 代价：看板不再是一个可分享的 `.md`；需要 `.base` 或应用内视图配置；Bases 没有原生列内手动排序，得额外加 `order` 字段（Projects 模式）或应用侧排序。
- 未决：SoloMD 的“任务”是否值得一整篇笔记；现有 `boards/*.md` 用户数据如何迁移/共存；移动端创建笔记的成本。

**方向 C：混合**

- 单文件 board 作为“顺序 + 列”的事实源，卡片可链接到独立笔记（类似 Kanban 的 “New note from card”）；或反过来，笔记为卡、单文件为生成的索引。
- 收益：保留单文件 UX，同时给需要长正文的卡一个稳定落点。
- 代价：两套身份（行 + 笔记路径）需要明确谁是真源；同步时可能同时改 board 文件和笔记；实现复杂度高于 A/B。

### 8.4 不管选哪条，先要定的约束

- **保真**：未知 frontmatter、preamble、archive、settings footer、CRLF/BOM 不能丢；这是现有 parser 已经做的事，不能回退。
- **重复标题**：同一列允许同名卡；任何“按标题找卡”的实现都会错，必须按位置或 ID。
- **外部编辑**：打开期间文件被 Obsidian/Git 改动时，不能静默覆盖；至少要有 mtime/hash 检测和“重载/保留本地”的选择。
- **本地化**：如果要和 Obsidian 双向兼容，必须同时认 `Archive/归档`、`Complete/完成`，以及 `kanban-plugin: basic` 旧值。
- **Tasks 兼容**：卡片保持 `- [ ]` 行；日期/优先级/依赖用 emoji 行内写；不要在 YAML 里再存一份状态。如果走一卡一笔记，`status` frontmatter 是视图列，Tasks 不会读它；要么同时维护卡片行上的 `[x]`/状态字符，要么接受两套状态。
- **规模**：整文件序列化在几百张卡以内可接受；上千张卡要评估写盘延迟和 diff 噪音。
- **平台**：Tauri 的 `read_file` / `write_file` / `list_dir` 是现有路径；如果要文件监听，需要确认跨平台 watcher 的可用性。

### 8.5 仍待验证的问题

- Obsidian Kanban 2.0.51 在“外部修改当前 board 文件”时，Obsidian 的 `TextFileView` 是否会重新加载？本文只确认了插件没有逐卡合并逻辑，没有在真实 Obsidian 里做双开实验。
- Bases 1.14 的列内排序是否会在后续版本补上？截至 2026-11 的帮助页仍只描述“拖到另一列更新属性”。
- Logseq DB 图未来是否会增加 board 布局？官方当前 Views 文档没有。
- SilverBullet 的 `kanban` 插件是否会在 2.12.x 上继续维护？最后提交停在 2024-09。

---

**主要来源汇总**

- Obsidian Kanban：源码 `src/parsers/formats/list.ts`、`src/parsers/common.ts`、`src/parsers/parseMarkdown.ts`、`src/StateManager.ts`、`src/KanbanView.tsx`、`src/main.ts`；文档 `docs/How do I/*`；release `2.0.51`。
- Obsidian Tasks：`docs/Reference/Task Formats/Tasks Emoji Format.md`、`docs/Getting Started/Statuses.md`、`docs/Getting Started/Global Filter.md`、`docs/Other Plugins/Kanban Plugin.md`；release `8.6.0`。
- Obsidian Bases：`help.obsidian.md/bases/views/kanban`、`help.obsidian.md/bases/syntax`、`help.obsidian.md/bases/views`；changelog `1.14.4`。
- Logseq：`docs/pages/Tasks.md`、`docs/pages/Properties.md`、`docs/db-version.md`；`benjypng/logseq-kanban-plugin`。
- SilverBullet：`docs/Task.md`、`docs/Guide/Task Management.md`；`dandimrod/silverbullet-kanban`；release `2.12.1`。
- DB 对照：Focalboard `server/model/boards_and_blocks.go`；Vikunja `help/views`；GitHub Docs `About Projects`。
