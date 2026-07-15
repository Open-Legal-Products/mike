# 北大法宝 (PKULaw) MCP 集成 — 技术需求文档

## 1. 项目概述

### 1.1 背景
北大法宝 (PKULaw) 是中国领先的法律数据库服务商，拥有 40 年法律数据积累，提供 MCP (Model Context Protocol) 智能法律服务平台。其 MCP 服务允许 AI 客户端（如 Cursor、Claude、Dify 等）通过自然语言调用法律检索、案例分析、法条溯源、引用核验等专业工具。

Mike 作为法律文档助手，已具备通用 MCP Connector 基础设施。本规划旨在将北大法宝 MCP 深度集成到 Mike 中，使中国法律从业者能够在对话中直接调用北大法宝的权威法律数据能力。

### 1.2 目标
- 用户可通过 Mike 的 MCP Connectors 界面配置北大法宝 MCP 服务
- 在对话中自然语言触发北大法宝法律检索工具（法规、案例、语义检索等）
- 提供与 CourtListener 对等的、面向中国法律体系的检索与分析能力
- 支持 Token 管理、工具发现、权限控制与审计日志

---

## 2. 北大法宝 MCP 服务分析

### 2.1 服务架构
| 组件 | 说明 |
|------|------|
| 平台入口 | `https://mcp.pkulaw.com` |
| MCP Gateway | `https://apim-gw.pkulaw.com/{SERVICE_ID}/mcp` |
| 认证方式 | Bearer Token (`Authorization: Bearer YOUR_TOKEN`) |
| 传输协议 | Streamable HTTP |
| CLI 工具 | `@pkulaw/mcp-cli` (npm) |
| 技能仓库 | `https://gitee.com/pkulaw/pkulaw-skills` |

### 2.2 数据规模
- **法律法规库**: 500万+ 法规，全面准确，实时更新
- **司法案例库**: 1.6亿+ 案例，内容健全，覆盖全面
- **行政执法库**: 4250万+ 执法文书
- **检察文书库**: 820万+ 检察文书
- **法学期刊库**: 45万+ 学术期刊
- **专题参考库**: 30+ 专题分类

### 2.3 MCP 服务器/技能清单

| 技能名称 | Server ID | 功能描述 | 产品线 |
|---------|-----------|---------|--------|
| 法规关键词检索 | `law-keyword` | 通过关键词检索法律法规，支持标题/全文匹配 | 智能检索-关键词 |
| 法规语义检索 | `law-semantic` | 通过自然语言语义检索法律法规 | 智能检索-语义 |
| 案例关键词检索 | `case-keyword` | 通过关键词检索司法案例 | 智能检索-关键词 |
| 案例语义检索 | `case-semantic` | 通过自然语言语义检索案例 | 智能检索-语义 |
| 引用核验 | `citation-validator` | 验证法律引用是否准确有效 | 智能工具 |
| 法条精准 | `fatiao-precise` | 精准定位具体法条内容 | 智能工具 |
| 案号溯源 | `case-number` | 通过案号追踪案件信息 | 智能工具 |
| 语义 NL-SQL | `semantic-nlsql` | 自然语言转结构化法律查询 | NL-SQL 产品 |
| 法律识别 | `law-recognition` | 识别文本中的法律实体和关系 | 智能工具 |
| 有依据回答 | `grounded-answer` | 基于法律数据的 grounded QA | 智能工具 |
| 法律研究 | `legal-research` | 综合法律研究组合工作流 | 律师/法务工作流 |
| 案例摘要 | `case-memo` | 生成案例摘要和要点 | 智能工具 |
| 意见引用检查 | `opinion-citation-check` | 检查法律意见中的引用 | 智能工具 |
| 监管回复检查 | `regulatory-reply-check` | 检查监管回复合规性 | 智能工具 |
| 合同审查轻量 | `contract-review-lite` | 轻量级合同审查 | 智能工具 |
| 批量合同筛查 | `batch-contract-screening` | 批量合同风险筛查 | 智能工具 |
| 劳动就业回答 | `labor-employment-answer` | 劳动就业法律问答 | 智能工具 |
| 治理研究备忘录 | `governance-research-memo` | 生成治理研究备忘录 | 智能工具 |
| 文档链接 | `doc-link` | 法律文档关联分析 | 智能工具 |

