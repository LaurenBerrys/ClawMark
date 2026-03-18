# Repository Guidelines

## ClawMark Runtime v6 (爪痕)

- This repository is currently executing `OpenClaw 增强版总实施蓝图 v6`.
- Deliver against the full blueprint. Do not intentionally ship a reduced prototype, demo path, or placeholder-only slice when the requested phase is expected to be complete.
- Only stop implementation for a true hard blocker that requires operator judgment. Do not interrupt for routine progress narration.

### Product Definitions

- `Runtime Core`: non-persona system core. It owns formal truth, execution sovereignty, privacy sovereignty, and local governance.
- `User Console`: the default web page and default operator entrypoint. It is not the system core and it is not an agent persona shell.
- `Agent`: an ecology object inside the runtime. Agents are not the product identity and do not own formal truth.
- `Surface`: a channel/account surface bound to either the user console or a specific agent. It must never bind to `Runtime Core`.
- `Federation Plane`: the controlled management/synchronization plane between the local runtime and the company Brain OS.
- `Brain OS`: the company-internal central brain. It is not shipped to end users and it must not be implemented inside this repository.

### Phase Ownership

- `Phase 1`: Runtime. Implemented in this repository.
- `Phase 2`: Federation Plane. Implemented in this repository.
- `Phase 3`: Brain OS. Must live in a separate internal repository.
- Do not skip phase order for acceptance purposes. Prebuilt scaffolding is fine, but Runtime acceptance remains the first gate.

### Runtime Sovereignty Boundaries

- Keep all formal truth local to the runtime:
  - formal memories
  - strategies
  - task state
  - private user model
- `Runtime Core` is the only formal-memory writer.
- `Decision Core` is the only final routing authority.
- `Task Loop` is the only continuous execution authority.
- `MCP host` is the capability-bus owner. Agents only receive a governed subset.
- Governance state must have execution meaning, not just dashboard meaning:
  - `core` and `adopted` are live-eligible
  - `candidate` and `shadow` stay off the default live route
  - `blocked` is a hard deny
  - task planning should prefer `core > adopted > implicit fallback > candidate > shadow > blocked`
- `Surface` local-business policy is an allowlisted runtime-owned schema, not an arbitrary JSON escape hatch. It must keep runtime-core binding forbidden and formal-memory/user-model/surface-role writes disabled.
- If federation or other local flows bind work to a `Surface`, that surface policy must still gate local task materialization. In particular, `taskCreation=disabled` must block coordinator-suggestion materialization instead of letting a side path spawn local tasks.
- Runtime self-evolution must keep structured risk review local. `autoApplyLowRisk` may only advance candidates reviewed as `low`; medium/high evolution candidates require an explicit local adoption reason and must not piggyback on the low-risk path.
- Channel delivery state is never canonical task truth. For example, a Discord thread archive action may affect delivery projection, but it must not redefine task completion.

### Federation Boundaries

- Federation may export/import controlled artifacts, suggestions, overlays, and packages.
- Federation must never bypass local sovereignty.
- Federation outbox replication is append-only and cursor-aware:
  - local outbox generation may advance the local head journal, but it must not silently acknowledge delivery
  - only a successful managed sync may advance the acknowledged outbox cursor
  - journal dedupe must be based on logical artifact content, not volatile `generatedAt` / envelope timestamp churn
- Never allow these to flow upstream by default:
  - raw chat
  - raw session working context
  - secrets
  - durable private memory dumps
  - private user model core
  - undistilled internal task details
  - full raw customer conversations
- Central packages must enter a local adoption chain; they must not directly overwrite local formal truth.

### Implementation Bias For This Project

- Prefer authoritative runtime stores and shared runtime modules over extension-local truth.
- Preserve the legacy runtime as an import/reference source. Do not delete it or mutate it in-place during migration work.
- Default product posture is `managed_high` capability access with a governed path to downgrade.
- News/info is a sidecar user-value module. It must not become the core decision lifeline and it must not auto-write formal memory.
- When upstream OpenClaw behavior conflicts with the v6 blueprint, preserve upstream where it improves infrastructure, but keep v6 product boundaries as the deciding rule.

### Single Source Of Truth

- This `AGENTS.md` is the single maintained v6 planning and progress file.
- Keep the canonical product plan, execution contract, and live delivery status in this file only.
- Runtime contracts and authoritative shapes still live in `src/shared/runtime/contracts.ts`.
- Runtime/Federation implementation must converge into `src/shared/runtime/*`, `src/gateway/server-methods/runtime.ts`, and the Runtime web UI.

### Canonical Plan

#### Phase 1: Runtime

##### 1. Runtime Boundary and Instance Model

- The formal isolation unit is the `runtime instance`.
- All runtime stores derive from `instance manifest + path resolver`.
- The path model is fixed:
  - `instanceRoot`
  - `configRoot`
  - `stateRoot`
  - `dataRoot`
  - `cacheRoot`
  - `logRoot`
  - `workspaceRoot`
  - `agentsRoot`
  - `skillsRoot`
  - `extensionsRoot`
  - `archiveRoot`
- Durable assets and volatile runtime state must stay separated.
- `profile` remains only as a compatibility selector.
- Multi-instance execution must not share writable state.
- The runtime must not depend on the home directory as the formal root.

##### 2. Memory Kernel

- Formal truth uses `SQLite + WAL`.
- Derived layers are fixed:
  - full-text index
  - vector archive backend
  - Markdown mirror layer
- The six-layer structure is fixed:
  - `logs`
  - `events`
  - `memories`
  - `strategies`
  - `meta_learning`
  - `evolution_memory`
- Formal memory types are fixed:
  - `user`
  - `knowledge`
  - `execution`
  - `avoidance`
  - `efficiency`
  - `completion`
  - `resource`
  - `communication`
- The memory kernel must support:
  - lineage
  - invalidation
  - rollback
  - reinforcement
  - decay
- `memory-lancedb-pro` may provide archive/vector capability only.
- External plugins must never write formal memory directly.

##### 3. Memory Update Engine

- Formal write chains are fixed:
  - `task/run/step/review -> execution / avoidance / efficiency / completion / strategy candidates / meta_learning`
  - `user/control actions -> user / communication`
  - manual promotion of pinned information into controlled knowledge memory
