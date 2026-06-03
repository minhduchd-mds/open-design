# WebUI Packaging Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new cross-platform "WebUI" packaging type — terminal-launched, no Electron, with configurable port/host/token and start/stop/status commands. In a GUI environment, double-clicking pops up a terminal and automatically opens the browser; in a non-GUI environment it prints the access URL.

**Architecture:** Reuse the headless startup path of `apps/packaged` (`startPackagedSidecars` spins up the daemon + web Next.js dual-process pair with `OD_WEB_OUTPUT_MODE=server`). Add a `webui-launcher.ts` entry that provides the start/stop/status subcommands and configuration parsing; extend `startPackagedSidecars` to support injecting network configuration (the web side's `OD_HOST`/`OD_WEB_PORT`, the daemon side's `OD_BIND_HOST`/`OD_API_TOKEN`). Add a `webui` subcommand under `tools/pack` that assembles the node app + the target-platform `better-sqlite3` prebuild + launch scripts/double-click wrappers, packaging per platform into a zip (mac/win) or tar.gz (linux).

**Tech Stack:** TypeScript (Node 24, ESM), esbuild, vitest, cac, `@open-design/sidecar` (IPC: `createJsonIpcServer` / `requestJsonIpc`), the system `tar`/`zip`, and `tools/pack/resources/win/7zip/7z.exe`.

**Design basis:** `specs/current/2026-05-30-webui-packaging-type-design.md` (§3 network model, §6 launcher, §7 GUI).

---

## File structure

**Part 1 — Runtime launcher (apps/packaged)**

- Create `apps/packaged/src/webui-config.ts` — pure functions: argument parsing, config-file loading, precedence merging, `hasDisplay()`, token auto-generation. Side-effect-free, easy to unit test.
- Modify `apps/packaged/src/sidecars.ts` — add an optional `network` field to `PackagedDaemonSpawnEnvOptions` and `startPackagedSidecars`, injecting environment variables; default behavior unchanged.
- Create `apps/packaged/src/webui-launcher.ts` — start/stop/status entry, reusing the headless startup + IPC.
- Modify `apps/packaged/esbuild.config.mjs` — add the `webui-launcher.ts` entry.
- Modify `apps/packaged/package.json` — add `./webui-launcher` to `exports`.
- Create `apps/packaged/tests/webui-config.test.ts`; extend `apps/packaged/tests/sidecars.test.ts`.

**Part 2 — Packaging build (tools/pack)**

- Create `tools/pack/resources/webui/` — launch scripts and double-click wrapper templates, `webui.config.example.json`, `README.md`.
- Modify `tools/pack/src/resources.ts` — expose the webui resources directory.
- Create `tools/pack/src/webui.ts` — assemble, select the better-sqlite3 prebuild, write scripts, compress.
- Modify `tools/pack/src/config.ts` — add an `arch` field.
- Modify `tools/pack/src/index.ts` — register the `webui <action>` command.
- Create `tools/pack/tests/webui.test.ts`.
- Modify `tools/pack/AGENTS.md` — document the webui subcommand.

---

## Part 1 — Runtime launcher

### Task 1: webui config parsing and GUI detection (pure functions)

**Files:**
- Create: `apps/packaged/src/webui-config.ts`
- Test: `apps/packaged/tests/webui-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/packaged/tests/webui-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  generateApiToken,
  hasDisplay,
  isLoopbackHost,
  parseWebuiArgs,
  resolveWebuiConfig,
} from "../src/webui-config.js";

describe("parseWebuiArgs", () => {
  it("parses command + flags", () => {
    const parsed = parseWebuiArgs([
      "start",
      "--port",
      "8080",
      "--host",
      "0.0.0.0",
      "--token",
      "abc",
      "--no-open",
      "--json",
      "--config",
      "/tmp/c.json",
    ]);
    expect(parsed.command).toBe("start");
    expect(parsed.flags).toEqual({
      port: 8080,
      host: "0.0.0.0",
      token: "abc",
      openBrowser: false,
      json: true,
      config: "/tmp/c.json",
    });
  });

  it("defaults command to start and leaves unset flags undefined", () => {
    const parsed = parseWebuiArgs([]);
    expect(parsed.command).toBe("start");
    expect(parsed.flags.port).toBeUndefined();
    expect(parsed.flags.host).toBeUndefined();
  });

  it("rejects an unknown command", () => {
    expect(() => parseWebuiArgs(["frobnicate"])).toThrow(/unknown command/i);
  });
});

describe("resolveWebuiConfig precedence", () => {
  it("flag > config file > env > default", () => {
    const resolved = resolveWebuiConfig({
      flags: { port: 8080 },
      configFile: { port: 9090, host: "0.0.0.0", token: "cfgtok" },
      env: { OD_WEB_PORT: "5000", OD_BIND_HOST: "127.0.0.1", OD_API_TOKEN: "envtok" },
    });
    // flag wins for port
    expect(resolved.port).toBe(8080);
    // config wins for host/token (no flag)
    expect(resolved.host).toBe("0.0.0.0");
    expect(resolved.token).toBe("cfgtok");
  });

  it("falls back to env then default", () => {
    const resolved = resolveWebuiConfig({
      flags: {},
      configFile: null,
      env: { OD_WEB_PORT: "5000" },
    });
    expect(resolved.port).toBe(5000);
    expect(resolved.host).toBe("127.0.0.1");
    expect(resolved.port).toBeTypeOf("number");
  });

  it("uses default port 7456 and host 127.0.0.1 when nothing set", () => {
    const resolved = resolveWebuiConfig({ flags: {}, configFile: null, env: {} });
    expect(resolved.port).toBe(7456);
    expect(resolved.host).toBe("127.0.0.1");
    expect(resolved.openBrowser).toBe(true);
  });
});

describe("isLoopbackHost", () => {
  it("treats loopback hosts as local", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });
  it("treats 0.0.0.0 and LAN IPs as remote", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.20")).toBe(false);
  });
});

describe("generateApiToken", () => {
  it("produces a prefixed base64url token", () => {
    const token = generateApiToken();
    expect(token).toMatch(/^odtoken_[A-Za-z0-9_-]{20,}$/);
    expect(generateApiToken()).not.toBe(token);
  });
});

describe("hasDisplay", () => {
  it("win32 always has display", () => {
    expect(hasDisplay("win32", {})).toBe(true);
  });
  it("darwin has display unless SSH session", () => {
    expect(hasDisplay("darwin", {})).toBe(true);
    expect(hasDisplay("darwin", { SSH_CONNECTION: "x" })).toBe(false);
  });
  it("linux needs DISPLAY or WAYLAND_DISPLAY", () => {
    expect(hasDisplay("linux", {})).toBe(false);
    expect(hasDisplay("linux", { DISPLAY: ":0" })).toBe(true);
    expect(hasDisplay("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @open-design/packaged test -- tests/webui-config.test.ts`
