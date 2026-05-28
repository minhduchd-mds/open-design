# `mocks/` — replay-based mock CLIs for OD's supported agents

A drop-in replacement for the real agent CLIs (`claude`, `opencode`,
`codex`, `gemini`, `cursor-agent`, `deepseek`, `qwen`, `grok`, and the
ACP family: `devin` / `hermes` / `kilo` / `kimi` / `kiro` / `vibe`)
that replays pre-recorded sessions in each CLI's native protocol —
stdout streaming for most, JSON-RPC over stdio for ACP. **Zero LLM tokens.**

Used by:

- **E2E tests** in `apps/daemon/tests/` — run the full chat-server
  pipeline against a known agent trace, assert UI events / artifacts.
- **Local self-tests during development** — iterate on `chat-routes.ts`,
  `claude-stream.ts`, `json-event-stream.ts` parser changes without
  burning provider budget.
- **Demo / onboarding** — show what a 17-tool `claude` editing session
  looks like end-to-end, offline.
- **Regression harness** — replay the same trace before and after a
  charter / parser change; diff the events the daemon surfaces.

The recordings are anonymized exports from open-design's Langfuse
project (179 traces across 9 agents and 5+ skills as of this commit).

---

## tl;dr

```bash
# Make the mock CLIs override the real ones for this shell:
export PATH="$PWD/mocks/bin:$PATH"

# Pick any recording to play back (8-char prefix OK):
export SYNCLO_EXPLORE_MOCK_TRACE=04097377

# Speed up replay (skip inter-event sleeps):
export SYNCLO_EXPLORE_MOCK_NO_DELAY=1

# Now anything that spawns opencode/claude/codex gets the recording:
echo "any prompt body" | opencode run
echo "any prompt"     | claude -p --output-format=stream-json
echo "any prompt"     | codex exec
```

The mock binaries are bash wrappers that exec
`node mocks/mock-agent.mjs --as <agent>`. Anything fed to stdin is
discarded by the renderer but used by the recording picker (see hash
mode below).

---

## What gets emitted

Each renderer matches the EXACT event shapes the OD daemon expects, as
verified line-by-line against the parsers in `apps/daemon/src/`:

| CLI | OD streamFormat | Parser source |
|---|---|---|
| `opencode`        | `json-event-stream` (opencode kind)     | `json-event-stream.ts:handleOpenCodeEvent`   |
| `codex`           | `json-event-stream` (codex kind)        | `json-event-stream.ts:handleCodexEvent`      |
| `claude`          | `claude-stream-json`                    | `claude-stream.ts:createClaudeStreamHandler` |
| `gemini`          | `json-event-stream` (gemini kind)       | `json-event-stream.ts:handleGeminiEvent`     |
| `cursor-agent`    | `json-event-stream` (cursor-agent kind) | `json-event-stream.ts:handleCursorEvent`     |
| `deepseek` `qwen` `grok` | `plain`                          | `server.ts` (raw stdout = final assistant text) |
| `devin` `hermes` `kilo` `kimi` `kiro` `vibe` | `acp-json-rpc` | `acp.ts:attachAcpSession`                       |

> **Note on `gemini` and `cursor-agent`**: OD's parsers for these two
> agents do NOT recognize tool-call events — only init / assistant text /
> usage. The renderers therefore emit ONLY the final assistant text wrapped
> in the expected init/text/usage envelope. Tool calls present in the
> source recording are silently dropped (which matches the real CLI's UI
> behavior — these agents don't surface tools in OD's chat view).

> **Note on ACP agents** (`devin` / `hermes` / `kilo` / `kimi` / `kiro` /
> `vibe`): These do NOT stream stdout — they speak JSON-RPC v2 over stdio.
> OD's daemon sends `initialize` → `session/new` → (optional `session/set_model`)
> → `session/prompt`; the mock responds in order, streams text via
> `session/update` notifications carrying `agent_message_chunk` parts,
> then responds to the prompt request with usage stats. Tool calls
> aren't part of the ACP protocol on this path (tools surface via MCP or
> other side channels), so they're dropped from playback.

Each tool call from the recording is rendered with the original input
arguments and tool output. The agents' assistant text is rendered as
the final message.

---

## Recording selection

Driven by env vars, in priority order:

| Env | Behavior |
|---|---|
| `SYNCLO_EXPLORE_MOCK_TRACE=<id>` | Always play this trace. 8-char prefix OK. |
| `SYNCLO_EXPLORE_MOCK_BY_PROMPT_HASH=1` + stdin prompt | Deterministic by `sha256(prompt) % len(all)`. Same prompt → same trace. Useful for "stable answer per question" tests. |
| `SYNCLO_EXPLORE_MOCK_POOL=<tag>` | Random within the tag pool. Examples: `agent:claude`, `skill:agent-browser`, `outcome:failed`. |
| `SYNCLO_EXPLORE_MOCK_SEED=<str>` | Makes "random" picks reproducible across runs. |
| `SYNCLO_EXPLORE_MOCK_NO_DELAY=1` | Skip inter-event waits. |
| `SYNCLO_EXPLORE_MOCK_RECORDINGS_DIR=<path>` | Override the recordings dir. |

If none are set, a uniformly random recording is played each invocation.

The mock binary announces the picked trace id on stderr:

```
[mock-opencode] picked 04097377… via fixed
```

This line is invisible to OD's stdout parser but useful for "wait, why
did my test get the FAQ-fix trace?" debugging.

---

## Recording catalog

The recordings live as one JSONL file per Langfuse trace under
`recordings/`. Each file starts with a `meta` event carrying:

```json
{
  "type": "meta",
  "source": {"provider": "langfuse", "trace_id": "...", "project_id": "..."},
  "agent": "claude" | "codex" | "opencode" | "gemini" | "cursor-agent" | "qwen" | "copilot" | "deepseek" | "antigravity",
  "model": "...",
  "outcome": "succeeded" | "failed" | "errored" | "interrupted",
  "duration_ms": 33620,
  "tool_call_count": 17,
  "error_count": 0,
  "total_tokens": 12345,
  "tags": ["agent:claude", "skill:agent-browser", "open-design", ...],
  "user_input": "...",
  "session_id": "..."
}
```

Subsequent events are `tool_call`, `tool_result`, and `report` (the
final assistant text).

### Indexed metadata

`recordings/index.json` is a flat manifest with one entry per recording
plus histograms over all recordings. Query with `jq`:

```bash
# All multi-turn claude sessions about HTML editing
jq '.entries[] | select(.agent=="claude" and .multi_turn==true)' \
  mocks/recordings/index.json | head -50

# Failed codex traces (negative-path tests)
jq '.entries[] | select(.agent=="codex" and .outcome=="failed") | .trace_id' \
  mocks/recordings/index.json

# Agent-browser skill, sorted by tool count desc
jq '[.entries[] | select(.skills | index("agent-browser"))] | sort_by(-.tool_count)' \
  mocks/recordings/index.json
```

### Headline stats (current dataset)

| Dimension | Distribution |
|---|---|
| Agents | claude 57 · opencode 41 · codex 38 · gemini 25 · cursor-agent 11 · qwen/copilot/deepseek 2 each · antigravity 1 |
| Outcomes | succeeded 144 · failed 35 |
| Skills | default 71 · ad-creative 50 · algorithmic-art 30 · agent-browser 22 · video-hyperframes 2 · magazine-web-ppt / brainstorming / data-report / penpot-flutter 1 each |
| Multi-turn | 124 traces tied to a session with ≥2 turns |
| Artifact | 18 traces produce `<artifact>` output |

---

## Anonymization

User-specific data has been scrubbed from every recording:

- `/Users/<name>/…`, `/home/<name>/…`, `C:\Users\<name>\…`
  → `${HOME}/…` / `%USERPROFILE%\…`
- Project UUIDs → stable `proj-001`, `proj-002`, … per recording
- meta tag `project:<uuid>` rewritten too

The anonymizer is idempotent. Tool input/output payloads (HTML, code,
etc.) are preserved verbatim — they're templated UI without cell-level
PII; if a future audit finds otherwise, add specific scrubs in
`apps/daemon/src/mocks/anonymize.ts` (in the synclo-explore source) and
re-run.

---

## Adding more recordings

