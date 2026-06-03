# Design: Cross-platform "WebUI" packaging type

- Date: 2026-05-30
- Status: Design confirmed, implementation plan pending
- Scope: Add a new packaging type that bundles the daemon+web runtime into a terminal-launched, cross-platform, configurable package (no Electron)

## 1. Background and goals

The current build artifacts are limited to the Windows / mac GUI installers (Electron). We need to add a "WebUI" packaging type that satisfies:

1. Cross-platform support (Windows, mac, Linux).
2. Terminal launch; on GUI systems, double-clicking pops up a terminal window, the terminal prints the access URL, and if a browser is available it opens the corresponding URL directly.
3. Non-GUI systems launch from the terminal, and after startup the terminal prints the access URL.
4. Support configuration via launch arguments or a config file: token, port, remote access.
5. Provide both a start command and a stop command.

## 2. Design decisions (confirmed)

| Item | Decision |
| --- | --- |
| Runtime | Bundle the system Node + scripts, reuse the existing `apps/packaged/src/headless.ts` startup path, no Electron |
| Deployment shape | Dual-process (daemon + web Next.js process, `OD_WEB_OUTPUT_MODE=server`); the browser accesses the web port |
| Command shape | A single launcher + subcommands: `open-design start / stop / status` |
| Config file | `webui.config.json` (JSON) alongside the launcher; precedence: command-line arguments > config file > environment variables > defaults |
| Remote + token semantics | The token only protects the daemon `/api` (for programmatic clients); remote Web UI access does not require a token (the frontend currently carries no token and reaches the daemon through the web same-host loopback proxy, which is exempted) |
| Remote without token | When binding a non-loopback host without a provided token, a strong token is generated automatically and printed (for use by API clients) |
| Node runtime | Requires Node 24 already installed on the system; only the `better-sqlite3` native module is prebuilt per platform |
| Build artifacts | One archive per platform, `tools-pack webui build --to <platform>` |

## 3. Runtime architecture and network model (dual-process)

The webui runtime reuses `startPackagedSidecars` to launch two child processes:

- **daemon**: HTTP API + business logic. Binds `OD_BIND_HOST` (default `127.0.0.1`), port `OD_PORT` (can be dynamic). `OD_API_TOKEN` protects `/api`, but loopback origins are exempted.
- **web** (Next.js process, `OD_WEB_OUTPUT_MODE=server`): the browser-facing frontend. Listens on host `OD_HOST` (`apps/web/sidecar/server.ts:30`, default `127.0.0.1`), port `OD_WEB_PORT` / `PORT`. The web process proxies `/api` to the daemon, with the proxy target always `127.0.0.1` (`apps/web/next.config.ts:12`, `DAEMON_HOST` in `apps/web/sidecar/server.ts`).

This yields the following configuration-to-environment-variable mapping:

| Launcher config | Applies to | Environment variable | Default |
| --- | --- | --- | --- |
| `port` | web (browser access port) | `OD_WEB_PORT` and `PORT` | 7456 |
| `host` | web listener + daemon binding | web `OD_HOST` and daemon `OD_BIND_HOST` | 127.0.0.1 |
| `token` | daemon API | `OD_API_TOKEN` | none |

Security-semantics validation:

- Local access `http://127.0.0.1:<port>`: web→daemon loopback, the UI is fully usable, no token required.
- Remote access `http://<lan-ip>:<port>`: web listens on `0.0.0.0` and is reachable; web→daemon still goes over `127.0.0.1` loopback ⇒ remote users operating through the UI do not need a token (consistent with "UI remote not required").
- Remote programmatic clients connecting directly to the daemon `/api`: the origin is non-loopback ⇒ requires `Authorization: Bearer <token>` (consistent with "token only protects the API"). The daemon requires a token when binding a non-loopback host, so one is generated automatically when not provided.

> Note: the current web frontend does not read/carry a token (there is no `?token=` / `Authorization: Bearer` handling in the repo). This feature does not change frontend token behavior; access control for the remote Web UI is the user's responsibility via reverse proxy / VPN / network isolation, and the README must state this clearly.

## 4. Existing capabilities reused

