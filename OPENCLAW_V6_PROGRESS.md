# OpenClaw v6 Progress

Last updated: 2026-03-14

This file tracks implementation progress against `OpenClaw 增强版总实施蓝图 v6`.
Statuses:

- `completed`: implemented and covered by the current runtime/federation validation pass
- `in_progress`: partially implemented, but not yet at the v6 acceptance bar
- `not_started`: not implemented in this repository yet

## Phase 1: Runtime

| Area                             | Status        | Notes                                                                                                                                           |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime Core / Instance Boundary | `completed`   | Instance-rooted runtime store and path-resolver based layout are in place.                                                                      |
| Memory Kernel                    | `in_progress` | Authoritative SQLite/WAL store landed; v6-grade lineage/invalidation/rollback coverage is not complete yet.                                     |
| Memory Update Engine             | `in_progress` | Review/distill persistence is wired, but the full v6 update lifecycle is not complete.                                                          |
| Retrieval Orchestrator           | `in_progress` | Core retrieval plane now uses `strategy`, `memory`, `session`, `archive`; broader v6 retrieval policy is still being tightened.                 |
| Decision Core                    | `in_progress` | Structured runtime decisions are wired to the updated retrieval planes; more v6 policy coverage remains.                                        |
| Task Loop                        | `in_progress` | Canonical task/run/step/review flow remains active and persists through the authoritative store, but full v6 completion criteria are not met.   |
| User Model                       | `in_progress` | `User 控制台` model is formalized and stored; deeper long-term preference behavior is still being expanded.                                     |
| Agent / Surface Ecology          | `in_progress` | `Agent`, `Surface`, and role overlays are formalized and exposed in the runtime UI, but broader operating flows remain.                         |
| Self-Evolution Engine            | `in_progress` | Existing evolution/shadow hooks remain active, but the full v6 optimization loop is not finished.                                               |
| Capability Governance            | `in_progress` | Governance persists through the authoritative store, but the full v6 state model is not complete.                                               |
| News / Info Module               | `in_progress` | Independent news/info handling remains active and is no longer treated as a core retrieval plane, but the full v6 module shape is not complete. |
| User 控制台 UI                   | `completed`   | The runtime web page now clearly separates `User 控制台`, `Agents`, `Surfaces`, and federation status.                                          |

## Phase 2: Federation Plane

| Area                           | Status        | Notes                                                                                                                   |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Outbox envelopes               | `in_progress` | Runtime manifest, strategy/news digests, telemetry, and governance materialization are wired locally.                   |
| Inbox packages                 | `in_progress` | Local inbox persistence and package typing are implemented.                                                             |
| Package state machine          | `in_progress` | `received -> validated -> shadowed -> recommended -> adopted/rejected/expired/reverted` is implemented locally.         |
| Local adoption chain           | `in_progress` | Shared strategies, team knowledge, and role optimization packages can be applied locally.                               |
| Scope rules                    | `in_progress` | Default allowed/block scopes now match the v6 direction, with local enforcement in the runtime dashboard and sync flow. |
| Remote managed sync            | `in_progress` | Runtime can push outbox payloads and pull inbox payloads through the managed federation client.                         |
| Runtime UI federation controls | `completed`   | The runtime page can refresh federation status and trigger remote federation sync.                                      |

## Phase 3: Brain OS

| Area                          | Status        | Notes                                                 |
| ----------------------------- | ------------- | ----------------------------------------------------- |
| Brain OS repository           | `not_started` | No separate Brain OS repository has been created yet. |
| Runtime Registry              | `not_started` | Planned for the Brain OS repository.                  |
| Federation Gateway            | `not_started` | Planned for the Brain OS repository.                  |
| Artifact Ingest Pipeline      | `not_started` | Planned for the Brain OS repository.                  |
| Shared Strategy Synthesizer   | `not_started` | Planned for the Brain OS repository.                  |
| Team Knowledge Synthesizer    | `not_started` | Planned for the Brain OS repository.                  |
| Role Optimization Synthesizer | `not_started` | Planned for the Brain OS repository.                  |
| Coordination Engine           | `not_started` | Planned for the Brain OS repository.                  |
| Package Publisher             | `not_started` | Planned for the Brain OS repository.                  |
| Admin Console                 | `not_started` | Planned for the Brain OS repository.                  |
| Audit / Approval Layer        | `not_started` | Planned for the Brain OS repository.                  |

## Current Validation Snapshot

- Runtime/federation targeted Vitest suite: passing
- Runtime/federation UI hook for remote sync: wired
- Repository-wide `pnpm tsgo`: still blocked by pre-existing extension errors outside the current runtime/federation work
