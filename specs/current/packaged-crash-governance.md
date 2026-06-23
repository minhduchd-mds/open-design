# 打包态崩溃治理:启动期失败的可观测、可告知与自愈

> 本 spec 按 `powerformer/skills` 的 `spec-battle` 模板撰写,`Sources` 段为反幻觉命门——所有结论均锚到 `file:line`,reviewer 可照此拉源核对。
> **v2(已过一轮 5 镜头对抗评审)**:范围已从"三层一次上"收敛为"切片 A 先行,B/C/D 证据驱动后置";修订明细见末尾「评审与修订记录」。

## 标题

给打包态(Electron + 内嵌 daemon/web sidecar)的 **daemon/web 启动期失败** 这一整类故障,建立崩溃治理三件套:**可告知**(静默退出 → 可操作错误对话框)、**可观测**(主进程直连遥测,补当前盲区)、**自愈/韧性**(关键依赖完整性自检 + 崩溃循环识别)。**实现以切片 A(可告知)先行**,B(可观测)/C(自愈)以 A 上线后的遥测与复发证据为触发条件,而非一次性铺开。受众是全体打包态用户,先解决 macOS,Windows/Linux 同构跟进。

## Why · 为什么要做

- **用例**:issue #4638(macOS 27 Beta,Mac mini M4,stable 0.11.0)用户报"打开就崩,Console 无任何日志"。逐条核对用户上传的三份日志后发现:这是一类**我们既看不见、又没告诉用户、还无法自愈**的故障,而 issue 串里的人工排查给出了 5 个互相矛盾且被日志证伪的"根因",最终停在"macOS 定时删文件"这个无机制支撑的结论上——说明缺的不是某一次定位,而是**这一整类故障的治理框架**。
- **痛点(三条都是真账,各有证据)**:
  1. **用户零反馈(用户痛点,最痛且唯一确证)**:daemon 启动失败时主进程直接 `process.exit(1)`,**无窗口、无对话框、无 crash report**(`apps/packaged/src/index.ts:227-238` 只对 `PackagedPathAccessError` 弹窗)。用户只能把"闪一下没了"描述成"crash",排查全靠来回问。
  2. **可观测盲区(技术债)**:daemon 是 PostHog client 的宿主;daemon 起不来时 daemon/web 都不在,**整个崩溃产生 0 条遥测**。这类故障在任何看板都查不到,只能等用户手动开 issue(#4638 即如此)。证据目前是 N=1,故作为 B 的触发由 A 的遥测驱动。
  3. **零韧性(技术债)**:单个 external native 模块(`better-sqlite3`)缺失,就让 daemon 崩在一句晦涩的 `ERR_MODULE_NOT_FOUND`,应用无运行期完整性自检,反复重启反复同样崩(用户日志 14 连崩)。

## Sources · 事实源(必填,reviewer 照此核对)

- **Repo**:`nexu-io/open-design`(本仓)。
- **分支 / base commit**:`main` @ `c5ec410fd31a9f87bc370b015ea25affece0019d`。
- **如何拉取**:
  ```
  git clone https://github.com/nexu-io/open-design && cd open-design
  git checkout c5ec410fd31a9f87bc370b015ea25affece0019d
  ```
- **关键代码位置**(reviewer 直接跳过去):
  - `apps/packaged/src/index.ts:227-238` —— 顶层 `void main().catch`。**只有** `error instanceof PackagedPathAccessError` 才 `dialog.showErrorBox`(`:228-234`);其余任何错误只 `logger.error` + `console.error` + `process.exit(1)`(`:235-237`)。这是"静默退出"的根。
  - `apps/packaged/src/index.ts:17` —— `import { app, dialog } from "electron"` 在**模块顶层**;且 `:227` 是顶层 `void main()`——**一旦该模块被 import 即执行整条启动链**。这是切片 A 可测性的拦路石(见 Proposed design 层 1 与 Validation)。
  - `apps/packaged/src/sidecars.ts:185-211` —— `waitForStatus`;子进程在报状态前退出时抛 `daemon exited before reporting status (code=…, signal=…); see <logPath> for details`(`:206-208`)。**报错文本硬编码 "daemon"**,而 web 段(`:595-601`)复用同一函数,故 web 失败也抛 "daemon" 字样 → 仅凭错误文本无法区分 daemon-start vs web-start。
  - `apps/packaged/src/sidecars.ts:380-410` —— `POSTHOG_KEY` / `POSTHOG_HOST` / `OPEN_DESIGN_TELEMETRY_RELAY_URL` **仅作为 env 转发给 daemon/web 子进程**,主进程自身不上报任何事件 → 启动期崩溃的遥测盲区根因。
  - `apps/packaged/src/index.ts:144-146` & `:215-223` —— 主进程已持有 `posthogKey/posthogHost`(传给 update/sidecar),即"直连上报"所需材料已在手。
  - `apps/packaged/src/paths.ts:28-30,:106-123` —— `namespaceRoot` / `runtimeRoot`;packaged 运行态文件的合法落点(崩溃计数文件应落此,**非** daemon 数据根)。
  - `apps/packaged/tests/sidecars.test.ts:444-541` —— `waitForStatus child-exit fast-fail` 既有测试,已断言 `/daemon exited before reporting status/`。这是崩溃路径既有可测 seam;但**无任何测试 import `index.ts`**(顶层 `void main()` 一 import 即跑)。
  - `apps/daemon/src/analytics.ts:118-143,:232-233` —— `captureSafety`:一条**故意旁路用户 consent** 的稳定性事件通道,注释明确"No consent re-check here — that's the entire point",且要求 Settings → Privacy 同意文案写明这条旁路。主进程直连上报必须归入此政策。
  - `apps/web/src/analytics/scrub.ts:65-80` —— `scrubFilePath` 正则 `(?:file:\/\/)?[^()\n]*?\/((?:apps|packages|tools)\/[^\s)]+)`:**只重写含 `apps/`/`packages/`/`tools/` 段的路径**。已 `node` 实跑验证:对 #4638 的 `…/Open Design.app/Contents/Resources/app/…` 与 `/Users/<name>/Library/Application Support/…` **原样穿透不脱敏**。且 `apps/packaged/**` 不得 import `apps/web/src/**`(AGENTS 边界)。
  - `apps/daemon/src/redact.ts:146` —— `redactSecrets`;现有脱敏实现,但在 daemon src 内,packaged 不可直接 import(若要共享须提升为 pure package)。
  - `packages/contracts/src/analytics/events.ts:20` —— `AnalyticsEventName` typed union(`*_result` 家族);新事件名必须在此注册,不得让 packaged 另立命名。
  - `tools/pack/src/mac/app.ts:201-211` —— `validateMacNativeRebuildOutput`:**已存在的 build 期 native 校验**,`stat` `better_sqlite3.node` 且查 `size < 100_000`。层 3 运行期自检应对齐此启发式(检 `.node` 文件 + size),而非只检 `package.json` 是否存在。
  - `apps/desktop/src/main/updater.ts:1338-1352` —— launcher runtime 持久化 `active` + `lastSuccessful`(带 `generation`):现成的"上一个已知良好版本"回滚锚点。**边界**:仅 payload-launcher 模式有;DMG 拖装(#4638 即 `source: current-package`)无 launcher runtime,不适用。
  - `tools/pack/src/mac/builder.ts:95-129` —— mac 签名/公证:`hardenedRuntime: config.signed`(`:126`)、`gatekeeperAssess:false`(`:125`)、`afterSign`/`notarize`(`:95,:129`)。决定 native 模块是否被签名覆盖(缺陷 C 验证入口)。
  - `tools/pack/src/mac/constants.ts:26` —— `ELECTRON_BUILDER_ASAR = false`;bundle 内是裸文件布局,故 electron-builder 的 `asarIntegrity` 防删能力天然不适用(见 Alternatives)。
  - `tools/pack/src/{mac,win}/constants.ts` —— `ELECTRON_REBUILD_NATIVE_MODULES: ["better-sqlite3"]`;**better-sqlite3 是当前唯一 external 原生模块**,即完整性自检白名单的天然种子。
- **用户日志证据**(issue #4638 附件,已下载核对):
  - desktop `latest.log`:`06-21 16:35` 启动正常、`06-22 04:53` 干净退出(code 0);`06-22 15:55` 起每次启动 ~500ms 后 `daemon exited before reporting status (code=1, signal=none)`,14 连崩。updater 全程**只有** `check-not-available` / `metadata-unreachable`,**无任何 download/payload/install**。
  - daemon `latest.log`:`ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3' imported from /Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/chunks/server-PULTSXNL.mjs`。
  - 推论(由时间线锁定):`better-sqlite3` 消失发生在 **OD 完全没运行的 ~11h 空窗**(04:53 退出 → 15:55 再开),且 updater 全程未动 → **删除非 OD 运行时、非 OD 更新器所为**,系 OD 之外因素(第三方清理/杀软或 OS Beta 行为,无证据指向具体某个;"OS 定时进 /Applications 精准删单个 native 模块目录"无已知机制支撑)。
- **相关材料**:issue #4638;关联 issue #4441(Nightly 残留 IPC 引发启动崩溃,同族);`tools/pack/AGENTS.md` "Packaged auto-update architecture"; `AGENTS.md` "Daemon data directory contract"(数据/运行文件落点真相源)。
- **访问前提**:读源码无需特殊权限;核对线上遥测需 PostHog OpenDesign 项目;核对线上 stable 包签名需下载公开 DMG 跑 `codesign -dv --verbose=4` / `spctl -a`。

## Goals / Non-goals · 要做 / 明确不做

**Goals**

1. **可告知(切片 A,本 spec 主交付)**:任何启动失败都给用户确定性、可操作的错误对话框(原因 + daemon/web 日志路径 + 下一步建议),取代静默 `exit(1)`。
2. **可观测(切片 B,证据驱动)**:主进程在 daemon/web 启动失败时,即使 sidecar 从未起来,也能上报一条结构化遥测事件(含**可区分的** `failureKind`、退出码、从对应日志尾抓到的真实错误码与缺失模块名、版本/平台/namespace),离线不阻塞、隐私合规、归入既有 consent 旁路政策。
3. **自愈/韧性(切片 C,证据驱动)**:启动期对"关键 external native 依赖"做完整性自检(对齐已有 build 期 `.node`+size 启发式),缺失时给出明确归类与可操作引导。
4. 三件套对 macOS / Windows / Linux 同构(实现可分平台切片)。

**Non-goals**

- **不**承诺阻止外部进程(杀软 / OS / 用户)删除 bundle 内文件——不在我们控制面内;本 spec 治理"被删之后如何看见、告知、恢复"。
- **不**在本 spec 内改 auto-updater 行为(日志已证更新器与本故障无关)。
- **不预建**崩溃循环计数与机器标识:它们是为"尚未实现、阈值未定的自动恢复"预留的状态,属 YAGNI;对话框文案对所有启动失败一视同仁即可,区分"首崩/连崩"交给遥测看板按 (version) 聚合。若将来自动恢复立项,届时再引入持久化状态(见 Open questions)。
- **不**改 daemon 数据目录契约 / 不新增数据根。
- **不**做运行期(daemon 已起来后)崩溃治理——那已有 daemon/web 侧 PostHog 覆盖;本 spec 专攻**启动期(pre-daemon)盲区**。

## Proposed design · 方案

三层均落在 `apps/packaged`(主进程),与 daemon 解耦,因为故障前提就是"daemon 不在"。

### 层 1 — 可告知(切片 A,先行)

**前置重构(可测性拦路石,必须先做)**:`index.ts` 当前在模块顶层 import `dialog`(`:17`)且底部 `void main()`(`:227`),任何测试一 import 即 boot。切片 A 须:(a) 把 `void main()` 移出模块顶层(独立 entry,或 import guard),(b) 把 catch 体抽成导出的纯函数 `handleStartupFailure(error, deps)`,`deps` 含注入的 `dialog`。

改后:所有启动失败都经 `handleStartupFailure` 产出 `{ title, message, detail, logPath }` 并 `dialog.showErrorBox`。`PackagedPathAccessError` 保留专有文案(回归守护);daemon/web-start 失败给"关键组件缺失/安装可能损坏 + 对应日志路径 + 重装建议";未知错误给兜底。对话框失败(无 GUI)回落 console + exit。

**结构化失败信息(供层 1/2 共用)**:扩展 `waitForStatus` 的 watch 入参,携带 `{ app: 'daemon'|'web', logPath }`,使其抛出结构化 `StartupFailure { kind, code, signal, logPath }`,而非靠解析硬编码 "daemon" 文本。层 1 的文案与层 2 的 `failureKind`、读哪个日志都从该结构取——这同时修掉 web/daemon 误归类。

### 层 2 — 可观测(切片 B,证据驱动)

新增 `apps/packaged/src/startup-telemetry.ts`:不依赖 daemon 的最小 capture。

- **注入式传输**:capture 接受注入的 transport(`fetch`/`request`),不在实现里硬 `import https`——保证可测(见 Validation)。
- **新事件**:名字进 `packages/contracts/src/analytics/events.ts` 的 typed union(候选 `packaged_runtime_failed`,见 Open questions);字段 `failureKind`(`daemon-start`/`web-start`/`path-access`/`unknown`,取自层 1 结构)、`exitCode`、`signal`、`errorName`、`missingModule`、`errorCode`、`appVersion`、`namespace`、`source`、`platform`、`osVersion`。
- **纯函数 `readDaemonLogTail(logText)`**:吃日志字符串、吐 `{ errorCode, missingModule }`(正则提取 `ERR_[A-Z_]+`、`Cannot find package '(.+?)'`)。无依赖、可直接喂 #4638 日志原文——是本层最便宜的可测核心。
- **consent 政策对齐(blocking)**:主进程读不到 daemon 的同意态(daemon 不在),故直连**必然**旁路 consent。须显式将本事件归入 `apps/daemon/src/analytics.ts:232` 的 `captureSafety` 旁路政策,并把"打包态启动崩溃即使关闭遥测也会上报"补进 Settings → Privacy 文案。无 `posthogKey`(fork 构建)时整体 no-op。
- **脱敏(blocking)**:现有 `scrubFilePath`(`scrub.ts:77`)对本场景路径**实测不生效**,且 packaged 不可 import web。须**自带 packaged 侧 scrub**,正则覆盖 install-root(`…/Open Design.app/…`)与 `/Users/<name>/`、`Application Support` 路径;首选把 `redactSecrets`/scrub 提升为 pure package 共享而非第三份实现。
- **工程纪律**:catch 改 `async`,`await Promise.race([capture(), timeout(1500ms)])` 后再 `process.exit`——显式接受"最坏多等 1.5s 退出"(崩溃场景可接受),换取离线/慢网下不丢事件;capture 自身失败静默。

### 层 3 — 自愈/韧性(切片 C,证据驱动)

- **完整性自检**:启动 daemon **前**,对 `ELECTRON_REBUILD_NATIVE_MODULES`(当前 `["better-sqlite3"]`)**对齐 `tools/pack/src/mac/app.ts:201-211` 的启发式**——检 `build/Release/<mod>.node` 是否存在且 `size ≥ 100_000`,而非只检 `package.json`(后者会漏判"package.json 在、`.node` 没了")。缺失/过小 → 直接产出归类清晰的 `DaemonDependencyMissingError(missingModule)`,驱动层 1 文案 + 层 2 事件,无需等 daemon 抛裸 `ERR_MODULE_NOT_FOUND`。
- **崩溃循环识别(若实现)**:如需区分连崩,计数文件落 `paths.runtimeRoot`/`namespaceRoot`(packaged 运行态,合法),**非** daemon `dataRoot`;原子写(temp + `rename`);解析失败 fail-safe 归 0;整层包 try/catch,**写计数本身绝不能成为新的启动失败源**。默认 Non-goals 不预建此状态,除非自动恢复立项。

### 缺陷 C / 加固(独立校验,不混入实现 PR)

核对**线上 stable 0.11.0 DMG** 是否真签名+公证、且 `better_sqlite3.node` 被 bundle 签名覆盖(`codesign -dv --verbose=4`、`spctl -a`、`codesign --verify --deep`)。若未覆盖,native addon 被安全工具误删概率更高 → 归打包加固跟进,与三件套解耦。

## Alternatives considered · 备选方案

- **把 better-sqlite3 打进 esbuild chunk(不再 external)**:native `.node` 无法被 JS bundler 内联,`ELECTRON_REBUILD_NATIVE_MODULES` 的存在即因其必须按 ABI 重编。否决。
- **改用 Node 内置 `node:sqlite` 消除 native 模块这一整类脆弱性**:🟡 上游稳定度/ABI 取舍本机未核实;值得作为"治本"方向单独评估,但范围远超本 spec。记为后续调研。
- **复用 daemon/web 侧 PostHog 上报**:故障前提是 daemon 不在,这条路径天然失效——正是盲区本身。必须主进程直连。
- **经 `OPEN_DESIGN_TELEMETRY_RELAY_URL` relay**:relay 也由 sidecar 承载,daemon 不在时同样不可达。否决。
- **退避重启 daemon**:`better-sqlite3` 缺失是确定性失败,重试只复现同样崩(14 连崩即证)。重试只对瞬时故障有意义,故先完整性自检归类。
- **复用 launcher `lastSuccessful` 做连崩自动回退**(`updater.ts:1338-1352`):现成"上一个已知良好版本"锚点,与崩溃循环计数天然可组合成"连崩 N 次 → 回退 lastSuccessful payload"。**但**仅 payload-launcher 模式可用,DMG 拖装(#4638 即是)无 launcher runtime → 对本 case 不适用。记为"自动恢复立项时优先考虑的复用点"。
- **Electron `crashReporter` 作为 native-crash 补充通道**:不能替代层 2(#4638 是受控 `exit(1)` 非 native crash,抓不到),但 #4441(IPC 残留崩溃)与未来真 ABI segfault 是其甜区。作为**补充**通道取舍待评,不一票否决。
- **Sentry**:🟢 全仓无 `crashReporter`/Sentry 依赖,PostHog 已是既有遥测面,直连成本最低;引入 Sentry 是新依赖+新后端。否决。
- **electron-builder `asarIntegrity` 防删**:🟢 本仓 `ELECTRON_BUILDER_ASAR=false`(`constants.ts:26`,裸文件布局),asarIntegrity 天然不适用;🟡 其上游语义未核实。这正是支持"不靠 asar 完整性"的论据。

## Risks & mitigations · 风险与缓解

- **privacy / security(blocking 级)**:① 直连绕过 opt-out → 显式归入 `captureSafety` 旁路政策 + 更新隐私文案;② 现有 scrub 对本场景路径不生效 → 自带 packaged 侧 scrub + 红 spec 断言 payload 不含 `/Users/`;③ fork 无 key 全程 no-op。
- **observability flush vs exit 竞态**:`await Promise.race([capture, timeout(1500)])` 后再 exit;capture 失败静默,绝不让上报拖垮退出。
- **compatibility**:`PackagedPathAccessError` 专有文案/行为不回归 → 层 1 分发函数 + 回归断言。
- **data-dir 契约**:崩溃计数(若做)落 `runtimeRoot` 非 daemon `dataRoot`;不新增数据根。
- **韧性反噬**:层 3 自检/计数失败本身不得成为新崩溃源 → 全程 try/catch + fail-safe。
- **误归类**:web/daemon 失败靠结构化 `kind` 区分,不靠解析 "daemon" 文本。
- **platform skew**:对话框无 GUI 回落 console;日志尾读取走结构化 `logPath`,文件缺失/占用/超大时降级。
- **测试缺口**:见 Validation,先红后绿覆盖三层主路径。

## Rollout / migration / rollback · 上线与回滚

- 无数据迁移(层 3 计数小文件默认不建;若建,缺失即视为 0)。
- 切片 A 随常规 beta→stable 通道发布;B/C 待 A 的遥测/复发证据再排期;Windows/Linux 切片跟进。
- 回滚:纯主进程逻辑,无 schema/契约变更(事件名进 typed union 属新增);回滚即还原 `index.ts` 与移除新模块,无残留状态。
- 新遥测事件名一次定稿,避免看板断裂。

## Validation · 验收标准(behavior-level,先红后绿)

- **层 1(切片 A)**:前置重构后,`handleStartupFailure(new Error("daemon exited before reporting status (code=1…); see /…/daemon/latest.log …"), { dialog })` → 断言 `dialog.showErrorBox` 调用一次、第二参含 logPath 子串;并保留一条 `PackagedPathAccessError` 仍走专有文案的回归断言。
  - **措辞更正**:重构前**不存在"会失败的现有测试",而是测试根本写不出**(顶层 `void main()` + 顶层 `dialog` import 一 import 即 boot)。"先红"的前提是先完成前置重构;这是切片 A 的真实成本,不是已有红测。测试层 = `apps/packaged/tests/index-startup-failure.test.ts`,沿用既有 `vi.mock("electron")` 风格。
- **层 2(切片 B,拆两条独立验收)**:
  - (a) `readDaemonLogTail(logText)` 纯函数:喂 #4638 真实日志原文,断言 `errorCode==="ERR_MODULE_NOT_FOUND"` && `missingModule==="better-sqlite3"`(无 mock)。
  - (b) capture:注入假 transport,断言失败时 POST 出一条事件且字段正确;无 `posthogKey` 时断言零请求。
  - (c) 脱敏红 spec:喂 #4638 日志行,断言最终 payload **不含** `/Users/` 与真实 app bundle 绝对路径。
- **层 3(切片 C)**:构造缺 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`(及 size 过小)的临时 resource root 夹具(沿用 `launch.test.ts` 的 `mkdtempSync` 风格),断言 daemon 启动前抛 `DaemonDependencyMissingError(missingModule="better-sqlite3")`,不再让 daemon 抛裸 `ERR_MODULE_NOT_FOUND`。计数落盘验收待路径/schema 定稿(默认不实现)。
- **端到端(人工验收,可选)**:`pnpm tools-pack mac build` 出包后 `rm -rf "…/Resources/app/node_modules/better-sqlite3"` 再开 → 应弹错误对话框(而非静默消失)。复现 #4638,作人眼验收,非自动验收替身。
- 既有 `apps/packaged/tests/sidecars.test.ts:444-541` 保持绿(不回归 `waitForStatus` 语义)。

## Implementation slices · 实现切片

1. **切片 A(先行,独立上线)**:层 1 前置重构(`void main()` 移出顶层 + `handleStartupFailure` 注入 dialog)+ 结构化 `StartupFailure{kind,…}` + daemon/web 文案 + 红 spec。**仅 A 即消灭用户最痛的"零反馈"。**
2. **切片 B(证据驱动)**:`startup-telemetry.ts`(注入式 transport)+ `readDaemonLogTail` 纯函数 + packaged 侧 scrub(或提升共享)+ consent 旁路对齐 + 隐私文案 + 事件名进 typed union。触发条件:A 上线后遥测/复发证据。
3. **切片 C(证据驱动)**:启动前完整性自检(对齐 `.node`+size 启发式)→ `DaemonDependencyMissingError`。崩溃循环计数默认不做。
4. **切片 D(打包加固,独立)**:缺陷 C 签名/公证核验结论,按需补 mac 打包对 native addon 的签名覆盖。

每片可独立验证、独立发布。

## Open questions · 待解问题

1. 遥测事件名:`packaged_runtime_failed`(强调主进程层,能覆盖 web-start/path-access)进 `packages/contracts/src/analytics/events.ts` 的 `*_result` 命名家族时,是否要改成 `…_result` 风格以对齐既有约定?
2. 完整性自检范围:只守 `["better-sqlite3"]`(倾向,最高危),还是扩到 daemon chunk 全部 externals(如 `blake3-wasm`)?后者成本/收益待评。
3. 若将来自动恢复立项:复用 launcher `lastSuccessful` 回退(仅 payload-launcher 模式)+ 崩溃循环计数,阈值 N 与动作(文案升级 / 触发重装引导 / 自动回退)如何定?届时才引入持久化状态与可能的机器标识(并核对隐私约定)。
4. `node:sqlite` 替代 better-sqlite3 以根除 native 脆弱性,是否值得单开调研 spec?
5. 缺陷 C 若核实"线上包 native addon 未被签名覆盖",其优先级是否应高于切片 C(它可能是"被删"概率的真正放大器)?需打包 owner 判断。

---

## 评审与修订记录

**v1 → v2**:经 `spec-battle` 5 镜头对抗评审(边界/简单性/可测/风险安全/替代方案,全部 🟢 实读源码,风险镜头 `node` 实跑脱敏正则)。综合判断"再改(偏重想)",据此修订:

- **范围收敛**(简单性镜头,唯一判"重想"):三层从"一次全上"改为"切片 A 先行,B/C 证据驱动";**删除崩溃循环计数+机器标识的预建**(YAGNI),移入 Non-goals 与 Open questions。
- **可测性拦路石**(可测镜头):新增层 1 前置重构(`void main()` 移出顶层 + `handleStartupFailure` 注入 dialog);**更正 v1"当前断言为红"的错误措辞**——重构前是"无测"而非"红测"。
- **失败可区分**(边界镜头):新增结构化 `StartupFailure{kind,…}`,修 `sidecars.ts:211` 硬编码 "daemon" 导致的 web/daemon 误归类与 `readDaemonLogTail` 读错日志。
- **隐私脱敏**(风险镜头,实跑证):现有 `scrubFilePath` 对本场景路径不生效且不可 import → 层 2 改为自带 packaged 侧 scrub + 脱敏红 spec。
- **consent 政策**(风险镜头):层 2 显式归入 `captureSafety` 旁路 + 更新 Settings→Privacy 文案;事件名进 `packages/contracts` typed union。
- **flush vs exit 竞态**(边界+风险镜头):定死 `await Promise.race([capture, timeout(1500)])` 后再 exit。
- **prior art**(替代方案镜头,已二次对抗核验确认):层 3 自检对齐 `tools/pack/src/mac/app.ts:201-211` 的 `.node`+size 启发式(原方案仅查 package.json,弱于现状);Alternatives 补 launcher `lastSuccessful` 回退取舍(+DMG 无 launcher 边界)、`asarIntegrity` 因 asar=false 不适用、`crashReporter` 改"补充通道取舍"、`node:sqlite` 治本方向。
- **落盘契约**(边界+风险+可测镜头):崩溃计数(若做)落 `runtimeRoot` 非 daemon `dataRoot`,原子写 + fail-safe。
