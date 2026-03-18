# ClawMark (爪痕)

Local-first AI runtime for governed memory, structured execution, and multi-surface delivery.

[English](#english) | [简体中文](#zh-cn)

---

## <a name="zh-cn"></a>简体中文

ClawMark 不是一个“聊天壳”或单纯的 agent 外壳，而是一个完整的本地主权 AI Runtime。

它把用户入口、任务执行、正式记忆、决策治理、能力授权和外部交付面统一到一个受控运行时里，让 AI 不只是“能回话”，而是能在本地持续运行、复盘、学习、收敛，并在多渠道上稳定工作。

### ClawMark 是什么

ClawMark 的产品定位是：

- 一个以 `User Console` 为默认入口的本地 AI 操作台
- 一个以 `Runtime Core` 为真理拥有者的执行内核
- 一个支持多 Agent、多 Surface、多渠道交付的运行环境
- 一个为后续 `Federation Plane` 预留受控协同能力的产品

这意味着：

- 真正的长期记忆、策略、任务状态和用户模型都留在本地 Runtime
- 能力使用不是“模型想调什么就调什么”，而是受治理矩阵控制
- 渠道、控制台、Agent 只是运行时的入口与交付层，不拥有正式真理

### 你今天就能用什么

即使你完全不知道 OpenClaw 的历史，也可以把 ClawMark 理解为一个已经具备完整可用面的产品。当前仓库内已经具备并延续的能力包括：

- `User Console`：浏览器控制台，可用于聊天、配置、会话管理、日志、审批、节点和运行时视图
- 多渠道接入：`WhatsApp`、`Telegram`、`Discord`、`Slack`、`Signal`、`iMessage/BlueBubbles`、`WebChat`，以及 `LINE`、`Matrix`、`Mattermost`、`Google Chat`、`Twitch`、`Zalo` 等扩展渠道
- 多模型/多提供商：可接本地模型和兼容 OpenAI 的云模型路由
- 插件与扩展生态：渠道插件、功能插件、技能包、MCP 工具接入
- 自动化能力：定时任务、hooks、设备/节点连接、运行时运维工具
- 多 Agent 运行：按角色、工作区、发送者或策略做隔离和路由

换句话说，ClawMark 不是从零开始的“概念稿”，而是一个已经有完整交付层、控制层和接入层的系统，并正在把这些能力收敛到更强的 Runtime 之下。

### ClawMark 比普通 Agent Gateway 多了什么

ClawMark 的重点不是把“消息转给模型”，而是把 AI 运行本身做成一个可治理的本地系统：

| 能力层                 | ClawMark 的增强点                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Runtime Core           | 正式真理、执行主权、隐私主权和本地治理都归 Runtime Core 所有                                           |
| Memory Kernel          | `SQLite + WAL` 正式记忆内核，支持 lineage、invalidation、rollback、reinforcement、decay                |
| Retrieval Orchestrator | `strategy / memory / session / archive` 四平面检索，支持 `ContextPack` 与懒展开指针                    |
| Decision Core          | `System 1 / System 2` 双路决策，不把最终路由权交给外部插件或表层 persona                               |
| Task Loop              | 统一的 Intake / Planner / Executor / Recovery / Review / Notify 闭环，支持重试、恢复、复盘、压缩防漂移 |
| User Model             | 用户模型属于 Runtime，不属于某个 agent persona                                                         |
| Capability Governance  | `skill / agent / mcp` 全部走 `blocked / shadow / candidate / adopted / core` 治理状态                  |
| Federation Plane       | 为受控的上行同步、下行建议包、策略包和团队知识包预留边界，不让上游直接覆盖本地真理                     |

### 产品边界

为了避免把产品说成“一个万能 agent”，ClawMark 明确区分这些对象：

- `User Console`：默认网页入口和操作者控制面
- `Runtime Core`：正式记忆、决策、任务、治理的唯一权威内核
- `Agent`：运行时生态对象，不是产品身份本身
- `Surface`：绑定到 User Console 或某个 Agent 的渠道/账号表层
- `Federation Plane`：本地运行时与公司内部 Brain OS 之间的受控同步平面

这也是为什么 ClawMark 的 README 不应该只写“它是 OpenClaw 的一个变体”，因为产品边界和目标已经不同了。

### 快速开始

当前仓库要求：

- `Node.js >= 22.12`
- `pnpm`

从源码运行：

```bash
pnpm install
pnpm build
node openclaw.mjs onboard
node openclaw.mjs dashboard --no-open
```

如果你想直接前台启动网关：

```bash
node openclaw.mjs gateway --port 18789 --verbose
```

兼容性说明：

- 产品名已经是 `ClawMark`
- 当前 CLI 入口在迁移期仍然是 `openclaw` / `openclaw.mjs`
- 部分文档、配置路径和命令名暂时仍沿用 `openclaw` 命名

### 给 OpenClaw 老用户

如果你是从 OpenClaw 迁移过来的，需要知道两件事：

- ClawMark 不是删减版，也不是只改了名字的皮肤层
- 原来好用的渠道、Gateway、Control UI、插件机制、模型接入、节点能力，在这里仍然存在

区别在于，ClawMark 把这些原本偏“接入层”的能力，重新放进了一个更严格的 Runtime 体系里：

- 正式记忆必须本地归档和治理
- 任务执行必须经过统一 Task Loop
- 决策与能力调用必须经过治理边界
- Federation 只能同步受控产物，不能反向篡改本地真理

所以如果把 OpenClaw 理解为“很强的 AI Gateway / delivery layer”，那 ClawMark 更像是“保留强交付面的下一代本地主权 Runtime 产品”。

### 文档与蓝图

- 入门文档: [docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started)
- 控制台文档: [docs.openclaw.ai/web/dashboard](https://docs.openclaw.ai/web/dashboard)
- 渠道能力总览: [docs.openclaw.ai/channels](https://docs.openclaw.ai/channels)
- 从源码开发: [docs.openclaw.ai/start/setup](https://docs.openclaw.ai/start/setup)
- 本仓库的产品蓝图与执行边界: [AGENTS.md](AGENTS.md)

---

## <a name="english"></a>English

ClawMark is a local-first AI runtime, not just a chat wrapper around a model.

It combines operator entry, formal memory, structured task execution, governed tool access, and multi-surface delivery into one runtime-owned system. The goal is not merely to reply to messages, but to run AI workloads locally with reviewable state, stable execution loops, and clear governance boundaries.

### What ClawMark is

ClawMark is designed as:

- a `User Console` as the default operator entrypoint
- a `Runtime Core` that owns formal truth and execution authority
- a runtime for multiple agents, surfaces, and delivery channels
- a product with a controlled `Federation Plane`, without shipping `Brain OS` into end-user deployments

### What you can use today

ClawMark already ships with a real product surface, not a placeholder runtime shell:

- `User Console` in the browser for chat, config, sessions, logs, approvals, nodes, and runtime views
- multi-surface delivery through `WhatsApp`, `Telegram`, `Discord`, `Slack`, `Signal`, `iMessage/BlueBubbles`, `WebChat`, plus extension channels such as `LINE`, `Matrix`, `Mattermost`, `Google Chat`, `Twitch`, and `Zalo`
- local and hosted model routing
- plugins, extensions, skill packs, and MCP integrations
- automation tools including cron jobs, hooks, node/device connectivity, and gateway operations
- multi-agent routing and isolation by role, workspace, sender, or policy

### What makes ClawMark different

ClawMark upgrades the usual agent gateway pattern into a governed runtime:

- `Runtime Core` owns formal truth, privacy sovereignty, and local governance
- `Memory Kernel` uses `SQLite + WAL` with lineage, invalidation, rollback, reinforcement, and decay
- `Retrieval Orchestrator` works across `strategy`, `memory`, `session`, and `archive` planes
- `Decision Core` keeps final routing structured with `System 1 / System 2` lanes
- `Task Loop` unifies planning, execution, recovery, review, and notify into one closed loop
- `User Model` belongs to the runtime, not to an individual agent persona
- `Capability Governance` controls `skill`, `agent`, and `mcp` objects through governed states
- `Federation Plane` syncs controlled artifacts only and does not bypass local sovereignty

### Quick start

Requirements:

- `Node.js >= 22.12`
- `pnpm`

Run from source:

```bash
pnpm install
pnpm build
node openclaw.mjs onboard
node openclaw.mjs dashboard --no-open
```

Run the gateway in the foreground:

```bash
node openclaw.mjs gateway --port 18789 --verbose
```

Compatibility note:

- the product name is `ClawMark`
- the CLI entrypoint is still `openclaw` / `openclaw.mjs` during migration
- some docs, config paths, and command names still use `openclaw` naming

### For OpenClaw users

ClawMark should be understood as a new product first, not as a README that assumes prior OpenClaw knowledge.

That said, this repository still preserves the strong delivery and infrastructure layers people already relied on: channels, gateway operations, Control UI, plugin architecture, model integrations, and node/device flows. The difference is that ClawMark places those capabilities under a stronger runtime model with local truth ownership, governed execution, and controlled federation boundaries.

### Docs

- Getting started: [docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started)
- Dashboard: [docs.openclaw.ai/web/dashboard](https://docs.openclaw.ai/web/dashboard)
- Channels overview: [docs.openclaw.ai/channels](https://docs.openclaw.ai/channels)
- Source setup: [docs.openclaw.ai/start/setup](https://docs.openclaw.ai/start/setup)
- Product blueprint and runtime boundaries: [AGENTS.md](AGENTS.md)