### 2.4 工具调用模式
```bash
# 发现工具
pkulaw-mcp tools <serverId>

# 调用工具（关键词检索）
pkulaw-mcp law-keyword <toolName> --title "关键词"

# 调用工具（语义检索）
pkulaw-mcp law-semantic <toolName> --text "自然语言描述"
```

典型工具名示例：`get_law_list`, `search_article`, `search_case`, `ai_pkulaw_search`

---

## 3. Mike 现有 MCP 基础设施

### 3.1 数据库架构 (Supabase)
已有完整表结构（通过迁移 `20260613_04_user_mcp_connectors.sql` 和 `20260615_01_mcp_connector_oauth.sql` 创建）：

```sql
-- MCP 连接器主表
public.user_mcp_connectors
  - id, user_id, name, transport, server_url, enabled
  - auth_type (none|bearer|oauth)
  - encrypted_auth_config (加密存储 Token)
  - tool_policy

-- OAuth Token 表
public.user_mcp_oauth_tokens
  - connector_id, encrypted_access_token, encrypted_refresh_token
  - token_type, scope, expires_at

-- 工具缓存表
public.user_mcp_connector_tools
  - connector_id, tool_name, openai_tool_name, title, description
  - input_schema, output_schema, annotations
  - enabled, requires_confirmation

-- 审计日志表
public.user_mcp_tool_audit_logs
  - user_id, connector_id, tool_id, tool_name, status
  - duration_ms, result_size_chars, error_message
```

### 3.2 后端架构 (Express / TypeScript)

**核心库**: `backend/src/lib/mcp/`

| 文件 | 职责 |
|------|------|
| `client.ts` | MCP SDK 客户端封装、URL 验证、Auth 配置加密/解密 |
| `servers.ts` | 连接器 CRUD、工具发现刷新、工具执行、审计日志 |
| `oauth.ts` | OAuth 2.x 流程（授权、回调、Token 刷新） |
| `types.ts` | 类型定义、常量（超时 30s、结果上限 60KB） |

**API 路由** (`backend/src/routes/user.ts`):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/user/mcp-connectors` | 列出用户连接器 |
| GET | `/user/mcp-connectors/:id` | 获取连接器详情（含工具列表） |
| POST | `/user/mcp-connectors` | 创建连接器 |
| PATCH | `/user/mcp-connectors/:id` | 更新连接器 |
| DELETE | `/user/mcp-connectors/:id` | 删除连接器 |
| POST | `/user/mcp-connectors/:id/oauth/start` | 启动 OAuth 授权 |
| GET | `/user/mcp-connectors/oauth/callback` | OAuth 回调 |
| POST | `/user/mcp-connectors/:id/refresh-tools` | 刷新工具列表 |
| PATCH | `/user/mcp-connectors/:id/tools/:toolId` | 启用/禁用工具 |

**Chat 集成** (`backend/src/lib/chat/`):
- `streaming.ts:190`: `buildUserMcpTools(userId, db)` 动态加载用户启用的 MCP 工具
- `tools/toolDispatcher.ts:588-617`: `executeMcpToolCall()` 执行 MCP 工具调用，写入 SSE 事件流

### 3.3 前端架构 (Next.js)

**页面**: `frontend/src/app/(pages)/account/connectors/page.tsx`
- 连接器列表、详情、工具管理

**组件**: `frontend/src/app/components/account/NewMcpModal.tsx`
- 新建连接器表单：Label、URL endpoint、Bearer token、Custom headers
- 支持 OAuth 弹窗授权流程

---

## 4. 集成需求分析

### 4.1 功能需求

#### FR-1: 北大法宝 MCP 连接器配置
- 用户可在 Account > Connectors 页面添加北大法宝 MCP 连接器
- 配置字段：
  - **Name**: 自定义标签（如"北大法宝-法规检索"）
  - **Server URL**: `https://apim-gw.pkulaw.com/{SERVICE_ID}/mcp`
  - **Bearer Token**: 从北大法宝控制台获取的 Token
