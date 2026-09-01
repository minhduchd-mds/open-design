---
name: Task Graph Planning
version: 0.1.0
description: Use when a requested open-design change spans multiple modules, packages, runtime boundaries, UI/CLI surfaces, migrations, or parallel implementation tasks and needs a resumable dependency-aware execution plan.
---

# Task Graph Planning

Load this playbook only for non-trivial changes.

## Goal
Convert a product/architecture request into a resumable DAG whose nodes can be implemented, tested, reviewed, retried, and integrated independently.

## Procedure
1. Read the applicable `AGENTS.md` hierarchy.
2. Identify contracts and boundary owners before files.
3. Split work by independently testable outcome, not by job title.
4. For each node define: id, objective, dependencies, owned paths/boundaries, inputs, outputs/artifacts, acceptance oracle, rollback, and whether workspace mutation must be exclusive.
5. Mark nodes parallel only when their ownership and contracts do not conflict.
6. Put contract/schema changes before their consumers.
7. Put integration, independent review, regression, and release gates after builders.
8. Persist enough evidence that a failed node can resume without replaying the full conversation.

## Anti-patterns
- one giant `implement-feature` node;
- separate frontend/backend tasks before agreeing on a contract;
- two agents editing the same ownership surface concurrently;
- a builder reviewing its own patch as the only gate;
- task order encoded only in prose rather than explicit dependencies.

## Output
Return a compact DAG plus node-level acceptance criteria and the critical path.
