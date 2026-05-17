<!-- markdownlint-disable MD034 MD013 -->
<!-- cspell:ignore amr nexu opendesign opencode codex BYOK ndjson NDJSON openrouter keytar Hmbown DeepSeek deeplink fastify keyring composio fal -->

# open-design 接入 amr — 实施简报

> **给谁看:**这份文档丢进 `nexu-io/open-design` 仓库,让 open-design 端的 AI 编码 agent
> 照着实现"把 amr 当作 meta-agent 平级接入 open-design"的所有工作。
>
> **不要看:**为什么要做这件事(架构层面)。需要那部分时,问 amr 维护者要
> `docs/plan-meta-agent-and-open-design.md`(策略/取舍/为什么不是 BYOK proxy)。
> 本文档只讲"做什么"+"做完是什么样"+"接口契约是什么"。
>
> 文档协议:本文档中所有命令、HTTP 端点、env var、文件路径都是**最终契约**。
> 实现时若发现不一致,**不要默默改契约**,改 amr。先在 PR 描述里 flag,
> 再让 amr 维护者改这份文档。
>
> 写于 2026-05-17,基于 amr `master` HEAD。

---

## 0. 读完本节就知道要做什么

把 amr(`amr` CLI)接进 open-design,效果对终端用户是这样:

```text
用户在 open-design "设置 → AI Agent" 下拉框看到:
  • Claude Code      [本地已检测]
  • Codex            [本地已检测]
  • Cursor Agent     ...
  • amr              [新增 — 本次任务的目标]
  ↑ 选 amr 后:
    1. 如果用户没装 amr  → 弹"Install amr"按钮(给 brew / npm 命令)
    2. 如果用户没登录    → 弹浏览器走 OAuth → 一次同意 → 拿到 token
    3. 用户在对话框输 prompt → open-design daemon spawn `amr agent run ...`
    4. amr 一行 NDJSON 一行 NDJSON 把事件吐回来 → open-design 实时渲染
    5. 多轮续聊:open-design 存 amr session id,下一轮带 --resume
```

**用户的感知**:选 amr 跟选 claude-code 没区别;但后面是 amr 在帮他做
"模型路由 + 工具集 + skill 注入 + 计费",他自己不用配 N 个 key、不用比价。

**对 open-design 的工作量**:大约 300–500 行 TypeScript,可以一个 PR 合掉。
六个子任务,§3 列详。

---

## 1. amr 是什么(15 秒版本)

`amr`(Agentic Model Router)是一个本地 CLI + 可选 HTTP daemon:

- **行为像 claude-code / codex**:`amr agent run <id> -p "..." --stream` →
  stdout 吐 NDJSON 事件;一次性进程,出完 exit。**open-design daemon spawn 它的方式
  和 spawn claude-code 几乎一样。**
- **内部包的是**:OAuth 鉴权、token 计费、多家 model provider 路由、调底层
  claude-code/codex/opencode 的 adapter、tools/skills/MCP 注入。
- **用户视角**:一次 OAuth 给 amr,以后所有 agent 调用都用 amr 这一把 token,
  不再各家平台分别配 key。

amr 已发布 npm 包 `@amr/cli`(bin 名为 `amr`)。安装:`npm install -g @amr/cli` 或
`brew install amr`(brew tap 待 ship)。

---

## 2. 用户旅程:六张时序图

下面六张图按用户实际操作的时间顺序,逐步把 amr 接入 open-design。每张图末尾给出
对应的实现任务编号(§3),实现 agent 可以按这个顺序一节一节做。

### 2.1 用户第一次打开 open-design 的 agent 选择器

```text
T0  open-design 启动 daemon
T1  daemon 扫描 PATH,识别已安装 CLI:
      claude / codex / opencode / ... / amr  ← 新增检测
T2  UI 渲染下拉框,amr 出现在列表里
      • 已检测:绿点 + 版本号(从 `amr --version` 拿)
      • 未检测:灰色 + "Install" 按钮
```

→ 实现:**§3.1 PATH 检测**

---

### 2.2 用户选了 amr 但本机没装

```text
T0  用户点下拉项 "amr"
T1  daemon 跑 `which amr` → 没有
T2  UI 弹 "Install amr" 模态框,内容:
      平台     | 命令
      ─────────┼─────────────────────────────
      macOS    | brew install amr (或 npm i -g @amr/cli)
      Linux    | npm install -g @amr/cli
      Windows  | npm install -g @amr/cli
    + 一个 "Open in terminal" 按钮直接复制命令
T3  用户装完点 "Done"
T4  daemon 重新探测 → 绿点
```