Expected: FAIL — `Cannot find module '../src/webui-config.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/packaged/src/webui-config.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export type WebuiCommand = "start" | "stop" | "status";

export type WebuiFlags = {
  port?: number;
  host?: string;
  token?: string;
  openBrowser?: boolean;
  json?: boolean;
  config?: string;
};

export type WebuiConfigFile = {
  port?: number;
  host?: string;
  token?: string;
  openBrowser?: boolean;
  namespace?: string;
  dataDir?: string | null;
};

export type ResolvedWebuiConfig = {
  port: number;
  host: string;
  token: string | null;
  openBrowser: boolean;
  namespace: string | null;
  dataDir: string | null;
};

const DEFAULT_PORT = 7456;
const DEFAULT_HOST = "127.0.0.1";
const COMMANDS = new Set<WebuiCommand>(["start", "stop", "status"]);

export function parseWebuiArgs(argv: string[]): { command: WebuiCommand; flags: WebuiFlags } {
  const flags: WebuiFlags = {};
  let command: WebuiCommand = "start";
  let i = 0;

  if (argv.length > 0 && !argv[0].startsWith("-")) {
    const candidate = argv[0];
    if (!COMMANDS.has(candidate as WebuiCommand)) {
      throw new Error(`unknown command: ${candidate} (expected start|stop|status)`);
    }
    command = candidate as WebuiCommand;
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--port":
        flags.port = Number(argv[++i]);
        if (!Number.isInteger(flags.port)) throw new Error("--port must be an integer");
        break;
      case "--host":
        flags.host = argv[++i];
        break;
      case "--token":
        flags.token = argv[++i];
        break;
      case "--config":
        flags.config = argv[++i];
        break;
      case "--no-open":
        flags.openBrowser = false;
        break;
      case "--json":
        flags.json = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { command, flags };
}

export function loadConfigFile(path: string): WebuiConfigFile | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as WebuiConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`failed to read config file ${path}: ${(error as Error).message}`);
  }
}

export function resolveWebuiConfig(input: {
  flags: WebuiFlags;
  configFile: WebuiConfigFile | null;
  env: NodeJS.ProcessEnv;
}): ResolvedWebuiConfig {
  const { flags, configFile, env } = input;
  const cfg = configFile ?? {};

  const envPort = env.OD_WEB_PORT != null ? Number(env.OD_WEB_PORT) : undefined;
  const port =
    flags.port ?? cfg.port ?? (Number.isInteger(envPort) ? (envPort as number) : undefined) ?? DEFAULT_PORT;

  const host = flags.host ?? cfg.host ?? env.OD_BIND_HOST ?? DEFAULT_HOST;
  const token = flags.token ?? cfg.token ?? env.OD_API_TOKEN ?? null;
  const openBrowser = flags.openBrowser ?? cfg.openBrowser ?? true;
  const namespace = cfg.namespace ?? env.OD_PACKAGED_NAMESPACE ?? null;
  const dataDir = cfg.dataDir ?? env.OD_DATA_DIR ?? null;

  return { port, host, token, openBrowser, namespace, dataDir };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost") return true;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  return normalized === "127.0.0.1" || normalized.startsWith("127.");
}

export function generateApiToken(): string {
  return `odtoken_${randomBytes(32).toString("base64url")}`;
}

export function hasDisplay(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform === "win32") return true;
  if (platform === "darwin") return env.SSH_CONNECTION == null;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @open-design/packaged test -- tests/webui-config.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @open-design/packaged typecheck`
