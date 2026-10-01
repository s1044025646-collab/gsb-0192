# RNA 无伪结折叠与最优结构计数后端（教学用）

使用 **TypeScript + Node.js + 内置 SQLite（`node:sqlite`）** 实现的单链 RNA 二级结构分析后端，只提供 **HTTP API 与 CLI**，不含前端。

> 这是一个**简化的组合评分模型**，用于教学区间动态规划与计数；**不是真实热力学自由能预测**，不依赖任何外部生物数据库或在线服务。

## 功能

- 输入仅含 `A/U/G/C` 的短序列，计算**不含交叉配对（无伪结）**的最优折叠。
- 返回点括号（dot-bracket）表示、配对清单、整数评分，以及**不同最优配对集合的数量**。
- 计数使用 **BigInt 精确计算**，以**十进制字符串**经 API 返回并保存到 SQLite，可超过 `Number.MAX_SAFE_INTEGER` 不丢精度。
- 支持列出前 K 个不同最优结构；列举截断时**完整计数仍保留**，`truncated` 单独标记。
- 配对规则：`GC/CG`、`AU/UA`，以及**可配置开关**的 `GU/UG`；配对得分为**可配置整数**。
- 约束：`unpaired`（必须未配对）、`forbiddenPairs`（禁止配对）、`forcedPairs`（强制配对）。
  - 强制配对**交叉（形成伪结）、同一位置重复强制、碱基不相容、发夹间距不足、强制=禁止** 时一律**拒绝（HTTP 422 / CLI 退出码 422）**，绝不悄悄放松后声称成功。
  - 合法约束导致不可行时，结果以 `feasible:false`、`score:null`、`optimalCount:"0"` 单独表示。
- 序列/规则导入、折叠、结构核验、约束前后比较、歧义查询、报告导出。
- SQLite 保存**输入序列、约束、评分规则快照**；报告引用完整快照 ID，重启后可精确复现旧报告。
- 相同序列在不同编号/来源下**共享同一计算行**，并用 `sources` 表保留各自来源，不丢来源。

## 模型与默认参数（可配置）

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `maxLength` | `120` | 公开的最大序列长度 |
| `minHairpin` | `3` | 最小发夹环长度，配对 `(i,j)` 需满足 `j-i-1 >= minHairpin` |
| `gc` | `3` | GC/CG 配对整数得分 |
| `au` | `2` | AU/UA 配对整数得分 |
| `gu` | `1` | GU/UG 配对整数得分 |
| `allowGU` | `true` | 是否允许 GU 摆动配对 |

所有配对得分与环长均为整数；最优分是“所选配对得分之和”的最大值。

## 算法

- 自实现**区间 DP**：`best[i][j]` 为区间最优分，`count[i][j]` 为 BigInt 最优结构数。
  - 转移：位置 `i` 不配对；或 `i` 与 `m` 配对，分解为内部 `[i+1,m-1]` 与右侧 `[m+1,j]`。
  - `i` 的首个配对 `m` 唯一确定该结构归属，故**不同推导不会重复计数**。
  - 约束通过“干净区间”判断与强制/禁止/未配对检查融入 DP，保证每个位置最多配对一次、配对不交叉、环长达标。
- 回溯按确定性顺序枚举**不同配对集合**（以配对集合签名去重），达到 K 即停止，但计数独立完整。
- 另含**独立的小规模穷举参考实现**（`src/core/bruteforce.ts`），测试用其交叉核对最优分与计数。

## 环境要求

- Windows 本地运行，Node.js **>= 22.5**（使用内置 `node:sqlite`，无需 C++ 编译；开发机实测 Node v25）。
- 不依赖 Docker、WSL、付费服务或外部在线 API。

## 快速开始

```powershell
npm install
npm run build      # TypeScript 编译到 dist/
npm test           # 编译并运行 node:test（含穷举交叉核对）
npm run demo       # 端到端演示
npm start          # 启动 HTTP 服务
```

