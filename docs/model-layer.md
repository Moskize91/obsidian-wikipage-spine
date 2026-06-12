# Model Layer

本文约束 CLI 与 Obsidian plugin 共享的本地模型层。模型层以 SQLite 数据库为核心；Markdown 文件是数据库对象的 view。

## Note

`note` 指用户亲自写的 Markdown 笔记在数据库中的记录。用户笔记文件是 note 的 view。

Obsidian plugin settings 配置一组 glob 表达式；周期性扫描时，这组 glob 只用于扫描用户笔记 view，不用于扫描 entity view。

扫描后，每个被扫到的 note view 都必须对应一个数据库 note。若不存在，则新建 note，初始状态为 `modified`。

note 不能被其他对象引用，因此 note 没有引用计数。

note 与 view 之间有三种状态：

- `missing`: 数据库 note 存在，但 view 文件不存在。本轮扫描没扫到旧 view、文件被删除、或扫描范围变化，都视为 view 缺失。
- `synced`: note 与 view 同步。
- `modified`: view 存在，但和数据库 note 有差异，或是新发现的 view 尚未处理。

模型层不保存扫描范围，也不保存扫描历史。每次扫描只记录 note view 最后一次出现的 `view_last_seen_scan_id` 和 `view_last_scanned_at_unix_ms`，用于判断缺失和调试。

note view 修改检测分两级：

1. 比较文件最后修改时间和数据库中的 `view_mtime_unix_ms`。如果相同，不读取文件、不计算 hash，note 状态保持原样。
2. 如果修改时间不同，流式读取 view 文件并计算 hash，再与数据库中的 `view_hash` 比较。

只有修改时间不同且 hash 不同时，note 才能被标记为 `modified`。如果修改时间不同但 hash 相同，只更新 `view_mtime_unix_ms`、`view_size_bytes` 等观测字段，note 状态保持原样。

执行 `modified -> synced` 的同步操作时，先把 note view 标准化为文本流。Obsidian / Markdown 特殊结构会成为 matcher barrier；如果特殊结构是指向托管 entity view 的内部链接，则只展开用户可见文字，不能继承旧的 surface 到 EID 绑定。

标准化后的连续文本段交给 `SurfaceMatcher`。同步操作产出两类结构：

- `ResolvedMention`: 孤立 surface match 且只有唯一 EID，可直接拍板。
- `MentionConflict`: 单个 surface 对应多个 EID，或多个 surface match 重叠、嵌套成团，需要后续消歧。

`MentionConflict` 使用局部语境和候选集合计算 hash。同步时应尽量继承 hash 相同的既有消歧结果，因为人工或 LLM 消歧成本高。

同步结果只保存当前状态，不保存历史。自动拍板的 `ResolvedMention` 写入 `note_mentions`。需要消歧的 `MentionConflict` 写入 `note_mention_conflicts`，其内部的 `ConflictSurfaceMatch` 写入 `note_mention_conflict_matches`。

surface match 会用 `Intl.Segmenter` 标记 `word_boundary_suspect`。这个字段是弱判定：如果 surface 像是更长词或人名内部的切片，默认不应成为实体引用；但外部消歧可以通过 `resolved` / `resolved_eid` 显式覆盖该判断。

`note_mentions.resolved` 表示该 `ResolvedMention` 是由旧实体链接或外部决策强制确认。`word_boundary_suspect = 1` 且 `resolved = 0` 的 mention 只保存为观察结果，不计入 entity 引用计数，也不写回为内部链接。

`note_mention_conflict_matches.resolved_eid` 表示该候选 surface match 在当前 conflict 方案中被选为哪个 EID。一个 conflict 可以有多个 match 带 `resolved_eid`，例如 `北京大学` 可以被解决为 `北京` 和 `大学` 两个引用。

同一个 conflict 内所有已 resolved 的 match 不能重叠。SQLite schema 不表达这个约束；写入或继承 conflict resolution 的业务逻辑必须维护它。

如果标准化阶段展开了旧实体内部链接，且新产生的 `MentionConflict` 中某个 `ConflictSurfaceMatch` 精确覆盖该展开文本，并且候选 EID 包含旧链接指向的 EID，则可以直接把该 match 标记为 `resolved_eid`。这用于保留 `[[wiki/北京]]大学` 或 `[[wiki/北京]][[wiki/大学]]` 这类原始链接表达出的用户选择。

