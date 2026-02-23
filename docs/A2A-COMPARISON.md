# Accord vs. A2A Protocol — 对比分析

> 本文档对 Accord 当前架构与 Google A2A (Agent-to-Agent) 协议进行逐层对比，
> 识别重叠设计（重复造轮子）与 Accord 独有价值（应保留并深耕的部分）。

---

## 1. 背景

### 1.1 Accord 现状

Accord 是一个 Git-based 的多 AI Agent 协作框架，包含：
- **协议层**：基于文件的消息协议、请求状态机、合约注册表
- **运行时层**：Fastify HTTP 服务、Scheduler、Dispatcher、Worker Pool、Agent SDK 适配器
- **UI 层**：React Web UI + WebSocket 实时流

技术栈：TypeScript ~5,100 行，依赖 `@anthropic-ai/claude-agent-sdk` v0.1.0。

**当前痛点**：
- Agent SDK 不成熟（V2 接口标记为 `unstable_v2_*`）
- V1 适配器每请求 2-5s 冷启动
- SDK 无法加载项目 CLAUDE.md，上下文必须注入 prompt
- SDK 无法绕过 `~/.claude/settings.json` 权限控制
- 维护 Scheduler/Dispatcher/Worker Pool/Session Manager 等 46 个文件的运行时负担

### 1.2 A2A 协议

Google A2A (Agent-to-Agent) 是一个开放通讯标准（Apache 2.0, Linux Foundation 托管），使不同厂商/框架的 AI Agent 能够发现、通讯和协作。

- 版本：RC v1.0（v0.3.0 为最新发布版）
- 传输：HTTP/HTTPS + JSON-RPC 2.0 + SSE 流式 + gRPC（可选）
- 支持：150+ 组织（Microsoft, SAP, Amazon, LangChain 等）
- SDK：Python, TypeScript, Java, Go, .NET 官方实现

---

## 2. 逐层概念对照

### 2.1 服务发现

| 维度 | Accord | A2A |
|---|---|---|
| **机制** | `.accord/registry/{service}.md` Markdown 文件 | Agent Card (`/.well-known/agent.json`) JSON 文件 |
| **格式** | YAML frontmatter + Markdown | 结构化 JSON |
| **内容** | name, type, maintainer, owner, language, dependencies, contract refs | name, description, url, version, capabilities, skills, securitySchemes, extensions |
| **发现方式** | 读取本地文件系统 | HTTP GET well-known URI 或注册中心查询 |
| **机器可读性** | 中（需解析 YAML+Markdown） | 高（原生 JSON） |
| **安全** | 无 | OAuth 2.0, API Key, mTLS, OpenID Connect |

**重叠度：~85%** — Accord registry 和 Agent Card 解决同一个问题（"这个 agent 是谁、能做什么、怎么联系它"），A2A 方案更标准化。

**Accord 独有**：`maintainer` 类型（ai/human/hybrid/external）控制自动化程度、`contract refs` 关联合约文件。这些可以通过 A2A Agent Card 的 `extensions.params` 承载。

### 2.2 消息传递

| 维度 | Accord | A2A |
|---|---|---|
| **传输** | Git 文件系统（`.accord/comms/inbox/{target}/req-*.md`） | HTTP JSON-RPC 2.0 (`message/send`) |
| **格式** | YAML frontmatter + Markdown body | JSON Message 对象，包含 Parts (TextPart, DataPart, FilePart) |
| **元数据** | id, from, to, scope, type, priority, status, created, updated, related_contract | Task metadata (任意 key-value), Message metadata, Part metadata |
| **同步模式** | git pull = 接收, git push = 发送（轮询） | HTTP 请求-响应 + Push Notification webhook（推送） |
| **延迟** | 30 秒轮询间隔 | < 1 秒 |
| **跨网络** | 需要 `accord sync push/pull` 跨仓库同步 | HTTP 天然跨网络 |
| **离线支持** | 原生支持（Git 本地操作） | 不支持（需要网络） |

**重叠度：~95%** — 两者都在解决 "agent A 怎么把请求发给 agent B"，A2A 的 HTTP push 模型在延迟和跨网络方面显著优于 Git 轮询。

### 2.3 请求/任务生命周期

| 维度 | Accord | A2A |
|---|---|---|
| **实体** | AccordRequest (Markdown 文件) | Task (JSON 对象) |
| **标识** | `id: req-001-add-policy-api` (YAML field) | `taskId` (UUID) + `contextId` (关联多任务) |

