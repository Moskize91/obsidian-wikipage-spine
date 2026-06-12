这个仓库是 `obsidian-wikipage-spine` 的开源项目仓库，对应 <https://github.com/moskize91/obsidian-wikipage-spine>。

项目目标是为 Obsidian 笔记和 Agent 工作流提供本地 Wikipedia/Wikidata 实体候选召回能力。仓库同时维护上游的数据集预编译工程，以及下游面向用户和 Agent 的 CLI 与 Obsidian 插件。它们逻辑上是上下游关系，但工程差异很大，应按独立项目边界理解。

# 现状总览

- 当前仓库采用 monorepo 结构：`crates/` 放高性能数据集构建工程，`packages/` 放 TypeScript 应用工程。
- `crates/dataset-builder/` 是预编译数据集构建器。它面向 Wikipedia/Wikidata dump、surface form 索引、消歧义候选表和可选 Aho-Corasick 自动机等离线构建任务。
- `packages/app/` 是发布给用户的 TypeScript 工程。它包含同一套 TS 代码下的 CLI 与 Obsidian plugin 两个入口。
- CLI 是 Agent 和插件都应依赖的稳定操作面，负责数据集安装、状态检查、查询和后续笔记处理命令。
- Obsidian plugin 是桌面端用户 UI，原则上通过 CLI 间接操作本地数据集，不直接承载大型索引格式或离线构建逻辑。
- 数据集产物不作为源码维护，也不应打进 npm 包或 Obsidian 插件包。程序发布物和数据发布物应保持分离。
- 构建产物不作为源码维护：Obsidian plugin release staging 输出到 `packages/app/plugin-dist/`，CLI bundle 输出到 `packages/app/bin/`。

# 架构边界

- 数据集构建器关注离线吞吐、产物格式和数据 schema；它可以使用 Rust 等高性能语言，不受 Obsidian 或 Node 运行时约束影响。
- CLI 关注本地安装、文件系统、数据集校验和 JSON 协议；它是插件和外部 Agent 调用本项目能力的主要边界。
- Obsidian plugin 关注命令、设置页、交互和 vault 内写入；它不应复制 CLI 的数据处理职责。
- TypeScript shared code 只承载 CLI 与 plugin 都需要理解的项目常量、协议类型和轻量逻辑。
- Aho-Corasick 是数据集构建和可选运行后端的一部分，不是 Obsidian plugin 的直接职责。

# 文档路由

- 涉及数据集构建器的 `download`、`preprocess`、`compile`、`postprocess` 四步输入输出边界时，阅读 `docs/dataset-builder-pipeline.md`。
- 涉及 TypeScript model 层、SQLite schema、note/entity/view 边界、扫描状态和 entity metadata 约束时，阅读 `docs/model-layer.md`。

# 文档原则

- 文档入口是 AI 路由表。它的职责不是摘要下层文档，而是用问题域和触发条件把 AI 路由到合适的文档。
- 这个原则适用于整个仓库的所有文档。上层文档负责路由，下层文档负责展开；文档之间应通过引用组织信息，而不是重复彼此内容。
- 所有文档都应保持简洁，只写和业务有关、AI 不会天然知道的信息；不要为了阅读体验补写常识，也不要把细节不断堆回入口文档。
