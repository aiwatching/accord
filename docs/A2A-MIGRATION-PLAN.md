# Accord A2A 迁移计划

> 将 Accord 从 "完整的 multi-agent 框架" 转型为 "基于 A2A 的 contract-first 协作协议"。
>
> 前置文档：[A2A-COMPARISON.md](./A2A-COMPARISON.md)

---

## 1. 目标架构

### 1.1 定位转变

```
之前: Accord = 通讯协议 + 合约体系 + 执行引擎（5,100 行 TS 运行时）
之后: Accord = A2A Extension 规范 + 合约工具链 + 轻量协调层
```

Accord 不再自建消息传递、服务发现、流式传输、多仓库同步，而是作为 A2A 生态中的 **contract-first 协作扩展**——站在 A2A 的肩膀上，聚焦于合约层这一差异化价值。

### 1.2 目标架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Accord Hub                            │
│                 (Fastify Server)                          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  A2A Client   │  │  Contract    │  │  Dispatcher   │  │
│  │  (a2a-js SDK) │  │  Registry    │  │  (约束逻辑)   │  │
│  │              │  │              │  │              │  │
│  │  - 发现 Agent │  │  - OpenAPI   │  │  - 依赖检查   │  │
│  │  - 发送 Task  │  │  - 内部合约   │  │  - 排他性     │  │
│  │  - 监控状态   │  │  - 状态生命周期│  │  - 优先级     │  │
│  │  - 接收 Push  │  │  - 一致性校验 │  │  - maintainer │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                 │                  │           │
│  ┌──────┴─────────────────┴──────────────────┴────────┐  │
│  │           Accord Protocol Layer                     │  │
│  │                                                     │  │
│  │  - accord-contracts Extension 规范                   │  │
│  │  - 审批流程 (input-required 映射)                    │  │
│  │  - Token/Cost Analytics                             │  │
│  │  - 审计追踪 (Git 持久化)                             │  │
│  └──────┬────────────────┬─────────────────┬──────────┘  │
│         │                │                 │             │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴──────────┐  │
│  │  React UI    │ │  CLI Tools   │ │  Git Persistence │  │
│  │  (dashboard) │ │  (scan, etc) │ │  (contracts +    │  │
│  │              │ │              │ │   audit trail)   │  │
│  └──────────────┘ └──────────────┘ └─────────────────┘  │
└──────────┬───────────────┬──────────────────┬────────────┘
           │ A2A            │ A2A              │ A2A
           ▼                ▼                  ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ demo-engine  │ │ device-mgr   │ │  frontend    │
    │ A2A Server   │ │ A2A Server   │ │ A2A Server   │
    │              │ │              │ │              │
    │ Agent Card   │ │ Agent Card   │ │ Agent Card   │
    │ + contracts  │ │ + contracts  │ │ + contracts  │
    │ extension    │ │ extension    │ │ extension    │
    │              │ │              │ │              │
    │ Claude Code  │ │ Claude Code  │ │ Claude Code  │
    │ CLI / 其他   │ │ CLI / 其他   │ │ CLI / 其他   │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### 1.3 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| A2A 做通讯 | 替代 Git inbox/sync | 标准化、低延迟、跨网络、有 SDK |
| Git 做持久化 | 合约+审计仍在 Git | Git 是合约的 source of truth，A2A 是 notification channel |
| Hub 唯一常驻进程 | Service A2A Server 按需启动 | 与现有 Worker Pool 模式一致，零闲置成本 |
| a2a-js SDK | 不从零实现 A2A | 官方 SDK 处理 JSON-RPC/SSE/Agent Card |
| 保留 Fastify | 不换框架 | 复用现有 HTTP 服务和 UI API |
| SQLite + Git 双层持久化 | 替代纯文件 | SQLite 做实时 task 状态查询，Git 做合约审计 |

---

## 2. 代码变更清单

### 2.1 删除的模块

