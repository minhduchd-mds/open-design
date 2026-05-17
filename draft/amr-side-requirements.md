<!-- markdownlint-disable MD034 MD013 -->
<!-- cspell:ignore amr nexu opendesign opencode codex BYOK ndjson NDJSON keytar fastify -->

# AMR 侧:对接 open-design 还缺什么 — 实施简报

> **给谁看:** 这份文档丢进 AMR 仓库,让 AMR 端的实现 agent 照着补齐
> "让 open-design 能把 AMR 作为同级 agent 接入"还差的契约。
>
> **不要看:** open-design 端要写什么代码。那部分在 open-design 仓库的
> `draft/open-design-amr-integration-brief.md`(等同步进 `docs/integrations/amr.md`)。
> 本文档只讲"AMR 还差什么"+"做完是什么样"+"接口长什么样"。
>
> **基准时间:** 2026-05-17。基于 open-design 仓 `incongruous-megaraptor`
> 分支当前 WIP 状态(AMR 适配器代码已落 `apps/daemon/src/runtimes/defs/amr.ts`、
> `apps/daemon/src/integrations/amr/`、`apps/desktop/src/main/amr-callback.ts`)。
>
> **冲突处理:** open-design 已实现的代码就是契约消费者。AMR 这边只要落实
> 本文列的接口形状,open-design 不用再改一行。任何对契约的偏差,**改 AMR**,
> 不要让 open-design 维护者绕。

---

## 0. TL;DR — AMR 必须补的 6 项

按优先级从高到低:

| # | Item | 优先级 | 影响 |
|---|---|---|---|
| 1 | `amr login --callback <url>` 真正调起 deep-link 回调 | **P0** | 没有这个 → OAuth 完成后 open-design UI 不刷新到 connected;只能靠 fallback 轮询文件 |
| 2 | `~/.amr/session.json` 字段规范(token / gateway / org_id 等) | **P0** | open-design fallback 路径(`credentials.ts:63 readAmrSessionFile`)就是读这个文件 |
| 3 | `amr --version` 单行 stdout | **P0** | runtime 检测(`amr.ts:15`)依赖这个 |
| 4 | `GET /v1/models` 暴露底层模型目录(按 adapter 分组) | **P0** | open-design 现在只能塞 3 个写死 base,无法展示真正可选模型 |
| 5 | `amr agent run --base <id> --model <id>` 严格遵从契约 | **P0** | open-design 已经按这套语义在 `defs/amr.ts:75-79` build args |
| 6 | NDJSON 事件 schema 与简报 §4.5 完全一致 | **P0** | open-design 已经按这套 schema 实现 parser |
| 7 | `GET /v1/billing/balance` + `GET /v1/whoami` | P1 | 状态条 / 余额 widget;不阻塞主路径 |

下面 §1 - §7 一项一项展开。

---

## 1. [P0] `amr login --callback <url>` — OAuth 链路闭环

### 现状

open-design daemon 的 `apps/daemon/src/integrations/amr/login.ts` 当前长这样:

```ts
async function cliSupportsLoginCallback(amrBin: string, env): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(amrBin, ['login', '--help'], { ... });
    return String(stdout).includes('--callback');
  } catch { return false; }
}

const args = ['login', '--client-id', 'open-design'];
if (await cliSupportsLoginCallback(amrBin, env)) {
  args.push('--callback', callbackUrl);   // 只在 AMR 支持时才加
}
```

即 open-design **已经准备好用 deep link 接 token**,Electron 主进程也注册好了
`open-design://amr-callback` protocol handler(`apps/desktop/src/main/amr-callback.ts`),
daemon 也开好了 `POST /api/integrations/amr/callback` 路由
(`apps/daemon/src/integrations/amr/routes.ts`)。**就差 AMR CLI 真正会把 token deep-link 回来。**

如果 AMR 不支持 `--callback`,open-design 只能走 fallback:`amr login` 同步阻塞,
完了之后去读 `~/.amr/session.json`。这条路径**能跑通**,但有三个问题:

1. OAuth 期间整个 daemon worker 被 `execFile` 阻塞最多 180 秒(`login.ts:53 timeoutMs`)。
2. 用户在浏览器同意后,open-design 不知道 token 已到位,只能等子进程退出后读文件。
3. 浏览器跳转到的 verification URL 跟 open-design 的窗口完全脱钩,用户体验是"为什么我登完了 open-design 还在转圈"。