Expected: Passes, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/packaged/src/webui-config.ts apps/packaged/tests/webui-config.test.ts
git commit -m "feat(packaged): pure functions for webui config parsing and GUI detection"
```

---

### Task 2: Extend startPackagedSidecars to inject network configuration

**Files:**
- Modify: `apps/packaged/src/sidecars.ts` (`PackagedDaemonSpawnEnvOptions` around lines 279-297; `buildPackagedDaemonSpawnEnv` around lines 305-351; `startPackagedSidecars` options around lines 430-452 and the web env around lines 501-507)
- Test: `apps/packaged/tests/sidecars.test.ts` (append cases)

- [ ] **Step 1: Write the failing test**

Append to the end of `apps/packaged/tests/sidecars.test.ts` (following the file's existing `buildPackagedDaemonSpawnEnv` import and the `makePaths()` style; if the file does not import it, add `import { buildPackagedDaemonSpawnEnv } from "../src/sidecars.js";`):

```typescript
describe("buildPackagedDaemonSpawnEnv network injection", () => {
  const paths = {
    dataRoot: "/tmp/ns/data",
    resourceRoot: "/tmp/ns/res",
    installationRoot: "/tmp/ns/install",
  } as unknown as import("../src/paths.js").PackagedNamespacePaths;

  it("keeps dynamic daemon port and no token by default (no network)", () => {
    const env = buildPackagedDaemonSpawnEnv(paths, {
      appVersion: null,
      daemonCliEntry: null,
      requireDesktopAuth: false,
    });
    expect(env.OD_PORT).toBe("0");
    expect(env.OD_BIND_HOST).toBeUndefined();
    expect(env.OD_API_TOKEN).toBeUndefined();
  });

  it("injects bind host and token when network is provided", () => {
    const env = buildPackagedDaemonSpawnEnv(paths, {
      appVersion: null,
      daemonCliEntry: null,
      requireDesktopAuth: false,
      network: { bindHost: "0.0.0.0", apiToken: "odtoken_xyz", daemonPort: null },
    });
    expect(env.OD_BIND_HOST).toBe("0.0.0.0");
    expect(env.OD_API_TOKEN).toBe("odtoken_xyz");
    // daemonPort null -> remains dynamic "0"
    expect(env.OD_PORT).toBe("0");
  });

  it("honors an explicit daemon port", () => {
    const env = buildPackagedDaemonSpawnEnv(paths, {
      appVersion: null,
      daemonCliEntry: null,
      requireDesktopAuth: false,
      network: { daemonPort: 7777, bindHost: null, apiToken: null },
    });
    expect(env.OD_PORT).toBe("7777");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @open-design/packaged test -- tests/sidecars.test.ts`
Expected: FAIL — `network` is not a valid property (type error) or the injection assertions fail.

- [ ] **Step 3: Write the implementation**

3a. In `apps/packaged/src/sidecars.ts`, define the network options type (place it before `PackagedDaemonSpawnEnvOptions`):

```typescript
export type PackagedNetworkOptions = {
  /** Browser-facing web port; mapped to the web child's OD_WEB_PORT/PORT. */
  webPort?: number | null;
  /** Web listen host; mapped to the web child's OD_HOST. */
  webHost?: string | null;
  /** Daemon listen port; mapped to the daemon's OD_PORT, default 0 (dynamic). */
  daemonPort?: number | null;
  /** Daemon bind host; mapped to OD_BIND_HOST. */
  bindHost?: string | null;
  /** Daemon API token; mapped to OD_API_TOKEN. */
  apiToken?: string | null;
};
```

3b. Append optional fields to `PackagedDaemonSpawnEnvOptions` (around lines 279-297):

```typescript
  posthogHost?: string | null;
  /** webui network injection; when omitted, keeps dynamic port + loopback + no token. */
  network?: PackagedNetworkOptions | null;
};
```

3c. Modify the `buildPackagedDaemonSpawnEnv` return object: replace the hardcoded `[SIDECAR_ENV.DAEMON_PORT]: "0"` (around line 310) with the following, and at the end of the object (after the `posthogHost` injection, before the closing `}` of the return) append the host/token injection:

```typescript
    [SIDECAR_ENV.DAEMON_PORT]: String(options.network?.daemonPort ?? 0),
```

Append at the end:

```typescript
    ...(options.network?.bindHost == null || options.network.bindHost.length === 0
      ? {}
      : { OD_BIND_HOST: options.network.bindHost }),
    ...(options.network?.apiToken == null || options.network.apiToken.length === 0
      ? {}
      : { OD_API_TOKEN: options.network.apiToken }),
```

3d. Append to the options of `startPackagedSidecars` (around lines 430-452):

```typescript
    webOutputMode: PackagedWebOutputMode;
    network?: PackagedNetworkOptions | null;
  },
```

3e. Pass `options.network` through to the daemon env (add one line inside the `buildPackagedDaemonSpawnEnv(paths, { ... })` around lines 470-479):

```typescript
        posthogHost: options.posthogHost,
        network: options.network ?? null,
      }),
```

3f. Modify the web child-process env (around lines 501-507), injecting `OD_HOST` and using the network's web port (keeping the daemon's actual port `extractPort(daemonStatus.url)` unchanged):

```typescript
      env: {
        [SIDECAR_ENV.DAEMON_PORT]: extractPort(daemonStatus.url),
        [SIDECAR_ENV.WEB_PORT]: String(options.network?.webPort ?? 0),
        ...(options.webStandaloneRoot == null ? {} : { OD_WEB_STANDALONE_ROOT: options.webStandaloneRoot }),
        ...(options.network?.webHost == null || options.network.webHost.length === 0
          ? {}
          : { OD_HOST: options.network.webHost }),
        OD_WEB_OUTPUT_MODE: options.webOutputMode,
        PORT: String(options.network?.webPort ?? 0),
      },
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @open-design/packaged test -- tests/sidecars.test.ts`
Expected: PASS (new cases + existing cases).

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @open-design/packaged typecheck`
Expected: Passes.

- [ ] **Step 6: Commit**

```bash
git add apps/packaged/src/sidecars.ts apps/packaged/tests/sidecars.test.ts
git commit -m "feat(packaged): let startPackagedSidecars accept injected network config"
```

---

### Task 3: webui-launcher entry (start/stop/status)

**Files:**
- Create: `apps/packaged/src/webui-launcher.ts`
- Modify: `apps/packaged/esbuild.config.mjs`
- Modify: `apps/packaged/package.json` (`exports`)

> Note: The main body of this entry is process orchestration, which is hard to unit-test purely; the testable logic has already been extracted into Task 1's `webui-config.ts`. Verification relies on typecheck + build + the end-to-end smoke test in Part 2 (Task 7).

- [ ] **Step 1: Write the entry implementation**

Create `apps/packaged/src/webui-launcher.ts` (modeled on `headless.ts`, reusing its namespace/paths/stamp/identity/IPC logic; the full file is given below):

