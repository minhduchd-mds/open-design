# 打包态崩溃治理:启动期失败的可观测、可告知与自愈

> 本 spec 按 `powerformer/skills` 的 `spec-battle` 模板撰写,`Sources` 段为反幻觉命门——所有结论均锚到 `file:line`,reviewer 可照此拉源核对。

## 标题

给打包态(Electron + 内嵌 daemon/web sidecar)的 **daemon 启动失败** 这一整类故障,建立崩溃治理三件套:**可观测**(主进程直连遥测,补上当前盲区)、**可告知**(静默退出 → 可操作错误对话框)、**自愈/韧性**(关键依赖完整性自检 + 崩溃循环识别)。受众是全体打包态用户,先解决 macOS,Windows/Linux 同构跟进。

## Why · 为什么要做

- **用例**:issue #4638(macOS 27 Beta,Mac mini M4,stable 0.11.0)用户报"打开就崩,Console 无任何日志"。逐条核对用户上传的三份日志后发现:这是一类**我们既看不见、又没告诉用户、还无法自愈**的故障,而 issue 串里的人工排查给出了 5 个互相矛盾且被日志证伪的"根因",最终停在"macOS 定时删文件"这个无机制支撑的结论上——说明缺的不是某一次定位,而是**这一整类故障的治理框架**。
- **痛点(三条都是真账,各有证据)**:
  1. **可观测盲区(线上事故 + 技术债)**:daemon 是 PostHog client 的宿主;daemon 起不来时 daemon/web 都不在,**整个崩溃产生 0 条遥测**。所以这类故障在任何看板都查不到,只能等用户手动开 issue 才暴露。#4638 就是这么浮上来的。
  2. **用户零反馈(用户痛点)**:daemon 启动失败时主进程直接 `process.exit(1)`,**无窗口、无对话框、无 crash report**。用户只能把"闪一下没了"描述成"crash",排查全靠来回问。
  3. **零韧性(技术债)**:单个 external native 模块(`better-sqlite3`)缺失,就让 daemon 崩在一句晦涩的 `ERR_MODULE_NOT_FOUND`,应用无任何完整性自检或恢复引导,反复重启反复同样崩(用户日志里 14 连崩)。

## Sources · 事实源(必填,reviewer 照此核对)

- **Repo**:`nexu-io/open-design`(本仓)。
- **分支 / base commit**:`main` @ `c5ec410fd31a9f87bc370b015ea25affece0019d`。
- **如何拉取**:
  ```
  git clone https://github.com/nexu-io/open-design && cd open-design
  git checkout c5ec410fd31a9f87bc370b015ea25affece0019d
  ```
- **关键代码位置**(reviewer 直接跳过去):
  - `apps/packaged/src/index.ts:227-238` —— 顶层 `main().catch`。**只有** `error instanceof PackagedPathAccessError` 才 `dialog.showErrorBox`(`:228-234`);其余任何错误只 `logger.error` + `console.error` + `process.exit(1)`(`:235-237`)。这是"静默退出"的根。
  - `apps/packaged/src/sidecars.ts:185-211` —— `waitForStatus`;子进程在报状态前退出时抛 `daemon exited before reporting status (code=…, signal=…); see <logPath> for details`(`:206-208`)。这个错**不是** `PackagedPathAccessError`,因此走上面的静默分支。
  - `apps/packaged/src/sidecars.ts:380-410` —— `POSTHOG_KEY` / `POSTHOG_HOST` / `OPEN_DESIGN_TELEMETRY_RELAY_URL` **仅作为 env 转发给 daemon/web 子进程**,主进程自身不上报任何事件 → 启动期崩溃的遥测盲区根因。
  - `apps/packaged/src/index.ts:215-223` & `:144-146` —— 主进程已持有 `posthogKey/posthogHost`(传给 update/sidecar),即"直连上报"所需材料已在手。
  - `apps/packaged/tests/sidecars.test.ts:444-541` —— `waitForStatus child-exit fast-fail` 既有测试,已断言 `/daemon exited before reporting status/`。证明崩溃路径有现成可测 seam。
  - `tools/pack/src/mac/builder.ts:95-129` —— mac 签名/公证:`afterSign`(`:95`)、`entitlements`(`:123-124`)、`gatekeeperAssess:false`(`:125`)、`hardenedRuntime: config.signed`(`:126`)、`notarize`(`:129`)。决定 native 模块是否被签名覆盖(缺陷 C 验证入口)。
  - `tools/pack/src/mac/constants.ts:26` —— `ELECTRON_BUILDER_ASAR = false`;故 bundle 内是裸文件布局,`node_modules/better-sqlite3/` 是真实目录,与报错路径吻合。
  - `tools/pack/src/win/constants.ts` / `tools/pack/src/mac/constants.ts` —— `ELECTRON_REBUILD_NATIVE_MODULES: ["better-sqlite3"]`;**better-sqlite3 是当前唯一的 external 原生模块**,即"关键依赖"白名单的天然种子。