| 文件 | 行数 | 原因 |
|---|---|---|
| `server/scheduler.ts` | ~130 | A2A push notification 替代轮询 |
| `server/scanner.ts` 的 inbox 扫描逻辑 | ~300 | A2A message 接收替代文件扫描 |
| `server/git-sync.ts` 的通讯同步逻辑 | ~100 | HTTP 天然跨网络，不需要 Git 同步 |
| `server/session-manager.ts` | ~140 | A2A contextId 替代自建 session 管理 |
| `server/adapters/adapter.ts` 中 ClaudeCodeV1/V2 Adapter | ~500 | A2A AgentExecutor 替代 SDK 直接调用 |
| **删除小计** | **~1,170** | |

### 2.2 重构的模块

| 文件 | 变更 | 说明 |
|---|---|---|
| `server/dispatcher.ts` | 中等重构 | 保留约束逻辑（依赖、排他、优先级、maintainer），删除 worker 分配和 Git commit 逻辑，改为通过 A2A Client 发送 Task |
| `server/worker-pool.ts` | 大幅重构 | 从 "管理本地 worker 进程" 变为 "管理 A2A server 进程"。Worker 不再调 Agent SDK，而是启动临时 A2A Server 或调用远程 A2A Server |
| `server/event-bus.ts` | 简化 | 删除大部分自定义事件类型，适配 A2A TaskStatusUpdateEvent / TaskArtifactUpdateEvent |
| `server/scanner.ts` | 部分重构 | 保留合约解析、归档、依赖检查逻辑。删除 inbox 文件扫描。新增：解析 A2A DataPart 中的 accord_request |
| `server/prompt.ts` | 移动 | Prompt 构建逻辑移到 Service A2A Server 端，因为 service agent 有完整项目上下文 |
| `server/http.ts` | 扩展 | 新增 A2A webhook 接收路由、Agent Card 路由 |
| `server/types.ts` | 扩展 | 新增 A2A 相关类型定义，保留 Accord 业务类型 |

### 2.3 新增的模块

| 文件 | 说明 |
|---|---|
| `server/a2a-client.ts` | A2A Client 封装：发现 Agent Card、SendMessage、GetTask、SubscribeToTask、Push Notification 接收 |
| `server/a2a-service.ts` | Service A2A Server 模板：AgentExecutor 实现，内部调用 Claude Code CLI |
| `server/contract-validator.ts` | 合约校验中间件：从 A2A Artifact 提取合约变更 → 校验 OpenAPI 合法性 → 应用到 Git |
| `server/task-store.ts` | 持久化 TaskStore 实现（SQLite）：替代 A2A SDK 的 InMemoryTaskStore |
| `protocol/extensions/accord-contracts.json` | accord-contracts A2A Extension 规范定义 |
| `templates/agent-card.json.template` | Service Agent Card 模板（包含 accord-contracts extension） |

### 2.4 保持不变的模块

| 文件 | 说明 |
|---|---|
| `server/metrics.ts` | Token/Cost analytics — A2A 不涉及，完整保留 |
| `server/config.ts` | 合约/registry 配置加载 — 保留 |
| `server/git-sync.ts` 的合约提交逻辑 | 合约变更的 Git commit — 保留 |
| `server/api/` 的 UI 路由 | React UI 后端 API — 保留并适配数据源 |
| `ui/` | React Web UI — 保留，数据源从 WebSocket 适配到 A2A SSE |
| `protocol/` 目录（合约模板、扫描规则） | 合约工具链 — 完整保留 |

---

## 3. `accord-contracts` A2A Extension 规范

这是迁移的核心产出——定义 Accord 如何在 A2A 协议上层承载合约语义。

### 3.1 Extension 声明

```json
{
  "uri": "https://accord-protocol.dev/ext/contracts/v1",
  "description": "Contract-first agent coordination for multi-service software projects",
  "required": true,
  "params": {
    "maintainer": "ai | human | hybrid | external",
    "owner": "string",
    "language": "string",
    "contracts": {
      "external": "string (path to OpenAPI file)",
      "internal": ["string (paths to internal contract files)"]
    },
    "dependencies": ["string (service names)"]
  }
}
```

### 3.2 Agent Card 示例（Service）

