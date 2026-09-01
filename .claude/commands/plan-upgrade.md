---
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*)
argument-hint: <goal or product change>
description: Produce a repository-grounded product and code upgrade plan before implementation.
---

Plan this change without editing files yet: $ARGUMENTS

Read the relevant `AGENTS.md` hierarchy first. Then return:
- product outcome and target user;
- current-state evidence from the repo;
- architecture decision and rejected alternatives;
- dependency-aware task graph;
- affected contracts, UI, CLI, storage, runtime, and observability;
- test/evaluation oracle for every task;
- migration and rollback path;
- provenance/license notes for external concepts.

End with a concrete implementation order and merge gates. Prefer reuse of existing primitives over new abstractions.