- **用户日志证据**(issue #4638 附件,已下载核对):
  - desktop `latest.log`:`06-21 16:35` session 启动正常、`06-22 04:53` 干净退出(code 0);`06-22 15:55` 起每次启动 ~500ms 后 `daemon exited before reporting status (code=1, signal=none)`,14 连崩。整份日志 updater **只有** `check-not-available` / `metadata-unreachable`,**无任何 download/payload/install** 事件。
  - daemon `latest.log`:`ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3' imported from /Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/chunks/server-PULTSXNL.mjs`。
  - 推论(由时间线锁定):`better-sqlite3` 目录消失发生在 **OD 完全没运行的 ~11h 空窗**(04:53 退出 → 15:55 再开),且 updater 全程未动 → **删除非 OD 运行时、非 OD 更新器所为**,系 OD 之外的因素(第三方清理/杀软或 OS Beta 行为,无证据指向具体某个;"OS 定时进 /Applications 精准删单个 native 模块目录"无已知机制支撑)。
- **相关材料**:issue #4638;关联 issue #4441(Nightly 残留 IPC 引发的启动崩溃,同族);记忆 `project_exception_tracking_platform_fetch_noise_4661`(PostHog 错误追踪与脱敏约定);`tools/pack/AGENTS.md` "Packaged auto-update architecture and harness";`AGENTS.md` "Daemon data directory contract"(日志/数据路径真相源)。
- **访问前提**:读源码无需特殊权限;核对线上遥测需 PostHog OpenDesign 项目(`project_reliability_3408_takeover_roadmap`);核对线上 stable 包签名需下载公开 DMG 跑 `codesign -dv --verbose=4` / `spctl -a`。

## Goals / Non-goals · 要做 / 明确不做

**Goals**

1. **可观测**:打包态主进程在 daemon/web 启动失败时,即使 daemon 从未起来,也能上报一条结构化遥测事件(含失败类型、退出码、从 daemon 日志尾抓到的真实错误码与缺失模块名、版本/平台/namespace),离线时不阻塞、best-effort。
2. **可告知**:任何启动失败都给用户一个确定性的、可操作的错误对话框(原因 + daemon 日志路径 + 下一步建议),取代静默 `exit(1)`。
3. **自愈/韧性**:启动期对"关键 external native 依赖"做完整性自检,缺失时给出明确归类与可操作引导(如"安装似乎被破坏,请重装");识别崩溃循环(连续失败计数持久化),为后续自动恢复留挂点。
4. 三件套对 macOS / Windows / Linux 同构(实现可分平台切片,但设计不绑死 mac)。

**Non-goals**

- **不**承诺阻止外部进程(杀软 / OS / 用户)删除 bundle 内文件——那不在我们控制面内;本 spec 治理的是"被删之后我们如何看见、告知、恢复"。
- **不**在本 spec 内改 auto-updater 行为(日志已证更新器与本故障无关)。
- **不**改 daemon 数据目录契约 / 不新增数据根(遵守 `AGENTS.md` Daemon data directory contract)。
- **不**做运行期(daemon 已起来后)的崩溃治理——那已有 daemon/web 侧 PostHog 覆盖;本 spec 专攻**启动期(pre-daemon)盲区**。

## Proposed design · 方案

三层,均落在 `apps/packaged`(主进程),与 daemon 解耦,因为故障前提就是"daemon 不在"。

### 层 1 — 可告知:启动失败一律弹可操作对话框

改 `apps/packaged/src/index.ts:227-238` 的 catch:把"仅 `PackagedPathAccessError` 弹窗"扩展为**所有**启动失败都经过一个 `presentStartupFailure(error)` 纯函数,产出 `{ title, message, detail, logPath }` 并 `dialog.showErrorBox`。`PackagedPathAccessError` 保留其专有文案;daemon-start 失败给"关键组件缺失/安装可能损坏 + daemon 日志路径 + 重装建议";未知错误给兜底文案。对话框失败(无 GUI)再回落 console + exit。

### 层 2 — 可观测:主进程直连 PostHog,补 pre-daemon 盲区

新增 `apps/packaged/src/startup-telemetry.ts`:一个**不依赖 daemon**的最小 capture(直接 HTTPS POST 到 `posthogHost` 的 `/capture`,用主进程已持有的 `posthogKey`,见 `index.ts:144-146`)。

- 新事件 `packaged_runtime_failed`,字段:`failureKind`(`daemon-start` / `web-start` / `path-access` / `unknown`)、`exitCode`、`signal`、`errorName`、`missingModule`、`errorCode`(从 daemon 日志尾抓 `ERR_MODULE_NOT_FOUND` 等)、`appVersion`、`namespace`、`source`、`platform`、`osVersion`、`consecutiveFailures`。
- **抓真实错误码**:`waitForStatus` 的报错只有 `code=1`(零信息);新增 `readDaemonLogTail(logPath)` 读日志尾部,正则提取 `ERR_[A-Z_]+` 与 `Cannot find package '(.+?)'` → 把匿名崩溃变成可归类崩溃。这是本层价值的核心。
- **工程纪律**:fire-and-forget + 短超时(如 1.5s)+ 离线静默失败(用户日志显示常离线,不能让上报阻塞退出);`process.exit` 前 best-effort flush(beacon 风格)。
- **隐私**:stack/日志里含绝对用户路径(`/Users/<name>/…`),上报前 scrub(沿用记忆 `project_exception_tracking_platform_fetch_noise_4661` 的脱敏约定);无 `posthogKey`(fork 构建)时整体 no-op,与 `sidecars.ts:380-410` 现有"fork 无 key 干净 no-op"语义一致。

### 层 3 — 自愈/韧性:关键依赖完整性自检 + 崩溃循环识别

- **完整性自检**:启动 daemon **前**,校验 `ELECTRON_REBUILD_NATIVE_MODULES`(当前 `["better-sqlite3"]`,见 `tools/pack/src/*/constants.ts`)对应的 `node_modules/<mod>/package.json` 是否存在于 resource root。缺失 → 直接产出归类清晰的 `DaemonDependencyMissingError`(带 `missingModule`),驱动层 1 文案 + 层 2 事件;**无需**等 daemon 抛晦涩的 `ERR_MODULE_NOT_FOUND` 再反解。
- **崩溃循环识别**:在 namespace 运行目录持久化"连续启动失败计数 + 末次成功版本"。连续失败 ≥ N 时,对话框升级为更强引导(并把 `consecutiveFailures` 带进遥测)。为后续"自动触发重装/payload 重拉"留挂点(本 spec 不实现自动恢复动作,只建计数与挂点)。

### 缺陷 C(独立校验,不混入实现 PR)

核对**线上 stable 0.11.0 DMG** 是否真签名+公证、且 `better_sqlite3.node` 被 bundle 签名覆盖(`codesign -dv --verbose=4`、`spctl -a`、`codesign --verify --deep`)。若 native addon 未被签名覆盖,它被安全工具误删的概率更高 → 归为打包加固跟进项,与三件套解耦。

## Alternatives considered · 备选方案

- **把 better-sqlite3 打进 esbuild chunk(不再 external)**:它是 native `.node`,无法被 JS bundler 内联;`ELECTRON_REBUILD_NATIVE_MODULES` 的存在就是因为它必须按 ABI 重编。否决。
- **复用现有 daemon/web 侧 PostHog 上报**:故障前提是 daemon 不在,这条路径天然失效——这正是盲区本身。否决,必须主进程直连。
- **把崩溃事件经 `OPEN_DESIGN_TELEMETRY_RELAY_URL` relay**:relay 也由 sidecar 承载,daemon 不在时同样不可达。直连 PostHog 才闭环。
- **退避重启 daemon(在崩溃壳内重试)**:`better-sqlite3` 缺失是确定性失败,重试只会复现同样崩(用户日志 14 连崩即证)。重试对"瞬时"故障有意义、对"缺文件"无意义,故先做完整性自检归类,把重试留给真正瞬时的类别。
- **Electron `crashReporter` / Sentry**:`crashReporter` 抓的是 native 崩溃,这里是受控 `exit(1)`(非 crash),抓不到;引入 Sentry 是新依赖与新后端,而 PostHog 已是既有遥测面,直连成本最低。
- **Squirrel/electron-updater 自带健康检查回滚**:当前 updater 与本故障无关(日志证),且会把范围拉进更新链路。否决。

## Risks & mitigations · 风险与缓解

- **observability**:主进程直连上报写错可能拖慢/卡住崩溃退出 → 短超时 + fire-and-forget + 离线静默 + 退出前只 best-effort flush。
- **security / privacy**:日志/stack 含用户绝对路径与潜在敏感串 → 上报前 scrub;无 key 全程 no-op;只发结构化字段,不发整段日志原文。
- **compatibility**:`PackagedPathAccessError` 现有专有文案与行为必须保持 → 层 1 用分发函数,旧分支语义不回归(用现有测试守)。
- **誤报**:完整性自检若把"合法的非 better-sqlite3 启动失败"误判成"依赖缺失" → 自检只针对 `ELECTRON_REBUILD_NATIVE_MODULES` 白名单 + 文件存在性,判不出再回落"未知启动失败"通用文案。
- **platform skew**:mac/win/linux 日志路径与 GUI 可用性不同 → `readDaemonLogTail` 走既有 `watch.logPath`,对话框失败回落 console。
- **observability 反噬**:崩溃循环会在每次启动各发一条事件,可能刷量 → 带 `consecutiveFailures`,看板侧按 (machineId, version) 去重即可,客户端不抑制以免漏真实复发。
- **测试缺口**:见下方 Validation,先红后绿覆盖三层主路径。

## Rollout / migration / rollback · 上线与回滚

- 无数据迁移(只新增一个 namespace 内的失败计数小文件,缺失即视为 0)。
- 三层均为打包态主进程改动,按平台切片灰度:先 mac 随常规 beta→stable 通道发布;Windows/Linux 跟进切片。
- 回滚:纯主进程逻辑,无 schema/契约变更,回滚即还原 `index.ts` catch 与移除新模块,无残留状态需清理。
- 新遥测事件名一次定稿,避免后续改名造成看板断裂。

## Validation · 验收标准(behavior-level,先红后绿)

- **层 1(可告知)**:把 `main().catch` 收口成可测的 `handleStartupFailure(error, deps)`;喂一个**非 `PackagedPathAccessError`** 的 `daemon exited before reporting status` 错误,断言 `dialog.showErrorBox` 被调用且 message 含 daemon 日志路径。**当前代码下此断言为红**(现在这类错误不弹窗),修后转绿。
- **层 2(可观测)**:注入假 `posthogKey/host` + 假 HTTPS,断言失败时 POST 出一条 `packaged_runtime_failed`,且 `errorCode==="ERR_MODULE_NOT_FOUND"`、`missingModule==="better-sqlite3"`(由 `readDaemonLogTail` 从 #4638 真实日志文本解析);无 key 时断言零请求。
- **层 3(自愈)**:构造 resource root 缺 `node_modules/better-sqlite3/package.json` 的夹具,断言 daemon 启动前抛 `DaemonDependencyMissingError(missingModule="better-sqlite3")`,不再让 daemon 抛裸 `ERR_MODULE_NOT_FOUND`;断言连续失败计数自增并落盘。
- **端到端(人工验收,可选)**:本地 `pnpm tools-pack mac build` 出包后 `rm -rf "…/Resources/app/node_modules/better-sqlite3"` 再开 → 应弹错误对话框(而非静默消失),且 PostHog 收到事件。这条复现 #4638 用户经历,作为人眼验收。
- 既有 `apps/packaged/tests/sidecars.test.ts:444-541` 必须保持绿(不回归 `waitForStatus` 语义)。

## Implementation slices · 实现切片

1. **切片 A(可告知,最小可独立上线)**:`index.ts` catch → `handleStartupFailure` 分发函数 + daemon-start 文案 + 红 spec 转绿。用户立刻从"静默消失"变"看得懂的对话框"。
2. **切片 B(可观测)**:`startup-telemetry.ts` 直连 capture + `readDaemonLogTail` 抓错误码 + 脱敏 + 离线安全;接到切片 A 的失败分发点。补盲区。
3. **切片 C(自愈)**:启动前完整性自检 → `DaemonDependencyMissingError` 归类 + 连续失败计数持久化 + 升级文案。
4. **切片 D(打包加固,独立)**:缺陷 C 签名/公证核验结论,按需补 mac 打包对 native addon 的签名覆盖。

每片均可独立验证、独立发布;A 即可单独缓解用户最痛的"零反馈"。

## Open questions · 待解问题

1. 遥测事件名:`packaged_runtime_failed`(强调主进程层)还是 `daemon_start_failed`(强调子系统)?倾向前者更泛、能覆盖 web-start/path-access,但需与现有看板命名约定对齐(reviewer 若知 PostHog 既有事件命名风格请指正)。
2. 崩溃循环阈值 N 与"升级引导"具体动作:仅强化文案?还是到挂点就触发"打开下载页/重装引导"?本 spec 先留挂点,动作待定。
3. 完整性自检范围:只查 `ELECTRON_REBUILD_NATIVE_MODULES`(当前仅 better-sqlite3),还是扩展到 daemon chunk 声明的全部 externals(如 `blake3-wasm`)?倾向先只守 native 白名单(最高危、最易被外部工具删),externals 全量校验成本/收益待评。
4. 是否需要一个轻量"机器标识"以便看板按机器去重崩溃循环,且不违反隐私约定?复用 `sidecars.ts:89` 提到的"PostHog person identity 跨重装存续"机制可行性待核。
5. 缺陷 C 一旦核实"线上包 native addon 未被签名覆盖",其优先级是否应高于切片 C(因为它可能是"被删"概率的真正放大器)?需打包 owner 判断。
