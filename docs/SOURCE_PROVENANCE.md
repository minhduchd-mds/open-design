# Source provenance and copyright policy

This repository follows a **clean implementation** policy for architecture and algorithm work.

## Rules

1. External sources may be used to learn concepts, APIs, standards, research results, and architectural trade-offs.
2. Source code from third-party repositories must not be pasted into this repository unless the license is explicitly compatible and attribution obligations are satisfied.
3. New core algorithms should be implemented from first principles against a written specification and covered by tests.
4. If a third-party implementation is adapted, the file must include: source URL, exact upstream revision/tag, license, copyright notice requirements, and a description of modifications.
5. Generated code is treated the same as human-written code: it must be reviewed for accidental reproduction of third-party source.

## Current references

| Reference | Used for | License / status | Code copied? |
| --- | --- | --- | --- |
| Ink & Switch, “Local-first software: You own your data, in spite of the cloud” — https://www.inkandswitch.com/essay/local-first/ | Product/architecture principles: offline-first, user-owned primary data, background synchronization | Research article / conceptual reference | No |
| Node.js release policy — https://nodejs.org/en/about/previous-releases | Runtime support policy; production uses an LTS line | Documentation | No |
| Electron documentation — https://www.electronjs.org/docs/latest/ | Process isolation and desktop security API reference | Documentation; Electron is MIT-licensed | No |
| Hono documentation — https://hono.dev/docs/ | HTTP boundary/API conventions | Documentation; Hono is MIT-licensed | No |

## Repository-owned implementation

The following additions in the vNext architecture branch are original repository code:

- `scripts/check-merge-markers.ts`: deterministic repository scanner that rejects unresolved Git conflict markers before build/test gates.
- vNext architecture decisions and boundary definitions in `docs/architecture/VNEXT.md`.

No external source code was copied for these additions.