- Task completion, review/distill, invalidation, rollback, reinforcement, and lifecycle review must all flow through one authoritative engine.
- The news/info module must not auto-write formal memory.

##### 4. Retrieval Orchestrator

- The runtime-owned planes are fixed:
  - `strategy`
  - `memory`
  - `session`
  - `archive`
- The three stages are fixed:
  - `Structured Match`
  - `Hybrid Candidate Generation`
  - `Context Pack Synthesis`
- `ContextPack` is the only retrieval output.
- `System 1` uses `strategy + memory + session` and does not pull heavy archive by default.
- `System 2` may expand archive, perform deeper traversal, and use heavier rerank/fusion.
- External retrieval backends provide capability only, not sovereignty.

##### 5. Decision Core

- The Decision Core is the runtime-owned structured decision engine.
- Dual lanes are fixed:
  - `System 1`
  - `System 2`
- Decision inputs are fixed:
  - task state
  - relevant strategies
  - relevant memories
  - relevant session signals
  - runtime state
  - policy constraints
- Decision output must stay structured and testable.
- Optional modules may influence decisions only through structured signals or artifact refs.

##### 6. Task Loop

- The task system is the runtime's only continuous execution authority.
- Core objects are fixed:
  - `TaskRecord`
  - `TaskRun`
  - `TaskStep`
  - `TaskReview`
- The main loop is fixed:
  - `Intake`
  - `Planner`
  - `Executor`
  - `Recovery`
  - `Review`
  - `Notify`
- Canonical task statuses are fixed:
  - `queued`
  - `planning`
  - `ready`
  - `running`
  - `waiting_external`
  - `waiting_user`
  - `blocked`
  - `completed`
  - `cancelled`
- Derived tasks must attach to a root task.
- Completed tasks must review, and reviews must distill.
- The loop must support:
  - `per-task lease`
  - `per-worker concurrency`
  - `idempotency key`
  - `retry / recovery / replan`
  - memory-invalidation-triggered replanning

##### 7. User Model

- The user model belongs to `Runtime Core`, not to an agent.
- The three layers are fixed:
  - `RuntimeUserModelCore`
  - `AgentLocalOverlay`
  - `SessionWorkingPreference`
- V1 priority includes:
  - communication style
  - interruption threshold
  - reporting granularity
  - confirmation boundary
  - `reportPolicy`
- Structured user model is the truth source.
- `USER.md` is a human-editable mirror only.
- Session-local preference must not directly pollute long-term preference.
- Agent-local overlays must not overwrite the user core model.

##### 8. Agent / Surface Ecology

- Agents are ecology objects, not product identity.
- Each agent owns:
  - role base
  - local memory namespace
  - local skill pack
  - local channel bindings
  - local optimization history
- `User Console` stays the default homepage and operator control plane.
- Each surface binds to the `User Console` or a specific agent, never to `Runtime Core`.
- `SurfaceRoleOverlay` must remain runtime-owned and allowlisted.
- Customer/service surfaces must not rewrite runtime-core truth or the user core model.
- Role optimization follows:
  - `observe`
  - `shadow`
  - `recommend`
  - `adopt/reject`

##### 9. Self-Evolution Engine

- This is the runtime's system-level optimization kernel, not a skill.
- Optimization targets include:
  - decision policy
  - retrieval policy
  - context policy
  - retry/recovery policy
  - skill bundle usage
  - model routing
  - worker routing
  - role optimization
  - strategy refresh
- It must optimize for:
  - success
  - completion
  - token
  - latency
  - interruption
  - regression risk
- It may materialize:
  - strategy
  - route policy
  - retry policy
  - context policy
  - retrieval policy
  - role optimization recommendation
- It must not rewrite formal memory truth or bypass governance.

##### 10. Capability Governance

- Governed objects are fixed:
  - `skill`
  - `agent`
  - `mcp`
- Governance states are fixed:
  - `blocked`
  - `shadow`
  - `candidate`
  - `adopted`
  - `core`
- MCP capability is host-owned and matrix-governed.
- Agents receive only an authorized subset and may not self-escalate.
- New skills/agents/mcp entries must not enter the live path by default.

##### 11. News / Info Module

- This is an independent user-value sidecar, not the system lifeline.
- V1 includes:
  - category config
  - source config
  - scheduled digest
  - instant bulletin toggle
  - title + summary + URL
- Default categories:
  - military
  - technology
  - AI
  - business
- It uses its own store, adapters, dedupe, summarize, and scheduler path.
- It must not auto-create tasks, auto-write formal memory, or become the core decision lifeline.

##### 12. Phase 1 Acceptance

- The runtime must run fully without an upper-layer connection.
- The `User Console` must remain the default operator entrypoint and not collapse into an agent shell.
- Memory, retrieval, decision, task, user model, and evolution must form a local closed loop.
- Multi-agent and multi-surface execution must not pollute the user core model.
- Typecheck, build, unit tests, and key integration tests must pass.

##### 13. Architecture Evolution (v6.1 Pragmatic Track)

This section defines the next-generation runtime optimizations. The design philosophy is **pragmatic minimalism**: maximum real-world impact with minimum codebase complexity. All mechanisms below build on the existing `SQLite + WAL` truth layer and do not require external databases, microservices, or distributed consensus protocols.

###### 13a. Lazy Context Pointers (Token Efficiency)

- The primary Token-saving mechanism for `ContextPack` assembly.
- Rules are fixed:
  - Every `MemoryRecord` and `StrategyRecord` must maintain a `summary` field (≤100 characters).
  - During `System 1` (fast-decision) context assembly, `ContextPack` must **never** include memory detail text or raw chat history.
  - `ContextPack` delivers only a pointer list of matched memory IDs with their short summaries.
  - The main LLM must explicitly call `expand_memory(id)` to load full detail on demand.
