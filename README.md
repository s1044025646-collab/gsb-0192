# RNA 无伪结折叠与最优结构计数后端

这是一个教学用、可在 Windows 本地运行的 TypeScript + Node.js + SQLite 后端，只提供 API 与 CLI，不包含前端页面。

## 模型边界

- 输入为仅含 `A`、`U`、`G`、`C` 的单链 RNA，默认最大长度为 100。
- 结构不允许伪结/交叉配对，每个位置最多参与一个配对。
- 支持 `AU`、`GC`，以及可开关的 `GU` 配对。
- 默认最小发夹环长度为 3，可在请求中配置。
- 配对分数是可配置整数；默认 `AU=1`、`GC=2`、`GU=0`。
- 这是简化组合优化模型，不是真实热力学自由能预测，也不访问外部生物数据库。

## 功能

- 区间动态规划计算最优整数分数。
- 使用 `BigInt` 精确统计不同最优配对集合数量，并以十进制字符串返回和保存。
- 回溯最多列出前 K 个不同最优结构；`optimalStructureCount` 始终是完整计数，不随列举截断变化。
- 支持必须未配对、禁止配对、强制配对。
- 显式拒绝交叉强制配对、重复强制位置、不相容碱基、发夹环不足等请求，不悄悄放松约束。
- 支持点括号和配对清单双向核验。
- SQLite 保存完整报告快照，包括输入、规范化约束、评分版本、结果和模型声明。
- 不同 `sourceId` 的报告可以拥有相同 `calculationHash`，共享计算事实但保留各自来源与报告 UUID。

## 环境要求

- Node.js 22.5 或更新版本；推荐使用当前 Node 22/24/25。
- SQLite 使用 Node 内置实验模块 `node:sqlite`，无需安装原生第三方 SQLite 包。
- 不需要 Docker、WSL、付费服务或外部在线 API。

## 安装、构建与测试

```powershell
npm install
npm run build
npm test
```

测试包含：

- 可人工穷举的短序列；
- 全不可配对序列；
- 多个并列最优结构；
- 强制嵌套配对；
- 交叉强制配对拒绝；
- 点括号与配对集合往返；
- 枚举无重复；
- 独立小规模穷举核对分数和结构数量；
- 超过 `Number.MAX_SAFE_INTEGER` 的 BigInt 计数；
- 收紧约束后最优分数不提高；
- SQLite 关闭重开后的完整快照复现。

## CLI

折叠并保存报告：

```powershell
node dist/cli.js fold examples/fold.json --data data
node dist/cli.js fold examples/forced.json --data data
```

核验结构：

```powershell
node dist/cli.js verify examples/verify.json
```

比较同一序列的两套约束：

```powershell
node dist/cli.js compare examples/compare.json
```

查看、重启后查询和导出：

```powershell
node dist/cli.js list --data data
node dist/cli.js query <reportIdOrNumber> --data data
node dist/cli.js export <reportIdOrNumber> report.json --data data
```

内置演示：

```powershell
npm run demo
```

演示会展示同一序列在无约束和强制外配对下的歧义变化、非法约束拒绝、旧报告重开复现，以及超大精确计数。

## HTTP API

启动服务，默认监听 `127.0.0.1:3000`，数据目录为项目内 `data`：

```powershell
npm start
```

自定义端口和数据目录：

```powershell
node dist/cli.js serve --port 8080 --data data
$env:PORT="8080"; $env:RNA_DATA_DIR="data"; npm start
```

接口均为 JSON：

- `POST /api/sequences/import`：规范化并校验序列、约束和评分规则。
- `POST /api/fold`：折叠并保存完整快照。
- `POST /api/verify`：核验点括号或配对清单。
- `POST /api/compare-constraints`：比较同一序列两套约束。
- `POST /api/ambiguity`：只查询最优分数和完整歧义计数。
- `POST /api/reports/query`：按报告 UUID 或数字编号读取快照。
- `POST /api/reports/list`：列出报告元数据。
- `POST /api/reports/export`：返回可导出的完整 JSON 快照。
- `GET /health`：健康检查。

PowerShell 调用示例：

```powershell
$body = Get-Content examples/fold.json -Raw
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/fold -Method Post -ContentType "application/json" -Body $body
```

## 请求格式

```json
{
  "sequence": "GAGAUU",
  "listLimit": 10,
  "scoring": {
    "allowGU": true,
    "minHairpin": 1,
    "maxSequenceLength": 100,
    "pairScores": { "AU": 1, "GC": 2, "GU": 0 }
  },
  "constraints": {
    "unpaired": [3],
    "forbiddenPairs": [[2, 5]],
    "forcedPairs": [[1, 6]]
  }
}
```

所有位置和配对位置均使用从 1 开始的编号。

## 响应要点

```json
{
  "feasible": true,
  "optimalScore": 1,
  "optimalStructureCount": "5",
  "listedStructureCount": 5,
  "listTruncated": false,
  "structures": [
    {
      "dotBracket": "...(.)",
      "pairs": [[4, 6]]
    }
  ]
}
```

当请求本身非法时返回 HTTP 400 和 `problems` 明细。`feasible:false` 表示请求通过规则校验，但当前 DP 可行集合为空；本简化模型中多数直接矛盾已在请求校验阶段拒绝。

## 算法说明

对区间 `[i,j]`，DP 只做两类互斥分解：

1. 位置 `i` 不配对，转移到 `[i+1,j]`；
2. 位置 `i` 与某个 `k` 配对，分解为不交叉的 `[i+1,k-1]` 和 `[k+1,j]`。

枚举配对 `k` 时应用碱基、GU 开关、最小发夹环、未配对、禁止配对和强制配对规则。因为每个非空配对集合的最左位置配对对象唯一，同一结构不会经多个分解路径重复计数。

## 限制

- 最大长度固定为公开配置，默认 100；这是教学服务而不是高通量预测器。
- 没有环惩罚、堆叠能、温度、离子浓度、多分支环热力学或伪结支持。
- `node:sqlite` 在当前 Node 版本会输出实验性警告，不影响本地运行。