- 支持高级选项：自定义 Headers（如 `X-App-ID` 等）

#### FR-2: 工具自动发现与启用
- 连接成功后自动发现该 MCP 服务器提供的所有工具
- 工具列表展示：名称、描述、启用状态
- 支持按工具启用/禁用（默认全部启用，但 `requires_confirmation` 工具需手动确认）
- 支持手动刷新工具列表（当北大法宝服务端更新工具时）

#### FR-3: 对话中自然语言调用
- 用户发送类似"查找关于劳动合同解除的法规"时，LLM 自动选择 `law-keyword` 或 `law-semantic` 工具
- 工具结果作为外部上下文注入对话，并标注为不可信外部数据
- 支持工具调用链：先检索法规 → 再检索相关案例 → 引用核验

#### FR-4: 工具调用结果展示
- 前端 SSE 事件类型：`mcp_tool_start`, `mcp_tool_result`
- 展示连接器名称、工具名称、执行状态（成功/失败）
- 结果内容遵循现有 `MAX_MCP_RESULT_CHARS = 60000` 限制

#### FR-5: 审计与监控
- 每次工具调用记录到 `user_mcp_tool_audit_logs`
- 记录字段：状态、耗时、结果大小、错误信息
- 用户可在连接器详情查看调用历史（可选 v2）

#### FR-6: Token 与认证管理
- Token 加密存储（AES-GCM，与现有 `authConfigPatch` / `decryptAuthConfig` 一致）
- 支持 Token 失效检测（401/403）并提示用户重新配置
- 401 错误时前端提示："Token 已过期，请前往北大法宝控制台重新获取"

### 4.2 非功能需求

#### NFR-1: 性能
- MCP 工具调用超时：30 秒（与现有配置一致）
- 工具发现超时：30 秒
- 结果大小限制：60KB（超过则截断）

#### NFR-2: 安全
- Token 必须加密存储，不明文出现在数据库或日志中
- 工具结果标记为不可信外部上下文，防止 prompt injection
- 所有 URL 通过 `validateRemoteMcpUrl` 校验，拒绝内网地址（metadata.google.internal 等）
- OAuth 流程遵循现有 OAuth 2.x 安全规范（state、PKCE、CSP）

#### NFR-3: 兼容性
- 北大法宝 MCP 使用 Streamable HTTP 传输，与 Mike 现有 `streamable_http` 支持完全兼容
- 无需新增传输协议或数据库迁移

#### NFR-4: 可扩展性
- 保持通用 MCP Connector 架构，不因北大法宝做特殊硬编码
- 可通过同一套基础设施接入其他法律 MCP 服务（如未来的人民法院案例库 MCP）

---

## 5. 技术实现方案

### 5.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │ Chat Interface  │    │ Account > Connectors Page  │   │
│  │                 │    │  - NewMcpModal               │   │
│  │  "查找劳动法规"  │    │  - Connector list & tools    │   │
│  └────────┬────────┘    └──────────────┬───────────────┘   │
└───────────┼────────────────────────────┼───────────────────┘
            │                            │
            │ SSE / HTTP                 │ HTTP
            ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Mike Frontend (Next.js)                    │
│  ┌──────────────────────────┐  ┌────────────────────────┐  │
│  │ AssistantMessage.tsx       │  │ connectors/page.tsx    │  │
│  │ - mcp_tool_start event    │  │ - CRUD operations      │  │
│  │ - mcp_tool_result event   │  │ - OAuth popup handler  │  │
│  └────────────┬───────────────┘  └──────────┬─────────────┘  │
└───────────────┼─────────────────────────────┼────────────────┘
                │                             │
                │ API Calls                   │ API Calls
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Mike Backend (Express)                     │
│  ┌──────────────────────────┐  ┌────────────────────────┐  │
│  │ Chat Streaming           │  │ MCP Connector Routes    │  │
│  │ - streaming.ts           │  │ - user.ts /mcp-connectors│  │
│  │ - buildUserMcpTools()    │  │ - create/update/delete   │  │
│  │ - executeMcpToolCall()   │  │ - refresh-tools          │  │
│  │ - runToolCalls()         │  │ - OAuth callback         │  │
│  └────────────┬───────────────┘  └──────────┬─────────────┘  │
│               │                             │                │
│  ┌────────────┴──────────────┐  ┌──────────┴─────────────┐  │
│  │ lib/mcp/                  │  │ lib/mcpConnectors.ts     │  │
│  │ - client.ts               │  │ (exports)                │  │
│  │ - servers.ts              │  │                          │  │
│  │ - oauth.ts                │  │                          │  │
│  │ - types.ts                │  │                          │  │
│  └────────────┬──────────────┘  └──────────────────────────┘  │
└───────────────┼──────────────────────────────────────────────┘
                │
                │ Streamable HTTP + Bearer Auth
                ▼