- `System 2` (deep-analysis) may pre-expand up to a budgeted Token ceiling, but must still respect priority ordering by relevance score.
- Result: 90%+ reduction in retrieval-phase Token consumption for routine tasks.
- Implementation route:
  - `contracts.ts`: add mandatory `summary` field to `MemoryRecord` and `StrategyRecord` types.
  - `contracts.ts`: add `pointerOnly: boolean` flag to `ContextPack` type.
  - `retrieval-orchestrator.ts` → `buildContextPack()`: when `thinkingLane === "system1"`, set `pointerOnly: true` and strip `excerpt` / detail from all `RetrievalCandidate` entries, keeping only `recordId + title + score`.
  - `decision-core.ts` → `buildDecisionRecord()`: when `pointerOnly` is set on the pack, emit `memoryBullets` as ID+summary pairs only (no detail text). Ensure `toContextBullet()` respects the flag.
  - Register `expand_memory` as a runtime-internal MCP tool that reads a `MemoryRecord` by ID from the SQLite store and returns its full `detail` field.
  - `decision-core.ts` → System 2 path: pre-expand up to `config.maxContextChars` Token budget ceiling, ordered by relevance score descending.
  - Tests: extend `retrieval-orchestrator.test.ts` and `decision-core.test.ts` to assert that System 1 packs contain zero detail text.

###### 13b. Goal-State Compaction (Anti-Drift Context Compression)

- The runtime's defense against "context drift" during long-running tasks.
- Inspired by `codex-cli` state compaction: compression output is a structured "work board", not a prose summary.
- Rules are fixed:
  - A watermark trigger fires when a `TaskRun`'s accumulated step history exceeds a configurable character budget (default: 4000 chars).
  - On trigger, the system produces a structured checkpoint containing exactly:
    - `currentGoal`: the active objective in one sentence.
    - `eliminatedPaths`: dead ends and failed approaches already ruled out.
    - `nextPlan`: the immediate next execution step.
  - After checkpoint creation, the original verbose history is **physically removed** from the active working context (moved to the `archive` layer).
- User preferences and `RuntimeUserModelCore` are **never** subject to rolling compaction. They persist as structured top-level system instructions independent of session history.
- Result: tasks can run indefinitely without hitting Token limits, and goal drift is structurally prevented by the anchored checkpoint format.
- Implementation route:
  - `contracts.ts`: define `GoalStateCheckpoint` type with fields `{ currentGoal: string; eliminatedPaths: string[]; nextPlan: string; compactedAt: number; archivedStepIds: string[] }`.
  - `contracts.ts`: add optional `checkpoint?: GoalStateCheckpoint` to `TaskRun`.
  - `task-engine.ts` → in the main loop between `Executor` and `Review` stages: measure cumulative character length of all `TaskStep.output` in the current run. When exceeding `config.compactionWatermark` (default 4000), invoke compaction.
  - Compaction procedure: call lightweight LLM (or local summarizer) with a structured prompt that forces output into the `{ currentGoal, eliminatedPaths, nextPlan }` schema. Attach result as `run.checkpoint`. Move compacted steps to `archive` layer in SQLite and remove from active `steps[]` array.
  - `RuntimeUserModelCore` and `SessionWorkingPreference` must be injected as top-level system instructions **outside** the compactable history window, so they are never swept away.
  - Tests: add `task-engine.test.ts` cases verifying that (a) compaction fires at watermark, (b) checkpoint contains required fields, (c) user model survives compaction.

###### 13c. Human-in-the-Loop Evolution Governance

- The default evolution governance model for sovereign local deployments.
- Rules are fixed:
  - `Self-Evolution Engine` may propose new strategies, but the maximum auto-promotion ceiling is `Candidate`.
  - Promotion from `Candidate` to `Adopted` or `Core` requires explicit operator approval via `User Console` or CLI.
  - The system must surface pending candidates as a visible audit queue (dashboard notification or TUI prompt).
  - Approval UX must include: strategy summary, estimated impact, and one-click `Adopt` / `Reject` actions.
- Optional enterprise override: a configuration flag `autoCanaryEvolution: true` may be set for unattended server deployments. When enabled, the system uses automatic shadow-then-canary promotion (10% traffic trial with circuit-breaker rollback on metric regression). This flag must default to `false`.
- Result: zero risk of autonomous strategy regression in personal deployments; optional full-auto path for enterprise scale.
- Implementation route:
  - `mutations.ts` → `maybeAutoApplyLowRiskEvolution()`: gate current auto-apply path behind a new config flag `autoCanaryEvolution`. When `false` (default), this function must cap promotion at `candidate` and return a `pendingApproval` status instead of auto-adopting.
  - `user-console.ts`: add `autoCanaryEvolution?: boolean` to the evolution config type alongside existing `autoApplyLowRisk`. Default to `false`.
  - `runtime-dashboard.ts`: in the evolution candidates section (around `buildRuntimeEvolutionCandidateStatuses()`), surface actionable candidates with `{ summary, estimatedImpact, adoptAction, rejectAction }` shape for the frontend.
  - `task-engine.ts` → review/distill phase (around line 2664): when `autoCanaryEvolution` is `true`, implement canary logic: assign the candidate to 10% of matching tasks via `Math.random() < 0.1`, track `{ successCount, failCount, avgTokens, avgLatency }` on the candidate metadata, and auto-reject (circuit-break) if `failRate > threshold`.
  - Tests: extend `mutations.test.ts` to assert that `autoCanaryEvolution: false` blocks auto-adoption beyond `candidate`.

###### 13d. Dual-Track Architecture Strategy

- All v6.1 optimizations follow a **dual-track** design:
  - **Track A (Pragmatic / Sovereign)**: default for local single-user deployments. Minimal dependencies, maximum simplicity. This is the mandatory baseline.
  - **Track B (Enterprise / Federated)**: optional pluggable extensions for high-concurrency multi-node deployments (e.g., CQRS write queue, background distillation worker, advanced conflict resolution). These activate only when enterprise configuration is present.
- Track A mechanisms must be fully functional without any Track B components.
- Track B must not break Track A behavior when disabled.

#### Phase 2: Federation Plane

- The federation plane is the controlled management plane between the runtime and Brain OS.
- It is not an open federation platform, not a central executor, and not a user-deployable product.
- The connection model is fixed:
  - runtime-initiated
  - outbound sync only
  - runtime push outbox / pull inbox
- Upstream envelopes are fixed:
  - `RuntimeManifestEnvelope`
  - `ShareableReviewEnvelope`
  - `ShareableMemoryEnvelope`
  - `StrategyDigestEnvelope`
  - `NewsDigestEnvelope`
  - `ShadowTelemetryEnvelope`
  - `CapabilityGovernanceSnapshot`
  - `TeamKnowledgeEnvelope`
