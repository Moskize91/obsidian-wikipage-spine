# Dataset Builder Pipeline

本文只约束数据集构建器的四个离线步骤及其输入输出边界，不展开内部实现。

所有数据目录都位于 `crates/data/` 下，属于生成产物，不应签入 git。四个步骤彼此独立；每一步运行时只允许删除和重建自己的输出目录。

## 1. Download

`download` 负责把后续构建需要的上游 Wikimedia dump 拉到本地。它是纯数据获取步骤，不解释 dump 内容，也不生成项目自己的中间 schema。周期性更新数据集时，通常从这里重新开始。

输入：

- 目标 wiki 列表，当前默认是 `zhwiki,enwiki`。
- Wikimedia dump 日期，当前默认是 `latest`。
- 需要下载的 dump component。

输出：

- `crates/data/dumps/`
- 原始 Wikimedia dump 文件。
- 下载 manifest。

约束：

- 该步骤只负责取得上游原始数据，不做裁剪、归并或格式转换。
- 下载产物是后续预处理步骤的唯一上游输入。
- 色卡链路要求下载 `wikidata_entities`，即 `crates/data/dumps/wikidatawiki/latest/latest-all.json.bz2` 或对应日期的 Wikidata entities dump。

## 2. Preprocess

`preprocess` 负责把原始 dump 裁剪成项目自己的 surface 表，并抽取 Wikidata 的 `P31` / `P279` 类型边。它把来自不同 wiki 的页面标题和重定向信息归并到同一套 surface 空间中。这个步骤产出的 `surface_qids.tsv` 是后续所有 `surface_id` 的来源；`entity_type_edges.tsv` 是后处理计算 entity 色卡的来源。

输入：

- `crates/data/dumps/`
- 目标 wiki 列表和 dump 日期。
- Wikidata entities dump；缺失时不能生成有效的 `entity_type_edges.tsv`。

输出：

- `crates/data/preprocess/manifest.json`
- `crates/data/preprocess/surface_qids.tsv`
- `crates/data/preprocess/surface_sources.tsv`
- `crates/data/preprocess/entity_type_edges.tsv`

约束：

- `surface_qids.tsv` 是后续编译和后处理共同依赖的主表。
- `surface_qids.tsv` 的行顺序定义全局 `surface_id`，后续步骤必须保持这个顺序。
- 中文和英文来源在此阶段被视为平等输入，不拆分为不同数据集。
- `entity_type_edges.tsv` 记录 `qid -> P31/P279 target QID[]`；为了让后处理能沿类型链继续跳转，它不只覆盖 surface 候选中出现过的 QID。
- 缺少 Wikidata entities dump 时，预处理必须失败；空类型边会让后续色卡测试失去意义。

## 3. Compile

`compile` 负责把 `surface_qids.tsv` 中的 surface key 编译成 Aho-Corasick 自动机。它只关心字符串匹配，不关心 QID 候选表如何读取。该步骤的产物仍然是 Rust 构建器内部格式，不能作为 JS 运行时的稳定文件格式。

输入：

- `crates/data/preprocess/surface_qids.tsv`

输出：

- `crates/data/compile/automaton.bin`
- `crates/data/compile/manifest.json`
- `crates/data/compile/progress.tsv`

约束：

- 该步骤只编译 surface key 自动机。
- `automaton.bin` 是构建器内部产物，不是 JavaScript/Obsidian 运行时 ABI。
- 自动机 output 必须保留 `surface_id`，使后处理能回连到 `surface_qids.tsv`。

## 4. Postprocess

`postprocess` 负责把编译产物和预处理主表整理成 JS/Obsidian 运行时可读取的数据包。它把 Rust 内部自动机格式拆成固定记录宽度的二进制表，并补齐运行时需要的 surface 到 EID 映射表与 EID 色卡表。这个步骤之后的 `runtime/` 才是面向下游安装和查询的产物。

输入：

- `crates/data/preprocess/surface_qids.tsv`
- `crates/data/preprocess/entity_type_edges.tsv`
- `crates/data/compile/automaton.bin`

输出：

- `crates/data/runtime/manifest.json`
- `crates/data/runtime/automaton/char_code_map.bin`
- `crates/data/runtime/automaton/states.bin`
- `crates/data/runtime/automaton/state_outputs.bin`
- `crates/data/runtime/surfaces/surface_eid_index.bin`
- `crates/data/runtime/surfaces/surface_eid_values.bin`
- `crates/data/runtime/eids/qid_numbers.bin`
- `crates/data/runtime/eids/flags.bin`
- `crates/data/runtime/eids/color_index.bin`
- `crates/data/runtime/eids/color_values.bin`

约束：

- 该步骤生成 JavaScript/Obsidian 运行时应读取的稳定二进制表。
- runtime 产物必须能在低内存运行时中按需读取；cache 只能影响性能，不能影响正确性。
- runtime 产物不包含 surface 文本本体，只保留匹配定位和 `surface_id -> eid_id[] -> QID/color card` 所需的信息。
- 每个 QID 的 flags 和稀疏色卡只允许在 EID 表中出现一次；surface 候选表只能引用 `eid_id`。
- 色卡锚点是源码中的小规模 QID 表。色卡值表示某个 entity 沿 `P31/P279` 类型链到达锚点的最短距离；缺失条目等价于该锚点距离为 `-1`。
- 当前后处理从每个锚点做反向广度优先遍历，并只把 runtime EID 命中的结果写入稀疏色卡。用户或运行时策略只能解释色卡，不应修改色卡本体。