```json
{
  "name": "demo-engine",
  "description": "Core demo execution and policy engine",
  "url": "http://localhost:9001/",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "extensions": [
      {
        "uri": "https://accord-protocol.dev/ext/contracts/v1",
        "required": true,
        "params": {
          "maintainer": "ai",
          "owner": "backend-team",
          "language": "java",
          "contracts": {
            "external": ".accord/contracts/demo-engine.yaml",
            "internal": [
              ".accord/contracts/internal/plugin-api.md",
              ".accord/contracts/internal/lifecycle-api.md"
            ]
          },
          "dependencies": ["device-manager"]
        }
      }
    ]
  },
  "skills": [
    {
      "id": "api-implementation",
      "name": "API Implementation",
      "description": "Implement API changes per OpenAPI contract",
      "tags": ["api", "backend", "java"]
    },
    {
      "id": "contract-scan",
      "name": "Contract Scanning",
      "description": "Scan codebase and update API contracts",
      "tags": ["scan", "openapi"]
    }
  ]
}
```

### 3.3 Task Metadata 规范

所有 Accord 请求通过 A2A Task/Message 的 `metadata` 字段传递，key 前缀为 extension URI：

```json
{
  "metadata": {
    "https://accord-protocol.dev/ext/contracts/v1": {
      "accord_request": {
        "id": "req-001-add-policy-api",
        "from": "device-manager",
        "to": "demo-engine",
        "scope": "external",
        "type": "api-addition",
        "priority": "medium",
        "related_contract": ".accord/contracts/demo-engine.yaml",
        "directive": "dir-001-add-oauth",
        "depends_on_requests": []
      }
    }
  }
}
```

### 3.4 审批流程映射

```
状态转换                     A2A 实现
──────────────────────────────────────────────────────────────
创建请求                     Hub → SendMessage(accord_request DataPart)
等待审批                     Service Agent → TaskStatus: input-required
                             metadata.reason = "approval_needed"
                             metadata.contract_diff = "..."
审批通过                     Hub → SendMessage(同一 taskId)
                             message: "Approved. Proceed."
执行中                       Service Agent → TaskStatus: working
完成 + 合约更新               Service Agent → TaskStatus: completed
                             Artifact: contract-update (OpenAPI patch DataPart)
拒绝                         Service Agent → TaskStatus: rejected
                             metadata.reason = "..."
```

### 3.5 合约更新 Artifact 格式

```json
{
  "artifactId": "contract-update-001",
  "name": "demo-engine.yaml.patch",
  "parts": [
    {
      "kind": "data",
      "data": {
        "type": "openapi-patch",
        "contract_path": ".accord/contracts/demo-engine.yaml",
        "operations": [
          {
            "op": "add",
            "path": "/paths/~1api~1v1~1policies",
            "value": { "...OpenAPI path object..." }
          }
        ]
      },
      "metadata": {
        "https://accord-protocol.dev/ext/contracts/v1": {
          "contract_status_transition": "stable -> proposed",
          "request_id": "req-001-add-policy-api"
        }
      }
    }
  ]
}
```

---

## 4. 分阶段实施计划

### Phase 0：Extension 规范 + 验证（不改现有代码）

**目标**：定义规范，用最小原型验证 A2A + 合约的可行性。

**步骤**：

1. **编写 `accord-contracts` Extension 规范文档**
   - Agent Card params schema
   - Task metadata schema
   - Artifact 格式 (contract-update, contract-scan-result)
   - 审批流程映射 (input-required 语义)
   - 合约状态转换规则

2. **构建最小 A2A Server 原型（单个 service）**
   - 用 a2a-js SDK，~100-150 行
   - AgentExecutor 内部调用 `claude -p` (Claude Code CLI)
   - Agent Card 包含 accord-contracts extension
   - 支持 input-required 审批流

3. **构建最小 A2A Client 原型（Hub 侧）**
   - 发现 Agent Card
   - 发送 accord_request (DataPart)
   - 接收 task 状态更新
   - 接收 contract-update artifact

4. **端到端验证**
   - Hub 发送一个 api-addition 请求到 test service
   - Service agent 执行并返回合约更新
   - Hub 校验并提交合约到 Git
   - 验证审批流（input-required → 人工审批 → resume）

**产出**：Extension 规范文档 + 可运行的 PoC
**现有代码影响**：零（独立原型）