→ 实现:**§3.1 PATH 检测 + 安装引导**

---

### 2.3 用户第一次用 amr — OAuth 登录

```text
T0  用户在对话框输 prompt,点发送
T1  daemon 检查本地有没有 amr token(SQLite `amr_credentials` 表)→ 没有
T2  daemon spawn:
      amr login --client-id open-design \
                --callback open-design://amr-callback
T3  amr 启动设备流,弹默认浏览器到 verification URL,
    浏览器里用户输验证码 + 同意授权
T4  amr 拿到 access_token → 写自己的 keychain
T5  amr 用 callback URL 触发 deep link:
      open-design://amr-callback?token=<token>&user_id=<u>&org_id=<o>
T6  Electron 主进程注册的 protocol handler 接收 → 写 SQLite
T7  UI 状态变成 "amr connected"
```

→ 实现:**§3.2 OAuth + Electron deep-link**

> ⚠️ 注意:**open-design 自己不要实现 OAuth 客户端流程**。
> 把整个登录过程委托给 `amr login`,自己只接收 callback。这样 amr 升级 OAuth
> 协议时 open-design 不用跟着改。

---

### 2.4 用户第一次发对话 — spawn + 流式渲染

```text
T0  daemon 收到 prompt: "make a landing page"
T1  spawn:
      amr agent run design-helper \
          -p "make a landing page" \
          --stream \
          --output-format stream-json
      env: AMR_TOKEN=<from sqlite>
           AMR_TRACE_ID=<uuid>     (可选,用来日志关联)
T2  daemon 逐行读 stdout(NDJSON,每行一个 AgentEvent)
T3  按事件 type 渲染:
      session.start    → 显示 "agent starting…" 状态
      agent.thinking   → 灰色斜体 think bubble
      agent.token      → 流式 append 到 assistant 气泡
      agent.message    → 完整消息(同 token 终态)
      agent.tool_use   → 显示工具调用卡片
      agent.file_edit  → 显示 diff 卡片
      agent.todo_update → 渲染 TODO 列表
      session.done     → 把 usage / cost 写状态条
      session.end      → 把对话标记 done
T4  amr 进程退出 → daemon 看到 EOF
T5  daemon 把 session_id(从 session.start 事件里拿到)写 SQLite
```

→ 实现:**§3.3 spawn 接线 + §3.4 NDJSON 事件渲染**

---

### 2.5 用户发第二轮 — 续聊

```text
T0  daemon 从 SQLite 拿这个 conversation 的 amr_session_id
T1  spawn:
      amr agent run design-helper \
          -p "make it dark mode" \
          --resume <amr_session_id> \
          --stream --output-format stream-json
T2  amr 内部读 session meta → 把底层 claude-code 的 session 也续上
T3  继续走 §2.4 的渲染流程
```

→ 实现:**§3.5 session 续轮**

---

### 2.6(可选)对话顶部显示余额

```text
T0  open-design 顶部 widget 每 30s 轮询:
      GET <amr_gateway>/v1/billing/balance
      Authorization: Bearer <token>
T1  显示 "$X.XX"
T2  余额 < $1 → 红色 + 弹提示 → 点击跳 amr 充值页
```

→ 实现:**§3.6 余额 widget**

---

## 3. 实现任务清单(按依赖顺序)

每个任务下面有:Scope / Files / API 契约 / Acceptance(怎么算做完)。

> **总原则:**所有 amr 端的契约 §4 列了细节;先看 §4 再回来写代码。
> 不要在 open-design 这边凭直觉发明 endpoint / event 名字。

### 3.1 [P0] amr 加入 CLI 检测白名单 + 安装引导

**Scope**

1. 在 daemon 的 agent-detect 模块加一项 `amr`:
   - binary 名:`amr`
   - 版本探测命令:`amr --version`(stdout 第一行就是 semver)
   - invoke 模式:`stream-json`(同 DeepSeek-TUI / Hmbown 的 `deepseek exec`)
2. UI 下拉框加 "amr (meta-agent)" 项,带可点击的 "Install" 按钮
3. 安装引导:平台 → 命令的映射(见 §2.2 的表)

**Files(预估)**