┌─────────────────────────────────────────────────────────────┐
│              PKULaw MCP Gateway                             │
│         https://apim-gw.pkulaw.com                          │
│  ┌────────────┬────────────┬────────────┬─────────────────┐ │
│  │ law-keyword│ law-semantic│ case-keyword│ case-semantic  │ │
│  │ citation-  │ semantic-  │ fatiao-    │ case-number      │ │
│  │ validator  │ nlsql      │ precise    │                  │ │
│  └────────────┴────────────┴────────────┴─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 数据流：工具调用

```
1. User: "查找劳动合同解除的相关法规"
2. LLM (OpenAI/Claude): 选择 mcp_pkulaw_law_semantic_search_article
3. backend/src/lib/chat/streaming.ts
   └─ buildUserMcpTools(userId) → 加载启用的 MCP 工具 schema
   └─ LLM 返回 tool_call: {name: "mcp_pkulaw_...", arguments: {...}}
4. backend/src/lib/chat/tools/toolDispatcher.ts
   └─ tc.function.name starts with "mcp_"
   └─ executeMcpToolCall(userId, toolName, args)
5. backend/src/lib/mcp/servers.ts
   └─ resolveCallableTool() → 找到 connector + tool
   └─ withMcpClient() → StreamableHTTPClientTransport
   └─ client.callTool()
6. PKULaw Gateway → 返回法规检索结果
7. 结果 stringify → 返回给 LLM 作为 tool result
8. LLM 基于结果生成中文回答
```

### 5.3 配置示例

**用户配置**（Account > Connectors > New MCP Connector）:
```json
{
  "name": "北大法宝-法规语义检索",
  "serverUrl": "https://apim-gw.pkulaw.com/law-semantic/mcp",
  "bearerToken": "Bearer pkulaw_xxxxxxxxxxxxxxxx"
}
```

**存储到数据库**（encrypted_auth_config 字段加密后）:
```json
{
  "bearerToken": "pkulaw_xxxxxxxxxxxxxxxx",
  "headers": {}
}
```

**调用时 HTTP Header**:
```
Authorization: Bearer pkulaw_xxxxxxxxxxxxxxxx
```

### 5.4 多服务器配置策略

北大法宝提供 10+ 独立的 MCP 服务器（每个 serverId 一个 endpoint）。建议：

| 策略 | 说明 | 推荐度 |
|------|------|--------|
| **单连接器聚合** | 北大法宝提供一个统一 gateway URL，内部路由到不同服务 | 最佳（若支持） |
| **多连接器** | 每个 serverId 创建一个独立连接器（如"法规关键词"、"案例语义"） | 可行 |
| **按产品线分组** | 2-3 个连接器：检索类、工具类、工作流类 | 折中 |