- Downstream packages are fixed:
  - `CoordinatorSuggestionEnvelope`
  - `SharedStrategyPackage`
  - `TeamKnowledgePackage`
  - `RoleOptimizationPackage`
  - `RuntimePolicyOverlayPackage`
- Allowed upstream scopes:
  - `shareable_derived`
  - `strategy_digest`
  - `news_digest`
  - `shadow_telemetry`
  - `capability_governance`
  - `team_shareable_knowledge`
- Blocked upstream scopes:
  - `raw_chat`
  - `raw_session_working_context`
  - `secrets`
  - `durable_private_memory_dump`
  - `private_user_model_core`
  - `undistilled task internals`
  - `full raw customer conversations`
- Every downstream package must pass through:
  - `received`
  - `validated`
  - `shadowed`
  - `recommended`
  - `adopted / rejected / expired / reverted`
- `team-shareable` knowledge must stay isolated from private truth.
- Federation must never bypass local truth ownership.

#### Phase 3: Brain OS

- Brain OS is the company-internal central brain and must live in a separate repository.
- It is not published to users and must not be implemented in this repository.
- It is responsible for:
  - runtime registry
  - federation gateway
  - artifact ingest
  - shared strategy synthesis
  - team knowledge synthesis
  - role optimization synthesis
  - coordination suggestions
  - package publication
  - admin console
  - audit/approval
- It must not execute local tasks, overwrite local formal memory, or replace local decision ownership.

### Live Delivery | Area                             | Status        | Current live state                                                                                                                                                                                                                             |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime Core / Instance Boundary | `completed`   | Instance-rooted runtime store and manifest/path-resolver layout are authoritative.                                                                                                                                                             |
| Memory Kernel                    | `completed`   | SQLite/WAL truth, invalidation, rollback, lineage, markdown mirror, and lifecycle closure (reinforcement/decay) are fully implemented and unified.                                                                                             |
| Memory Update Engine             | `completed`   | Task/review/control writes, invalidation, rollback, reinforcement, and lifecycle review are unified and v6 compliant.                                                                                                                          |
| Retrieval Orchestrator           | `completed`   | `strategy/memory/session/archive` planes active. Lazy Context Pointers (pointerOnly) for System 1 and Canary Strategy (10% hash rollout) implemented.                                                                                         |
| Decision Core                    | `completed`   | Structured System 1/System 2 decisions with Governed Decision Policy. System 1 uses lazy pointers (summaries only) to save tokens.                                                                                                           |
| Task Loop                        | `completed`   | Canonical loop with recovery/replan. Goal-State Compaction (watermark-triggered checkpointing) implemented to prevent context drift and token bloat.                                                                                           |
| User Model                       | `completed`   | Structured core, `USER.md` mirror, and preference learning are live.                                                                                                                                                                           |
| Evolution Engine                 | `completed`   | Risk review and auto-apply pipeline live. Human-in-the-Loop Governance (autoCanaryEvolution gating) and Canary Rollout implemented.                                                                                                           |
| Phase 1 Runtime (v6.1 Unified)   | `completed`   | All Section 13 Architecture Evolution (Lazy Pointers, Compaction, Canary Governance) features are fully integrated into the Phase 1 Baseline.                                                                                                  |
e.                                                                                                                 |
| Agent / Surface Ecology          | `completed`   | Agent/surface records, overlays, allowlisted local-business policy, routing posture, and role optimization (auto-apply low risk) are fully hardened.                                                                                           |
| Self-Evolution Engine            | `completed`   | Full closed-loop optimization (retrieval_policy, strategy_refresh, worker_routing etc.) with mandatory risk gating and structured auto-apply is live.                                                                                          |
| Capability Governance            | `completed`   | Skill/agent/MCP governance and host-owned MCP grant matrix are authoritative and enforced at retrieval/decision layers.                                                                                                                        |
| News / Info Module               | `completed`   | Intel/news digest flow, topic weighting, usefulness feedback, and independent sidecar scheduler are fully v6 compliant.                                                                                                                        |
| Phase 1 Acceptance               | `completed`   | Phase 1 Runtime hardening is complete. All core components (Memory, Retrieval, Decision, Task, User Model, Evolution) form a local closed loop.                                                                                                |
| Architecture Evolution (v6.1)    | `planned`     | Lazy Context Pointers, Goal-State Compaction, and Human-in-the-Loop Evolution Governance are designed. Implementation pending.                                                                                                                  |
| Federation Plane                 | `in_progress` | Inbox/outbox/sync, package state machine, assignment materialization, outbox journal, remote maintenance, scope suppression audit, and team knowledge/shared strategy surfaces are live; full protocol/security/disconnect acceptance remains. |
| Brain OS                         | `not_started` | Must be implemented in a separate internal repository during Phase 3.                                                                                                                                                                          |

### Mandatory Maintenance

- After each material implementation slice, update the `Live Delivery Status` section in this file.
- Update this file whenever product definitions, hard boundaries, phase ownership, or execution rules change.
- Keep terminology consistent with the v6 blueprint. Do not casually swap `news` with `intel`, `surface` with `agent`, or `user console` with `runtime core`.

- Repo: https://github.com/openclaw/openclaw
- In chat replies, file references must be repo-root relative only (example: `extensions/bluebubbles/src/channel.ts:80`); never absolute paths or `~/...`.
- GitHub issues/comments/PR comments: use literal multiline strings or `-F - <<'EOF'` (or $'...') for real newlines; never embed "\\n".
- GitHub comment footgun: never use `gh issue/pr comment -b "..."` when body contains backticks or shell chars. Always use single-quoted heredoc (`-F - <<'EOF'`) so no command substitution/escaping corruption.
- GitHub linking footgun: don’t wrap issue/PR refs like `#24643` in backticks when you want auto-linking. Use plain `#24643` (optionally add full URL).
- PR landing comments: always make commit SHAs clickable with full commit links (both landed SHA + source SHA when present).
- PR review conversations: if a bot leaves review conversations on your PR, address them and resolve those conversations yourself once fixed. Leave a conversation unresolved only when reviewer or maintainer judgment is still needed; do not leave bot-conversation cleanup to maintainers.
- GitHub searching footgun: don't limit yourself to the first 500 issues or PRs when wanting to search all. Unless you're supposed to look at the most recent, keep going until you've reached the last page in the search
- Security advisory analysis: before triage/severity decisions, read `SECURITY.md` to align with OpenClaw's trust model and design boundaries.