- `apps/daemon/src/agents/detect.ts`(或同位)— 加 `amr` 项
- `apps/daemon/src/agents/registry.ts`(或同位)— 加 invoke 描述
- 前端选择器组件 — 加渲染项 + 安装弹窗

**Acceptance**

- 全新机器没装 amr:UI 显示 amr 为灰色 + Install
- 装好 amr:UI 显示 amr 为绿色 + 版本号
- 已有的其他 agent 检测**不被影响**

---

### 3.2 [P0] OAuth 集成(委托给 `amr login`)

**Scope**

1. Electron 主进程注册 deep-link protocol:`open-design://amr-callback`
   - macOS/Linux:`app.setAsDefaultProtocolClient('open-design')`
   - Windows:registry,Electron 文档有现成代码
2. 当用户首次需要 token 时,daemon spawn:

   ```bash
   amr login \
     --client-id open-design \
     --callback "open-design://amr-callback"
   ```

   `amr login` 自己起浏览器、走设备流、拿 token、触发 callback。
3. 主进程收到 callback URL 后,解析 query string 拿到:
   - `token`(必填,作为 Authorization Bearer)
   - `user_id` / `org_id` / `project_id` / `key_id`(可选,展示用)
   - `gateway`(必填,amr token 对应的 gateway URL,见 §4.1)
4. 写 SQLite 表 `amr_credentials`:
   ```sql
   CREATE TABLE amr_credentials (
     id INTEGER PRIMARY KEY,
     token TEXT NOT NULL,
     gateway TEXT NOT NULL,
     user_id TEXT,
     org_id TEXT,
     project_id TEXT,
     key_id TEXT,
     created_at INTEGER NOT NULL
   );
   ```
5. 暴露 daemon 内部 helper:`getAmrToken(): { token, gateway } | null`,
   §3.3 / §3.6 都用它

**Files**

- `apps/desktop/src/main/protocol-handlers.ts`(新)
- `apps/daemon/src/integrations/amr/login.ts`(新)
- `apps/daemon/src/integrations/amr/credentials.ts`(新)
- migration:加 `amr_credentials` 表

**Acceptance**

- 用户在干净机器上首次走 amr:浏览器自动开 → 同意 → callback → token 落 SQLite
- token 不在明文 JSON 配置文件里(SQLite 是 OK 的,文本配置 NOT OK)
- 第二次启动 open-design,daemon `getAmrToken()` 返回缓存的 token
- 用户在 amr CLI 里 `amr logout` 后,open-design 端的下次调用应该自动重新登录
  (这点不在 open-design 控制,但要确保**收到 401 时清空本地 token + 重走登录**)

---

### 3.3 [P0] spawn `amr agent run` + agent resource 选择

**Scope**

1. 当用户选了 amr 作为 agent 后,UI 进一步问"用 amr 的哪个 agent":
   - daemon 调:`GET <gateway>/v1/agents`(带 Bearer)→ 拿到 amr 端用户已创建的
     agent 列表(id + name + base)
   - 若用户没有任何 agent,先创建一个默认的(POST /v1/agents,body 见 §4.4)
2. 对话框发送 prompt → daemon spawn:

   ```bash
   amr agent run <agent_id_or_name> \
       -p "<prompt>" \
       --stream \
       --output-format stream-json
   env:
     AMR_TOKEN=<from sqlite>
     AMR_TRACE_ID=<uuid>     # 可选,用于 audit
     AMR_GATEWAY_URL=<gateway from sqlite>   # 让 amr CLI 找对 daemon
   cwd: <workspace dir>      # 同当前 claude-code spawn 用的 workspace
   ```

3. **不要走 HTTP `/v1/agents/:id/runs`**。open-design daemon 主路径是 spawn 子进程
   (模式 A)。HTTP 路径是给 `amr serve` daemon 模式准备的,open-design 这边不用。
4. 处理子进程的 stdout / stderr / exit:
   - stdout = NDJSON 事件流(渲染见 §3.4)
   - stderr = log,记到 daemon 日志,**不展示给用户**
   - exit code 非 0 = 异常,UI 显示 "amr run failed: <stderr tail>"

**Files**

- `apps/daemon/src/integrations/amr/spawn.ts`(新,核心)
- `apps/daemon/src/integrations/amr/agents.ts`(新,list/create agent resource)

**Acceptance**