note 数据库状态变化后，应触发数据库到 view 的 react 写回。写回使用同一套标准化 token 流，按 `ResolvedMention` 和 `MentionConflict` 当前状态生成新的 Markdown 文本，再由外层写入临时文件并原子替换原 view。

写回时，同一 section 内每个 EID 只渲染第一次内部链接，后续相同 EID 只输出纯文本。section 由正文中的 Markdown thematic break 分隔；文件开头 frontmatter 的 `---` 不作为 section 分隔。

未解决的 `MentionConflict` 不写回为内部链接。冲突解决是高成本动作，应由用户或 Agent 明确决策。

## Entity

`entity` 指从 wikipage / Wikidata EID 体系中生成的数据库记录。entity 也有 Markdown view，但这些 view 原则上由系统管理，不是用户创作的笔记。

所有 entity view 都保存在一个特定文件夹中。该文件夹路径由 Obsidian plugin settings 配置。

entity view 通过保留 property `EID` 与数据库 entity 关联。每次整理后，entity view 文件夹中的文件和数据库 entity 应严格一一对应：

- 数据库有 entity，但 view 缺失：直接创建 view。
- entity view 文件夹中有多余 view：直接删除。
- 用户修改 EID 导致无法关联：不尝试恢复，按多余 view 或缺失 view 处理。

entity 没有 note 的三种同步状态。entity 有 `ref_count`。note 或其他结构可以引用 entity。

当 entity 的 `ref_count = 0`：

- 如果 entity view 没有用户自定义内容，处理逻辑应删除数据库 entity 和 view。
- 如果 entity view 有非保留 properties 或正文内容，处理逻辑应尽力保留该 entity，使其长期停留在 `ref_count = 0` 状态。

## Entity Metadata

entity 的稳定主键是 `EID`。`preferred_lang` 也是必填字段，取值为 `zh` 或 `en`，由创建 entity 时的 Obsidian plugin settings 决定，不使用隐式默认值。

Wikipedia 页面信息允许异步拉取。创建 entity 时不要求已经拿到完整 Wikipedia metadata。

`metadata_complete` 表示已经按 `preferred_lang` 和 fallback 规则尝试读取过完整 metadata。它用于区分“字段读不到”和“字段还没读过”。`metadata_checked_at_unix_ms` 记录最后一次尝试读取 metadata 的时间，用于调试。

从 Wikipedia / Wikidata 获取的展示字段都是可选缓存：

- `wikipage_url`: 实际选中的 Wikipedia 页面 URL。
- `title`: 页面或 Wikidata label，可用于生成 view 标题。
- `description`: Wikidata description 或 Wikipedia summary response 中的短描述。
- `summary`: Wikipedia page summary / extract，用于简短描述词条。
- `image_url`: Wikipedia page summary / PageImages 给出的缩略图或原图 URL。

这些展示字段不应作为 entity 身份依据。不同语言页面、页面类型、缺图页面、消歧义页或缺少 sitelink 的 Wikidata item 都可能导致字段缺失。

如果某个展示字段被异步拉取到，entity 数据库记录和 entity view 的保留 properties 必须同步；同步时以数据库值覆盖 view 中对应的保留 property。

## Markdown Properties

保留 properties 由本项目管理，例如 `EID`、`WikipageURL`。用户不应修改这些字段；同步时系统可以直接覆盖。

非保留 properties 属于用户内容。同步逻辑应尽力保留这些字段。

正文属于用户内容。note 正文完全由用户管理；entity view 正文原则上由系统生成，但如果用户写入内容，处理逻辑应尽力保留。

扫描到没有 EID 的 entity view 时，不入库；扫描实现应直接删除该文件。

## Schema Boundary

当前模型 schema 位于 `packages/app/src/model/schema.ts`。

模型层只定义数据库结构、状态枚举、初始化 SQL 和基础状态查询。它不负责：

- 解析 glob 扫描范围。
- 读取、创建或删除 Markdown 文件。
- 执行 note/view 或 entity/view 同步。
- 维护扫描历史。
- 选择具体 SQLite driver。