## Auto-close labels (issues and PRs)

- If an issue/PR matches one of the reasons below, apply the label and let `.github/workflows/auto-response.yml` handle comment/close/lock.
- Do not manually close + manually comment for these reasons.
- Why: keeps wording consistent, preserves automation behavior (`state_reason`, locking), and keeps triage/reporting searchable by label.
- `r:*` labels can be used on both issues and PRs.

- `r: skill`: close with guidance to publish skills on Clawhub.
- `r: support`: close with redirect to Discord support + stuck FAQ.
- `r: no-ci-pr`: close test-fix-only PRs for failing `main` CI and post the standard explanation.
- `r: too-many-prs`: close when author exceeds active PR limit.
- `r: testflight`: close requests asking for TestFlight access/builds. OpenClaw does not provide TestFlight distribution yet, so use the standard response (“Not available, build from source.”) instead of ad-hoc replies.
- `r: third-party-extension`: close with guidance to ship as third-party plugin.
- `r: moltbook`: close + lock as off-topic (not affiliated).
- `r: spam`: close + lock as spam (`lock_reason: spam`).
- `invalid`: close invalid items (issues are closed as `not_planned`; PRs are closed).
- `dirty`: close PRs with too many unrelated/unexpected changes (PR-only label).

## PR truthfulness and bug-fix validation

- Never merge a bug-fix PR based only on issue text, PR text, or AI rationale.
- Before `/landpr`, run `/reviewpr` and require explicit evidence for bug-fix claims.
- Minimum merge gate for bug-fix PRs:
  1. symptom evidence (repro/log/failing test),
  2. verified root cause in code with file/line,
  3. fix touches the implicated code path,
  4. regression test (fail before/pass after) when feasible; if not feasible, include manual verification proof and why no test was added.
- If claim is unsubstantiated or likely hallucinated/BS: do not merge. Request evidence/changes, or close with `invalid` when appropriate.
- If linked issue appears wrong/outdated, correct triage first; do not merge speculative fixes.

## Project Structure & Module Organization