### 要做什么

`amr login` 增加 `--callback <url>` 参数,语义如下:

```text
amr login [options]

Options:
  --client-id <id>          OAuth client id;open-design 会传 "open-design"
  --callback <url>          完成后回调的 deep link 模板。AMR 拿到 access_token
                            后立即对此 URL 发起 deep-link 触发(macOS 上是
                            `open <url>`,Linux 上是 `xdg-open <url>`,Windows
                            上是 ShellExecute)。
                            必须把 token 和身份信息作为 query string 拼进 URL。
  --gateway <url>           amr gateway,default 走 AMR 默认配置
  --no-browser              不自动开浏览器(打印 URL 让人手动开),给 CI / headless 用
  --timeout <seconds>       device flow 轮询超时(默认 120)
```

**callback URL 拼接规则:**

```text
<base callback url>?
  token=<access_token>&
  gateway=<gateway_url>&
  user_id=<u_xxx>&
  org_id=<o_xxx>&
  project_id=<p_xxx>&
  key_id=<k_xxx>
```

例:open-design 传入 `--callback open-design://amr-callback`,AMR 拼出
`open-design://amr-callback?token=eyJ...&gateway=https%3A%2F%2Famr.example.com&user_id=u_42&org_id=o_7&project_id=p_3&key_id=k_99`,
然后 `open` 这个 URL。

**Exit code:**

```text
0   登录成功(token 已写本地 + callback 已触发)
1   超时 / 用户拒绝 / 网络错
2   用户传了 --callback 但 deep-link 执行失败(token 还是写本地了)
130 用户 Ctrl+C
```

### Acceptance

- `amr login --client-id open-design --callback "open-design://amr-callback"`:
  - 弹默认浏览器到 verification URL
  - 用户同意后,AMR CLI 把 `open-design://amr-callback?token=...&...` 触发出去
  - macOS 上 `open <url>` 会让 Electron 收到 `open-url` 事件
  - exit code 0
- 不传 `--callback`:行为跟现在一样,只写 `~/.amr/session.json`
- `amr login --help` 输出里**必须**有 `--callback` 字样(open-design 在探测它)

### 为什么不让 open-design 自己实现 OAuth

简报草稿里写得很清楚:把 OAuth 委托给 `amr login`,这样 AMR 升级协议(从 device flow
换成 PKCE 之类)时 open-design 不用跟着改。这是契约层面的稳定性需求,**不要建议
"让 open-design 直接调 /v1/oauth/* 三个端点"** 来绕开 `--callback` 的实现。

---

## 2. [P0] `~/.amr/session.json` 字段规范

### 现状

`apps/daemon/src/integrations/amr/credentials.ts:63 readAmrSessionFile` 把这个文件
当 fallback 用:`amr login` 跑完后,若 callback 没回来,open-design 会读这个文件
拿 token。当前 reader 兼容多种字段名:

```ts
const token =
  cleanString(row.token) ??
  cleanString(row.api_key) ??
  cleanString(row.access_token);
```

意味着 AMR 现在的实现可能用了 `api_key` 或 `access_token` 之类的字段。

### 要做什么

把 `~/.amr/session.json` 的 schema 锁死成下面这一份(也是 §1 的 callback query
反序列化后应该是同一个对象):

```jsonc
{
  // ── 必填 ─────────────────────────────────
  "token": "eyJhbGciOi...",            // access_token,带 Bearer 前缀走 HTTP
  "gateway": "https://amr.example.com", // gateway base URL,trailing slash 任意

  // ── 可选(用于显示) ─────────────────────
  "user_id":    "u_42",
  "org_id":     "o_7",
  "project_id": "p_3",
  "key_id":     "k_99",

  // ── 可选(版本/调试) ───────────────────
  "created_at": 1715952000,            // unix seconds
  "updated_at": 1715952000,
  "amr_cli_version": "0.4.1"
}
```

**保留 `api_key` / `access_token` 作为别名读 OK,但 AMR 新写的代码要写 `token`。**
两个 reader 路径(`credentials.ts:63` 和 `credentials.ts:94 amrCredentialsFromCallback`)
共用这一份字段表,要保持一致。

### Acceptance

- `amr login` 完成后,`~/.amr/session.json` 至少含 `token` + `gateway`
- 字段名严格用 snake_case(`user_id` 而非 `userId`)
- 文件权限 0600(macOS / Linux),Windows 走 ACL 等价
- 多账号(可选 P1):允许 `--profile <name>` 写到 `~/.amr/sessions/<name>.json`,
  默认 profile 仍写 `~/.amr/session.json`