- 用户首次跑 amr:daemon 自动建一个默认 agent(base: `claude-code`,model: `auto`)
- 第二次跑:复用同一个 agent id
- spawn 出来的进程退出后,daemon 不再持有它的 handle(没有泄漏)

---

### 3.4 [P0] NDJSON 事件渲染

**Scope**

1. 实现一个 NDJSON line reader,按行 parse JSON,容错(空行 / 半行 / 非 JSON 都跳过)
2. 把每个 AgentEvent 映射到 UI 渲染动作。事件 schema 见 §4.5,**逐字段照抄**
3. 完整事件列表(必须支持):

   | type | 渲染 |
   |---|---|
   | `session.start` | 记录 session_id(回写 conversation 表),显示 "starting..." |
   | `session.done` | 显示本轮 usage(input/output tokens)+ cost |
   | `session.end` | 标记对话本轮结束;读 `exit_code` 判断成败 |
   | `session.error` | 红色 banner,内容是 `message` |
   | `agent.thinking` | 灰色斜体 "thinking..." 气泡(可选地把 text 显示出来) |
   | `agent.token` | 流式 append 到 assistant 气泡的当前文本 |
   | `agent.message` | assistant 完整消息(若已 stream 过 token,可忽略以避免重复) |
   | `agent.tool_use` | 工具调用卡片:tool 名 + input 摘要 |
   | `agent.file_edit` | diff 卡片:path + op + diff |
   | `agent.todo_update` | TODO 列表 widget |
   | `user.message` | 用户消息回显(amr 也会把用户输入 echo 回来) |
   | `user.tool_result` | 工具结果(通常折叠) |

4. 任何未识别的 type:**不要崩**,记 warn,跳过。amr 后续会加事件类型,
   open-design 要 forward-compatible
5. **多 thread 预留**:每个事件可能带 `session_thread_id`(string)。当前
   都为 null,但 UI 数据结构要支持按 thread 分组(预留 P1 multiagent)

**Files**

- `apps/daemon/src/integrations/amr/events.ts`(新,parser + dispatcher)
- 现有的对话渲染组件(任何加新事件类型时复用 / 扩展)

**Acceptance**

- 跑一条简单 prompt:能看到 token 流式输出
- 跑一条调工具的 prompt(例如 "search web for X"):能看到 tool_use 卡片
- 中间 kill 一下 amr 进程:UI 给出 "agent ended unexpectedly",不卡死
- amr 加新事件类型(eg `agent.image_generated`):open-design 显示原始 JSON 也行,
  绝不抛错

---

### 3.5 [P1] Session 续轮(多轮对话)

**Scope**

1. SQLite `conversations` 表加一列:

   ```sql
   ALTER TABLE conversations ADD COLUMN amr_session_id TEXT;
   ```

2. 首轮:从 `session.start` 事件里读 `session_id`,写入此列
3. 续轮:spawn 时多加 `--resume <amr_session_id>`:

   ```bash
   amr agent run <agent_id> \
       --resume <amr_session_id> \
       -p "<follow-up prompt>" \
       --stream --output-format stream-json
   ```

4. 若 amr 返回 `session not found`(用户换机器 / amr 端 session 已 GC):
   清掉 `amr_session_id`,把这一轮当首轮重来

**Files**

- migration(加列)
- `apps/daemon/src/integrations/amr/spawn.ts`(扩展)

**Acceptance**

- 同一对话连续发 5 条消息:amr 端是同一个 session(可用 `amr sessions show <id>` 验证)
- 关掉 open-design 重开,接着发第 6 条:仍续在同一个 session

---

### 3.6 [P2] 余额 widget(可选,但推荐 ship)

**Scope**

1. 顶部 status bar 加一个余额组件,每 30s 调:
   ```http
   GET <gateway>/v1/billing/balance
   Authorization: Bearer <token>
   ```
   返回:`{ org_id: "o_...", balance_usd: 12.34, ... }`
2. 显示 `$12.34`;`< $1` 时红色 + tooltip "low balance, click to top up"
3. 点击 → 在浏览器打开 amr dashboard 的充值页(URL:`<gateway>/dashboard/billing`,
   gateway 路径不是 API 路径)

**Files**

- 前端组件
- `apps/daemon/src/integrations/amr/billing.ts`(轮询 helper)

**Acceptance**

- 余额变动后 30s 内 UI 反映
- 401 时清 token + 弹"please log in to amr"

---

## 4. 接口契约(amr 暴露的全部内容)

> 这一节是真值表。任何"我以为 amr 是这样"都来这里查。