**状态机对照：**

```
Accord 状态         A2A 状态               语义差异
────────────────────────────────────────────────────────
pending             submitted              相同：请求已创建，等待处理
(无对应)            auth-required          A2A 独有：需要额外认证
pending→approved    input-required→resume  Accord 有独立的 approved 状态；
                                           A2A 需用 input-required +
                                           metadata 模拟审批
approved→in-progress working               相同：开始执行
in-progress         working                相同：执行中
completed           completed              相同：成功完成
rejected            rejected               相同：拒绝
failed              failed                 相同：执行失败
(无对应)            canceled               A2A 独有：客户端取消
```

**重叠度：~90%** — 核心状态转换几乎一致。关键差异是 Accord 的 `approved` 独立状态在 A2A 中没有原生对应，需要用 `input-required` + 自定义 metadata 模拟。

### 2.4 请求结构

**Accord Request (YAML frontmatter)**：
```yaml
---
id: req-001-add-policy-api
from: device-manager
to: demo-engine
scope: external
type: api-addition
priority: medium
status: pending
created: 2026-02-09T10:30:00Z
updated: 2026-02-09T10:30:00Z
related_contract: .accord/contracts/demo-engine.yaml
directive: dir-001-add-oauth
depends_on_requests: [req-000-setup-auth]
---

## What
Add GET /api/v1/policies endpoint...

## Proposed Change
(OpenAPI snippet)

## Why
(Justification)
```

**A2A Message + DataPart 等效表达**：
```json
{
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "text": "Add GET /api/v1/policies endpoint..."
    },
    {
      "kind": "data",
      "data": {
        "accord_request": {
          "id": "req-001-add-policy-api",
          "from": "device-manager",
          "to": "demo-engine",
          "scope": "external",
          "type": "api-addition",
          "priority": "medium",
          "related_contract": ".accord/contracts/demo-engine.yaml",
          "directive": "dir-001-add-oauth",
          "depends_on_requests": ["req-000-setup-auth"]
        },
        "proposed_change": { "...OpenAPI snippet..." }
      },
      "metadata": {
        "accord-extension": "https://accord-protocol.dev/ext/contracts/v1"
      }
    }
  ]
}
```

**重叠度：~80%** — Accord 的结构化请求可以完整映射到 A2A DataPart，无信息损失。

### 2.5 实时流 / 事件系统

| 维度 | Accord | A2A |
|---|---|---|
| **传输** | WebSocket (Fastify plugin) | SSE (Server-Sent Events) |
| **事件模型** | 17 种事件类型 (EventBus) | TaskStatusUpdateEvent + TaskArtifactUpdateEvent |
| **流式内容** | 5 种 StreamEvent (text, tool_use, tool_result, thinking, status) | Message Parts 流式传输 |
| **订阅** | WebSocket 连接后自动接收所有事件 | `message/stream` (主动) 或 `tasks/subscribe` (被动) |

**重叠度：~90%** — 功能等价。Accord 的 5 种 StreamEvent 可映射到 A2A 的 Message Parts + 自定义 metadata。

### 2.6 多仓库同步

| 维度 | Accord | A2A |
|---|---|---|
| **模型** | Hub-and-Spoke（共享 Git 仓库做中转） | HTTP 点对点通讯（无需中转仓库） |
| **同步机制** | `accord sync push` / `accord sync pull` | 无需同步，HTTP 天然跨仓库 |
| **冲突处理** | Git merge conflict + human resolution | 不存在冲突问题（无共享状态文件） |
| **离线** | 支持 | 不支持 |

**重叠度：~100%** — A2A 的 HTTP 通讯让 `accord sync` 这整套机制变得不必要。跨仓库场景下 A2A 方案严格优于 Git 同步。

### 2.7 编排 / Orchestrator

| 维度 | Accord v2 | A2A |
|---|---|---|
| **角色** | Hub Orchestrator（专用 agent session） | A2A Client Agent（任何 agent 可做 client） |
| **能力** | 分解 directive → per-service requests、路由、监控 | SendMessage 到多个 server agent、GetTask 监控、contextId 关联 |
| **发现** | 读取 `.accord/registry/` | 查询 Agent Cards |
| **路由** | Orchestrator-initiated (top-down) + Service-escalated (bottom-up) | Client-server 模式，agent 可同时做 client 和 server |