```typescript
import { mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_DEFAULTS,
  SIDECAR_MESSAGES,
  SIDECAR_MODES,
  SIDECAR_SOURCES,
  normalizeDesktopSidecarMessage,
  type SidecarStamp,
} from "@open-design/sidecar-proto";
import {
  bootstrapSidecarRuntime,
  createJsonIpcServer,
  requestJsonIpc,
  resolveAppIpcPath,
} from "@open-design/sidecar";
import { openBrowser } from "@open-design/daemon/browser-open";

import { PACKAGED_NAMESPACE_ENV, type PackagedConfig } from "./config.js";
import { writePackagedDesktopIdentity, writePackagedWebIdentity } from "./identity.js";
import { resolvePackagedNamespacePaths } from "./paths.js";
import { startPackagedSidecars } from "./sidecars.js";
import {
  generateApiToken,
  hasDisplay,
  isLoopbackHost,
  loadConfigFile,
  parseWebuiArgs,
  resolveWebuiConfig,
  type ResolvedWebuiConfig,
} from "./webui-config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function resolveNamespaceBaseRoot(): string {
  const odDataDir = process.env.OD_DATA_DIR;
  if (odDataDir != null && odDataDir.length > 0) {
    return join(resolve(odDataDir.replace(/^~/, homedir())), "namespaces");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataBase =
    xdgDataHome != null && xdgDataHome.length > 0 ? xdgDataHome : join(homedir(), ".local", "share");
  return join(dataBase, "open-design", "namespaces");
}

function resolveLauncherConfig(namespace: string): PackagedConfig {
  const resourceRoot =
    process.env.OD_RESOURCE_ROOT ?? join(__dirname, "..", "..", "..", "open-design");
  return {
    amrProfile: null,
    appVersion: null,
    daemonCliEntry: null,
    daemonSidecarEntry: null,
    namespace,
    namespaceBaseRoot: resolveNamespaceBaseRoot(),
    nodeCommand: null,
    resourceRoot,
    telemetryRelayUrl: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL?.trim() || null,
    posthogKey: process.env.POSTHOG_KEY?.trim() || null,
    posthogHost: process.env.POSTHOG_HOST?.trim() || null,
    webSidecarEntry: null,
    webStandaloneRoot: null,
    // Web run mode consistent with the existing Linux headless path, verified to run after packaging.
    webOutputMode: "server",
  };
}

function createStamp(namespace: string): SidecarStamp {
  return {
    app: APP_KEYS.DESKTOP,
    ipc: resolveAppIpcPath({ app: APP_KEYS.DESKTOP, contract: OPEN_DESIGN_SIDECAR_CONTRACT, namespace }),
    mode: SIDECAR_MODES.RUNTIME,
    namespace,
    source: SIDECAR_SOURCES.PACKAGED,
  };
}

function colorize(text: string): string {
  if (process.stdout.isTTY !== true || process.env.NO_COLOR != null) return text;
  return `\x1b[36m\x1b[4m${text}\x1b[0m`;
}

function discoverConfigFile(explicitPath?: string) {
  if (explicitPath != null) return loadConfigFile(explicitPath);
  // Auto-discovery: webui.config.json next to the launcher / in the install root
  const candidates = [
    join(process.cwd(), "webui.config.json"),
    join(__dirname, "..", "..", "..", "..", "webui.config.json"),
  ];
  for (const candidate of candidates) {
    const cfg = loadConfigFile(candidate);
    if (cfg != null) return cfg;
  }
  return null;
}

function browserUrl(config: ResolvedWebuiConfig): string {
  const host = isLoopbackHost(config.host) ? "localhost" : config.host;
  return `http://${host}:${config.port}`;
}

async function commandStart(config: ResolvedWebuiConfig, json: boolean): Promise<void> {
  const namespace = OPEN_DESIGN_SIDECAR_CONTRACT.normalizeNamespace(
    config.namespace ?? process.env[PACKAGED_NAMESPACE_ENV] ?? SIDECAR_DEFAULTS.namespace,
  );
  if (config.dataDir != null) process.env.OD_DATA_DIR = config.dataDir;

  // Remote access without a token -> auto-generate
  let token = config.token;
  if (!isLoopbackHost(config.host) && (token == null || token.length === 0)) {
    token = generateApiToken();
    process.stdout.write(`\n  No token was set for remote access; one was generated automatically:\n    token: ${token}\n`);
  }

  const packagedConfig = resolveLauncherConfig(namespace);
  const paths = resolvePackagedNamespacePaths(packagedConfig);
  const stamp = createStamp(namespace);
  await mkdir(paths.runtimeRoot, { recursive: true });

  const runtime = bootstrapSidecarRuntime(stamp, process.env, {
    app: APP_KEYS.DESKTOP,
    base: paths.runtimeRoot,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
  });

  const identity = await writePackagedDesktopIdentity({
    identityPath: paths.headlessIdentityPath,
    paths,
    stamp,
  });

  const sidecars = await startPackagedSidecars(runtime, paths, {
    appVersion: packagedConfig.appVersion,
    amrProfile: packagedConfig.amrProfile,
    daemonCliEntry: packagedConfig.daemonCliEntry,
    daemonSidecarEntry: packagedConfig.daemonSidecarEntry,
    nodeCommand: packagedConfig.nodeCommand,
    telemetryRelayUrl: packagedConfig.telemetryRelayUrl,
    posthogKey: packagedConfig.posthogKey,
    posthogHost: packagedConfig.posthogHost,
    requireDesktopAuth: false,
    webSidecarEntry: packagedConfig.webSidecarEntry,
    webStandaloneRoot: packagedConfig.webStandaloneRoot,
    webOutputMode: packagedConfig.webOutputMode,
    network: {
      webHost: config.host,
      webPort: config.port,
      daemonPort: null,
      bindHost: config.host,
      apiToken: token,
    },
  });

  const webUrl = sidecars.web.url;
  if (!webUrl) {
    await sidecars.close().catch(() => undefined);
    await identity.close().catch(() => undefined);
    throw new Error("web sidecar failed to produce URL — check logs/desktop/latest.log");
  }
  const displayUrl = browserUrl(config);

  const shutdown = async (): Promise<void> => {
    process.stdout.write("\n Shutting down Open Design...\n");
    await ipcServer.close().catch(() => undefined);
    await sidecars.close().catch(() => undefined);
    await identity.close().catch(() => undefined);
    process.exit(0);
  };

  const ipcServer = await createJsonIpcServer({
    socketPath: stamp.ipc,
    handler: async (message: unknown) => {
      const request = normalizeDesktopSidecarMessage(message);
      switch (request.type) {
        case SIDECAR_MESSAGES.STATUS:
          return { pid: process.pid, state: "running", url: displayUrl, updatedAt: new Date().toISOString() };
        case SIDECAR_MESSAGES.SHUTDOWN:
          setImmediate(() => {
            void shutdown().finally(() => process.exit(0));
          });
          return { accepted: true };
      }
    },
  });

  await writePackagedWebIdentity({ paths, pid: process.pid, url: displayUrl });

  if (json) {
    process.stdout.write(`${JSON.stringify({ pid: process.pid, url: displayUrl, token })}\n`);
  } else {
    process.stdout.write(`\n Open Design is running\n\n`);
    process.stdout.write(` ➜ ${colorize(token ? `${displayUrl}/?token=${token}` : displayUrl)}\n\n`);
    process.stdout.write(` Press Ctrl+C to stop\n\n`);
  }

  if (config.openBrowser && hasDisplay(process.platform, process.env)) {
    openBrowser(displayUrl);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function commandStopOrStatus(command: "stop" | "status", json: boolean): Promise<void> {
  const namespace = OPEN_DESIGN_SIDECAR_CONTRACT.normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? SIDECAR_DEFAULTS.namespace,
  );
  const ipc = resolveAppIpcPath({ app: APP_KEYS.DESKTOP, contract: OPEN_DESIGN_SIDECAR_CONTRACT, namespace });
  const type = command === "stop" ? SIDECAR_MESSAGES.SHUTDOWN : SIDECAR_MESSAGES.STATUS;
  try {
    const reply = await requestJsonIpc(ipc, { type }, { timeoutMs: 2000 });
    if (json) process.stdout.write(`${JSON.stringify(reply)}\n`);
    else if (command === "status") process.stdout.write(` ${JSON.stringify(reply)}\n`);
    else process.stdout.write(` Open Design stopped\n`);
  } catch {
    if (json) process.stdout.write(`${JSON.stringify({ state: "stopped" })}\n`);
    else process.stdout.write(` No running Open Design found (namespace=${namespace})\n`);
    if (command === "status") process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseWebuiArgs(process.argv.slice(2));
  if (command === "start") {
    const configFile = discoverConfigFile(flags.config);
    const config = resolveWebuiConfig({ flags, configFile, env: process.env });
    await commandStart(config, flags.json === true);
    return;
  }
  await commandStopOrStatus(command, flags.json === true);
}

void main().catch((error: unknown) => {
  process.stderr.write(`open-design webui failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
```

> Note: The `@open-design/daemon/browser-open` import path must match the daemon package's `exports`. If the daemon does not export that subpath, instead add `"./browser-open": { "default": "./dist/browser-open.js" }` to `apps/daemon/package.json` in an additional step of Task 3, and confirm that `apps/daemon` has been built. Verify first with the typecheck in the next step.

- [ ] **Step 2: Add the esbuild entry**

Modify `apps/packaged/esbuild.config.mjs`, appending a third build at the end:

```javascript
await build({
  ...sharedOptions,
  entryPoints: ["./src/webui-launcher.ts"],
  outfile: "./dist/webui-launcher.mjs",
});
```

- [ ] **Step 3: Add the package.json export**

Modify the `exports` of `apps/packaged/package.json`, appending after `"./headless"`:

```json
    "./webui-launcher": {
      "default": "./dist/webui-launcher.mjs"
    },
```

- [ ] **Step 4: Confirm the daemon exports browser-open (as needed)**

Run: `node -e "console.log(require('./apps/daemon/package.json').exports)"`
If there is no `./browser-open`, Modify the `exports` of `apps/daemon/package.json` to append:

```json
    "./browser-open": {
      "types": "./dist/browser-open.d.ts",
      "default": "./dist/browser-open.js"
    },
```

Then Run: `pnpm --filter @open-design/daemon build`

- [ ] **Step 5: typecheck + build**

Run:
```bash
pnpm --filter @open-design/packaged typecheck
pnpm --filter @open-design/packaged build
```
Expected: Passes; `apps/packaged/dist/webui-launcher.mjs` is generated.

- [ ] **Step 6: Commit**

```bash
git add apps/packaged/src/webui-launcher.ts apps/packaged/esbuild.config.mjs apps/packaged/package.json apps/daemon/package.json
git commit -m "feat(packaged): webui-launcher start/stop/status entry"
```

---

## Part 2 — Packaging build (tools/pack)

### Task 4: webui resource templates and scripts

**Files:**
- Create: `tools/pack/resources/webui/open-design.sh` (mac/linux shell)
- Create: `tools/pack/resources/webui/open-design.cmd` (win shell)
- Create: `tools/pack/resources/webui/launch-mac.command`
- Create: `tools/pack/resources/webui/launch-win.bat`
- Create: `tools/pack/resources/webui/open-design-webui.desktop`
- Create: `tools/pack/resources/webui/webui.config.example.json`
- Create: `tools/pack/resources/webui/README.md`
- Modify: `tools/pack/src/resources.ts`

> These are static templates, copied into the artifact during assembly. Relative paths in the scripts are based on the "artifact root": the shell scripts sit alongside `app/`, and the launcher entry is at `app/node_modules/@open-design/packaged/dist/webui-launcher.mjs`.

- [ ] **Step 1: Write the mac/linux shell `open-design.sh`**

```bash
#!/usr/bin/env sh
# Open Design WebUI launcher shell. Validates Node 24 then forwards to webui-launcher.
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRY="$SCRIPT_DIR/app/node_modules/@open-design/packaged/dist/webui-launcher.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node 24 and try again: https://nodejs.org" >&2
  exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 24 ]; then
  echo "Node 24+ is required, current version is $(node --version). Please upgrade and try again." >&2
  exit 1
fi
export OD_RESOURCE_ROOT="$SCRIPT_DIR/app/resources/open-design"
exec node "$ENTRY" "$@"
```

- [ ] **Step 2: Write the win shell `open-design.cmd`**

```bat
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "ENTRY=%SCRIPT_DIR%app\node_modules\@open-design\packaged\dist\webui-launcher.mjs"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node 24 and try again: https://nodejs.org 1>&2
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "MAJOR=%%v"
if %MAJOR% LSS 24 (
  echo Node 24+ is required, please upgrade and try again. 1>&2
  exit /b 1
)
set "OD_RESOURCE_ROOT=%SCRIPT_DIR%app\resources\open-design"
node "%ENTRY%" %*
endlocal
```

- [ ] **Step 3: Write the double-click wrappers**

`launch-mac.command` (double-click runs start in Terminal):

```bash
#!/usr/bin/env sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/open-design.sh" start
```

`launch-win.bat`:

```bat
@echo off
cd /d "%~dp0"
call open-design.cmd start
pause
```

`open-design-webui.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Open Design WebUI
Comment=Start Open Design WebUI in a terminal
Exec=sh -c 'cd "$(dirname "%k")" && ./open-design.sh start; exec $SHELL'
Terminal=true
Categories=Development;
```

- [ ] **Step 4: Write the example config and README**

`webui.config.example.json`:

```json
{
  "port": 7456,
  "host": "127.0.0.1",
  "token": null,
  "openBrowser": true
}
```

`README.md`:

```markdown
# Open Design WebUI

Cross-platform, terminal-launched Open Design Web runtime (no Electron).

## Prerequisites
- Node.js 24+ installed (`node --version`).

## Start / Stop
- mac/Linux: `./open-design.sh start`, stop with `./open-design.sh stop`
- Windows: `open-design.cmd start`, stop with `open-design.cmd stop`
- Double-click: mac `Open Design WebUI.command`, Windows `Open Design WebUI.bat`, Linux `open-design-webui.desktop`

After starting, the terminal prints the access URL; when a display is detected, the browser opens automatically. Without a display (server), it only prints the URL.

## Configuration (precedence: command line > webui.config.json > environment variables > default)
- `--port <N>` (default 7456): browser access port
- `--host <ADDR>` (default 127.0.0.1; set `0.0.0.0` to enable remote access)
- `--token <T>`: protects the daemon `/api` (programmatic clients use `Authorization: Bearer <T>`)
- `--no-open`: do not open the browser automatically
- `--config <PATH>`: specify a config file

Write the keys above into a `webui.config.json` next to this script to persist them.

## Security note
When remote access is enabled (`host=0.0.0.0`), the token only protects programmatic clients connecting directly to the daemon API; **the Web UI itself performs no application-level authentication**. To protect a remote Web UI, place a reverse proxy in front (nginx/caddy basic-auth) or use VPN / network isolation.
```

- [ ] **Step 5: Expose the resources directory**

Modify `tools/pack/src/resources.ts`, appending an export after the `resourcesRoot` definition:

```typescript
export const webuiResourcesRoot = join(resourcesRoot, "webui");
```

- [ ] **Step 6: Commit**

```bash
chmod +x tools/pack/resources/webui/open-design.sh tools/pack/resources/webui/launch-mac.command
git add tools/pack/resources/webui tools/pack/src/resources.ts
git commit -m "feat(tools-pack): webui launcher scripts and resource templates"
```

---

### Task 5: webui assembly and compression

**Files:**
- Create: `tools/pack/src/webui.ts`
- Modify: `tools/pack/src/config.ts` (add `arch`)
- Test: `tools/pack/tests/webui.test.ts`

- [ ] **Step 1: First add the arch field and write the pure-function test**

Modify `tools/pack/src/config.ts`: add `arch: ToolPackArch;` to `ToolPackConfig`, plus the definition and parsing:

```typescript
export type ToolPackArch = "x64" | "arm64";

export function resolveToolPackArch(value: unknown): ToolPackArch {
  const v = typeof value === "string" && value.length > 0 ? value : process.arch;
  if (v === "x64" || v === "arm64") return v;
  throw new Error(`unsupported arch: ${String(v)} (expected x64 or arm64)`);
}
```

In the object returned by `resolveToolPackConfig`, add `arch: resolveToolPackArch((options as { arch?: string }).arch)`, and add an optional `arch?: string` to the `ToolPackCliOptions` type.

Create `tools/pack/tests/webui.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  prebuiltSqliteTarget,
  webuiArchiveName,
  webuiArchiveKind,
} from "../src/webui.js";

describe("webuiArchiveName", () => {
  it("names per platform/arch/version", () => {
    expect(webuiArchiveName({ platform: "mac", arch: "arm64", version: "0.8.1" }))
      .toBe("open-design-webui-0.8.1-mac-arm64.zip");
    expect(webuiArchiveName({ platform: "linux", arch: "x64", version: "0.8.1" }))
      .toBe("open-design-webui-0.8.1-linux-x64.tar.gz");
    expect(webuiArchiveName({ platform: "win", arch: "x64", version: "0.8.1" }))
      .toBe("open-design-webui-0.8.1-win-x64.zip");
  });
});

describe("webuiArchiveKind", () => {
  it("linux -> tar.gz, mac/win -> zip", () => {
    expect(webuiArchiveKind("linux")).toBe("tar.gz");
    expect(webuiArchiveKind("mac")).toBe("zip");
    expect(webuiArchiveKind("win")).toBe("zip");
  });
});

describe("prebuiltSqliteTarget", () => {
  it("maps tools-pack platform/arch to prebuild-install napi target", () => {
    expect(prebuiltSqliteTarget("mac", "arm64")).toEqual({ platform: "darwin", arch: "arm64" });
    expect(prebuiltSqliteTarget("win", "x64")).toEqual({ platform: "win32", arch: "x64" });
    expect(prebuiltSqliteTarget("linux", "x64")).toEqual({ platform: "linux", arch: "x64" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @open-design/tools-pack test -- tests/webui.test.ts`
Expected: FAIL — `../src/webui.js` does not exist.

- [ ] **Step 3: Write the pure-function part of the implementation**

Create `tools/pack/src/webui.ts` (put the pure functions first; the assembly functions are completed in the next step):

```typescript
import { execFile } from "node:child_process";
import { cp, mkdir, rm, stat, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackArch, ToolPackConfig, ToolPackPlatform } from "./config.js";
import { webuiResourcesRoot } from "./resources.js";

const execFileAsync = promisify(execFile);

export type WebuiArchiveKind = "zip" | "tar.gz";

export function webuiArchiveKind(platform: ToolPackPlatform): WebuiArchiveKind {
  return platform === "linux" ? "tar.gz" : "zip";
}

export function webuiArchiveName(input: {
  platform: ToolPackPlatform;
  arch: ToolPackArch;
  version: string;
}): string {
  const ext = webuiArchiveKind(input.platform);
  return `open-design-webui-${input.version}-${input.platform}-${input.arch}.${ext}`;
}

export function prebuiltSqliteTarget(
  platform: ToolPackPlatform,
  arch: ToolPackArch,
): { platform: "darwin" | "linux" | "win32"; arch: ToolPackArch } {
  const map = { mac: "darwin", linux: "linux", win: "win32" } as const;
  return { platform: map[platform], arch };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @open-design/tools-pack test -- tests/webui.test.ts`
Expected: PASS.

- [ ] **Step 5: Complete the assembly and compression functions**

Append to `tools/pack/src/webui.ts` (depends on the Part 1 artifacts and the existing workspace build / assembly conventions; reuse the `writeAssembledApp` approach from `linux.ts`, but write it as a webui-specific inline implementation to keep single responsibility):

```typescript
export type WebuiBuildResult = {
  platform: ToolPackPlatform;
  arch: ToolPackArch;
  archivePath: string;
  stageRoot: string;
};

/**
 * Install the target platform's better-sqlite3 prebuilt binary into the already-installed node_modules.
 * Requires a prebuild on npm for the supported os/arch; fails loudly on error (no silent skip).
 */
export async function installPrebuiltSqlite(
  appRoot: string,
  platform: ToolPackPlatform,
  arch: ToolPackArch,
): Promise<void> {
  const target = prebuiltSqliteTarget(platform, arch);
  const sqliteDir = join(appRoot, "node_modules", "better-sqlite3");
  const prebuildInstall = join(sqliteDir, "node_modules", ".bin", "prebuild-install");
  try {
    await execFileAsync(
      process.execPath,
      [prebuildInstall, "--platform", target.platform, "--arch", target.arch, "--napi"],
      { cwd: sqliteDir },
    );
  } catch (error) {
    throw new Error(
      `failed to fetch better-sqlite3 prebuild for ${target.platform}/${target.arch}: ` +
        `${(error as Error).message}. This os/arch may have no prebuilt package.`,
    );
  }
}

export async function createWebuiArchive(
  stageRoot: string,
  archivePath: string,
  kind: WebuiArchiveKind,
  sevenZipExe: string | null,
): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  await rm(archivePath, { force: true });
  if (kind === "tar.gz") {
    await execFileAsync("tar", ["-czf", archivePath, "-C", stageRoot, "."]);
  } else if (sevenZipExe != null) {
    await execFileAsync(sevenZipExe, ["a", "-tzip", "-mx=5", archivePath, "./*"], { cwd: stageRoot });
  } else {
    // mac: use the system zip
    await execFileAsync("zip", ["-r", "-q", archivePath, "."], { cwd: stageRoot });
  }
  await stat(archivePath);
}
```

- [ ] **Step 6: Extract the shared assembly primitives (prerequisite refactor)**

`buildPackedWebui` reuses the assembly logic of `linux.ts`, but these primitives are currently private to `linux.ts` and coupled to `LinuxPaths`: `INTERNAL_PACKAGES`, `PackedTarballInfo`, `collectWorkspaceTarballs` (`linux.ts:428-447`), `readPackagedVersion` (`384`), `copyResourceTree` (`449`, including the `bin/node` copy), and `writeAssembledApp` (`468-525`, which writes the Electron `preload.cjs`/`main.cjs` + `package.json` + production install).

Create `tools/pack/src/assemble.ts`, move the above primitives into it, and change them to accept **raw path parameters** instead of `LinuxPaths`. Target signatures:

```typescript
export type PackedTarballInfo = { fileName: string; packageName: string };
export const INTERNAL_PACKAGES: ReadonlyArray<{ directory: string; name: string }>; // migrated verbatim from linux.ts

export async function collectWorkspaceTarballs(config: ToolPackConfig, tarballsRoot: string): Promise<PackedTarballInfo[]>;
export async function readPackagedVersion(config: ToolPackConfig): Promise<string>;
export async function copyResourceTree(config: ToolPackConfig, resourceRoot: string): Promise<void>;

/** assembleNodeApp: assemble an app directory that node can run directly (without Electron preload/main). */
export async function assembleNodeApp(input: {
  config: ToolPackConfig;
  appRoot: string;
  tarballsRoot: string;
  packed: PackedTarballInfo[];
}): Promise<void>; // writes package.json(file: deps) + main.cjs stub + runProductionInstall(appRoot)
```

Change `linux.ts` to import these symbols from `assemble.ts` (delete its local definitions; have `writeAssembledApp` internally call `assembleNodeApp` and itself additionally write `preload.cjs`/the Electron `open-design-config.json`, keeping linux behavior unchanged).

Run the linux assembly regression: `pnpm --filter @open-design/tools-pack test`, confirming the existing linux cases are still green (diff against baseline: first `git stash` to check whether main already has failures).

- [ ] **Step 7: Implement buildPackedWebui**

Append to `tools/pack/src/webui.ts` (calling the primitives extracted in Step 6):

```typescript
import {
  assembleNodeApp,
  collectWorkspaceTarballs,
  copyResourceTree,
  readPackagedVersion,
} from "./assemble.js";
import { webuiResourcesRoot } from "./resources.js";
import { winResources } from "./resources.js"; // reuse 7z

export async function buildPackedWebui(config: ToolPackConfig): Promise<WebuiBuildResult> {
  const platform = config.platform;
  const arch = config.arch;
  const version = await readPackagedVersion(config);

  // 1) Ensure the workspace build artifacts (web + daemon dist + packaged dist) are ready.
  //    Reuse packLinux's ensureWorkspaceBuildArtifacts call shape (see packLinux starting at linux.ts:616).
  //    webui is fixed to server mode (config.webOutputMode is already overridden to "server" at the Task 6 command layer).

  const stageRoot = join(config.roots.output.namespaceRoot, "webui", `${platform}-${arch}`, "stage");
  const appRoot = join(stageRoot, "app");
  const resourceRoot = join(appRoot, "resources", "open-design");
  await rm(stageRoot, { force: true, recursive: true });
  await mkdir(appRoot, { recursive: true });

  // 2) Assemble the node app + production install.
  const tarballsRoot = join(config.roots.output.namespaceRoot, "webui", `${platform}-${arch}`, "tarballs");
  const packed = await collectWorkspaceTarballs(config, tarballsRoot);
  await assembleNodeApp({ config, appRoot, tarballsRoot, packed });

  // 3) Resource tree + bundled node (webui requires system node, so do not copy bin/node; copy only resources like skills).
  await copyResourceTree(config, resourceRoot);

  // 4) Target-platform better-sqlite3 prebuild.
  await installPrebuiltSqlite(appRoot, platform, arch);

  // 5) Copy the webui launcher scripts / double-click wrappers / example config / README into stageRoot.
  for (const name of [
    "open-design.sh",
    "open-design.cmd",
    "webui.config.example.json",
    "README.md",
  ]) {
    await cp(join(webuiResourcesRoot, name), join(stageRoot, name));
  }
  await chmod(join(stageRoot, "open-design.sh"), 0o755);
  if (platform === "mac") {
    await cp(join(webuiResourcesRoot, "launch-mac.command"), join(stageRoot, "Open Design WebUI.command"));
    await chmod(join(stageRoot, "Open Design WebUI.command"), 0o755);
  } else if (platform === "win") {
    await cp(join(webuiResourcesRoot, "launch-win.bat"), join(stageRoot, "Open Design WebUI.bat"));
  } else {
    await cp(join(webuiResourcesRoot, "open-design-webui.desktop"), join(stageRoot, "open-design-webui.desktop"));
  }

  // 6) Archive.
  const kind = webuiArchiveKind(platform);
  const archivePath = join(config.roots.output.platformRoot, webuiArchiveName({ platform, arch, version }));
  const sevenZip = platform === "win" ? winResources.sevenZipExe : null;
  await createWebuiArchive(stageRoot, archivePath, kind, sevenZip);

  return { platform, arch, archivePath, stageRoot };
}
```

> Execution notes: `copyResourceTree` currently copies `bin/node` (see `linux.ts:457-460`). webui requires system node and should not bundle node. When extracting in Step 6, add an `includeNodeBinary` parameter to `copyResourceTree` (default true to keep linux behavior; webui passes false). Whether `winResources` is already exported from `resources.ts` must be confirmed at execution time (see `winResources` in `resources.ts`); if it is not exported, add the `export`. The exact call shape of `ensureWorkspaceBuildArtifacts` in step 1 takes `packLinux` (`linux.ts:616`) as the template.

- [ ] **Step 8: typecheck + linux regression**

Run:
```bash
pnpm --filter @open-design/tools-pack typecheck
pnpm --filter @open-design/tools-pack test
```
Expected: Passes; the linux-assembly-related cases are still green.

- [ ] **Step 9: Commit**

```bash
git add tools/pack/src/webui.ts tools/pack/src/assemble.ts tools/pack/src/linux.ts tools/pack/src/config.ts tools/pack/src/resources.ts tools/pack/tests/webui.test.ts
git commit -m "feat(tools-pack): webui assembly, better-sqlite3 prebuild selection, and archiving"
```

---

### Task 6: Register the tools-pack webui command

**Files:**
- Modify: `tools/pack/src/index.ts`

- [ ] **Step 1: Register the command**

Modify `tools/pack/src/index.ts`: import `buildPackedWebui` and `webuiArchiveName`, and add a new registration block modeled on the mac command (the `--arch` option is added via a separate `.option` outside `addSharedOptions`):

```typescript
addSharedOptions(
  cli
    .command("webui <action>", "WebUI packaging commands: build")
    .option("--arch <arch>", "Target arch: x64|arm64 (default: host arch)"),
).action(async (action: string, options: CliOptions) => {
  const platform = options.to as ToolPackPlatform; // --to mac|win|linux
  // The webui dual-process pair uniformly uses server mode (consistent with the existing Linux headless path, verified to run);
  // override the per-platform defaults to avoid the inconsistency of mac/win falling to standalone while linux falls to server.
  const config = { ...resolveToolPackConfig(platform, options), webOutputMode: "server" as const };
  switch (action) {
    case "build":
      printJson(await buildPackedWebui(config));
      return;
    default:
      throw new Error(`unknown webui action: ${action} (expected build)`);
  }
});
```

> If the existing `--to` value validation does not accept `mac|win|linux` as a platform selector, instead add a new `--platform <mac|win|linux>` option and call `resolveToolPackConfig` based on it. At execution time, first read `resolveToolPackBuildOutput` and the `ToolPackPlatform` values in `tools/pack/src/config.ts` to confirm.

- [ ] **Step 2: typecheck + build**

Run:
```bash
pnpm --filter @open-design/tools-pack typecheck
pnpm --filter @open-design/tools-pack build
```
Expected: Passes.

- [ ] **Step 3: Commit**

```bash
git add tools/pack/src/index.ts
git commit -m "feat(tools-pack): register the webui build command"
```

---

### Task 7: End-to-end smoke test and documentation

**Files:**
- Modify: `tools/pack/AGENTS.md`
- (verification) No new source files

- [ ] **Step 1: Actually run a build for the host platform once**

Run (example on a Linux host):
```bash
pnpm install
pnpm tools-pack webui build --to linux --arch x64 --json
```
Expected: The output JSON contains `archivePath` pointing to `open-design-webui-<ver>-linux-x64.tar.gz`, and the file exists.

- [ ] **Step 2: Extract and run end-to-end start/status/stop**

Run:
```bash
WORK=$(mktemp -d)
tar -xzf <archivePath> -C "$WORK"
"$WORK/open-design.sh" start --port 7466 --no-open --json &
sleep 8
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7466   # expect 200
"$WORK/open-design.sh" status --json                                # expect running + url
"$WORK/open-design.sh" stop --json                                  # expect stopped
```
Expected: HTTP 200; status reports running; the process exits after stop.
If it fails: check `~/.local/share/open-design/namespaces/<ns>/logs/desktop/latest.log`.

- [ ] **Step 3: Manually verify the remote token behavior**

Run:
```bash
"$WORK/open-design.sh" start --host 0.0.0.0 --port 7467 --no-open &
sleep 8
# terminal should print "token generated automatically"
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7467/api/version        # loopback exemption -> 200
curl -fsS -o /dev/null -w "%{http_code}\n" http://<lan-ip>:7467/api/version          # non-loopback without token -> 401
"$WORK/open-design.sh" stop
```
Expected: Loopback 200, non-loopback 401 (verifying the token semantics in §3).

- [ ] **Step 4: Update AGENTS.md**

Modify the "Owns" list in `tools/pack/AGENTS.md` to append a line:

```markdown
- Cross-platform WebUI (no-Electron) build via `tools-pack webui build --to <mac|win|linux> [--arch]`; terminal launcher with start/stop/status, configurable port/host/token, browser auto-open when a display is present.
```

- [ ] **Step 5: guard + full typecheck**

Run:
```bash
pnpm guard
pnpm typecheck
```
Expected: Passes.

- [ ] **Step 6: Commit**

```bash
git add tools/pack/AGENTS.md
git commit -m "docs(tools-pack): document the webui packaging subcommand"
```

---

## Validation matrix (wrap-up)

```bash
pnpm --filter @open-design/packaged test
pnpm --filter @open-design/packaged typecheck
pnpm --filter @open-design/tools-pack test
pnpm --filter @open-design/tools-pack typecheck
pnpm guard
pnpm typecheck
```

Cross-platform artifacts (mac/win) must be validated on the corresponding platform — or in an environment that can pull the corresponding `better-sqlite3` prebuild — for the extract → start → stop flow of Task 7.