---

## 3. [P0] `amr --version` 单行 stdout

### 现状

`apps/daemon/src/runtimes/defs/amr.ts:15` 用 `--version` 探测版本。这个 invocation
走 daemon 的通用 binary detection 流程,要求 stdout 第一行就是合法 semver
(或带 prefix 的 semver,例 `amr 0.4.1` / `0.4.1`)。

### 要做什么

确保 `amr --version`:

- exit code 0
- stdout 第一行 = 一行版本字符串,**不带 ANSI 颜色码、不带多行 banner**
  - 推荐格式:`amr 0.4.1`(prefix 可选,但要稳定)
- stderr 空
- 不读任何远程服务,纯本地 metadata

如果 AMR 有 daily build / nightly tag,允许 `0.4.1-nightly.20260517`,但**不能**
是 `0.4.1 (built 2026-05-17, foo bar)` 这种带空格描述的字符串。

### Acceptance

- `amr --version` 在 PATH 命中后 ≤ 50ms 返回
- 输出能被 semver 正则 `^v?\d+\.\d+\.\d+(-[\w.-]+)?` 一行匹配

---

## 4. [P0] `GET /v1/models` — 模型目录(本次新增)

### 现状

`apps/daemon/src/runtimes/defs/amr.ts:23-38 fetchModels` 当前只能列**用户已创建的 agent**:

```ts
const agents = await listAmrAgents(credentials, fetch);
return [
  DEFAULT_MODEL_OPTION,
  ...agents.map((agent) => ({ id: `agent:${agent.id}`, label: ... })),
  { id: 'base:claude-code', label: 'Claude Code base' },
  { id: 'base:codex',       label: 'Codex base' },
  { id: 'base:opencode',    label: 'OpenCode base' },
];
```

三个 `base:*` 是写死的。下游 build args 会变成 `amr agent run ... --base claude-code`,
让 AMR 自己 `auto` 选模型。**结果:**

- 新用户(还没建过 agent)的下拉只有 4 个选项:Auto + 3 个 base
- 每个 base 下面真正可用的具体模型(`claude-sonnet-4-6`、`claude-opus-4-7`、
  `gpt-4o-mini`、`deepseek-chat`、`gpt-5-thinking` 等)用户**看不见**,只能瞎填
- AMR 后续给某个 base adapter 接新 provider,open-design 这边永远跟不上

### 要做什么

AMR gateway 暴露 `GET /v1/models`,返回所有 AMR router 当前能路由到的底层模型,
按 adapter / family 分组:

```http
GET /v1/models
Authorization: Bearer <token>

→ 200 OK
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-4-6",
      "family": "claude",
      "adapter": "claude-code",        // 哪些 base 能用
      "context_window": 200000,
      "supports_tools": true,
      "supports_vision": true,
      "pricing": {
        "input_per_million_usd":  3.0,
        "output_per_million_usd": 15.0
      },
      "labels": ["recommended", "balanced"]
    },
    {
      "id": "claude-opus-4-7",
      "family": "claude",
      "adapter": "claude-code",
      "context_window": 1000000,
      "supports_tools": true,
      "supports_vision": true,
      "pricing": { "input_per_million_usd": 15.0, "output_per_million_usd": 75.0 },
      "labels": ["recommended", "max_quality"]
    },
    {
      "id": "gpt-5-thinking",
      "family": "gpt",
      "adapter": "codex",
      "context_window": 400000,
      "supports_tools": true,
      "supports_vision": false,
      "pricing": { "input_per_million_usd": 5.0, "output_per_million_usd": 30.0 },
      "labels": ["recommended", "deep_reasoning"]
    },
    {
      "id": "auto",
      "family": "router",
      "adapter": "any",
      "labels": ["default"],
      "description": "Let AMR pick based on prompt complexity + cost target."
    }
    // ... 其余模型
  ]
}
```

字段说明:

| 字段 | 必填 | 用途 |
|---|---|---|
| `id` | ✅ | open-design 直接传给 `amr agent run --model <id>` |
| `family` | ✅ | UI 分组用(claude / gpt / deepseek / qwen / gemini / router) |
| `adapter` | ✅ | 该模型走哪个 base adapter(`claude-code` / `codex` / `opencode` / `any`) |
| `context_window` | 优先填 | UI 显示 "200K ctx",影响用户选模型决策 |
| `supports_tools` | 优先填 | 没工具支持的模型 open-design 不应该让用户选(我们工作流强依赖工具) |
| `supports_vision` | 可选 | 影响"是否在拖图后允许这个模型" |
| `pricing` | 可选但推荐 | UI 显示价位,跟余额联动 |
| `labels` | 可选 | UI 排序 / 加 "Recommended" 徽标 |
| `description` | 可选 | hover tooltip |

返回顺序就是 UI 默认展示顺序;`recommended` label 的模型 open-design 会高亮置顶。

### 兼容老 open-design

open-design 现在的 fetcher 在 401 时返回 null,在异常时也 fallback 到本地 default
模型列表(见 `defs/shared.ts` 的 `DEFAULT_MODEL_OPTION`)。AMR 加 `/v1/models` 后,
open-design 那边的 fetcher 会扩展成:

```ts
fetchModels: async (_bin, env) => {
  const cred = readAmrSessionFile(env);
  if (!cred) return null;
  const [models, agents] = await Promise.all([
    listAmrModels(cred).catch(() => []),    // ← NEW
    listAmrAgents(cred).catch(() => []),
  ]);
  return [
    DEFAULT_MODEL_OPTION,
    ...agents.map(...),                      // 用户已建 agent
    ...models.map((m) => ({                  // ← NEW:具体模型目录
      id: `model:${m.id}`,
      label: `${m.id} (${m.family})`,
      group: m.family,
    })),
  ];
};
```

`buildArgs` 把 `model:<id>` 翻译成 `--model <id>`(它已经懂 `--model`,见
`defs/amr.ts:77 if (model) args.push('--model', model)`)。

### Acceptance

- `GET /v1/models` 在带合法 Bearer 时返回 200 + ≥ 5 个 entries
- 401 / 402 / 5xx 的错误形状跟其他端点一致(§7 的 `{ error: { type, message } }`)
- 缓存:服务端建议返回 `Cache-Control: max-age=300`,open-design 不会做客户端缓存
- 列表里 `adapter` 字段一定能和 `amr agent run --base <id>` 的 base 名称对齐

---

## 5. [P0] `amr agent run` CLI 语义

### 现状

open-design 已经按下面这个语义在拼参数(`defs/amr.ts:39-84`):

```bash
amr agent run [<agent_ref>] \
  --stream \
  --output-format stream-json \
  [-w <cwd>] \
  [--base <claude-code|codex|opencode>] \
  [--model <model_id>] \
  [--resume <session_id>]
```

调用 matrix:

| 用户在 UI 选了 | open-design 传 |
|---|---|
| `agent:<id>` | 位置参数填 `<id>`,**不传 `--base`** |
| `base:claude-code` | 不传 agent,加 `--base claude-code` |
| `model:claude-sonnet-4-6`(§4 新增) | 加 `--model claude-sonnet-4-6`,base 默认 `claude-code` |
| `Auto` | 不传任何模型相关参数 |

### 要做什么

AMR CLI 必须严格遵从下面这套优先级和默认值:

1. **agent ref 位置参数**:存在则覆盖 `--base` / `--model` / system prompt / tools
2. **`--base <id>`**:无 agent ref 时使用;合法值 = `/v1/models` 里某个 model 的
   `adapter` 字段 ∪ `any`
3. **`--model <id>`**:进一步覆盖 base 的默认 model;`auto` 表示交给 router
4. **`--resume <session_id>`**:同 §3.5 的简报,必须工作
5. **`-w <cwd>` / `--workspace`**:workspace 路径,默认 cwd

env:

| 变量 | 当前 open-design 行为 |
|---|---|
| `AMR_TOKEN` | 主要 token 来源,必填 |
| `AMR_API_KEY` | 别名,`credentials.ts:182` 同时写两份(兼容老 CLI) |
| `AMR_GATEWAY_URL` | gateway base,跟 `~/.amr/session.json` 的 `gateway` 一致 |
| `AMR_TRACE_ID` | 可选,审计串联 |
| `AMR_SESSION` | session 文件路径(默认 `~/.amr/session.json`) |

AMR 这边的实现:

- 优先读 `AMR_TOKEN`,fallback 到 `AMR_API_KEY`
- 不要因为同时设两个就报错(`credentials.ts` 故意冗余写两份)
- 没 token 时退出 code 1 + stderr 输出 `401: AMR token missing or invalid`,
  open-design 的错误模型(§6 简报)就能匹配并自动清 SQLite credentials