### 4.1 `amr login` CLI(给 daemon spawn 的)

```text
amr login [options]

Options:
  --client-id <id>          OAuth client id (default: "amr-cli")
                            open-design 传 "open-design"
  --callback <url>          callback URL,amr 拿到 token 后会用 deep link 打开它
                            例如:open-design://amr-callback
                            若不传,只把 token 写本地 keychain,不通知调用方
  --gateway <url>           指定 amr gateway。不传则用 amr 默认配置
  --no-browser              不自动开浏览器(打印 URL 让用户手动开)
  --timeout <seconds>       轮询超时(默认 120s)

Exit code:
  0   登录成功
  1   超时 / 用户拒绝 / 网络错
  130 用户 Ctrl+C
```

**Callback URL 格式:**

```text
open-design://amr-callback?
  token=<access_token>&
  gateway=<gateway_url>&
  user_id=<u_xxx>&
  org_id=<o_xxx>&
  project_id=<p_xxx>&
  key_id=<k_xxx>
```

> ⚠️ 当前 amr 的 `amr login` 还不支持 `--callback` 参数。**这是 open-design 端实现
> 时需要 flag 给 amr 维护者补的小改动**,~30 行 TypeScript。在简报草稿里我已经标记
> 为 P0 阻塞项(amr 端 ticket 编号待定)。如果 amr 没补,open-design 临时方案是:
> daemon 监听 amr 子进程 stdout 的 "Login OK" 行 + 读 `~/.amr/session.json`
> 拿 token。这个 fallback 是一次性的,**不要永久依赖**。

---

### 4.2 `amr agent run` CLI(主路径)

```text
amr agent run <agent_id_or_name> [options]

Args:
  agent_id_or_name          通过 GET /v1/agents 拿到的 id 或 name

Options:
  -p, --prompt <text>       单轮 prompt(必填,除非走 stdin NDJSON)
  --stream                  输出 NDJSON 事件(open-design 必须传这个)
  --output-format <fmt>     stream-json | inherit
                            stream-json = NDJSON 模式(open-design 用)
                            inherit = 透传底层 TUI(给人用,不给 daemon 用)
                            未传时根据 stdin 是否 TTY 自动判定
  --resume <session_id>     续轮(见 §3.5)
  -w, --workspace <dir>     工作目录(默认 cwd)
  -m, --model <id>          覆盖 agent 默认 model
  --gateway <url>           走 HTTP daemon 而不是本地 spawn(open-design 不用)
  -k, --key <token>         覆盖 token(open-design 不用,用 env AMR_TOKEN)

Env(open-design 关心的):
  AMR_TOKEN                 access token(必须传)
  AMR_GATEWAY_URL           amr gateway URL(若 token 跟 gateway 绑了就要传)
  AMR_TRACE_ID              用于审计串联日志(可选)
  AMR_SESSION               session 缓存文件路径(默认 ~/.amr/session.json)

Stdin:
  TTY                       透传到底层 agent TUI
  pipe (NDJSON)             多轮 prompt,每行一个 {"type":"user","content":"..."}
  pipe (text)               与 -p 等价

Stdout:
  NDJSON,每行一个 AgentEvent(schema 见 §4.5)

Stderr:
  日志(non-fatal warning / debug),open-design 不要展示给用户

Exit code:
  0     正常完成(对应 session.end.exit_code=0)
  非 0  失败(对应 session.end 或 session.error)
```

---

### 4.3 OAuth 端点(若 open-design 想直接做 OAuth,不推荐)

amr gateway 暴露这些端点,但 **open-design 不应该直接调它们**——委托给
`amr login` CLI(§4.1)。这里列出来只是为了让 review 的人能 trace。

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/v1/oauth/device` | 起设备流,返回 user_code + verification_uri |
| `POST` | `/v1/oauth/device/:user_code/approve` | 浏览器端用户同意(amr dashboard 调) |
| `POST` | `/v1/oauth/token` | 轮询拿 access_token |
| `POST` | `/v1/oauth/exchange` | 一次性 code 换 token(给 web app 用) |

返回结构:`{ access_token, token_type: "Bearer", expires_in, key_id, user_id, org_id, project_id }`

---

### 4.4 Agent / Session 资源 HTTP API(open-design 直接调)

所有请求都要 `Authorization: Bearer <token>`。`<gateway>` 来自 §3.2 落 SQLite
那一步存的 gateway URL。

**列 agent**:
```http
GET <gateway>/v1/agents
→ { object: "list", data: [{ id, name, base, model, version, ... }, ...] }
```

**创建默认 agent**(当用户没 agent 时):
```http
POST <gateway>/v1/agents
Content-Type: application/json