The exporter that produced this set lives in
[nexu-io/agent-pr-explore](https://github.com/nexu-io/agent-pr-explore)
under `cli/src/local/orchestrator/langfuse-import.ts`. To pull more:

```bash
cd ~/Documents/agent-pr-explore
export LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...

# Examples:
synclo-explore local langfuse-import \
  --tag skill:data-report --limit 30

synclo-explore local langfuse-import \
  --min-tool-calls 8 --min-turns-in-session 3 --limit 50

synclo-explore local langfuse-import \
  --outcome failed --tag agent:gemini --limit 20

# Anonymize + ship to OD:
synclo-explore local recordings anonymize \
  --out-dir ~/Documents/open-design/mocks/recordings
```

The CLI is also available standalone for OD contributors who don't have
the synclo-explore checkout — install via:

```bash
npm i -g @nexu-io/synclo-explore   # when published
# or run the dist/index.js directly from the source repo.
```

---

## Usage from OD's test code

### From a test (Vitest / Jest)

```ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const MOCK_BIN = join(__dirname, '../../mocks/bin');

it('parses an opencode session with 4 tool calls into 4 UI events', async () => {
  const child = spawn('opencode', ['run'], {
    env: {
      ...process.env,
      PATH: `${MOCK_BIN}:${process.env.PATH}`,
      SYNCLO_EXPLORE_MOCK_TRACE: '06a9324a',   // 4-tool claude session
      SYNCLO_EXPLORE_MOCK_NO_DELAY: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write('test prompt');
  child.stdin.end();
  // ... assert events parsed from child.stdout
});
```

### From a manual playback

```bash
# See what claude's 17-tool "delete v2" session emits to OD:
export PATH=$(git rev-parse --show-toplevel)/mocks/bin:$PATH
export SYNCLO_EXPLORE_MOCK_TRACE=04097377
export SYNCLO_EXPLORE_MOCK_NO_DELAY=1
echo "anything" | claude -p --output-format=stream-json | jq .type | uniq -c
```

---

## Files

```
mocks/
├── README.md                 ← you are here
├── mock-agent.mjs                ← entry; routes --as <agent> to format renderer
├── lib/
│   ├── recording-picker.mjs      ← env-driven trace selection
│   ├── format-opencode.mjs       ← matches handleOpenCodeEvent
│   ├── format-codex.mjs          ← matches handleCodexEvent
│   ├── format-claude.mjs         ← matches createClaudeStreamHandler
│   ├── format-gemini.mjs         ← matches handleGeminiEvent
│   ├── format-cursor-agent.mjs   ← matches handleCursorEvent
│   ├── format-acp.mjs            ← JSON-RPC server matching attachAcpSession
│   └── format-plain.mjs          ← raw stdout (deepseek/qwen/grok)
├── bin/
│   ├── opencode  claude  codex
│   ├── gemini    cursor-agent
│   ├── deepseek  qwen    grok
│   └── devin hermes kilo kimi kiro vibe    ← 14 bash wrappers, PATH-overlay
└── recordings/
    ├── index.json             ← histograms + per-recording metadata
    └── *.jsonl                ← 179 anonymized Langfuse traces
```

No external dependencies. Pure node:`fs`/`crypto`/`child_process`. Works
under any Node ≥18.

---

## Limitations

- `copilot`, `qoder`, `pi` (the niche `copilot-stream-json` /
  `qoder-stream-json` / `pi-rpc` formats) are recorded but not yet
  rendered as their native protocols — they fall back to the plain
  renderer for now. If you need them, add a `format-<agent>.mjs`
  following the same pattern as `format-codex.mjs`; the parsers are
  in `apps/daemon/src/{copilot-stream,qoder-stream}.ts` and the pi-rpc
  handler inside `apps/daemon/src/server.ts`.
- The mock does not honor CLI flags that change semantics (`--model`,
  `--permission-mode`, `--allowed-tools`). They're silently ignored.

---

## Provenance / safety

All recordings come from open-design's own Langfuse project (the
`open-design` project under the `powerformer` org). Users opted into
telemetry when they installed the desktop client. The anonymizer
removed user-identifying paths and project UUIDs before checking in.

If you find a recording that includes content that should be redacted,
delete the file (`rm mocks/recordings/<id>.jsonl`) and regenerate the
index (`jq` will skip missing entries; for a fresh index, rerun the
exporter from synclo-explore).