### Acceptance

- `amr agent run my-agent -p "hello" --stream --output-format stream-json` →
  stdout 一系列 NDJSON 行,以 `session.start` 开头,以 `session.end` 收尾,
  exit code 0
- `amr agent run --base claude-code --model claude-sonnet-4-6 -p "hello" --stream --output-format stream-json` → 同上
- `amr agent run nonexistent-agent -p "..." --stream ...` →
  stderr `404: agent not found`,exit code 1
- token 失效时 stderr 有 `401`/`Bearer` 字样(open-design `routes.ts` 错误模型靠这个)

---

## 6. [P0] NDJSON 事件 schema

### 现状

open-design 已实现 NDJSON parser (`apps/daemon/src/json-event-stream.ts`),并按
`apps/daemon/src/runtimes/defs/amr.ts:88 eventParser: 'amr'` 分派渲染。schema 跟
`docs/integrations/amr.md`(原始简报)§4.5 完全对齐。

### 要做什么

AMR CLI 的 `--output-format stream-json` 输出必须**完全符合**下面 schema
(简报里的 §4.5 重抄一份,加几条 enforcement note):

```ts
type AgentEvent =
  | { type: "session.start";  session_id: string; adapter: string; adapter_version?: string;
      model?: string; workspace?: string; trace_id?: string }
  | { type: "session.done";   session_id: string; result?: string;
      usage?: { input_tokens: number; output_tokens: number; cost_usd?: number };
      trace_id?: string }
  | { type: "session.end";    session_id: string; exit_code: number;
      duration_ms: number; active_duration_ms?: number; trace_id?: string }
  | { type: "session.error";  session_id: string; message: string;
      code?: string; recoverable?: boolean; trace_id?: string }
  | { type: "agent.token";    session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.thinking"; session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "agent.message";  session_id: string; role: "assistant" | "system"; text: string;
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
  | { type: "user.message";   session_id: string; text: string;
      session_thread_id?: string | null; trace_id?: string }
  | { type: "user.tool_result"; session_id: string; call_id: string; output: unknown;
      is_error?: boolean; session_thread_id?: string | null; trace_id?: string }
  | { type: "user.custom_tool_result"; session_id: string; call_id: string; output: unknown;
      is_error?: boolean; session_thread_id?: string | null; trace_id?: string };
```

Enforcement note:

1. **每行必须是合法 JSON**。`tee` 出来 grep 不到 `^\{` 的行 = bug。
2. **`session.start` 必须最先发出**,带 `session_id`。open-design 用这个 id
   写 SQLite `conversations.amr_session_id`(`server.ts:8760`),后续 `--resume`
   靠它续轮。
3. **`session.end` 必须最后发出**,带 `exit_code` 和 `duration_ms`。AMR 子进程
   退出和 `session.end` 之间不要再有任何 stdout。
4. **不要混入 ANSI 颜色码、progress bar、TUI 控制字符到 stdout**。日志去 stderr。
5. **未知 type 不要让 stream 中断**。AMR 自己加新 type(eg `agent.image_generated`)
   时,open-design 的 parser 会 warn-log + skip,但**前提是这一行仍然是合法 JSON
   且有 `type` 字段**。
6. **`session_thread_id`** 字段保留位置,multiagent 上线前都是 `null`,但**字段
   一定要有**(可以是 explicit `null`),open-design 数据结构按 thread 分组。

### Acceptance

- 跑 `amr agent run ... --stream --output-format stream-json -p "say hi" 2>/dev/null | python -c "import sys,json; [json.loads(l) for l in sys.stdin]"` 不抛错
- 第一行 type = `session.start`,最后一行 type = `session.end`
- 所有事件的 `session_id` 跟 `session.start` 一致
- token 流式:`agent.token` 之间间隔 < 200ms

---

## 7. [P1] `GET /v1/billing/balance` + `GET /v1/whoami`

### 现状

简报 §3.6 列了余额 widget(open-design 端 P2,但要做的话依赖 AMR 这两个端点)。
open-design 目前没接,但 `defs/amr.ts` 的 `fetchModels` 已经用了 `Authorization: Bearer`
对 gateway 调 `/v1/agents`,加这两个端点的成本极低。

### 要做什么