---

### Phase 1：Hub 侧 A2A Client 集成

**目标**：给现有 Hub 添加 A2A Client 能力，与 Git 通讯并存。

**步骤**：

1. **添加 `server/a2a-client.ts`**
   - 封装 a2a-js SDK 的 client 操作
   - Agent Card 发现和缓存
   - SendMessage / GetTask / SubscribeToTask
   - Push Notification webhook 接收

2. **添加 `server/task-store.ts`**
   - SQLite 持久化 TaskStore
   - 实现 A2A TaskStore 接口
   - Task ↔ AccordRequest 双向转换

3. **修改 `server/dispatcher.ts`**
   - 新增分发路径：如果目标 service 有 A2A Agent Card → 通过 A2A Client 发送
   - 保留 fallback：如果没有 Agent Card → 走原有 Git inbox 路径
   - 约束逻辑不变

4. **修改 `server/http.ts`**
   - 新增 `/webhook/a2a` 路由接收 push notification
   - 新增 `/.well-known/agent.json` 路由暴露 Hub 自身的 Agent Card

5. **适配 `server/event-bus.ts`**
   - A2A TaskStatusUpdateEvent → 映射到现有 `request:claimed` / `request:completed` 事件
   - 保留 WebSocket bridge（UI 仍用 WebSocket）

**产出**：Hub 同时支持 Git 和 A2A 两种通讯路径
**关键原则**：Git 通讯路径完整保留，A2A 是可选的增强

---

### Phase 2：Service A2A Server 模板

**目标**：提供标准化的 Service A2A Server 实现，可快速部署。

**步骤**：

1. **创建 `server/a2a-service.ts`**
   - 通用的 Service A2A Server 模板
   - AgentExecutor 实现：
     - 解析 DataPart 中的 accord_request
     - 构建 prompt（含合约上下文）
     - 调用 Claude Code CLI (`claude -p`)
     - 流式返回执行状态
     - 合约变更作为 Artifact 返回
   - Agent Card 自动生成（从 .accord/config.yaml 读取 service 信息）

2. **创建 `templates/agent-card.json.template`**
   - 标准化 Agent Card 模板
   - 包含 accord-contracts extension
   - `{{SERVICE_NAME}}`, `{{PORT}}`, `{{CONTRACTS}}` 等占位符

3. **创建启动脚本**
   ```bash
   # 启动单个 service 的 A2A Server
   accord-service --name demo-engine --port 9001 --cwd /path/to/service
   ```

4. **Hub Worker Pool 适配**
   - 选项 A（远程模式）：Hub 直接调用已启动的 Service A2A Server
   - 选项 B（按需模式）：Hub 按需 spawn 临时 A2A Server 进程，请求完成后关闭
   - 两种模式通过配置切换

**产出**：标准化的 Service A2A Server + 启动工具

---

### Phase 3：合约校验管道

**目标**：构建从 A2A Artifact 到 Git 合约的自动化管道。

**步骤**：

1. **创建 `server/contract-validator.ts`**
   - 从 TaskArtifactUpdateEvent 提取 contract-update DataPart
   - 校验 OpenAPI patch 合法性（JSON Patch RFC 6902）
   - 校验向后兼容性（breaking change 检测）
   - 校验合约状态转换合法性（draft→stable, stable→proposed 等）

2. **修改 `server/git-sync.ts`**
   - 新增：接收校验通过的合约更新 → 应用 patch → git commit
   - 保留：合约提交的 Git 规范（commit message 格式）

3. **合约变更通知**
   - 合约更新后，通过 A2A Client 通知依赖方 service agents
   - 使用 SendMessage + DataPart 携带合约 diff

**产出**：Artifact → 校验 → Git 的完整管道

---

### Phase 4：清理 Git 通讯代码

**目标**：确认 A2A 路径稳定后，移除冗余的 Git 通讯代码。

**前提条件**：Phase 1-3 在生产环境稳定运行。

**步骤**：

1. **删除 `server/scheduler.ts`**
   - A2A push notification 完全替代轮询