- `apps/packaged/src/headless.ts`: already capable of starting the daemon+web sidecars without Electron, establishing IPC (STATUS/SHUTDOWN), and printing the URL. The webui-launcher's start builds on top of it (adding config parsing, network injection, browser opening, and the start/stop/status subcommands).
- `openBrowser()` / `createBrowserOpenInvocation()` in `apps/daemon/src/browser-open.ts`: already cross-platform (`open` / `xdg-open` / `cmd start`), safe when an opener is missing (best-effort; failure only warns and does not crash).
- The daemon's binding validation: `apps/daemon/src/server.ts:3819-3826`, which throws when the host is non-loopback and `OD_API_TOKEN` is absent (the error message includes an `openssl rand -hex 32` hint).
- The assembly flow in `tools/pack/src/linux.ts` (`writeAssembledApp`, `runProductionInstall`, `copyResourceTree`) and `ensureWorkspaceBuildArtifacts` in `tools/pack/src/workspace-build.ts`: a reference for the webui build's assembly and artifact sourcing.

### Injection points that need rework

The existing `startPackagedSidecars` (`apps/packaged/src/sidecars.ts`) hardcodes the daemon child process's `OD_PORT` (i.e. `SIDECAR_ENV.DAEMON_PORT`) to `"0"`, and **does not inject** `OD_BIND_HOST` / `OD_API_TOKEN`; the web child process likewise does not inject `OD_HOST` / a fixed `OD_WEB_PORT`. We therefore need to add an optional `network` option to `startPackagedSidecars` and inject the environment variables from the table above in `buildPackagedDaemonSpawnEnv` (daemon) and in the web child process's env construction. This rework keeps the existing headless / Electron callers' default behavior unchanged (when `network` is not passed, it retains dynamic ports + loopback + no token).

## 5. Artifact structure

Build command:

```
tools-pack webui build --to <mac|win|linux> [--arch <x64|arm64>] [--app-version <ver>] [--json]
```

One archive per platform (mac/win → `.zip`, linux → `.tar.gz`):

```
open-design-webui-<version>-<os>-<arch>.(zip|tar.gz)
  app/                         # assembled node app: daemon dist + web artifacts (server mode) + packaged dist
    node_modules/              # production dependencies, including the platform-prebuilt better-sqlite3
  bin/open-design              # launcher shell script -> calls `node app/.../webui-launcher.mjs`
  Open Design WebUI.command    # mac double-click -> opens Terminal and runs `open-design start`
  Open Design WebUI.bat        # win double-click -> opens a cmd window and runs start
  open-design-webui.desktop    # linux double-click (Terminal=true); ships start.sh as a fallback
  webui.config.example.json
  README(.md)
```

Native module strategy: requires system Node 24 (ABI 137 is stable within 24.x), so only the `better-sqlite3` prebuilt artifact is differentiated per platform/architecture. At build time, the target-platform prebuilt binary is fetched via `prebuild-install --platform/--arch` (or an equivalent method) and placed into `app/node_modules`, so supported platforms need no local compiler. Cross-architecture builds require the target platform's prebuilt package to exist.

Web output mode: webui uniformly uses `OD_WEB_OUTPUT_MODE=server` (consistent with the existing Linux headless setup, a dual-process combination already verified to run after packaging); the build command layer overrides each platform's default to avoid the inconsistency where mac/win fall back to standalone and linux falls back to server.

## 6. Launcher CLI

A new entry point (located in `apps/packaged`, e.g. `webui-launcher.ts`, compiled output `dist/webui-launcher.mjs`). The `bin/open-design` shell script is responsible for locating the system node and forwarding arguments.

```
open-design start [--port N] [--host ADDR] [--token T] [--no-open] [--config PATH] [--json]
open-design stop  [--json]
open-design status [--json]
```

### Config resolution (requirement 4)

Precedence: command-line arguments > `webui.config.json` (auto-discovered, alongside the launcher) > `OD_*` environment variables > defaults. A pure function `resolveWebuiConfig(...)`, for easy unit testing.

Config keys:

```json
{
  "port": 7456,
  "host": "0.0.0.0",
  "token": "s3cr3t",
  "openBrowser": true,
  "namespace": "default",
  "dataDir": null
}
```

- `--config PATH` can explicitly specify the config file path (overriding auto-discovery).
- The resolved result is mapped to the environment variables in the §3 table before starting the runtime.

### Node check