可配置端口与项目内数据目录（均有默认值）：

```powershell
$env:PORT="3000"
$env:DATA_DIR="$PWD/data"
npm start
```

## HTTP API

`Content-Type: application/json`。评分/约束字段均可选，缺省用默认值。

| 方法 & 路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `POST /sequences` | 导入序列（可带 `source` 登记来源） |
| `POST /fold` | 折叠；`persist:true` 时保存报告 |
| `POST /verify` | 核验给定 `dotBracket` 是否合法且满足约束 |
| `POST /compare` | 同一序列 `before` / `after` 两套约束前后比较 |
| `POST /ambiguity` | 仅查询最优结构完整计数与列举数 |
| `GET /reports` / `GET /reports/:id` | 报告列表 / 旧报告复现（含完整快照） |
| `GET /export/:id` | 导出报告 JSON 文件 |

请求体示例：

```json
{ "sequence": "GCGCGC", "score": { "minHairpin": 0 }, "constraints": { "unpaired": [0] }, "topK": 5, "persist": true }
```

快速试一条：

```powershell
Invoke-RestMethod http://localhost:3000/fold -Method Post `
  -Body '{"sequence":"GCGCGC","score":{"minHairpin":0},"topK":3}' `
  -ContentType 'application/json'
```

## CLI

```powershell
node dist/src/cli/index.js fold --seq GCGCGC --score examples/score.custom.json --topK 5
node dist/src/cli/index.js fold --seq GGAACC --constraints examples/constraints.nested.json
node dist/src/cli/index.js fold --seq GGAACC --constraints examples/constraints.crossing.json   # 422 拒绝
node dist/src/cli/index.js verify --seq GCGC --dot "(..)" --score examples/score.custom.json
node dist/src/cli/index.js compare --seq GCGCGC --before examples/constraints.nested.json --after examples/constraints.crossing.json
node dist/src/cli/index.js ambiguity --seq GCGCGC
node dist/src/cli/index.js import --seq GCGCGC --source lab-batch-1
node dist/src/cli/index.js sources
node dist/src/cli/index.js reports
node dist/src/cli/index.js report --id 1
node dist/src/cli/index.js export --id 1 --out report-1.json
```

## 数据与复现

- SQLite 文件默认位于项目内 `data/rna.sqlite`。
- 表：`sequences`（相同序列唯一，共享计算）、`sources`（来源别名）、`reports`（序列 + 快照 + 结果）。
- 快照 JSON 包含模型标识、完整评分规则与全部约束，并取 16 位 sha256 前缀作为 `snapshotId`；报告结果内嵌该 ID，`/reports/:id` 与导出均回引完整快照。

## 测试覆盖

- 可人工穷举短序列、全不可配对序列、多个并列最优解、强制配对嵌套与交叉冲突。
- DP 与独立穷举在 200 组随机短序列、多种评分（含关闭 GU、不同环长）下一致。
- 点括号 ↔ 配对集合往返、枚举无重复、位置唯一/不交叉/环长核验。
- 计数超过安全整数仍精确（64 位序列，Catalan(32)=55534064877048198）。
- 约束收紧后最优分不提高（单调性）；禁止配对使歧义下降。
- 交叉/重复强制、不相容、间距不足、强制=禁止均被拒绝；旧报告重启后复现。

## 合理假设与限制

- 评分是教学用整数加权配对模型，**不代表真实自由能**，也不考虑最近邻能量、温度、离子浓度等。
- 仅支持点括号表示的无伪结结构；不处理伪结、多分支架构的特殊命名差异（同一配对集合即同一结构）。
- 序列上限默认 120；DP 时间复杂度约 O(n^3)、空间 O(n^2)。
- `node:sqlite` 在 Node 22/25 带实验性标注，启动时以 `--no-warnings` 静默；其文件格式为标准 SQLite。