2. **简化 `server/scanner.ts`**
   - 删除 inbox 文件扫描逻辑（`scanInboxes`, `isRequestFile` 等）
   - 保留合约解析、归档逻辑

3. **删除 `server/session-manager.ts`**
   - A2A contextId 替代

4. **删除 `server/adapters/adapter.ts` 中的 SDK 适配器**
   - ClaudeCodeV1Adapter、ClaudeCodeV2Adapter 删除
   - ShellAdapter 可选保留作为 fallback

5. **简化 `server/git-sync.ts`**
   - 删除 `accord sync push/pull` 通讯逻辑
   - 只保留合约 git commit

6. **简化 `server/event-bus.ts`**
   - 删除冗余事件类型
   - 保留 UI 需要的事件 + A2A 事件映射

7. **更新协议文档**
   - `docs/PROTOCOL.md` — 更新为 A2A + accord-contracts 描述
   - `docs/INTERFACE.md` — 从 9 个 behaviors 更新为 A2A Extension 行为
   - `docs/DESIGN.md` — 新增 A2A 迁移章节

**产出**：精简后的代码库，删除 ~1,170 行冗余代码

---

### Phase 5：UI 适配 + 文档完善

**步骤**：

1. **UI 数据源切换**
   - 从 WebSocket 切换到 A2A SSE（或 Hub 做中转：Hub 接收 A2A SSE → 转发给 UI WebSocket）
   - Task 视图适配 A2A Task 结构
   - Agent 发现视图（展示 Agent Cards）

2. **CLI 工具更新**
   - `accord status` — 从 A2A GetTask/ListTasks 获取
   - `accord send` — 通过 A2A SendMessage 发送
   - 保留 `accord scan` — 合约扫描不涉及 A2A

3. **文档更新**
   - README.md — 更新项目定位
   - INSTALL.md — 更新安装指引
   - 新增：EXTENSION-SPEC.md — accord-contracts 完整规范

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| A2A SDK 不成熟 (a2a-js) | 运行时 bug | Phase 0 充分验证；必要时薄封装隔离 SDK 细节 |
| A2A 规范变动 (仍是 RC) | 接口不稳定 | Extension 机制已明确不会大改；核心 Task/Message 结构稳定 |
| Service A2A Server 进程管理 | 运维复杂度增加 | 按需启动模式（Hub spawn → 完成 → 关闭），与现有 Worker Pool 模式一致 |
| 离线工作不可用 | 无网络时无法协作 | 保留 Git fallback 模式作为降级方案（Phase 4 中可选保留） |
| SQLite 引入新依赖 | 包体积/兼容性 | 用 better-sqlite3 (zero-dependency native module)，或 JSON 文件替代 |
| input-required 模拟审批的语义偏差 | 审批流不够严格 | Extension metadata 中明确定义 reason 枚举和审批规则 |

---

## 6. 依赖关系

```
Phase 0 (Extension 规范 + PoC)
    │
    ▼
Phase 1 (Hub A2A Client)  ──────►  Phase 2 (Service A2A Server)
    │                                    │
    └───────────┬────────────────────────┘
                ▼
          Phase 3 (合约校验管道)
                │
                ▼
          Phase 4 (清理 Git 通讯代码)
                │
                ▼
          Phase 5 (UI + 文档)
```

Phase 1 和 Phase 2 可以并行开发——Hub client 和 Service server 是独立的两端。

---

## 7. 预期收益

| 指标 | 迁移前 | 迁移后 |
|---|---|---|
| 运行时代码量 | ~5,100 行 TS | ~3,500 行 TS（估计减少 ~30%） |
| 外部依赖 | @anthropic-ai/claude-agent-sdk (不稳定) | a2a-js (Linux Foundation 维护) |
| 通讯延迟 | 30s 轮询 | < 1s push |
| 跨网络支持 | 需要 Git SSH + accord sync | HTTP 天然支持 |
| 生态互操作 | 仅 Accord 适配器 | 任何 A2A 兼容 agent |
| 合约体系 | 保持不变 | 保持不变 + 标准化 Extension 规范 |
| Agent 无关性 | 理论上支持（adapter 模式） | 实际支持（A2A 标准协议） |