The shell scripts (`bin/open-design` and each double-click wrapper) first verify that `node --version` ≥ 24; when node is missing or the version is too low, they print a clear install/upgrade hint and exit (a double-click GUI session's PATH may not include node, so an explicit error is required here).

### start

1. Resolve config (`resolveWebuiConfig`).
2. If `host` is a non-loopback address and no token is provided → generate a strong random token (`odtoken_<base64url(randomBytes(32))>`) and print it prominently in the terminal (for use by API clients).
3. Call `startPackagedSidecars`, passing `network: { webHost, webPort, daemonBindHost, apiToken }`.
4. Write `webui-root.json` (pid, url, startedAt) to the namespace runtime directory.
5. Print the access URL (local `http://<host or localhost>:<port>`).
6. Attempt to open the browser per the §7 GUI rules.
7. Establish the IPC server (reusing the existing STATUS/SHUTDOWN handler), and listen for SIGINT/SIGTERM for graceful shutdown.

### stop

Read `webui-root.json`, send `SHUTDOWN` over IPC (the existing mechanism); when IPC is unreachable, fall back to signaling the pid; then clean up the identity file.

### status

Send `STATUS` over IPC, print the running state and URL; `--json` outputs a machine-readable result.

## 7. GUI and non-GUI behavior (requirements 2, 3)

- The double-click wrappers (`.command` / `.bat` / `.desktop`) open a **terminal window** and run `open-design start`, so GUI users can see the terminal output and the URL.
- `openBrowser` defaults to `auto` handling: it only opens the browser when a display device is detected. The decision `hasDisplay(platform, env)`:
  - Windows: treated as having a display.
  - mac: has a display, unless `SSH_CONNECTION` is detected (a remote session does not open the browser).
  - Linux: only when `DISPLAY` or `WAYLAND_DISPLAY` exists.
- Headless servers: only print the URL and keep running (satisfying requirement 3).
- `--no-open` or `openBrowser: false` forcibly disables auto-opening the browser.
- Opening the browser reuses `openBrowser()`, which is itself best-effort and only warns on failure.

## 8. Boundaries and consistency

- `webui-root.json` is a packaged local identity file, not a web/daemon API DTO, so **no changes to `packages/contracts` are needed**.
- This feature is a packaging/toolchain capability (`tools/pack` build command + the packaged launcher), not a product business capability, so the AGENTS.md "UI + od CLI dual-track" rule does not apply—the launcher itself is the CLI surface, and there is no corresponding web UI surface. **This will be called out in the PR description to avoid reviewers mistaking it for a missing UI surface.**
- Process identity/namespace/paths follow the existing sidecar conventions, introducing no second process-identity model; `--od-stamp-*` is not hand-built, and `createProcessStampArgs` is used.
- The pack resource files live under `tools/pack/resources/` (adding `tools/pack/resources/webui/`).
- The `network` rework of `startPackagedSidecars` must keep the existing headless / Electron callers' default behavior unchanged (default dynamic ports + loopback + no token).

## 9. Testing strategy

- `apps/packaged` unit tests (vitest, `tests/*.test.ts`):
  - `resolveWebuiConfig` precedence (command line > config file > environment variables > defaults).
  - The logic that auto-generates a token when remote access has no token.
  - `hasDisplay()` decisions across platforms / environment variables.
  - argv parsing and switches like `--config` / `--no-open`.
  - The `buildPackagedDaemonSpawnEnv` environment-variable branches with and without `network` passed (keeping default behavior unchanged).
- `tools/pack` unit tests (vitest):
  - The webui archive file manifest (app/, bin/open-design, each double-click wrapper, the config example, and README all present).
  - Selecting the correct `better-sqlite3` prebuilt artifact per `--to`.
- Smoke: unpack the artifact → `open-design start` → poll until the URL returns 200 → `open-design status` → `open-design stop` (optionally gated per platform).

## 10. Risks and mitigations

- **Linux double-click variance**: different desktop environments handle `.desktop` / executable-script double-clicks inconsistently → terminal launch is the primary path, double-click is best-effort, documented in the README.
- **Missing cross-architecture better-sqlite3 prebuilt**: a build targeting an architecture fails when there is no matching prebuilt package → validate before building and give a clear error, with the supported os/arch combinations listed in the docs.
- **GUI session PATH missing node**: a double-click launch may fail to find node → the shell script explicitly detects this and errors, prompting to install Node 24.
- **No application-layer auth for the remote Web UI**: the token does not protect the UI (the frontend carries no token) → the README clearly requires users to protect the remote exposure surface with a reverse proxy / VPN / network isolation.

## 11. Out of scope (YAGNI)

- No self-contained single-executable (SEA/pkg) approach.
- No reuse of an Electron windowless mode.
- No change to the web frontend's token-carrying behavior (no `?token=` frontend reading).
- No integration with the product auto-update (updater) flow.
- No system service / daemon registration (systemd/launchd/Windows service)—only a foreground terminal process + start/stop.
