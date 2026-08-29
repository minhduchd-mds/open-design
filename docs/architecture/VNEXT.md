# Open Design vNext architecture

## Product role

Open Design is a **local-first design runtime for code agents**. It should not become another generic AI dashboard. The core contract is: local project in → deterministic design skill execution → sandboxed artifacts → inspectable preview → user-approved patch.

## Architectural principles

- **Local authority:** the local workspace is authoritative; remote services are optional accelerators.
- **Ports and adapters:** domain code does not import Electron, HTTP, persistence, or model-provider SDKs directly.
- **Deterministic core:** planning, artifact identity, dependency ordering, and merge decisions are pure functions where possible.
- **Explicit effects:** filesystem, process spawning, network calls, and model calls live behind adapters.
- **Event journal:** every run records inputs, selected skill, tool calls, artifacts, checksums, and terminal state.
- **Sandbox by default:** generated preview/build work never receives unrestricted host access.

## Target boundaries

```text
apps/
  desktop/               Electron shell only
  web/                   preview/management UI
  daemon/                local runtime host
packages/
  domain/                run, artifact, skill, workspace contracts
  planner/               deterministic execution planning
  scheduler/             dependency-aware task scheduling
  artifact-store/        content-addressed artifact metadata
  adapters/
    filesystem/
    process/
    model/
    persistence/
  observability/         traces, structured events, run metrics
```

Dependency direction:

```text
UI / daemon / adapters
          ↓
     application
          ↓
       domain
```

The domain layer must never depend on an adapter.

## Original scheduling model

vNext should use a repository-owned dependency scheduler rather than copying an orchestration library implementation.

Each task has:

- stable task ID,
- declared dependencies,
- resource class (`cpu`, `io`, `model`, `exclusive-workspace`),
- estimated cost,
- retry policy,
- idempotency key.

Ready priority is calculated from:

```text
priority = criticalPathWeight
         + blockedDescendantWeight
         + ageBoost
         - resourcePressurePenalty
         - retryPenalty
```

Constraints:

1. A task is ready only when all required dependencies are terminal-success.
2. At most one `exclusive-workspace` mutation may run per workspace.
3. Model/network tasks may be cancelled without corrupting artifact state.
4. Artifact commits occur atomically after validation.
5. Replaying the same run input and tool outputs must reproduce the same artifact IDs.

This scoring/scheduling specification is original to this repository. The implementation should be created from this specification with property tests; no third-party scheduler source is required.

## Artifact identity

Use content-derived identities rather than timestamps:

```text
artifactId = hash(
  schemaVersion,
  workspaceRevision,
  skillId,
  normalizedInputs,
  normalizedOutput
)
```

Benefits: deduplication, replay, caching, provenance, and corruption detection.

## Frontend/UX direction

The UI should behave like an engineering workspace, not a marketing dashboard:

```text
┌ Project / runs ┐ ┌ Preview / canvas ┐ ┌ Evidence / patch ┐
│ history        │ │ live artifact     │ │ reasoning facts │
│ skills         │ │ responsive states │ │ diffs/checks    │
└────────────────┘ └───────────────────┘ └──────────────────┘
```

Required states: queued, running, waiting-for-user, blocked, failed-retryable, failed-terminal, completed, cancelled.

UX rules:

- Never hide destructive filesystem changes behind an AI message.
- Preview and patch are separate concepts.
- Every generated artifact exposes origin + checksum + producing run.
- Keyboard navigation and visible focus are mandatory.
- Long-running runs show stage-level progress, not fake percentage progress.

## Backend/runtime migration sequence

### v0.12.x stabilization
- Resolve all merge conflicts.
- Add repository merge-marker guard.
- Make build/test/typecheck mandatory before merge.

### v0.13
- Introduce domain/application/adapters boundaries.
- Add event journal and content-addressed artifacts.
- Wrap process/filesystem/model effects behind ports.

### v0.14
- Introduce dependency scheduler and workspace mutation lock.
- Add replayable run manifests.
- Add OpenTelemetry-compatible tracing boundary.

### v0.15
- Optional sync layer; local workspace remains authoritative.
- Conflict-aware metadata synchronization.
- Multi-device run history without making cloud availability a runtime dependency.

## Quality gates

A PR cannot merge when any of these fail:

- merge-marker scan,
- typecheck,
- unit tests,
- architecture import-boundary tests,
- UI E2E smoke test,
- provenance review for new third-party code.