{
  "name": "open-design-default",
  "base": "claude-code",
  "model": "auto",
  "system": "You are open-design's helper agent.",
  "tools": []
}

→ { id: "a_xxx", name: "...", base: "claude-code", model: "auto", version: 1, ... }
```

**余额**:
```http
GET <gateway>/v1/billing/balance
→ { org_id: "o_xxx", balance_usd: 12.34, total_credit_usd: 20.00, total_debit_usd: 7.66 }
```

**whoami**(可选,展示用户名 / org 名):
```http
GET <gateway>/v1/whoami
→ { auth: "identity", user: {...}, org: {...}, project: {...}, key: {...} }
```

> open-design **不需要**调 `POST /v1/sessions` 或 `POST /v1/agents/:id/runs` HTTP。
> 这些是 `amr serve` daemon 模式用的;open-design 走 CLI spawn,事件直接从 stdout 来。

---

### 4.5 AgentEvent NDJSON Schema(渲染时的真值表)

每行一个 JSON 对象。**全部字段:**

```ts
type AgentEvent =
  | { type: "session.start"; session_id: string; adapter: string; adapter_version?: string;
      model?: string; workspace?: string; trace_id?: string }
  | { type: "session.done"; session_id: string; result?: string;
      usage?: { input_tokens: number; output_tokens: number; cost_usd?: number };
      trace_id?: string }
  | { type: "session.end"; session_id: string; exit_code: number;
      duration_ms: number; active_duration_ms?: number; trace_id?: string }
  | { type: "session.error"; session_id: string; message: string;
      code?: string; recoverable?: boolean; trace_id?: string }

  | { type: "agent.token"; session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.thinking"; session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.message"; session_id: string; role: "assistant" | "system"; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.tool_use"; session_id: string; tool: string; input: unknown; call_id: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.file_edit"; session_id: string; path: string;
      op: "create" | "modify" | "delete"; diff?: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.todo_update"; session_id: string;
      todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.custom_tool_use"; session_id: string; tool: string; input: unknown; call_id: string;
      session_thread_id?: string | null; trace_id?: string }

  | { type: "user.message"; session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "user.tool_result"; session_id: string; call_id: string; output: unknown;
      is_error?: boolean; session_thread_id?: string | null; trace_id?: string }
  | { type: "user.custom_tool_result"; session_id: string; call_id: string; output: unknown;
      is_error?: boolean; session_thread_id?: string | null; trace_id?: string };
```

**实现建议**:

- type 用 string union 而不是 enum,**保留未知 type 的容错**
- `session_thread_id` 当前都是 null,但 multiagent 上来后会用,**不要丢这个字段**
- amr 未来加新事件(eg `agent.image_generated`),按本表"未识别就 fallback 渲染"
  原则,**不要让 NDJSON parser 抛错**

---

### 4.6 错误模型

amr 进程异常 → exit code 非 0 + stderr 有 message。open-design 应该:

| 现象 | 处理 |
|---|---|
| exit code 1,stderr 含 `401`/`Bearer` | token 失效 → 清 amr_credentials → 提示重登 |
| exit code 1,stderr 含 `402`/`balance` | 余额不足 → 弹充值提示(链接到 gateway dashboard) |
| exit code 1,stderr 含 `412`/`not found` 类 | adapter binary 没装 → 引导用户装 claude-code |
| 任意非 0 + 没匹配的 stderr | 通用 "amr failed" 错误,展示 stderr 末 20 行 |
| 进程被信号杀死 | "agent interrupted" |

HTTP 调用(§4.4)的错误是 JSON:
```json
{ "error": { "type": "auth_error" | "payment_required" | "validation_error" | ...,
             "message": "..." } }