**重叠度：~80%** — Accord 的 Orchestrator 模式和 A2A 的 client-agent 编排模式在设计理念上一致。

### 2.8 调度与执行

| 维度 | Accord | A2A |
|---|---|---|
| **调度** | Scheduler 30s 轮询 + Dispatcher 约束分配 | Push Notification + client 端逻辑 |
| **执行** | Worker Pool + Agent SDK Adapter | AgentExecutor (server 端) |
| **约束** | 服务排他、目录排他、依赖检查、maintainer 检查 | 无内置约束机制 |
| **Session** | SessionManager (persist + rotate) | contextId (多 turn 关联) |
| **重试** | max_attempts + crash recovery checkpoint | Client 端重试逻辑 |

**重叠度：~60%** — Scheduler 和基本 worker 管理被 A2A 替代，但 Dispatcher 的约束逻辑（依赖检查、排他性、优先级排序）是 Accord 特有的，A2A 不提供。

### 2.9 可观测性

| 维度 | Accord | A2A |
|---|---|---|
| **UI** | React Web UI (实时 dashboard) | 无内置 UI |
| **Token 追踪** | 每请求 input/output/cache token 分类统计 | 无（协议层不涉及） |
| **成本分析** | 按 service、按天、按 model 聚合 | 无 |
| **审计日志** | JSONL history + Git commit 历史 | Task history (需自建持久化) |

**重叠度：~30%** — A2A 是通讯协议，不关心可观测性。Accord 的 metrics/analytics 层需要完整保留。

---

## 3. 重叠度总览

| 模块 | 代码量 (行) | 重叠度 | 结论 |
|---|---|---|---|
| scanner.ts (inbox 扫描) | ~500 | 95% | **可删除** — A2A message 接收替代 |
| scheduler.ts | ~130 | 100% | **可删除** — A2A push 替代轮询 |
| git-sync.ts (通讯部分) | ~100 | 100% | **可删除** — HTTP 替代 Git 同步 |
| event-bus.ts | ~210 | 70% | **大幅简化** — A2A SSE 替代 |
| session-manager.ts | ~140 | 70% | **简化** — A2A contextId 替代 |
| worker-pool.ts (调度部分) | ~200 | 60% | **重构** — 保留约束逻辑，删除 SDK 调用 |
| adapters/adapter.ts (SDK) | ~620 | 80% | **替换** — A2A AgentExecutor 替代 |
| dispatcher.ts (通讯部分) | ~100 | 70% | **简化** — A2A SendMessage 替代 |
| prompt.ts | ~150 | 50% | **移到 service 端** |
| **重叠小计** | **~2,150** | - | 占总运行时代码 ~42% |

| 模块 | 代码量 (行) | 重叠度 | 结论 |
|---|---|---|---|
| dispatcher.ts (约束逻辑) | ~140 | 0% | **保留** — 依赖检查、排他性、优先级 |
| metrics.ts | ~400 | 0% | **保留** — Token/成本追踪 |
| scanner.ts (合约扫描) | ~200 | 0% | **保留** — 合约解析和校验 |
| config.ts | ~260 | 10% | **保留** — 合约/registry 配置 |
| http.ts + API routes | ~400 | 30% | **保留并适配** — UI API 保留 |
| git-sync.ts (合约提交) | ~50 | 0% | **保留** — 合约的 Git 持久化 |
| UI (React) | ~2,000 | 10% | **保留并适配** — 数据源切换 |
| **独有小计** | **~3,450** | - | 占总代码 ~58% |

---

## 4. Accord 独有价值（A2A 不做、无法替代的部分）

### 4.1 Contract Registry（合约注册表）

A2A 完全不涉及 "API 合约" 概念。Accord 的两级合约体系是核心差异化：

- **外部合约** (OpenAPI 3.0+)：定义服务间 API 边界
- **内部合约** (Markdown + 代码签名)：定义模块间接口边界
- **合约状态生命周期**：draft → stable → proposed → deprecated
- **合约所有权规则**：不能直接修改其他模块的合约

### 4.2 Contract-First 工作流

Accord 的核心理念 — 先协商合约，再实现代码：

1. 提出合约变更请求
2. 对方审批
3. 更新合约
4. 按合约实现

A2A 只解决 agent 间如何通讯，不定义通讯内容的语义和约束。