根据 `mcp.pkulaw.com` 文档，建议配置格式为：
```json
{
  "mcpServers": {
    "pkulaw-law-semantic": {
      "url": "https://apim-gw.pkulaw.com/law-semantic/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

即每个 `serverId` 对应一个独立 URL。因此用户需要为每个服务创建一个连接器，或我们提供预设模板。

---

## 6. 实施计划

### 6.1 阶段划分

| 阶段 | 内容 | 预计工作量 | 依赖 |
|------|------|-----------|------|
| **Phase 1** | 基础集成验证：确认北大法宝 MCP 服务器可被 Mike 通用连接器接入 | 1-2 天 | 需北大法宝测试 Token |
| **Phase 2** | 预设模板：在 NewMcpModal 中增加"北大法宝"预设，自动填充 URL 模板 | 2-3 天 | Phase 1 |
| **Phase 3** | 文档与引导：配置指南、常见问题、错误提示优化 | 1-2 天 | Phase 2 |
| **Phase 4** | 高级功能：Token 用量提示、工具结果格式化、法律引用卡片 | 3-5 天 | Phase 3 |

### 6.2 Phase 1 详细任务

1. **获取测试环境**
   - 注册 `mcp.pkulaw.com` 账号
   - 创建应用，获取测试 Token
   - 确认可用的 serverId 列表

2. **端到端验证**
   - 在 Mike 本地环境通过 Account > Connectors 添加北大法宝连接器
   - 验证 `refresh-tools` 能正确发现工具列表
   - 验证对话中工具调用成功（`executeMcpToolCall`）
   - 验证结果能正确返回给 LLM 并生成中文回答

3. **问题修复**
   - 处理中文字符编码问题（如有）
   - 处理超时、结果截断等边界情况
   - 验证 401 错误能被正确捕获并提示用户

### 6.3 Phase 2 详细任务

1. **预设模板 UI**
   - 在 `NewMcpModal` 中增加"Preset"选择器
   - 选择"北大法宝"后自动填充：
     - Server URL: `https://apim-gw.pkulaw.com/{SERVER_ID}/mcp`
     - 提示用户替换 `{SERVER_ID}` 并粘贴 Token
   - 提供常用 serverId 下拉选择（law-keyword, law-semantic, case-keyword, case-semantic）

2. **一键配置优化**
   - 提供配置复制按钮（生成 JSON 配置）
   - 支持从 URL 解析 serverId（如 `https://apim-gw.pkulaw.com/law-semantic/mcp` → auto-fill label）

3. **错误提示本地化**
   - 当北大法宝返回 401/403 时，提示中文：
     - "Token 无效或已过期，请前往 [北大法宝控制台](https://mcp.pkulaw.com/console) 重新获取"
   - 当工具调用失败时，展示 `pkulaw-mcp` CLI 调试命令

### 6.4 Phase 3 详细任务

1. **用户文档**
   - 在 Mike 文档中添加"北大法宝 MCP 配置指南"
   - 包含：注册流程、Token 获取、serverId 选择、测试对话示例

2. **前端引导**
   - 连接器列表中，对北大法宝连接器显示品牌图标（如有）
   - 工具详情页增加"使用示例"提示

### 6.5 Phase 4 详细任务（可选）

1. **结果格式化**
   - 法规检索结果：展示法规标题、发布日期、效力级别、条文摘要
   - 案例检索结果：展示案号、法院、案由、裁判日期、裁判要旨

2. **法律引用卡片**
   - 当 LLM 引用北大法宝检索结果时，生成可点击的引用卡片（类似 CourtListener 的 case_citation）
   - 卡片包含：标题、法条/案号、来源链接

3. **Token 用量监控**
   - 在连接器详情页展示 Token 消耗统计（如北大法宝 API 返回用量头信息）

---

## 7. 数据库与 API 变更

### 7.1 数据库变更

**结论：无需数据库迁移。**

现有 `user_mcp_connectors` 及相关表已完全支持北大法宝 MCP 集成：
- `server_url` 存储 `https://apim-gw.pkulaw.com/{SERVER_ID}/mcp`
- `auth_type = 'bearer'` 配合 `encrypted_auth_config` 存储 Token
- `user_mcp_connector_tools` 缓存发现的工具列表
- `user_mcp_tool_audit_logs` 记录调用日志

### 7.2 API 变更

**结论：无需新增 API 端点。**

现有 `/user/mcp-connectors/*` 路由已完全支持：
- 创建、更新、删除北大法宝连接器
- 刷新工具列表
- 启用/禁用工具
- OAuth 流程（如北大法宝未来支持 OAuth）

### 7.3 前端变更