- Source code: `src/` (CLI wiring in `src/cli`, commands in `src/commands`, web provider in `src/provider-web.ts`, infra in `src/infra`, media pipeline in `src/media`).
- Tests: colocated `*.test.ts`.
- Docs: `docs/` (images, queue, Pi config). Built output lives in `dist/`.
- Plugins/extensions: live under `extensions/*` (workspace packages). Keep plugin-only deps in the extension `package.json`; do not add them to the root `package.json` unless core uses them.
- Plugins: install runs `npm install --omit=dev` in plugin dir; runtime deps must live in `dependencies`. Avoid `workspace:*` in `dependencies` (npm install breaks); put `openclaw` in `devDependencies` or `peerDependencies` instead (runtime resolves `openclaw/plugin-sdk` via jiti alias).
- Installers served from `https://openclaw.ai/*`: live in the sibling repo `../openclaw.ai` (`public/install.sh`, `public/install-cli.sh`, `public/install.ps1`).
- Messaging channels: always consider **all** built-in + extension channels when refactoring shared logic (routing, allowlists, pairing, command gating, onboarding, docs).
  - Core channel docs: `docs/channels/`
  - Core channel code: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web` (WhatsApp web), `src/channels`, `src/routing`
  - Extensions (channel plugins): `extensions/*` (e.g. `extensions/msteams`, `extensions/matrix`, `extensions/zalo`, `extensions/zalouser`, `extensions/voice-call`)
- When adding channels/extensions/apps/docs, update `.github/labeler.yml` and create matching GitHub labels (use existing channel/extension label colors).

## Docs Linking (Mintlify)

- Docs are hosted on Mintlify (docs.openclaw.ai).
- Internal doc links in `docs/**/*.md`: root-relative, no `.md`/`.mdx` (example: `[Config](/configuration)`).
- When working with documentation, read the mintlify skill.
- For docs, UI copy, and picker lists, order services/providers alphabetically unless the section is explicitly describing runtime behavior (for example auto-detection or execution order).
- Section cross-references: use anchors on root-relative paths (example: `[Hooks](/configuration#hooks)`).
- Doc headings and anchors: avoid em dashes and apostrophes in headings because they break Mintlify anchor links.
- When Peter asks for links, reply with full `https://docs.openclaw.ai/...` URLs (not root-relative).
- When you touch docs, end the reply with the `https://docs.openclaw.ai/...` URLs you referenced.
- README (GitHub): keep absolute docs URLs (`https://docs.openclaw.ai/...`) so links work on GitHub.
- Docs content must be generic: no personal device names/hostnames/paths; use placeholders like `user@gateway-host` and “gateway host”.

## Docs i18n (zh-CN)

- `docs/zh-CN/**` is generated; do not edit unless the user explicitly asks.
- Pipeline: update English docs → adjust glossary (`docs/.i18n/glossary.zh-CN.json`) → run `scripts/docs-i18n` → apply targeted fixes only if instructed.
- Translation memory: `docs/.i18n/zh-CN.tm.jsonl` (generated).
- See `docs/.i18n/README.md`.
- The pipeline can be slow/inefficient; if it’s dragging, ping @jospalmbier on Discord instead of hacking around it.

## exe.dev VM ops (general)

- Access: stable path is `ssh exe.dev` then `ssh vm-name` (assume SSH key already set).
- SSH flaky: use exe.dev web terminal or Shelley (web agent); keep a tmux session for long ops.
- Update: `sudo npm i -g openclaw@latest` (global install needs root on `/usr/lib/node_modules`).
- Config: use `openclaw config set ...`; ensure `gateway.mode=local` is set.
- Discord: store raw token only (no `DISCORD_BOT_TOKEN=` prefix).
- Restart: stop old gateway and run:
  `pkill -9 -f openclaw-gateway || true; nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &`
- Verify: `openclaw channels status --probe`, `ss -ltnp | rg 18789`, `tail -n 120 /tmp/openclaw-gateway.log`.

## Build, Test, and Development Commands

- Runtime baseline: Node **22+** (keep Node + Bun paths working).
- Install deps: `pnpm install`
- If deps are missing (for example `node_modules` missing, `vitest not found`, or `command not found`), run the repo’s package-manager install command (prefer lockfile/README-defined PM), then rerun the exact requested command once. Apply this to test/build/lint/typecheck/dev commands; if retry still fails, report the command and first actionable error.
- Pre-commit hooks: `prek install` (runs same checks as CI)
- Also supported: `bun install` (keep `pnpm-lock.yaml` + Bun patching in sync when touching deps/patches).
- Prefer Bun for TypeScript execution (scripts, dev, tests): `bun <file.ts>` / `bunx <tool>`.
- Run CLI in dev: `pnpm openclaw ...` (bun) or `pnpm dev`.
- Node remains supported for running built output (`dist/*`) and production installs.
- Mac packaging (dev): `scripts/package-mac-app.sh` defaults to current arch. Release checklist: `docs/platforms/mac/release.md`.
- Type-check/build: `pnpm build`
- TypeScript checks: `pnpm tsgo`
- Lint/format: `pnpm check`
- Format check: `pnpm format` (oxfmt --check)
- Format fix: `pnpm format:fix` (oxfmt --write)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`

## Coding Style & Naming Conventions

- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Formatting/linting via Oxlint and Oxfmt; run `pnpm check` before commits.
- Never add `@ts-nocheck` and do not disable `no-explicit-any`; fix root causes and update Oxlint/Oxfmt config only when required.
- Dynamic import guardrail: do not mix `await import("x")` and static `import ... from "x"` for the same module in production code paths. If you need lazy loading, create a dedicated `*.runtime.ts` boundary (that re-exports from `x`) and dynamically import that boundary from lazy callers only.
- Dynamic import verification: after refactors that touch lazy-loading/module boundaries, run `pnpm build` and check for `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings before submitting.
- Never share class behavior via prototype mutation (`applyPrototypeMixins`, `Object.defineProperty` on `.prototype`, or exporting `Class.prototype` for merges). Use explicit inheritance/composition (`A extends B extends C`) or helper composition so TypeScript can typecheck.
- If this pattern is needed, stop and get explicit approval before shipping; default behavior is to split/refactor into an explicit class hierarchy and keep members strongly typed.
- In tests, prefer per-instance stubs over prototype mutation (`SomeClass.prototype.method = ...`) unless a test explicitly documents why prototype-level patching is required.
- Add brief code comments for tricky or non-obvious logic.
- Keep files concise; extract helpers instead of “V2” copies. Use existing patterns for CLI options and dependency injection via `createDefaultDeps`.
- Aim to keep files under ~700 LOC; guideline only (not a hard guardrail). Split/refactor when it improves clarity or testability.
- Naming: use **OpenClaw** for product/app/docs headings; use `openclaw` for CLI command, package/binary, paths, and config keys.
- Written English: use American spelling and grammar in code, comments, docs, and UI strings (e.g. "color" not "colour", "behavior" not "behaviour", "analyze" not "analyse").

## Release Channels (Naming)

- stable: tagged releases only (e.g. `vYYYY.M.D`), npm dist-tag `latest`.
- beta: prerelease tags `vYYYY.M.D-beta.N`, npm dist-tag `beta` (may ship without macOS app).
- beta naming: prefer `-beta.N`; do not mint new `-1/-2` betas. Legacy `vYYYY.M.D-<patch>` and `vYYYY.M.D.beta.N` remain recognized.
- dev: moving head on `main` (no tag; git checkout main).

## Testing Guidelines

- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Naming: match source names with `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` (or `pnpm test:coverage`) before pushing when you touch logic.
- Do not set test workers above 16; tried already.
- If local Vitest runs cause memory pressure (common on non-Mac-Studio hosts), use `OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test` for land/gate runs.
- Live tests (real keys): `CLAWDBOT_LIVE_TEST=1 pnpm test:live` (OpenClaw-only) or `LIVE=1 pnpm test:live` (includes provider live tests). Docker: `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway`. Onboarding Docker E2E: `pnpm test:docker:onboard`.
- Full kit + what’s covered: `docs/testing.md`.
- Changelog: user-facing changes only; no internal/meta notes (version alignment, appcast reminders, release process).
- Changelog placement: in the active version block, append new entries to the end of the target section (`### Changes` or `### Fixes`); do not insert new entries at the top of a section.
- Changelog attribution: use at most one contributor mention per line; prefer `Thanks @author` and do not also add `by @author` on the same entry.
- Pure test additions/fixes generally do **not** need a changelog entry unless they alter user-facing behavior or the user asks for one.
- Mobile: before using a simulator, check for connected real devices (iOS + Android) and prefer them when available.

## Commit & Pull Request Guidelines

**Full maintainer PR workflow (optional):** If you want the repo's end-to-end maintainer workflow (triage order, quality bar, rebase rules, commit/changelog conventions, co-contributor policy, and the `review-pr` > `prepare-pr` > `merge-pr` pipeline), see `.agents/skills/PR_WORKFLOW.md`. Maintainers may use other workflows; when a maintainer specifies a workflow, follow that. If no workflow is specified, default to PR_WORKFLOW.

- `/landpr` lives in the global Codex prompts (`~/.codex/prompts/landpr.md`); when landing or merging any PR, always follow that `/landpr` process.
- Create commits with `scripts/committer "<msg>" <file...>`; avoid manual `git add`/`git commit` so staging stays scoped.
- Follow concise, action-oriented commit messages (e.g., `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.
- PR submission template (canonical): `.github/pull_request_template.md`
- Issue submission templates (canonical): `.github/ISSUE_TEMPLATE/`

## Shorthand Commands

- `sync`: if working tree is dirty, commit all changes (pick a sensible Conventional Commit message), then `git pull --rebase`; if rebase conflicts and cannot resolve, stop; otherwise `git push`.

## Git Notes

- If `git branch -d/-D <branch>` is policy-blocked, delete the local ref directly: `git update-ref -d refs/heads/<branch>`.
- Bulk PR close/reopen safety: if a close action would affect more than 5 PRs, first ask for explicit user confirmation with the exact PR count and target scope/query.

## GitHub Search (`gh`)

- Prefer targeted keyword search before proposing new work or duplicating fixes.
- Use `--repo openclaw/openclaw` + `--match title,body` first; add `--match comments` when triaging follow-up threads.
- PRs: `gh search prs --repo openclaw/openclaw --match title,body --limit 50 -- "auto-update"`
- Issues: `gh search issues --repo openclaw/openclaw --match title,body --limit 50 -- "auto-update"`
- Structured output example:
  `gh search issues --repo openclaw/openclaw --match title,body --limit 50 --json number,title,state,url,updatedAt -- "auto update" --jq '.[] | "\(.number) | \(.state) | \(.title) | \(.url)"'`

## Security & Configuration Tips

- Web provider stores creds at `~/.openclaw/credentials/`; rerun `openclaw login` if logged out.
- Pi sessions live under `~/.openclaw/sessions/` by default; the base directory is not configurable.
- Environment variables: see `~/.profile`.
- Never commit or publish real phone numbers, videos, or live configuration values. Use obviously fake placeholders in docs, tests, and examples.
- Release flow: always read `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md` before any release work; do not ask routine questions once those docs answer them.

## GHSA (Repo Advisory) Patch/Publish

- Before reviewing security advisories, read `SECURITY.md`.
- Fetch: `gh api /repos/openclaw/openclaw/security-advisories/<GHSA>`
- Latest npm: `npm view openclaw version --userconfig "$(mktemp)"`
- Private fork PRs must be closed:
  `fork=$(gh api /repos/openclaw/openclaw/security-advisories/<GHSA> | jq -r .private_fork.full_name)`
  `gh pr list -R "$fork" --state open` (must be empty)
- Description newline footgun: write Markdown via heredoc to `/tmp/ghsa.desc.md` (no `"\\n"` strings)
- Build patch JSON via jq: `jq -n --rawfile desc /tmp/ghsa.desc.md '{summary,severity,description:$desc,vulnerabilities:[...]}' > /tmp/ghsa.patch.json`
- GHSA API footgun: cannot set `severity` and `cvss_vector_string` in the same PATCH; do separate calls.
- Patch + publish: `gh api -X PATCH /repos/openclaw/openclaw/security-advisories/<GHSA> --input /tmp/ghsa.patch.json` (publish = include `"state":"published"`; no `/publish` endpoint)
- If publish fails (HTTP 422): missing `severity`/`description`/`vulnerabilities[]`, or private fork has open PRs
- Verify: re-fetch; ensure `state=published`, `published_at` set; `jq -r .description | rg '\\\\n'` returns nothing

## Troubleshooting

- Rebrand/migration issues or legacy config/service warnings: run `openclaw doctor` (see `docs/gateway/doctor.md`).

## Agent-Specific Notes

- Vocabulary: "makeup" = "mac app".
- Never edit `node_modules` (global/Homebrew/npm/git installs too). Updates overwrite. Skill notes go in `tools.md` or `AGENTS.md`.
- When adding a new `AGENTS.md` anywhere in the repo, also add a `CLAUDE.md` symlink pointing to it (example: `ln -s AGENTS.md CLAUDE.md`).
- Signal: "update fly" => `fly ssh console -a flawd-bot -C "bash -lc 'cd /data/clawd/openclaw && git pull --rebase origin main'"` then `fly machines restart e825232f34d058 -a flawd-bot`.
- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- When answering questions, respond with high-confidence answers only: verify in code; do not guess.
- Never update the Carbon dependency.
- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies (pnpm patches, overrides, or vendored changes) requires explicit approval; do not do this by default.
- CLI progress: use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner); don’t hand-roll spinners/bars.
- Status output: keep tables + ANSI-safe wrapping (`src/terminal/table.ts`); `status --all` = read-only/pasteable, `status --deep` = probes.
- Gateway currently runs only as the menubar app; there is no separate LaunchAgent/helper label installed. Restart via the OpenClaw Mac app or `scripts/restart-mac.sh`; to verify/kill use `launchctl print gui/$UID | grep openclaw` rather than assuming a fixed label. **When debugging on macOS, start/stop the gateway via the app, not ad-hoc tmux sessions; kill any temporary tunnels before handoff.**
- macOS logs: use `./scripts/clawlog.sh` to query unified logs for the OpenClaw subsystem; it supports follow/tail/category filters and expects passwordless sudo for `/usr/bin/log`.
- If shared guardrails are available locally, review them; otherwise follow this repo's guidance.
- SwiftUI state management (iOS/macOS): prefer the `Observation` framework (`@Observable`, `@Bindable`) over `ObservableObject`/`@StateObject`; don’t introduce new `ObservableObject` unless required for compatibility, and migrate existing usages when touching related code.
- Connection providers: when adding a new connection, update every UI surface and docs (macOS app, web UI, mobile if applicable, onboarding/overview docs) and add matching status + configuration forms so provider lists and settings stay in sync.
- Version locations: `package.json` (CLI), `apps/android/app/build.gradle.kts` (versionName/versionCode), `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `apps/macos/Sources/OpenClaw/Resources/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `docs/install/updating.md` (pinned npm version), `docs/platforms/mac/release.md` (APP_VERSION/APP_BUILD examples), Peekaboo Xcode projects/Info.plists (MARKETING_VERSION/CURRENT_PROJECT_VERSION).
- "Bump version everywhere" means all version locations above **except** `appcast.xml` (only touch appcast when cutting a new macOS Sparkle release).
- **Restart apps:** “restart iOS/Android apps” means rebuild (recompile/install) and relaunch, not just kill/launch.
- **Device checks:** before testing, verify connected real devices (iOS/Android) before reaching for simulators/emulators.
- iOS Team ID lookup: `security find-identity -p codesigning -v` → use Apple Development (…) TEAMID. Fallback: `defaults read com.apple.dt.Xcode IDEProvisioningTeamIdentifiers`.
- A2UI bundle hash: `src/canvas-host/a2ui/.bundle.hash` is auto-generated; ignore unexpected changes, and only regenerate via `pnpm canvas:a2ui:bundle` (or `scripts/bundle-a2ui.sh`) when needed. Commit the hash as a separate commit.
- Release signing/notary keys are managed outside the repo; follow internal release docs.
- Notary auth env vars (`APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_API_KEY_P8`) are expected in your environment (per internal release docs).
- **Multi-agent safety:** do **not** create/apply/drop `git stash` entries unless explicitly requested (this includes `git pull --rebase --autostash`). Assume other agents may be working; keep unrelated WIP untouched and avoid cross-cutting state changes.
- **Multi-agent safety:** when the user says "push", you may `git pull --rebase` to integrate latest changes (never discard other agents' work). When the user says "commit", scope to your changes only. When the user says "commit all", commit everything in grouped chunks.
- **Multi-agent safety:** do **not** create/remove/modify `git worktree` checkouts (or edit `.worktrees/*`) unless explicitly requested.
- **Multi-agent safety:** do **not** switch branches / check out a different branch unless explicitly requested.
- **Multi-agent safety:** running multiple agents is OK as long as each agent has its own session.
- **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.
- Lint/format churn:
  - If staged+unstaged diffs are formatting-only, auto-resolve without asking.
  - If commit/push already requested, auto-stage and include formatting-only follow-ups in the same commit (or a tiny follow-up commit if needed), no extra confirmation.
  - Only ask when changes are semantic (logic/data/behavior).
- Lobster seam: use the shared CLI palette in `src/terminal/palette.ts` (no hardcoded colors); apply palette to onboarding/config prompts and other TTY UI output as needed.
- **Multi-agent safety:** focus reports on your edits; avoid guard-rail disclaimers unless truly blocked; when multiple agents touch the same file, continue if safe; end with a brief “other files present” note only if relevant.
- Bug investigations: read source code of relevant npm dependencies and all related local code before concluding; aim for high-confidence root cause.
- Code style: add brief comments for tricky logic; keep files under ~500 LOC when feasible (split/refactor as needed).
- Tool schema guardrails (google-antigravity): avoid `Type.Union` in tool input schemas; no `anyOf`/`oneOf`/`allOf`. Use `stringEnum`/`optionalStringEnum` (Type.Unsafe enum) for string lists, and `Type.Optional(...)` instead of `... | null`. Keep top-level tool schema as `type: "object"` with `properties`.
- Tool schema guardrails: avoid raw `format` property names in tool schemas; some validators treat `format` as a reserved keyword and reject the schema.
- When asked to open a “session” file, open the Pi session logs under `~/.openclaw/agents/<agentId>/sessions/*.jsonl` (use the `agent=<id>` value in the Runtime line of the system prompt; newest unless a specific ID is given), not the default `sessions.json`. If logs are needed from another machine, SSH via Tailscale and read the same path there.
- Do not rebuild the macOS app over SSH; rebuilds must be run directly on the Mac.
- Never send streaming/partial replies to external messaging surfaces (WhatsApp, Telegram); only final replies should be delivered there. Streaming/tool events may still go to internal UIs/control channel.
- Voice wake forwarding tips:
  - Command template should stay `openclaw-mac agent --message "${text}" --thinking low`; `VoiceWakeForwarder` already shell-escapes `${text}`. Don’t add extra quotes.
  - launchd PATH is minimal; ensure the app’s launch agent PATH includes standard system paths plus your pnpm bin (typically `$HOME/Library/pnpm`) so `pnpm`/`openclaw` binaries resolve when invoked via `openclaw-mac`.
- For manual `openclaw message send` messages that include `!`, use the heredoc pattern noted below to avoid the Bash tool’s escaping.
- Release guardrails: do not change version numbers without operator’s explicit consent; always ask permission before running any npm publish/release step.
- Beta release guardrail: when using a beta Git tag (for example `vYYYY.M.D-beta.N`), publish npm with a matching beta version suffix (for example `YYYY.M.D-beta.N`) rather than a plain version on `--tag beta`; otherwise the plain version name gets consumed/blocked.

## NPM + 1Password (publish/verify)

- Use the 1password skill; all `op` commands must run inside a fresh tmux session.
- Correct 1Password path for npm release auth: `op://Private/Npmjs` (use that item; OTP stays `op://Private/Npmjs/one-time password?attribute=otp`).
- Sign in: `eval "$(op signin --account my.1password.com)"` (app unlocked + integration on).
- OTP: `op read 'op://Private/Npmjs/one-time password?attribute=otp'`.
- Publish: `npm publish --access public --otp="<otp>"` (run from the package dir).
- Verify without local npmrc side effects: `npm view <pkg> version --userconfig "$(mktemp)"`.
- Kill the tmux session after publish.

## Plugin Release Fast Path (no core `openclaw` publish)

- Release only already-on-npm plugins. Source list is in `docs/reference/RELEASING.md` under "Current npm plugin list".
- Run all CLI `op` calls and `npm publish` inside tmux to avoid hangs/interruption:
  - `tmux new -d -s release-plugins-$(date +%Y%m%d-%H%M%S)`
  - `eval "$(op signin --account my.1password.com)"`
- 1Password helpers:
  - password used by `npm login`:
    `op item get Npmjs --format=json | jq -r '.fields[] | select(.id=="password").value'`
  - OTP:
    `op read 'op://Private/Npmjs/one-time password?attribute=otp'`
- Fast publish loop (local helper script in `/tmp` is fine; keep repo clean):
  - compare local plugin `version` to `npm view <name> version`
  - only run `npm publish --access public --otp="<otp>"` when versions differ
  - skip if package is missing on npm or version already matches.
- Keep `openclaw` untouched: never run publish from repo root unless explicitly requested.
- Post-check for each release:
  - per-plugin: `npm view @openclaw/<name> version --userconfig "$(mktemp)"` should be `2026.2.17`
  - core guard: `npm view openclaw version --userconfig "$(mktemp)"` should stay at previous version unless explicitly requested.

## Changelog Release Notes

- When cutting a mac release with beta GitHub prerelease:
  - Tag `vYYYY.M.D-beta.N` from the release commit (example: `v2026.2.15-beta.1`).
  - Create prerelease with title `openclaw YYYY.M.D-beta.N`.
  - Use release notes from `CHANGELOG.md` version section (`Changes` + `Fixes`, no title duplicate).
  - Attach at least `OpenClaw-YYYY.M.D.zip` and `OpenClaw-YYYY.M.D.dSYM.zip`; include `.dmg` if available.

- Keep top version entries in `CHANGELOG.md` sorted by impact:
  - `### Changes` first.
  - `### Fixes` deduped and ranked with user-facing fixes first.
- Before tagging/publishing, run:
  - `node --import tsx scripts/release-check.ts`
  - `pnpm release:check`
  - `pnpm test:install:smoke` or `OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` for non-root smoke path.