```http
GET /v1/billing/balance
Authorization: Bearer <token>
→ 200 OK
{
  "org_id": "o_7",
  "balance_usd": 12.34,
  "total_credit_usd": 20.00,
  "total_debit_usd":  7.66,
  "currency": "USD",
  "as_of": 1715952000
}
```

```http
GET /v1/whoami
Authorization: Bearer <token>
→ 200 OK
{
  "auth": "identity",            // or "service_key"
  "user":    { "id": "u_42", "email": "huan@...", "name": "..." },
  "org":     { "id": "o_7",  "name": "Open Design", "plan": "team" },
  "project": { "id": "p_3",  "name": "default" },
  "key":     { "id": "k_99", "label": "open-design", "scopes": ["agent.run", "agent.read"] }
}
```

错误形状(401 / 402 / 5xx)和其他端点一致(见下面 §8 错误模型)。

### Acceptance

- `/v1/whoami` 在 token 有效时返回 200 + 完整 user/org/project
- `/v1/billing/balance` 服务端建议 `Cache-Control: max-age=10`(open-design 可能
  每 30 秒轮一次)
- 余额接近 0 时仍正常返回(`balance_usd: 0.0023`),**不要**返回 402

---

## 8. 错误模型 — HTTP + Exit Code

### HTTP

所有 gateway 端点错误返回 JSON,顶层 `error` 对象:

```json
{ "error": { "type": "auth_error", "message": "AMR token missing or invalid." } }
```

`type` 枚举(与 open-design `apps/daemon/src/integrations/amr/routes.ts` 错误
分支对齐):

| HTTP | type | open-design 行为 |
|---|---|---|
| 401 | `auth_error` | 清 SQLite `amr_credentials` + 弹"请重新登录" |
| 402 | `payment_required` | 弹充值提示,链 dashboard |
| 400 | `validation_error` | 显示 message 到 UI,不清 token |
| 404 | `not_found` | 把请求当作"资源不存在",**不要**清 token |
| 429 | `rate_limited` | 后退一会重试(open-design 自己 backoff) |
| 5xx | `server_error` | 显示 "AMR backend issue, try again" |

### CLI Exit Code

| Exit | 含义 | open-design 行为(`server.ts` spawn 错误分支) |
|---|---|---|
| 0 | 正常 | 进入 done 状态 |
| 1 | 错误,stderr 中包含 `401` / `Bearer` | 清 token + 弹重登 |
| 1 | 错误,stderr 中包含 `402` / `balance` | 弹充值 |
| 1 | 错误,其他 | 通用 "amr failed" + 显示 stderr 末 20 行 |
| 130 | 被 Ctrl+C 杀 | "agent interrupted" |
| 其他非 0 | 同 1 | 同 1 通用分支 |

### Acceptance

- stderr 错误第一行包含 HTTP status code 数字(如 `Error: HTTP 401: token expired`),
  让 open-design 的字符串匹配能命中
- 不要把多行 stack trace 写 stdout,**只**写 stderr

---

## 9. 实施顺序建议(给 AMR 实现 agent)

按依赖关系,推荐这样排:

1. **第 1 步 — `amr --version` 单行输出**(§3)
   不动也许已经满足;先 audit,确保稳定。
2. **第 2 步 — `~/.amr/session.json` schema 落实 + `amr --version` 锁死**(§2, §3)
   是后面所有事情的前置。
3. **第 3 步 — `amr login --callback <url>`**(§1)
   open-design 已经在探测和接收,做完这步 OAuth 端到端体验就活了。
4. **第 4 步 — `amr agent run` 语义对齐 + NDJSON 事件 schema**(§5, §6)
   两件事是同一个进程的输入输出,一并实现 + 一并测。
5. **第 5 步 — `GET /v1/models`**(§4)
   open-design `fetchModels` 已经在调 `/v1/agents`,加 `/v1/models` 成本最小。
6. **第 6 步 — `/v1/billing/balance` + `/v1/whoami`**(§7)
   独立增量,可以随时做。

预计总工作量:中规模 PR,大约 800–1500 行 Rust/TypeScript(取决于 AMR 实现栈)+
一份 changelog。

---

## 10. 验收时跟 open-design 端的对照测

每完成一项,都可以在 open-design 仓库这个 worktree 里跑下面这条手工验证:

```bash
# 1. version 探测
amr --version
# 期望:一行 semver,exit 0

# 2. login 链路
amr login --client-id open-design --callback open-design://amr-callback
# 期望:浏览器开 → 同意 → Electron 收到 open-url → daemon POST callback → SQLite 落库
sqlite3 .od/app.sqlite "SELECT token, gateway, user_id, org_id FROM amr_credentials;"

# 3. 模型目录
curl -sS -H "Authorization: Bearer $TOKEN" "$AMR_GATEWAY_URL/v1/models" | jq '.data[].id'
# 期望:能看到具体 model id 列表

# 4. agent run + NDJSON
AMR_TOKEN=$TOKEN AMR_GATEWAY_URL=$AMR_GATEWAY_URL \
  amr agent run --base claude-code -p "say hi" --stream --output-format stream-json | jq -c .
# 期望:第一行 session.start,最后一行 session.end,中间是 agent.token / agent.message

# 5. resume
AMR_TOKEN=$TOKEN AMR_GATEWAY_URL=$AMR_GATEWAY_URL \
  amr agent run --base claude-code --resume <id> -p "and you?" --stream --output-format stream-json | jq -c .

# 6. whoami / balance
curl -sS -H "Authorization: Bearer $TOKEN" "$AMR_GATEWAY_URL/v1/whoami"
curl -sS -H "Authorization: Bearer $TOKEN" "$AMR_GATEWAY_URL/v1/billing/balance"
```

任意一步不通,记一个 ticket,标本文档章节号,例:`[AMR §4] /v1/models returns 500`。

---

## 11. 不在 AMR 这次 PR 范围内的事

- ❌ AMR 端的 connector / skill / MCP 注入(AMR 内部的事,open-design 透明无感)
- ❌ 计费规则细节(open-design 只显示 balance,不参与定价)
- ❌ 多 agent 协同(`session_thread_id` 留个 `null` 就行)
- ❌ 把 AMR 设成 open-design 默认 agent(open-design 那边的产品决定,跟 AMR 无关)
- ❌ AMR dashboard 的 UI 改造(浏览器里 OAuth 同意页就行)

---

## 12. 与 open-design 端实现的接口归集表(单页速查)

| 编号 | AMR 暴露 | open-design 消费点 |
|---|---|---|
| 1 | `amr --version`(stdout 一行 semver) | `apps/daemon/src/runtimes/defs/amr.ts` 通用 detect |
| 2 | `amr login --client-id <id> --callback <url>` | `apps/daemon/src/integrations/amr/login.ts:70-73` |
| 3 | `~/.amr/session.json`(`token`/`gateway`/...) | `apps/daemon/src/integrations/amr/credentials.ts:63 readAmrSessionFile` |
| 4 | deep-link 触发到 `open-design://amr-callback?token=...` | `apps/desktop/src/main/amr-callback.ts` + `apps/daemon/.../routes.ts` |
| 5 | `GET /v1/models` | `apps/daemon/src/runtimes/defs/amr.ts:23 fetchModels`(本次新增) |
| 6 | `GET /v1/agents` | `apps/daemon/src/integrations/amr/agents.ts:62 listAmrAgents` |
| 7 | `POST /v1/agents` | `apps/daemon/src/integrations/amr/agents.ts:76 ensureOpenDesignAmrAgent` |
| 8 | `amr agent run [agent] --base --model --resume -w --stream --output-format stream-json` | `apps/daemon/src/runtimes/defs/amr.ts:39 buildArgs` |
| 9 | NDJSON 事件 schema | `apps/daemon/src/json-event-stream.ts` + `eventParser: 'amr'` |
| 10 | `GET /v1/billing/balance` | (open-design P2,余额 widget) |
| 11 | `GET /v1/whoami` | (open-design P2,状态条) |

把这份表打印贴墙上,做完一行划掉一行。

---

## 附 A. open-design 侧后续会做的 UI 工作(供 AMR 团队参考时间线)

AMR 完成 §1–§6 后,open-design 这边大约还要再补:

- Settings → AMR 卡片加 "Connect" / "Disconnect" / "Reauthenticate" 按钮
  (现在只显示 `agentAuthRequired` 文字,无操作入口 — `SettingsDialog.tsx:1948`)
- 模型下拉根据 `/v1/models` 的 `family` 分组渲染,`recommended` 高亮
- spawn 失败时根据 stderr 自动清 token(已实现框架,等错误信号到位)
- (可选)顶部 status bar 余额 widget

这些都在 open-design 仓库,**AMR 不用关心**,只要按本文契约 ship 就行。