### 4.3 合约扫描器

自动化工具：扫描代码 → 生成/更新 OpenAPI 合约和内部接口合约。这是 Accord 的工具链，与通讯协议无关。

### 4.4 Human Approval 语义

Accord 的 `pending → approved` 是一等公民状态转换，有明确的规则：
- 只有接收方可以 approve/reject
- 跨服务 API 变更必须人工审批
- 审批是阻塞性门控

A2A 的 `input-required` 可以模拟，但不是为此设计的。

### 4.5 Dispatcher 约束逻辑

- 同 service 不并发执行
- 同目录排他锁
- 依赖链检查 (`depends_on_requests`)
- maintainer 类型决定是否可自动执行
- 优先级排序 (critical > high > medium > low)

A2A 作为通讯协议不提供任何调度约束。

### 4.6 Token/Cost Analytics

按请求、按服务、按模型、按天的 token 用量和成本统计。A2A 在协议层不涉及 LLM token 概念。

---

## 5. 定位结论

Accord 当前架构可以分为两层：

```
┌───────────────────────────────────────────────┐
│   Domain Layer（独有价值，应保留并深耕）        │
│                                               │
│   - Contract Registry + 状态生命周期           │
│   - Contract Scanner（代码 → 合约生成）        │
│   - 合约一致性规则                             │
│   - Contract-first 工作流                     │
│   - Human Approval 门控                       │
│   - Dispatcher 约束逻辑                       │
│   - Token/Cost Analytics                      │
│                                               │
├───────────────────────────────────────────────┤
│   Infrastructure Layer（与 A2A 高度重叠）      │
│                                               │
│   - 消息传递（inbox 文件 ≈ SendMessage）       │
│   - 状态机（request status ≈ task state）     │
│   - 服务发现（registry .md ≈ Agent Card）     │
│   - 轮询调度（scheduler ≈ push notification） │
│   - 实时流（WebSocket ≈ SSE）                 │
│   - 多仓库同步（git sync ≈ HTTP 天然跨网络）  │
│   - 审计追踪（JSONL ≈ task history）          │
│   - Orchestrator 编排（≈ A2A client-agent）   │
│                                               │
└───────────────────────────────────────────────┘
```

**Infrastructure Layer 约 42% 代码与 A2A 高度重叠，且 A2A 方案在标准化、生态支持、延迟、跨网络能力上全面优于自建实现。**

**建议方向**：将 Accord 从 "完整的 multi-agent 框架" 转型为 "基于 A2A 的 contract-first 协作协议"，即 A2A Extension + 合约工具链。聚焦在 A2A 生态中没有任何项目覆盖的合约层。

---

## 附录 A：A2A 协议技术规格速查

| 项目 | 规格 |
|---|---|
| 版本 | RC v1.0 (latest), v0.3.0 (released) |
| 治理 | Linux Foundation, Apache 2.0 |
| 传输 | HTTP/HTTPS + JSON-RPC 2.0, gRPC (可选) |
| 流式 | SSE (Server-Sent Events) |
| 异步 | Push Notifications (webhook) |
| 发现 | Agent Card at `/.well-known/agent.json` |
| 扩展 | Extensions 机制（data-only, profile, method, state machine 四类） |
| 数据 | Message > Part (TextPart, DataPart, FilePart) |
| 任务 | Task (submitted, working, input-required, auth-required, completed, failed, canceled, rejected) |
| 关联 | contextId (多任务关联), taskId (单任务引用) |
| 安全 | OAuth 2.0, API Key, mTLS, OpenID Connect |
| SDK | Python, TypeScript, Java, Go, .NET |

## 附录 B：参考资源

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Extensions Documentation](https://a2a-protocol.org/latest/topics/extensions/)
- [A2A Key Concepts](https://a2a-protocol.org/latest/topics/key-concepts/)
- [A2A Life of a Task](https://a2a-protocol.org/latest/topics/life-of-a-task/)
- [A2A GitHub Repository](https://github.com/a2aproject/A2A)
- [A2A TypeScript SDK](https://github.com/a2aproject/a2a-js)
- [A2A Python SDK](https://github.com/a2aproject/a2a-python)
- [claude-a2a (Claude Code as A2A Server)](https://github.com/ericabouaf/claude-a2a)
- [A2A-MCP-Server (MCP-A2A Bridge)](https://github.com/GongRzhe/A2A-MCP-Server)