| 文件 | 变更内容 | 工作量 |
|------|---------|--------|
| `NewMcpModal.tsx` | 增加 Preset 选择器、北大法宝模板 | 中等 |
| `connectors/page.tsx` | 增加品牌图标识别、配置向导链接 | 小 |
| `AssistantMessage.tsx` | 如需要，增加北大法宝结果卡片渲染 | 中等（Phase 4） |

### 7.4 后端变更

| 文件 | 变更内容 | 工作量 |
|------|---------|--------|
| `backend/src/lib/mcp/client.ts` | 无需变更（通用 URL 验证和 Auth 已支持） | 无 |
| `backend/src/lib/mcp/servers.ts` | 无需变更（通用工具发现和执行已支持） | 无 |
| `backend/src/lib/chat/tools/toolDispatcher.ts` | 无需变更（`mcp_` 前缀工具已自动路由） | 无 |

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 北大法宝 MCP 服务不稳定 | 工具调用失败影响用户体验 | 已有超时（30s）和错误降级机制；建议增加重试策略 |
| Token 泄露 | 安全风险 | Token 已 AES-GCM 加密存储；建议增加 Token 轮换提醒 |
| 中文结果截断 | 60KB 限制下信息丢失 | 北大法宝结果通常为结构化 JSON，一般小于 60KB；如超限制可协商分页 |
| 工具命名冲突 | 多个北大法宝连接器工具名冲突 | `openaiToolName` 生成规则已包含 connector ID 前缀，避免冲突 |
| 用户配置困难 | 需手动填写多个 serverId | Phase 2 提供预设模板和 URL 解析，降低配置门槛 |
| 法律数据准确性 | 检索结果可能不准确 | 明确标注 MCP 结果为"外部不可信数据"，LLM 需自行判断 |

---

## 9. 测试计划

### 9.1 单元测试
- `validateRemoteMcpUrl` 对北大法宝 URL 的验证
- `headersForAuth` 正确生成 `Authorization: Bearer xxx` 头
- `openaiToolName` 生成唯一工具名（含 connector 前缀）

### 9.2 集成测试
- 使用测试 Token 连接北大法宝 `law-keyword` 服务器
- 验证 `client.listTools()` 返回工具列表非空
- 验证 `client.callTool()` 执行 `search_article` 成功
- 验证对话全流程：用户输入 → LLM 选择工具 → 调用 → 结果返回 → 生成回答

### 9.3 端到端测试
- 前端：新建北大法宝连接器 → 刷新工具 → 启用/禁用 → 删除
- 对话："查找合同法第52条" → 确认工具被调用 → 确认结果在回答中引用
- 错误：输入无效 Token → 确认 401 被捕获 → 确认前端提示重配 Token

---

## 10. 附录

### 10.1 参考资源
- 北大法宝 MCP 平台: https://mcp.pkulaw.com
- 北大法宝文档中心: https://mcp.pkulaw.com/docs
- 北大法宝 CLI (npm): https://www.npmjs.com/package/@pkulaw/mcp-cli
- 北大法宝 Skills 仓库: https://gitee.com/pkulaw/pkulaw-skills
- MCP 协议规范: https://modelcontextprotocol.io

### 10.2 现有代码关键位置
- MCP 连接器库: `backend/src/lib/mcpConnectors.ts`
- MCP 客户端实现: `backend/src/lib/mcp/client.ts`
- MCP 服务端逻辑: `backend/src/lib/mcp/servers.ts`
- MCP 类型定义: `backend/src/lib/mcp/types.ts`
- MCP 路由: `backend/src/routes/user.ts:639-939`
- 前端连接器页面: `frontend/src/app/(pages)/account/connectors/page.tsx`
- 新建连接器弹窗: `frontend/src/app/components/account/NewMcpModal.tsx`
- 聊天工具调度: `backend/src/lib/chat/tools/toolDispatcher.ts:435-1896`
- 聊天流式处理: `backend/src/lib/chat/streaming.ts:146-200`

### 10.3 环境变量
无需新增环境变量。用户 Token 通过前端配置，加密存储于数据库。

---

*文档版本: v1.0*
*日期: 2026-07-15*
*作者: CodeBuddy Agent*