```
对应 HTTP 状态 401 / 402 / 400 / 404 / 500。**402 时**给用户跳充值页,**不要在 UI 里
弹通用错误**。

---

## 5. 测试 / 验收(open-design PR review 的检查点)

以下场景必须手工跑通(自动化测试是 nice-to-have,不强求):

| # | 场景 | 期望 |
|---|---|---|
| 1 | 干净机器,没装 amr | UI 显示 amr 为灰 + Install 按钮 |
| 2 | 装好 amr,没 login | 选 amr 后弹浏览器走 OAuth → 回 callback → token 落库 |
| 3 | login 后发简单 prompt | 流式输出 token,session 完成,余额扣减 |
| 4 | 跟同一对话发第 2/3 条 | amr session 复用,`amr sessions show <id>` 看到完整历史 |
| 5 | 中途 kill amr 进程 | UI 给 "agent ended unexpectedly",不卡死 |
| 6 | 把 amr_credentials 表里的 token 改坏 | 下次调用 401 → 自动清 token + 重弹登录 |
| 7 | 余额改为 $0(用 `amr usage` mock 或调 ledger) | 调用返 402,UI 弹充值 |
| 8 | 关掉 open-design 重开 | 仍能跑(token 持久化) |
| 9 | amr 端 `amr logout` | open-design 下次调用 401 → 重登 |
| 10 | 同时跑 amr 和 claude-code(各自独立对话) | 两边互不干扰 |

---

## 6. 不在这次 PR 范围内的事(避免 scope creep)

- ❌ amr 端的 connector / skill / MCP 注入(amr 内部的事,open-design 透明无感)
- ❌ amr 端的 token 计费规则细节(open-design 只显示 balance)
- ❌ 多 agent 协同(`session_thread_id` 字段预留就行,UI 不画)
- ❌ 把 amr 设成 open-design 默认 agent(默认仍是用户选择,UI 不偏)
- ❌ 给 amr 实现一个自家 BYOK proxy(那是入口 1,跟入口 1.5 走不同代码路径)
- ❌ 把现有 31 个 skill 推给 amr(amr 自己会做 `amr skills install --from-open-design`,
  open-design 这边等)

---

## 7. 参考与协作

- amr 仓库:`https://github.com/<owner>/agentic-model-router`(待 ship 公开)
- amr 维护者沟通:通过 open-design 团队 → amr 团队的 Slack/微信
- amr 端追踪本集成的文档:`docs/plan-meta-agent-and-open-design.md` §3 / §5
- 本文档若与 amr 端实际行为冲突:**amr 行为为准**;flag 给 amr 维护者改这份文档

**实现 agent 在 open-design 仓库内可以创建的工作记录文件:**

- `docs/integrations/amr.md` —— 把这份简报拷一份进 open-design,作为契约 source
- `apps/daemon/src/integrations/amr/README.md` —— 短的"我是怎么实现的"笔记

不要创建超过这两份的 design/planning 文档。

---

## 附 A. 一段最小可工作的 spawn 代码(给实现 agent 当起点)

```ts
// apps/daemon/src/integrations/amr/spawn.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface AmrRunOpts {
  agent: string;             // amr agent id or name
  prompt: string;
  resumeSessionId?: string;
  workspace: string;
  token: string;
  gateway: string;
  traceId?: string;
}

export type AmrEvent = { type: string; [k: string]: unknown };

export interface AmrRun {
  events: AsyncIterable<AmrEvent>;
  done: Promise<{ exitCode: number; sessionId?: string }>;
  kill: () => void;
}

export function runAmrAgent(opts: AmrRunOpts): AmrRun {
  const args = ['agent', 'run', opts.agent, '-p', opts.prompt,
                '--stream', '--output-format', 'stream-json',
                '-w', opts.workspace];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);

  const child: ChildProcessWithoutNullStreams = spawn('amr', args, {
    env: {
      ...process.env,
      AMR_TOKEN: opts.token,
      AMR_GATEWAY_URL: opts.gateway,
      ...(opts.traceId ? { AMR_TRACE_ID: opts.traceId } : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let sessionId: string | undefined;
  const events = (async function* () {
    const rl = createInterface({ input: child.stdout });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: AmrEvent;
      try { evt = JSON.parse(trimmed); }
      catch { continue; } // tolerate non-JSON noise
      if (evt.type === 'session.start' && typeof evt.session_id === 'string') {
        sessionId = evt.session_id;
      }
      yield evt;
    }
  })();

  const done = new Promise<{ exitCode: number; sessionId?: string }>((resolve) => {
    child.on('exit', (code) => resolve({ exitCode: code ?? 0, sessionId }));
  });

  return { events, done, kill: () => child.kill('SIGTERM') };
}
```

照这段起步,把它接到 §3.3 / §3.4 / §3.5 的位置即可。
