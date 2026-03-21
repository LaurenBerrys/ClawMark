import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  RuntimeAgentInput,
  RuntimeCapabilityMcpGrantInput,
  RuntimeCapabilityRegistryEntryInput,
  RuntimeEvolutionCandidateStateInput,
  RuntimeEvolutionVerificationAcknowledgeInput,
  RuntimeEvolutionConfigureInput,
  RuntimeFederationInboxMaintenanceConfigureInput,
  RuntimeFederationRemoteMaintenanceConfigureInput,
  RuntimeFederationAssignmentTransitionInput,
  RuntimeFederationPushPolicyConfigureInput,
  RuntimeFederationPackageTransitionInput,
  RuntimeIntelConfigureInput,
  RuntimeIntelSourceInput,
  RuntimeIntelPinInput,
  RuntimeMemoryConfigureInput,
  RuntimeMemoryInvalidationInput,
  RuntimeMemoryReinforcementInput,
  RuntimeMemoryRollbackInput,
  RuntimeTaskLoopConfigureInput,
  RuntimeTaskUpsertInput,
  RuntimeTaskWaitingUserResponseInput,
  RuntimeRoleOptimizationRejectInput,
  RuntimeSessionPreferenceInput,
  RuntimeSurfaceInput,
  RuntimeSurfaceRoleInput,
  RuntimeUserConsoleMaintenanceConfigureInput,
  RuntimeUserModelOptimizationRejectInput,
  RuntimeUserModelInput,
} from "../controllers/runtime.ts";
import { clampText, formatList, formatMs, formatRelativeTimestamp } from "../format.ts";
import type {
  FederationRemoteSyncPreview,
  FederationRuntimeSnapshot,
  LegacyRuntimeImportApplyResult,
  LegacyRuntimeImportReport,
  RuntimeDashboardSnapshot,
  RuntimeUserConsoleStore,
} from "../types.ts";

type RuntimeProps = {
  loading: boolean;
  error: string | null;
  snapshot: RuntimeDashboardSnapshot | null;
  consoleStore: RuntimeUserConsoleStore | null;
  importPreview: LegacyRuntimeImportReport | null;
  importBusy: boolean;
  importApplyResult: LegacyRuntimeImportApplyResult | null;
  federationLoading: boolean;
  federationError: string | null;
  federationStatus: FederationRuntimeSnapshot | null;
  federationPreviewError: string | null;
  federationPreview: FederationRemoteSyncPreview | null;
  onRefresh: () => void;
  onImportApply: () => void;
  onFederationPreview: () => void;
  onFederationSync: () => void;
  onFederationPushPolicyConfigure: (
    input: RuntimeFederationPushPolicyConfigureInput,
  ) => Promise<void> | void;
  onFederationRemoteMaintenanceConfigure: (
    input: RuntimeFederationRemoteMaintenanceConfigureInput,
  ) => Promise<void> | void;
  onFederationMaintenanceConfigure: (
    input: RuntimeFederationInboxMaintenanceConfigureInput,
  ) => Promise<void> | void;
  onFederationMaintenanceReview: () => Promise<void> | void;
  onFederationPackageTransition: (
    input: RuntimeFederationPackageTransitionInput,
  ) => Promise<void> | void;
  onCoordinatorSuggestionMaterialize: (id: string) => Promise<void> | void;
  onFederationAssignmentTransition: (
    input: RuntimeFederationAssignmentTransitionInput,
  ) => Promise<void> | void;
  onFederationAssignmentMaterialize: (id: string) => Promise<void> | void;
  onUserModelSave: (input: RuntimeUserModelInput) => Promise<void> | void;
  onUserModelMirrorSync: (force?: boolean) => Promise<void> | void;
  onUserModelMirrorImport: () => Promise<void> | void;
  onSessionPreferenceSave: (input: RuntimeSessionPreferenceInput) => Promise<void> | void;
  onSessionPreferenceDelete: (id: string) => Promise<void> | void;
  onAgentSave: (input: RuntimeAgentInput) => Promise<void> | void;
  onAgentDelete: (id: string) => Promise<void> | void;
  onSurfaceSave: (input: RuntimeSurfaceInput) => Promise<void> | void;
  onSurfaceRoleSave: (input: RuntimeSurfaceRoleInput) => Promise<void> | void;
  onUserConsoleMaintenanceConfigure: (
    input: RuntimeUserConsoleMaintenanceConfigureInput,
  ) => Promise<void> | void;
  onUserConsoleMaintenanceReview: () => Promise<void> | void;
  onUserModelOptimizationReview: () => Promise<void> | void;
  onUserModelOptimizationAdopt: (id: string) => Promise<void> | void;
  onUserModelOptimizationReject: (
    input: RuntimeUserModelOptimizationRejectInput,
  ) => Promise<void> | void;
  onRoleOptimizationReview: () => Promise<void> | void;
  onRoleOptimizationAdopt: (id: string) => Promise<void> | void;
  onRoleOptimizationReject: (input: RuntimeRoleOptimizationRejectInput) => Promise<void> | void;
  onCapabilitiesSync: () => Promise<void> | void;
  onCapabilityEntrySet: (input: RuntimeCapabilityRegistryEntryInput) => Promise<void> | void;
  onCapabilityMcpGrantSet: (input: RuntimeCapabilityMcpGrantInput) => Promise<void> | void;
  onIntelConfigure: (input: RuntimeIntelConfigureInput) => Promise<void> | void;
  onIntelRefresh: (
    domains?: Array<"military" | "tech" | "ai" | "business">,
  ) => Promise<void> | void;
  onIntelDispatch: () => Promise<void> | void;
  onIntelSourceSave: (input: RuntimeIntelSourceInput) => Promise<void> | void;
  onIntelSourceDelete: (id: string) => Promise<void> | void;
  onIntelPin: (input: RuntimeIntelPinInput) => Promise<void> | void;
  onMemoryReview: () => Promise<void> | void;
  onMemoryConfigure: (input: RuntimeMemoryConfigureInput) => Promise<void> | void;
  onMemoryReinforce: (input: RuntimeMemoryReinforcementInput) => Promise<void> | void;
  onMemoryInvalidate: (input: RuntimeMemoryInvalidationInput) => Promise<void> | void;
  onMemoryRollback: (input: RuntimeMemoryRollbackInput) => Promise<void> | void;
  onEvolutionConfigure: (input: RuntimeEvolutionConfigureInput) => Promise<void> | void;
  onEvolutionReview: () => Promise<void> | void;
  onEvolutionVerificationAcknowledge: (
    input: RuntimeEvolutionVerificationAcknowledgeInput,
  ) => Promise<void> | void;
  onEvolutionCandidateStateSet: (
    input: RuntimeEvolutionCandidateStateInput,
  ) => Promise<void> | void;
  onTaskLoopConfigure: (input: RuntimeTaskLoopConfigureInput) => Promise<void> | void;
  onTaskSave: (input: RuntimeTaskUpsertInput) => Promise<void> | void;
  onTaskLoopTick: () => Promise<void> | void;
  onTaskPlan: (taskId: string) => Promise<void> | void;
  onWaitingUserTaskRespond: (input: RuntimeTaskWaitingUserResponseInput) => Promise<void> | void;
};

const FORM_GRID_STYLE =
  "display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;";
const STACK_STYLE = "display:grid; gap: 12px;";
const GOVERNANCE_STATES = ["blocked", "shadow", "candidate", "adopted", "core"] as const;

function formatConfidencePercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function formatIntelRefreshOutcome(value: string) {
  switch (value) {
    case "success":
      return "healthy";
    case "partial":
      return "partial";
    case "error":
      return "error";
    case "skipped":
      return "skipped";
    case "disabled":
      return "disabled";
    default:
      return "never";
  }
}

function renderStat(label: string, value: string | number, hint?: string) {
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${hint ? html`<div class="muted" style="font-size: 12px;">${hint}</div>` : nothing}
    </div>
  `;
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readChecked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function readPositiveNumber(formData: FormData, name: string): number | undefined {
  const value = Number(readText(formData, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readStringList(formData: FormData, name: string): string[] {
  const value = readText(formData, name);
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value.split(",")) {
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function readSurfaceTaskCreation(
  formData: FormData,
  name: string,
): "disabled" | "recommend_only" | undefined {
  const value = readText(formData, name);
  return value === "disabled" || value === "recommend_only" ? value : undefined;
}

function readSurfaceEscalationTarget(
  formData: FormData,
  name: string,
): "runtime-user" | "surface-owner" | undefined {
  const value = readText(formData, name);
  return value === "runtime-user" || value === "surface-owner" ? value : undefined;
}

function readMultiText(formData: FormData, name: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of formData.getAll(name)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function readOptionalNumber(formData: FormData, name: string): number | undefined {
  const raw = readText(formData, name);
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readOptionalDateTime(formData: FormData, name: string): number | null | undefined {
  const raw = readText(formData, name);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDateTimeLocal(value?: number) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const date = new Date(Number(value));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function readReportPolicy(
  formData: FormData,
  name: string,
): "silent" | "reply" | "proactive" | "reply_and_proactive" | undefined {
  const value = readText(formData, name);
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function readInterruptionThreshold(
  formData: FormData,
  name: string,
): "low" | "medium" | "high" | undefined {
  const value = readText(formData, name);
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function readReportVerbosity(
  formData: FormData,
  name: string,
): "brief" | "balanced" | "detailed" | undefined {
  const value = readText(formData, name);
  return value === "brief" || value === "balanced" || value === "detailed" ? value : undefined;
}

function readConfirmationBoundary(
  formData: FormData,
  name: string,
): "strict" | "balanced" | "light" | undefined {
  const value = readText(formData, name);
  return value === "strict" || value === "balanced" || value === "light" ? value : undefined;
}

function readInitiative(formData: FormData, name: string): "low" | "medium" | "high" | undefined {
  const value = readText(formData, name);
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function resolveFederationPrimaryTransition(
  entry: FederationRuntimeSnapshot["inbox"]["latestPackages"][number],
): RuntimeFederationPackageTransitionInput["state"] | null {
  const state = entry.state;
  if (state === "received") {
    return "validated";
  }
  if (state === "validated") {
    return "shadowed";
  }
  if (state === "shadowed") {
    return "recommended";
  }
  if (state === "recommended") {
    return "adopted";
  }
  if (state === "adopted") {
    return "reverted";
  }
  return null;
}

function resolveFederationPrimaryLabel(
  entry: FederationRuntimeSnapshot["inbox"]["latestPackages"][number],
) {
  const state = entry.state;
  if (state === "received") {
    return "Validate";
  }
  if (state === "validated") {
    return "Shadow";
  }
  if (state === "shadowed") {
    return "Recommend";
  }
  if (state === "recommended") {
    return entry.requiresReasonOnAdopt ? "Adopt (manual)" : "Adopt";
  }
  if (state === "adopted") {
    return "Revert";
  }
  return null;
}

function resolveFederationPrimaryReason(
  entry: FederationRuntimeSnapshot["inbox"]["latestPackages"][number],
): string | undefined {
  if (entry.state !== "recommended" || !entry.requiresReasonOnAdopt) {
    return undefined;
  }
  return `Manual local approval via Runtime console (${entry.riskLevel ?? "medium"} risk ${entry.packageType}).`;
}

function resolveFederationRiskPillClass(
  riskLevel: FederationRuntimeSnapshot["inbox"]["latestPackages"][number]["riskLevel"],
): string {
  return riskLevel === "high" ? "pill danger" : riskLevel === "medium" ? "pill warn" : "pill";
}

function resolveFederationAssignmentPillClass(
  state: FederationRuntimeSnapshot["assignmentInbox"]["latestAssignments"][number]["state"],
): string {
  if (state === "invalid") {
    return "pill danger";
  }
  if (state === "blocked") {
    return "pill warn";
  }
  return "pill";
}

function renderTaskStatusList(snapshot: RuntimeDashboardSnapshot) {
  const rows = Object.entries(snapshot.tasks.statusCounts).filter(([, count]) => Number(count) > 0);
  return rows.length === 0
    ? html`
        <div class="muted">No managed tasks detected.</div>
      `
    : html`
        <div class="stat-grid stat-grid--4" style="margin-bottom: 12px;">
          ${renderStat("Active tasks", snapshot.tasks.activeTaskCount)}
          ${renderStat("Lease", formatMs(snapshot.tasks.leaseDurationMs))}
          ${renderStat("Worker slots", `${snapshot.tasks.maxConcurrentRunsPerWorker} max`)}
          ${renderStat("Route slots", `${snapshot.tasks.maxConcurrentRunsPerRoute} max`)}
          ${renderStat("Archived steps", snapshot.tasks.archivedStepCount)}
          ${renderStat("Compaction", `${snapshot.retrieval.compactionWatermark} chars`)}
        </div>
        ${
          Object.keys(snapshot.tasks.activeWorkerSlots).length > 0
            ? html`
              <div class="muted" style="font-size: 12px; margin-bottom: 8px;">
                Active worker slots:
                ${Object.entries(snapshot.tasks.activeWorkerSlots)
                  .map(([worker, count]) => `${worker} ${count}`)
                  .join(" · ")}
              </div>
            `
            : nothing
        }
        ${
          Object.keys(snapshot.tasks.activeRouteSlots).length > 0
            ? html`
              <div class="muted" style="font-size: 12px; margin-bottom: 8px;">
                Active route slots:
                ${Object.entries(snapshot.tasks.activeRouteSlots)
                  .map(([route, count]) => `${route} ${count}`)
                  .join(" · ")}
              </div>
            `
            : nothing
        }
        ${rows.map(
          ([status, count]) => html`
            <div class="row spread" style="padding: 6px 0; border-bottom: 1px solid var(--line);">
              <span class="mono">${status}</span>
              <strong>${count}</strong>
            </div>
          `,
        )}
        ${
          snapshot.tasks.replanPendingCount > 0
            ? html`
              <div class="callout warning" style="margin-top: 12px;">
                ${snapshot.tasks.replanPendingCount} task(s) are queued for structured replanning after
                local memory invalidation.
              </div>
            `
            : nothing
        }
      `;
}

function canManuallyPlanTask(status: RuntimeDashboardSnapshot["tasks"]["tasks"][number]["status"]) {
  return (
    status !== "running" &&
    status !== "waiting_user" &&
    status !== "completed" &&
    status !== "cancelled"
  );
}

function formatTaskCadence(intervalMinutes?: number) {
  if (!Number.isFinite(intervalMinutes) || Number(intervalMinutes) <= 0) {
    return null;
  }
  const minutes = Math.round(Number(intervalMinutes));
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `every ${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `every ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `every ${minutes} min`;
}

function renderTaskComposer(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement | null;
        if (!form) {
          return;
        }
        const formData = new FormData(form);
        const startInMinutes = readPositiveNumber(formData, "startInMinutes");
        void props.onTaskSave({
          title: readText(formData, "title"),
          parentTaskId: readText(formData, "parentTaskId") || undefined,
          agentId: readText(formData, "agentId") || undefined,
          surfaceId: readText(formData, "surfaceId") || undefined,
          sessionId: readText(formData, "sessionId") || undefined,
          route: readText(formData, "route") || undefined,
          worker: readText(formData, "worker") || undefined,
          priority:
            (readText(formData, "priority") as RuntimeTaskUpsertInput["priority"]) || undefined,
          budgetMode:
            (readText(formData, "budgetMode") as RuntimeTaskUpsertInput["budgetMode"]) || undefined,
          retrievalMode:
            (readText(formData, "retrievalMode") as RuntimeTaskUpsertInput["retrievalMode"]) ||
            undefined,
          reportPolicy: readReportPolicy(formData, "reportPolicy"),
          goal: readText(formData, "goal") || undefined,
          successCriteria: readText(formData, "successCriteria") || undefined,
          tags: readStringList(formData, "tags"),
          skillIds: readStringList(formData, "skillIds"),
          recurring: readChecked(formData, "recurring"),
          maintenance: readChecked(formData, "maintenance"),
          scheduleIntervalMinutes: readPositiveNumber(formData, "scheduleIntervalMinutes"),
          nextRunAt:
            typeof startInMinutes === "number"
              ? Date.now() + startInMinutes * 60 * 1000
              : undefined,
        });
        form.reset();
      }}
    >
      <div class="card-sub">
        Create canonical root tasks, bind them to the right agent or surface when needed, and push
        them into the local loop.
      </div>
      <div style=${FORM_GRID_STYLE}>
        <label>
          <div class="muted">Title</div>
          <input name="title" placeholder="Weekly revenue digest" required />
        </label>
        <label>
          <div class="muted">Parent task ID</div>
          <input name="parentTaskId" placeholder="root-task-id (optional)" />
        </label>
        <label>
          <div class="muted">Agent ID</div>
          <input name="agentId" list="runtime-agent-options" placeholder="agent-sales" />
        </label>
        <label>
          <div class="muted">Surface ID</div>
          <input name="surfaceId" list="runtime-surface-options" placeholder="surface-wechat-sales" />
        </label>
        <label>
          <div class="muted">Session ID</div>
          <input name="sessionId" placeholder="operator-session" />
        </label>
        <label>
          <div class="muted">Route</div>
          <input name="route" placeholder="ops" />
        </label>
        <label>
          <div class="muted">Worker</div>
          <input name="worker" placeholder="main" />
        </label>
        <label>
          <div class="muted">Priority</div>
          <select name="priority">
            <option value="high">high</option>
            <option value="normal" selected>normal</option>
            <option value="low">low</option>
          </select>
        </label>
        <label>
          <div class="muted">Budget</div>
          <select name="budgetMode">
            <option
              value="strict"
              ?selected=${snapshot.retrieval.defaultBudgetMode === "strict"}
            >
              strict
            </option>
            <option
              value="balanced"
              ?selected=${snapshot.retrieval.defaultBudgetMode === "balanced"}
            >
              balanced
            </option>
            <option value="deep" ?selected=${snapshot.retrieval.defaultBudgetMode === "deep"}>
              deep
            </option>
          </select>
        </label>
        <label>
          <div class="muted">Retrieval</div>
          <select name="retrievalMode">
            <option value="off">off</option>
            <option value="light" ?selected=${snapshot.retrieval.defaultRetrievalMode === "light"}>
              light
            </option>
            <option value="deep" ?selected=${snapshot.retrieval.defaultRetrievalMode === "deep"}>
              deep
            </option>
          </select>
        </label>
        <label>
          <div class="muted">Report policy</div>
          <select name="reportPolicy">
            <option value="reply_and_proactive" selected>reply_and_proactive</option>
            <option value="reply">reply</option>
            <option value="proactive">proactive</option>
            <option value="silent">silent</option>
          </select>
        </label>
        <label>
          <div class="muted">Start in minutes</div>
          <input name="startInMinutes" type="number" min="1" step="1" placeholder="10" />
        </label>
        <label>
          <div class="muted">Repeat every minutes</div>
          <input
            name="scheduleIntervalMinutes"
            type="number"
            min="1"
            step="1"
            placeholder="1440"
          />
        </label>
        <label>
          <div class="muted">Skills (comma)</div>
          <input name="skillIds" placeholder="patch-edit,browser" />
        </label>
        <label>
          <div class="muted">Tags (comma)</div>
          <input name="tags" placeholder="ops,maintenance" />
        </label>
      </div>
      <label>
        <div class="muted">Goal</div>
        <textarea name="goal" rows="2" placeholder="Keep recurring checks current."></textarea>
      </label>
      <label>
        <div class="muted">Success criteria</div>
        <textarea
          name="successCriteria"
          rows="2"
          placeholder="Digest ships, anomalies flagged, next cadence scheduled."
        ></textarea>
      </label>
      <div class="row" style="gap: 16px; flex-wrap: wrap; align-items: center;">
        <label class="row" style="gap: 8px;">
          <input name="recurring" type="checkbox" />
          <span>Recurring</span>
        </label>
        <label class="row" style="gap: 8px;">
          <input name="maintenance" type="checkbox" />
          <span>Maintenance</span>
        </label>
      </div>
      <div class="row" style="margin-top: 12px; gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.loading}>
          ${props.loading ? "Saving..." : "Create Managed Task"}
        </button>
        <button
          class="btn secondary"
          type="button"
          ?disabled=${props.loading}
          @click=${() => {
            void props.onTaskLoopTick();
          }}
        >
          Run Task Loop Now
        </button>
      </div>
      <datalist id="runtime-agent-options">
        ${snapshot.agents.map(
          (agent) =>
            html`<option value=${agent.id}>${agent.name}${agent.roleBase ? ` · ${agent.roleBase}` : ""}</option>`,
        )}
      </datalist>
      <datalist id="runtime-surface-options">
        ${snapshot.surfaces.map(
          (surface) =>
            html`<option value=${surface.id}>${surface.label} · ${surface.channel}</option>`,
        )}
      </datalist>
    </form>
  `;
}

function renderTaskLoopControls(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement | null;
        if (!form) {
          return;
        }
        const formData = new FormData(form);
        void props.onTaskLoopConfigure({
          defaultBudgetMode:
            (readText(
              formData,
              "defaultBudgetMode",
            ) as RuntimeTaskLoopConfigureInput["defaultBudgetMode"]) || undefined,
          defaultRetrievalMode:
            (readText(
              formData,
              "defaultRetrievalMode",
            ) as RuntimeTaskLoopConfigureInput["defaultRetrievalMode"]) || undefined,
          maxInputTokensPerTurn: readPositiveNumber(formData, "maxInputTokensPerTurn"),
          maxContextChars: readPositiveNumber(formData, "maxContextChars"),
          compactionWatermark: readPositiveNumber(formData, "compactionWatermark"),
          maxRemoteCallsPerTask: readPositiveNumber(formData, "maxRemoteCallsPerTask"),
          leaseDurationMs:
            (readPositiveNumber(formData, "leaseDurationSeconds") ?? 0) > 0
              ? (readPositiveNumber(formData, "leaseDurationSeconds") ?? 0) * 1000
              : undefined,
          maxConcurrentRunsPerWorker: readPositiveNumber(formData, "maxConcurrentRunsPerWorker"),
          maxConcurrentRunsPerRoute: readPositiveNumber(formData, "maxConcurrentRunsPerRoute"),
        });
      }}
    >
      <div class="card-sub">Task loop defaults, lease duration, and concurrency slots.</div>
      <div style=${FORM_GRID_STYLE}>
        <label>
          <div class="muted">Default budget</div>
          <select name="defaultBudgetMode">
            <option value="strict" ?selected=${snapshot.retrieval.defaultBudgetMode === "strict"}>
              strict
            </option>
            <option
              value="balanced"
              ?selected=${snapshot.retrieval.defaultBudgetMode === "balanced"}
            >
              balanced
            </option>
            <option value="deep" ?selected=${snapshot.retrieval.defaultBudgetMode === "deep"}>
              deep
            </option>
          </select>
        </label>
        <label>
          <div class="muted">Default retrieval</div>
          <select name="defaultRetrievalMode">
            <option value="off" ?selected=${snapshot.retrieval.defaultRetrievalMode === "off"}>
              off
            </option>
            <option
              value="light"
              ?selected=${snapshot.retrieval.defaultRetrievalMode === "light"}
            >
              light
            </option>
            <option value="deep" ?selected=${snapshot.retrieval.defaultRetrievalMode === "deep"}>
              deep
            </option>
          </select>
        </label>
        <label>
          <div class="muted">Lease seconds</div>
          <input
            name="leaseDurationSeconds"
            type="number"
            min="1"
            step="1"
            .value=${String(Math.round(snapshot.tasks.leaseDurationMs / 1000))}
          />
        </label>
        <label>
          <div class="muted">Worker slots</div>
          <input
            name="maxConcurrentRunsPerWorker"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.tasks.maxConcurrentRunsPerWorker)}
          />
        </label>
        <label>
          <div class="muted">Route slots</div>
          <input
            name="maxConcurrentRunsPerRoute"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.tasks.maxConcurrentRunsPerRoute)}
          />
        </label>
        <label>
          <div class="muted">Max remote calls</div>
          <input
            name="maxRemoteCallsPerTask"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.retrieval.maxRemoteCallsPerTask)}
          />
        </label>
        <label>
          <div class="muted">Max input tokens</div>
          <input
            name="maxInputTokensPerTurn"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.retrieval.maxInputTokensPerTurn)}
          />
        </label>
        <label>
          <div class="muted">Max context chars</div>
          <input
            name="maxContextChars"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.retrieval.maxContextChars)}
          />
        </label>
        <label>
          <div class="muted">Compaction watermark</div>
          <input
            name="compactionWatermark"
            type="number"
            min="1"
            step="1"
            .value=${String(snapshot.retrieval.compactionWatermark)}
          />
        </label>
      </div>
      <div class="row" style="margin-top: 12px; gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.loading}>
          ${props.loading ? "Saving..." : "Save Task Loop Policy"}
        </button>
      </div>
    </form>
  `;
}

function renderRecentTasks(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const tasks = snapshot.tasks.tasks.slice(0, 5);
  return tasks.length === 0
    ? html`
        <div class="muted">No task history in the authoritative store yet.</div>
      `
    : html`${tasks.map(
        (task) => html`
          <div
            class="row spread"
            style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
          >
            <div style="min-width: 0;">
              <div><strong>${clampText(task.title, 72)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${task.route} · ${task.status} · updated ${formatRelativeTimestamp(task.updatedAt)}
              </div>
              ${
                task.agentId || task.surfaceId || task.sessionId
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      binding${
                        task.agentId ? html` · agent ${task.agentLabel ?? task.agentId}` : nothing
                      }${
                        task.surfaceId
                          ? html` · surface ${task.surfaceLabel ?? task.surfaceId}`
                          : nothing
                      }${
                        task.sessionId
                          ? html` · session ${task.sessionLabel ?? task.sessionId}`
                          : nothing
                      }
                    </div>
                  `
                  : nothing
              }
              ${
                task.thinkingLane ||
                task.recommendedWorker ||
                task.recommendedSkills.length > 0 ||
                task.reportPolicy ||
                task.reportVerbosity ||
                task.interruptionThreshold ||
                task.confirmationBoundary ||
                task.contextSummary ||
                task.contextSynthesis.length > 0 ||
                task.strategyCandidateIds.length > 0 ||
                task.archiveCandidateIds.length > 0 ||
                task.relevantMemoryIds.length > 0 ||
                task.relevantSessionIds.length > 0 ||
                task.fallbackOrder.length > 0
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      decision ${task.thinkingLane ?? "system1"}${
                        task.lastDecisionAt
                          ? html` · ${formatRelativeTimestamp(task.lastDecisionAt)}`
                          : nothing
                      }${
                        task.recommendedWorker ? html` · worker ${task.recommendedWorker}` : nothing
                      }${
                        task.recommendedSkills.length > 0
                          ? html` · skills ${clampText(formatList(task.recommendedSkills), 72)}`
                          : nothing
                      }
                    </div>
                    ${
                      task.reportPolicy ||
                      task.reportVerbosity ||
                      task.interruptionThreshold ||
                      task.confirmationBoundary
                        ? html`
                          <div class="muted" style="font-size: 12px; margin-top: 4px;">
                            prefs ${task.reportPolicy ?? "reply"}${
                              task.reportVerbosity
                                ? html` · verbosity ${task.reportVerbosity}`
                                : nothing
                            }${
                              task.interruptionThreshold
                                ? html` · interrupt ${task.interruptionThreshold}`
                                : nothing
                            }${
                              task.confirmationBoundary
                                ? html` · confirm ${task.confirmationBoundary}`
                                : nothing
                            }
                          </div>
                        `
                        : nothing
                    }
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      retrieval ${task.retrievalQueryId ?? "local"}${
                        task.contextSummary
                          ? html` · ${clampText(task.contextSummary, 96)}`
                          : nothing
                      }
                    </div>
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      planes strategy ${task.strategyCandidateIds.length} · archive
                      ${task.archiveCandidateIds.length} · memory ${task.relevantMemoryIds.length}
                      · session ${task.relevantSessionIds.length}${
                        task.fallbackOrder.length > 0
                          ? html` · fallback ${clampText(formatList(task.fallbackOrder), 72)}`
                          : nothing
                      }
                    </div>
                    ${
                      task.contextSynthesis.length > 0
                        ? html`
                          <div class="muted" style="font-size: 12px; margin-top: 4px;">
                            synthesis ${clampText(formatList(task.contextSynthesis), 120)}
                          </div>
                        `
                        : nothing
                    }
                  `
                  : nothing
              }
              ${
                task.parentTaskId
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      derived from ${task.parentTaskId} · root ${task.rootTaskId}
                    </div>
                  `
                  : nothing
              }
              ${
                task.recurring || task.maintenance || task.scheduleIntervalMinutes
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      ${task.recurring ? "recurring" : task.maintenance ? "maintenance" : "scheduled"}
                      ${
                        formatTaskCadence(task.scheduleIntervalMinutes)
                          ? html` · ${formatTaskCadence(task.scheduleIntervalMinutes)}`
                          : nothing
                      }
                    </div>
                  `
                  : nothing
              }
              ${
                task.nextRunAt
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      next run ${formatRelativeTimestamp(task.nextRunAt)}
                    </div>
                  `
                  : nothing
              }
              ${
                task.lastRetryStrategyId ||
                task.lastRetryDelayMinutes ||
                task.lastRetryBlockedThreshold
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      retry${
                        task.lastRetryStrategyId
                          ? html` · strategy ${task.lastRetryStrategyId}`
                          : nothing
                      }${
                        task.lastRetryDelayMinutes
                          ? html` · ${task.lastRetryDelayMinutes}m`
                          : nothing
                      }${
                        task.lastRetryBlockedThreshold
                          ? html` · pause after ${task.lastRetryBlockedThreshold} failures`
                          : nothing
                      }
                    </div>
                  `
                  : nothing
              }
              ${
                task.userResponseCount || task.lastUserResponseAt || task.lastUserResponseSummary
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      user responses ${task.userResponseCount ?? 0}
                      ${
                        task.lastUserResponseAt
                          ? html`· last ${formatRelativeTimestamp(task.lastUserResponseAt)}`
                          : nothing
                      }
                      ${
                        task.lastUserResponseSummary
                          ? html`· ${clampText(task.lastUserResponseSummary, 72)}`
                          : nothing
                      }
                    </div>
                  `
                  : nothing
              }
              ${
                task.needsReplan || task.invalidatedMemoryIds.length > 0
                  ? html`
                    <div class="muted" style="font-size: 12px; margin-top: 4px;">
                      ${task.needsReplan ? "structured replan pending" : "replanned"} · invalidated
                      memories ${task.invalidatedMemoryIds.length} · reasons
                      ${task.invalidatedBy.length}
                      ${
                        task.lastReplannedAt
                          ? html`· last replan ${formatRelativeTimestamp(task.lastReplannedAt)}`
                          : nothing
                      }
                    </div>
                  `
                  : nothing
              }
            </div>
            <div style="display:grid; gap: 8px; justify-items:end;">
              <div class="pill">${task.priority}</div>
              ${
                canManuallyPlanTask(task.status)
                  ? html`
                    <button
                      class="btn secondary"
                      type="button"
                      @click=${() => {
                        void props.onTaskPlan(task.id);
                      }}
                    >
                      Plan now
                    </button>
                  `
                  : nothing
              }
            </div>
          </div>
        `,
      )}`;
}

function formatTaskReportKind(
  kind: RuntimeDashboardSnapshot["notify"]["recentReports"][number]["kind"],
) {
  switch (kind) {
    case "waiting_user":
      return "Waiting user";
    case "completion":
      return "Completion";
    case "blocked":
      return "Blocked";
    case "waiting_external":
      return "Waiting external";
    case "cancelled":
      return "Cancelled";
    default:
      return kind;
  }
}

function renderRuntimeNotifyLedger(snapshot: RuntimeDashboardSnapshot) {
  const reports = snapshot.notify.recentReports;
  return html`
    <div style="display:grid; gap: 12px;">
      <div class="stat-grid stat-grid--4">
        ${renderStat("Pending", snapshot.notify.pendingCount)}
        ${renderStat("Delivered", snapshot.notify.deliveredCount)}
        ${renderStat("Resolved", snapshot.notify.resolvedCount)}
        ${renderStat("Waiting user", snapshot.notify.waitingUserPendingCount)}
        ${renderStat("Proactive", snapshot.notify.proactiveReportCount)}
      </div>
      <div class="muted" style="font-size: 12px;">
        Durable local notify/report ledger generated by the canonical task loop. Waiting-user items stay
        pending until the operator responds; proactive updates are preserved as delivered history.
      </div>
      <div class="list">
        ${
          reports.length === 0
            ? html`
                <div class="muted">No local task reports yet.</div>
              `
            : reports.map(
                (report) => html`
                <div class="list-item" style="display:grid; gap: 8px;">
                  <div class="list-main">
                    <div class="list-title">${report.title}</div>
                  <div class="list-sub">
                      ${formatTaskReportKind(report.kind)} · ${report.state} · ${report.reportPolicy} ·
                      ${formatRelativeTimestamp(report.updatedAt)}
                    </div>
                  </div>
                  <div class="muted" style="font-size: 12px;">${report.summary}</div>
                  <div class="mono" style="font-size: 12px;">
                    task=${report.taskId} · run=${report.runId} · status=${report.taskStatus} ·
                    verbosity=${report.reportVerbosity ?? "balanced"} · interrupt=${
                      report.interruptionThreshold ?? "medium"
                    } · confirm=${report.confirmationBoundary ?? "balanced"}
                  </div>
                  <div class="mono" style="font-size: 12px;">
                    notify=${report.reportTarget ?? "runtime-user"}${
                      report.surfaceLabel
                        ? ` · surface=${report.surfaceLabel}${report.surfaceId ? ` (${report.surfaceId})` : ""}`
                        : report.surfaceId
                          ? ` · surface=${report.surfaceId}`
                          : ""
                    }${report.agentId ? ` · agent=${report.agentId}` : ""}${
                      report.sessionId ? ` · session=${report.sessionId}` : ""
                    }${report.escalationTarget ? ` · escalate=${report.escalationTarget}` : ""}
                  </div>
                  ${
                    report.nextAction
                      ? html`
                        <div class="muted" style="font-size: 12px;">
                          Next action: ${clampText(report.nextAction, 120)}
                        </div>
                      `
                      : nothing
                  }
                </div>
              `,
              )
        }
      </div>
    </div>
  `;
}

function renderTaskReviewLedger(snapshot: RuntimeDashboardSnapshot) {
  const reviews = snapshot.tasks.recentReviews;
  return html`
    <div style="display:grid; gap: 12px;">
      <div class="stat-grid stat-grid--4">
        ${renderStat("Reviews", snapshot.tasks.reviewCount)}
        ${renderStat(
          "Recent review memories",
          reviews.reduce((sum, review) => sum + review.extractedMemoryIds.length, 0),
        )}
        ${renderStat(
          "Recent strategy candidates",
          reviews.reduce((sum, review) => sum + review.strategyCandidateIds.length, 0),
        )}
        ${renderStat(
          "Recent meta-learning",
          reviews.reduce((sum, review) => sum + review.metaLearningIds.length, 0),
        )}
      </div>
      <div class="muted" style="font-size: 12px;">
        Structured local review/distill ledger from the canonical task loop. Completion, waiting-user,
        and blocked terminal states stay auditable here with their extracted memory and strategy output.
      </div>
      <div class="list">
        ${
          reviews.length === 0
            ? html`
                <div class="muted">No local task reviews yet.</div>
              `
            : reviews.map(
                (review) => html`
                <div class="list-item" style="display:grid; gap: 8px;">
                  <div class="list-main">
                    <div class="list-title">${review.taskTitle}</div>
                    <div class="list-sub">
                      ${review.outcome} · ${formatRelativeTimestamp(review.createdAt)} ·
                      ${review.shareable ? "shareable" : "local-only"}
                    </div>
                  </div>
                  <div class="muted" style="font-size: 12px;">
                    ${clampText(review.summary, 140)}
                  </div>
                  <div class="mono" style="font-size: 12px;">
                    task=${review.taskId} · run=${review.runId}
                  </div>
                  <div class="muted" style="font-size: 12px;">
                    memories ${review.extractedMemoryIds.length} · strategies
                    ${review.strategyCandidateIds.length} · meta-learning
                    ${review.metaLearningIds.length}
                  </div>
                </div>
              `,
              )
        }
      </div>
    </div>
  `;
}

function renderRecentMemories(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const memories = snapshot.memory.memories.slice(0, 5);
  return memories.length === 0
    ? html`
        <div class="muted">No formal memories in the authoritative store yet.</div>
      `
    : html`${memories.map(
        (memory) => html`
          <div
            class="row spread"
            style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
          >
            <div style="min-width: 0;">
              <div><strong>${clampText(memory.summary, 96)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${memory.memoryType}${memory.route ? html` · ${memory.route}` : nothing} ·
                ${formatRelativeTimestamp(memory.updatedAt)}
              </div>
              <div class="muted" style="font-size: 12px;">
                decay ${memory.decayScore ?? 0} · reinforced
                ${
                  memory.lastReinforcedAt
                    ? formatRelativeTimestamp(memory.lastReinforcedAt)
                    : "never"
                }${
                  memory.invalidated
                    ? html`
                        · invalidated
                      `
                    : nothing
                }
              </div>
              <div class="muted" style="font-size: 12px;">
                sources task ${memory.sourceTaskIds.length} · event ${memory.sourceEventIds.length} ·
                intel ${memory.sourceIntelIds.length}
              </div>
              <div class="muted" style="font-size: 12px;">
                lineage parents ${memory.derivedFromMemoryIds.length} · downstream
                ${memory.downstreamMemoryIds.length} · linked strategies
                ${memory.linkedStrategyIds.length}
              </div>
              ${
                memory.tags.length > 0
                  ? html`
                    <div class="muted" style="font-size: 12px;">
                      tags ${clampText(formatList(memory.tags), 120)}
                    </div>
                  `
                  : nothing
              }
              ${
                memory.invalidatedBy.length > 0
                  ? html`
                    <div class="muted" style="font-size: 12px;">
                      invalidated by ${clampText(formatList(memory.invalidatedBy), 120)}
                    </div>
                  `
                  : nothing
              }
            </div>
            <div style="display:grid; gap: 8px; justify-items: end;">
              <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: end;">
                <div class="pill">${formatConfidencePercent(memory.confidence)}</div>
                ${
                  memory.shareable
                    ? html`
                        <div class="pill ok">shareable</div>
                      `
                    : nothing
                }
                ${
                  memory.teamShareable
                    ? html`
                        <div class="pill">team</div>
                      `
                    : nothing
                }
              </div>
              <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: end;">
                <button
                  type="button"
                  class="btn btn--sm"
                  ?disabled=${props.loading || memory.invalidated}
                  @click=${() => {
                    const reason = window.prompt("Reinforcement reason (optional)", "") ?? "";
                    void props.onMemoryReinforce({
                      memoryIds: [memory.id],
                      reason: reason.trim() || undefined,
                    });
                  }}
                >
                  Reinforce
                </button>
                <button
                  type="button"
                  class="btn btn--sm danger"
                  ?disabled=${props.loading || memory.invalidated}
                  @click=${() => {
                    const reason =
                      window.prompt(
                        "Invalidation reason/event id",
                        `runtime-memory-invalidate-${memory.id}-${Date.now()}`,
                      ) ?? "";
                    if (!reason.trim()) {
                      return;
                    }
                    void props.onMemoryInvalidate({
                      memoryIds: [memory.id],
                      reasonEventId: reason.trim(),
                    });
                  }}
                >
                  Invalidate
                </button>
                ${
                  memory.activeInvalidationEventId
                    ? html`
                      <button
                        type="button"
                        class="btn btn--sm"
                        ?disabled=${props.loading}
                        @click=${() => {
                          void props.onMemoryRollback({
                            invalidationEventId: memory.activeInvalidationEventId as string,
                          });
                        }}
                      >
                        Roll Back
                      </button>
                    `
                    : nothing
                }
              </div>
            </div>
          </div>
        `,
      )}`;
}

function renderMemoryLifecycleEvents(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const events = snapshot.memory.recentLifecycleEvents;
  return events.length === 0
    ? html`
        <div class="muted">No lifecycle review, reinforcement, or rollback events yet.</div>
      `
    : html`${events.map(
        (event) => html`
          <div
            class="row spread"
            style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
          >
            <div style="min-width: 0;">
              <div><strong>${event.label}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${event.type} · ${formatRelativeTimestamp(event.createdAt)} · memories
                ${event.memoryIds.length} · strategies ${event.strategyIds.length} · learnings
                ${event.metaLearningIds.length} · evolution ${event.evolutionIds.length}
              </div>
              ${
                event.reason
                  ? html`<div class="muted" style="font-size: 12px;">
                    reason ${clampText(event.reason, 96)}
                  </div>`
                  : nothing
              }
            </div>
            ${
              event.rollbackAvailable && event.invalidationEventId
                ? html`<button
                  type="button"
                  class="btn btn--sm"
                  ?disabled=${props.loading}
                  @click=${() => {
                    void props.onMemoryRollback({
                      invalidationEventId: event.invalidationEventId ?? event.id,
                    });
                  }}
                >
                  Roll Back
                </button>`
                : nothing
            }
          </div>
        `,
      )}`;
}

function renderMemoryLifecycleControls(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onMemoryConfigure({
          enabled: readChecked(formData, "enabled"),
          reviewIntervalHours: readOptionalNumber(formData, "reviewIntervalHours"),
          decayGraceDays: readOptionalNumber(formData, "decayGraceDays"),
          minDecayIncreasePerReview: readOptionalNumber(formData, "minDecayIncreasePerReview"),
          agePressurePerDay: readOptionalNumber(formData, "agePressurePerDay"),
          confidencePenaltyDivisor: readOptionalNumber(formData, "confidencePenaltyDivisor"),
          linkedStrategyConfidencePenalty: readOptionalNumber(
            formData,
            "linkedStrategyConfidencePenalty",
          ),
          highDecayThreshold: readOptionalNumber(formData, "highDecayThreshold"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field" style="justify-content: end;">
          <span>Lifecycle review enabled</span>
          <input
            type="checkbox"
            name="enabled"
            ?checked=${snapshot.memory.lifecycleReviewEnabled}
          />
        </label>
        <label class="field">
          <span>Review interval (hours)</span>
          <input
            name="reviewIntervalHours"
            type="number"
            min="1"
            max="168"
            .value=${String(snapshot.memory.reviewIntervalHours)}
          />
        </label>
        <label class="field">
          <span>Grace window (days)</span>
          <input
            name="decayGraceDays"
            type="number"
            min="1"
            max="90"
            .value=${String(snapshot.memory.lifecyclePolicy.decayGraceDays)}
          />
        </label>
        <label class="field">
          <span>Min decay per review</span>
          <input
            name="minDecayIncreasePerReview"
            type="number"
            min="1"
            max="25"
            .value=${String(snapshot.memory.lifecyclePolicy.minDecayIncreasePerReview)}
          />
        </label>
        <label class="field">
          <span>Age pressure / day</span>
          <input
            name="agePressurePerDay"
            type="number"
            min="1"
            max="25"
            .value=${String(snapshot.memory.lifecyclePolicy.agePressurePerDay)}
          />
        </label>
        <label class="field">
          <span>Confidence divisor</span>
          <input
            name="confidencePenaltyDivisor"
            type="number"
            min="1"
            max="20"
            .value=${String(snapshot.memory.lifecyclePolicy.confidencePenaltyDivisor)}
          />
        </label>
        <label class="field">
          <span>Linked strategy penalty</span>
          <input
            name="linkedStrategyConfidencePenalty"
            type="number"
            min="1"
            max="25"
            .value=${String(snapshot.memory.lifecyclePolicy.linkedStrategyConfidencePenalty)}
          />
        </label>
        <label class="field">
          <span>High decay threshold</span>
          <input
            name="highDecayThreshold"
            type="number"
            min="1"
            max="100"
            .value=${String(snapshot.memory.lifecyclePolicy.highDecayThreshold)}
          />
        </label>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn primary" ?disabled=${props.loading}>Save Memory Policy</button>
        <button
          type="button"
          class="btn"
          ?disabled=${props.loading}
          @click=${() => {
            void props.onMemoryReview();
          }}
        >
          Run Memory Lifecycle Review
        </button>
      </div>
      <div class="muted" style="font-size: 12px;">
        Formal-memory aging, confidence penalty, linked-strategy downweighting, and high-decay
        classification all run against this authoritative lifecycle policy.
      </div>
    </form>
  `;
}

function renderIntelDomains(snapshot: RuntimeDashboardSnapshot) {
  return html`${snapshot.intel.domains.map(
    (domain) => html`
      <div class="row spread" style="padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div>
          <strong>${domain.label}</strong>
          <div class="muted" style="font-size: 12px;">
            ${domain.enabled ? "enabled" : "paused"} ·
            sources ${domain.enabledSourceCount}/${domain.sourceCount} · candidates ${domain.candidateCount}
            · selected ${domain.selectedCount} · pushed ${domain.digestCount} · ${domain.refreshStatus}
          </div>
          <div class="muted" style="font-size: 12px;">
            ${
              domain.lastSuccessfulRefreshAt
                ? `last good refresh ${formatRelativeTimestamp(domain.lastSuccessfulRefreshAt)}`
                : "no successful refresh yet"
            }
            ${domain.nextRefreshAt ? ` · next ${formatRelativeTimestamp(domain.nextRefreshAt)}` : ""}
            ${domain.stale ? " · stale" : ""}
          </div>
          ${
            domain.lastError
              ? html`<div class="muted" style="font-size: 12px;">last error: ${clampText(
                  domain.lastError,
                  120,
                )}</div>`
              : nothing
          }
        </div>
        <div class="muted" style="font-size: 12px;">
          ${
            domain.latestDeliveryAt
              ? formatRelativeTimestamp(domain.latestDeliveryAt)
              : "not pushed yet"
          }
        </div>
      </div>
    `,
  )}`;
}

function renderIntelSources(snapshot: RuntimeDashboardSnapshot) {
  const sources = snapshot.intel.sources;
  return sources.length === 0
    ? html`
        <div class="muted">No configured sources.</div>
      `
    : html`${sources.map(
        (source) => html`
          <div
            class="row spread"
            style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;"
          >
            <div style="min-width: 0;">
              <div><strong>${source.label}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${source.domain} · ${source.kind} · priority ${source.priority}${
                  source.custom ? " · custom" : ""
                } · ${source.refreshStatus}
              </div>
              <div class="muted" style="font-size: 12px;">
                ${
                  source.lastSuccessfulRefreshAt
                    ? `last good refresh ${formatRelativeTimestamp(source.lastSuccessfulRefreshAt)}`
                    : "no successful refresh yet"
                }
                ${source.nextRefreshAt ? ` · next ${formatRelativeTimestamp(source.nextRefreshAt)}` : ""}
                ${source.stale ? " · stale" : ""}
              </div>
              ${
                source.url
                  ? html`<div class="muted" style="font-size: 12px;">${clampText(source.url, 96)}</div>`
                  : nothing
              }
              ${
                source.lastError
                  ? html`<div class="muted" style="font-size: 12px;">last error: ${clampText(
                      source.lastError,
                      120,
                    )}</div>`
                  : nothing
              }
            </div>
            <div class="pill">${source.enabled ? "enabled" : "off"}</div>
          </div>
        `,
      )}`;
}

function renderIntelSourceProfiles(snapshot: RuntimeDashboardSnapshot) {
  const profiles = snapshot.intel.sourceProfiles;
  return profiles.length === 0
    ? html`
        <div class="muted">No authoritative source-profile metadata yet.</div>
      `
    : html`${profiles.map(
        (profile) => html`
          <div
            class="row spread"
            style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;"
          >
            <div style="min-width: 0;">
              <div><strong>${profile.label}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${profile.domain} · trust ${profile.trustScore}% · usefulness
                ${profile.usefulnessScore == null ? "n/a" : `${profile.usefulnessScore}%`} ·
                signals ${profile.usefulnessCount} · recent digests ${profile.recentDigestAppearances}
              </div>
              <div class="muted" style="font-size: 12px;">
                priority ${profile.priority}
                ${
                  profile.latestFetchAt
                    ? html` · latest fetch ${formatRelativeTimestamp(profile.latestFetchAt)}`
                    : nothing
                }
                ${profile.sourceType ? html` · ${profile.sourceType}` : nothing}
              </div>
            </div>
            <div class="pill">${profile.usefulnessCount > 0 ? "scored" : "cold"}</div>
          </div>
        `,
      )}`;
}

function renderIntelTopicProfiles(snapshot: RuntimeDashboardSnapshot) {
  const topics = snapshot.intel.topicProfiles;
  return topics.length === 0
    ? html`
        <div class="muted">No topic-weight metadata yet.</div>
      `
    : html`${topics.map(
        (topic) => html`
          <div
            class="row spread"
            style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;"
          >
            <div style="min-width: 0;">
              <div><strong>${topic.topic}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${topic.domain} · weight ${topic.weight}% · digest mentions ${topic.recentDigestMentions}
              </div>
            </div>
            <div class="muted" style="font-size: 12px;">
              ${formatRelativeTimestamp(topic.updatedAt)}
            </div>
          </div>
        `,
      )}`;
}

function renderIntelUsefulnessHistory(snapshot: RuntimeDashboardSnapshot) {
  const records = snapshot.intel.usefulnessHistory;
  return records.length === 0
    ? html`
        <div class="muted">No explicit source-usefulness signals recorded yet.</div>
      `
    : html`${records.map(
        (record) => html`
          <div
            class="row spread"
            style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;"
          >
            <div style="min-width: 0;">
              <div><strong>${record.title || record.intelId}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${record.domain} · ${record.sourceId} · usefulness ${record.usefulnessScore}%
                ${record.reason ? html` · ${record.reason}` : nothing}
              </div>
              ${
                record.promotedToMemoryId
                  ? html`<div class="muted" style="font-size: 12px;">
                      promoted to ${record.promotedToMemoryId}
                    </div>`
                  : nothing
              }
            </div>
            <div class="muted" style="font-size: 12px;">
              ${formatRelativeTimestamp(record.createdAt)}
            </div>
          </div>
        `,
      )}`;
}

function renderIntelDigestHistory(snapshot: RuntimeDashboardSnapshot) {
  const items = snapshot.intel.digestHistory;
  return items.length === 0
    ? html`
        <div class="muted">No digest history recorded yet.</div>
      `
    : html`${items.map(
        (item) => html`
          <div
            class="row spread"
            style="padding: 8px 0; border-bottom: 1px solid var(--line); gap: 12px; align-items: flex-start;"
          >
            <div style="min-width: 0;">
              <div><strong>${clampText(item.title, 88)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${item.domain} · ${item.exploit ? "exploit" : "explore"} ·
                ${formatRelativeTimestamp(item.createdAt)} · ${formatList(item.sourceIds)}
              </div>
              <div class="muted" style="font-size: 12px;">${clampText(item.whyItMatters, 120)}</div>
              <div class="muted" style="font-size: 12px;">
                attention ${item.recommendedAttention} · action ${item.recommendedAction}
              </div>
            </div>
            <div class="pill">${item.exploit ? "exploit" : "explore"}</div>
          </div>
        `,
      )}`;
}

function renderIntelRankHistory(snapshot: RuntimeDashboardSnapshot) {
  const records = snapshot.intel.rankHistory;
  return records.length === 0
    ? html`
        <div class="muted">No rank-history audit yet.</div>
      `
    : html`${records.map(
        (record) => html`
          <div
            class="row spread"
            style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;"
          >
            <div style="min-width: 0;">
              <div><strong>${clampText(record.title, 88)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${record.domain} · ${record.sourceId} · select #${record.selectionRank ?? "-"} · explore
                #${record.explorationRank ?? "-"}
              </div>
              <div class="muted" style="font-size: 12px;">
                selection ${record.selectionScore}% · exploration ${record.explorationScore}% ·
                ${record.selectedMode}
                ${
                  record.topicFingerprint
                    ? html` · topic ${clampText(record.topicFingerprint, 18)}`
                    : nothing
                }
              </div>
            </div>
            <div class="muted" style="font-size: 12px;">
              ${formatRelativeTimestamp(record.createdAt)}
            </div>
          </div>
        `,
      )}`;
}

function renderIntelRecentItems(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const items = snapshot.intel.recentItems.slice(0, 8);
  return items.length === 0
    ? html`
        <div class="muted">No recent intel items to promote yet.</div>
      `
    : html`${items.map(
        (item) => html`
          <div
            class="row spread"
            style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); align-items: flex-start;"
          >
            <div style="min-width: 0;">
              <div><strong>${clampText(item.title, 88)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${item.kind} · ${item.domain} · ${item.sourceLabel} ·
                ${formatRelativeTimestamp(item.createdAt)}
              </div>
              <div class="muted" style="font-size: 12px; margin-top: 4px;">
                ${clampText(item.summary || "No summary.", 140)}
              </div>
            </div>
            <div style="display:grid; gap: 8px; justify-items: end;">
              <div class="pill">${item.exploit ? "exploit" : `${item.score}%`}</div>
              ${
                item.pinned
                  ? html`
                      <div class="pill ok">pinned</div>
                    `
                  : html`<button
                      class="btn btn--sm"
                      ?disabled=${props.loading}
                      @click=${() => {
                        void props.onIntelPin({
                          intelId: item.id,
                          promotedBy: "runtime-user",
                        });
                      }}
                    >
                      Pin to Knowledge
                    </button>`
              }
            </div>
          </div>
        `,
      )}`;
}

function renderUserModelForm(
  store: RuntimeUserConsoleStore,
  snapshot: RuntimeDashboardSnapshot | null,
  props: RuntimeProps,
) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onUserModelSave({
          displayName: readText(formData, "displayName"),
          communicationStyle: readText(formData, "communicationStyle"),
          interruptionThreshold: readInterruptionThreshold(formData, "interruptionThreshold"),
          reportVerbosity: readReportVerbosity(formData, "reportVerbosity"),
          confirmationBoundary: readConfirmationBoundary(formData, "confirmationBoundary"),
          reportPolicy: readReportPolicy(formData, "reportPolicy"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field">
          <span>Display name</span>
          <input name="displayName" .value=${store.userModel.displayName ?? ""} />
        </label>
        <label class="field">
          <span>Report policy</span>
          <select name="reportPolicy">
            ${["reply", "proactive", "reply_and_proactive", "silent"].map(
              (value) => html`<option
                value=${value}
                ?selected=${(store.userModel.reportPolicy ?? "reply") === value}
              >
                ${value}
              </option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>Interruption threshold</span>
          <select name="interruptionThreshold">
            ${["low", "medium", "high"].map(
              (value) => html`<option
                value=${value}
                ?selected=${(store.userModel.interruptionThreshold ?? "medium") === value}
              >
                ${value}
              </option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>Report verbosity</span>
          <select name="reportVerbosity">
            ${["brief", "balanced", "detailed"].map(
              (value) => html`<option
                value=${value}
                ?selected=${(store.userModel.reportVerbosity ?? "balanced") === value}
              >
                ${value}
              </option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>Confirmation boundary</span>
          <select name="confirmationBoundary">
            ${["strict", "balanced", "light"].map(
              (value) => html`<option
                value=${value}
                ?selected=${(store.userModel.confirmationBoundary ?? "balanced") === value}
              >
                ${value}
              </option>`,
            )}
          </select>
        </label>
      </div>
      <label class="field">
        <span>Communication style</span>
        <textarea
          name="communicationStyle"
          rows="3"
          .value=${store.userModel.communicationStyle ?? ""}
        ></textarea>
      </label>
      <div class="card" style="padding: 12px;">
        <div class="card-title">USER.md Mirror</div>
        <div class="muted" style="font-size: 12px; margin-top: 6px;">
          Manual long-term preference mirror for the authoritative Runtime user model.
        </div>
        <div class="mono" style="font-size: 12px; margin-top: 8px;">
          ${snapshot?.userConsole.mirror.path ?? "USER.md path unavailable"}
        </div>
        <div class="muted" style="font-size: 12px; margin-top: 8px;">
          ${
            snapshot?.userConsole.mirror.exists
              ? `Last modified ${
                  snapshot.userConsole.mirror.lastModifiedAt
                    ? formatRelativeTimestamp(snapshot.userConsole.mirror.lastModifiedAt)
                    : "just now"
                }`
              : "Mirror file not created yet."
          }
          ${
            snapshot?.userConsole.mirror.lastSyncedAt
              ? ` · last synced ${formatRelativeTimestamp(snapshot.userConsole.mirror.lastSyncedAt)}`
              : ""
          }
          ${
            snapshot?.userConsole.mirror.lastImportedAt
              ? ` · last imported ${formatRelativeTimestamp(snapshot.userConsole.mirror.lastImportedAt)}`
              : ""
          }
        </div>
        ${
          snapshot?.userConsole.mirror.pendingImport
            ? html`
                <div class="muted" style="font-size: 12px; margin-top: 8px; color: var(--warning-strong, #b45309)">
                  USER.md has newer manual edits waiting to be imported.
                </div>
              `
            : nothing
        }
        <div class="row" style="gap: 12px; align-items: center; margin-top: 12px;">
          <button
            type="button"
            class="btn"
            ?disabled=${props.loading}
            @click=${() => {
              void props.onUserModelMirrorSync(snapshot?.userConsole.mirror.pendingImport === true);
            }}
          >
            ${snapshot?.userConsole.mirror.pendingImport ? "Force Sync USER.md" : "Sync USER.md"}
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${props.loading || !snapshot?.userConsole.mirror.exists}
            @click=${() => {
              void props.onUserModelMirrorImport();
            }}
          >
            Import USER.md
          </button>
        </div>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn primary" ?disabled=${props.loading}>Save User Console</button>
        <div class="muted" style="font-size: 12px;">
          This writes the local Runtime user model, not an agent persona.
        </div>
      </div>
    </form>
  `;
}

function renderUserConsoleMaintenanceControls(
  snapshot: RuntimeDashboardSnapshot,
  props: RuntimeProps,
) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onUserConsoleMaintenanceConfigure({
          enabled: readChecked(formData, "enabled"),
          reviewIntervalHours: readOptionalNumber(formData, "reviewIntervalHours"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field" style="justify-content: end;">
          <span>Maintenance enabled</span>
          <input
            type="checkbox"
            name="enabled"
            ?checked=${snapshot.userConsole.maintenanceEnabled}
          />
        </label>
        <label class="field">
          <span>Review interval hours</span>
          <input
            name="reviewIntervalHours"
            type="number"
            min="1"
            max="168"
            step="1"
            .value=${String(snapshot.userConsole.reviewIntervalHours)}
          />
        </label>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.loading}>
          ${props.loading ? "Saving..." : "Save User Console Maintenance"}
        </button>
        <div class="muted" style="font-size: 12px;">
          Controls the same authoritative cleanup and optimization review cadence used by idle
          task-loop ticks.
        </div>
      </div>
    </form>
  `;
}

function renderSessionPreferenceEditor(
  preference: RuntimeUserConsoleStore["sessionWorkingPreferences"][number] | undefined,
  props: RuntimeProps,
) {
  const title = preference?.label || preference?.sessionId || "Create Session Preference";
  const subtitle = preference
    ? `${preference.sessionId}${preference.expiresAt ? ` · expires ${formatRelativeTimestamp(preference.expiresAt)}` : " · no expiry"}`
    : "Temporary working preference that does not overwrite the long-term user model.";
  return html`
    <div class="list-item" style="display:grid; gap: 12px;">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">${subtitle}</div>
      </div>
      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          void props.onSessionPreferenceSave({
            id: preference?.id,
            sessionId: readText(formData, "sessionId"),
            label: readText(formData, "label"),
            communicationStyle: readText(formData, "communicationStyle"),
            interruptionThreshold: readInterruptionThreshold(formData, "interruptionThreshold"),
            reportVerbosity: readReportVerbosity(formData, "reportVerbosity"),
            confirmationBoundary: readConfirmationBoundary(formData, "confirmationBoundary"),
            reportPolicy: readReportPolicy(formData, "reportPolicy"),
            notes: readText(formData, "notes"),
            expiresAt: readOptionalDateTime(formData, "expiresAt"),
          });
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Session id</span>
            <input name="sessionId" .value=${preference?.sessionId ?? ""} required />
          </label>
          <label class="field">
            <span>Label</span>
            <input name="label" .value=${preference?.label ?? ""} placeholder="Launch week focus" />
          </label>
          <label class="field">
            <span>Report policy</span>
            <select name="reportPolicy">
              ${["reply", "proactive", "reply_and_proactive", "silent"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(preference?.reportPolicy ?? "reply") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Expires at</span>
            <input
              type="datetime-local"
              name="expiresAt"
              .value=${formatDateTimeLocal(preference?.expiresAt)}
            />
          </label>
          <label class="field">
            <span>Interruption threshold</span>
            <select name="interruptionThreshold">
              ${["low", "medium", "high"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(preference?.interruptionThreshold ?? "medium") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Report verbosity</span>
            <select name="reportVerbosity">
              ${["brief", "balanced", "detailed"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(preference?.reportVerbosity ?? "balanced") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Confirmation boundary</span>
            <select name="confirmationBoundary">
              ${["strict", "balanced", "light"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(preference?.confirmationBoundary ?? "balanced") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Communication style</span>
          <textarea
            name="communicationStyle"
            rows="2"
            .value=${preference?.communicationStyle ?? ""}
          ></textarea>
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea name="notes" rows="2" .value=${preference?.notes ?? ""}></textarea>
        </label>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn primary" ?disabled=${props.loading}>
            ${preference ? "Save Session Preference" : "Create Session Preference"}
          </button>
          ${
            preference
              ? html`<button
                  type="button"
                  class="btn danger"
                  ?disabled=${props.loading}
                  @click=${() => {
                    if (window.confirm(`Delete session preference "${preference.sessionId}"?`)) {
                      void props.onSessionPreferenceDelete(preference.id);
                    }
                  }}
                >
                  Delete
                </button>`
              : nothing
          }
        </div>
      </form>
    </div>
  `;
}

function renderSessionPreferenceEditors(store: RuntimeUserConsoleStore, props: RuntimeProps) {
  const activePreferences = [...store.sessionWorkingPreferences].toSorted(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId),
  );
  return html`
    ${
      activePreferences.length === 0
        ? html`
            <div class="muted">No temporary session preferences yet.</div>
          `
        : activePreferences.map((entry) => renderSessionPreferenceEditor(entry, props))
    }
    ${renderSessionPreferenceEditor(undefined, props)}
  `;
}

function renderAgentEditor(
  store: RuntimeUserConsoleStore,
  snapshot: RuntimeDashboardSnapshot | undefined,
  props: RuntimeProps,
  agent?: RuntimeUserConsoleStore["agents"][number],
) {
  const overlay = agent
    ? store.agentOverlays.find((entry) => entry.agentId === agent.id)
    : undefined;
  const status = agent ? snapshot?.agents.find((entry) => entry.id === agent.id) : undefined;
  const title = agent ? agent.name : "Create Agent";
  const subtitle = agent
    ? `${agent.roleBase || "role unset"} · ${agent.active ? "active" : "paused"}`
    : "Local ecology object. Not the runtime itself.";
  return html`
    <div class="list-item" style="display:grid; gap: 12px;">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">${subtitle}</div>
      </div>
      ${
        status
          ? html`<div
              class="mono"
              style="display:grid; gap: 6px; font-size: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 10px;"
            >
              <div>
                surfaces=${status.surfaceCount} | skills=${status.skillCount} | tasks=${status.openTaskCount}
                | waiting_user=${status.waitingUserTaskCount}
              </div>
              <div>
                reports=${status.recentReportCount} | completed=${status.recentCompletionReportCount}
                | follow-up=${status.followUpPressureCount} | blocked=${status.blockedReportCount}
                | waiting_external=${status.waitingExternalReportCount}
              </div>
              <div>
                intel=${status.recentIntelDeliveryCount} | role suggestions=${status.pendingRoleOptimizationCount}
                | coordinator pending=${status.pendingCoordinatorSuggestionCount} | materialized=${
                  status.materializedCoordinatorSuggestionCount
                }
              </div>
              <div>
                latest activity=${
                  status.latestActivityAt
                    ? formatRelativeTimestamp(status.latestActivityAt)
                    : "none"
                } | report=${status.reportPolicy ?? "default"}
              </div>
            </div>`
          : nothing
      }
      ${
        status
          ? html`
              <div>
                <div class="muted" style="font-size: 12px; margin-bottom: 8px;">Recent operating activity</div>
                ${renderEcologyActivityList(status.recentActivity)}
              </div>
            `
          : nothing
      }
      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          void props.onAgentSave({
            id: agent?.id,
            name: readText(formData, "name") || "Untitled agent",
            description: readText(formData, "description"),
            roleBase: readText(formData, "roleBase"),
            memoryNamespace: readText(formData, "memoryNamespace"),
            skillIds: readStringList(formData, "skillIds"),
            active: readChecked(formData, "active"),
            overlay: {
              communicationStyle: readText(formData, "overlayCommunicationStyle"),
              reportPolicy: readReportPolicy(formData, "overlayReportPolicy"),
              notes: readText(formData, "overlayNotes"),
            },
          });
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Name</span>
            <input name="name" .value=${agent?.name ?? ""} required />
          </label>
          <label class="field">
            <span>Role base</span>
            <input name="roleBase" .value=${agent?.roleBase ?? ""} />
          </label>
          <label class="field">
            <span>Memory namespace</span>
            <input
              name="memoryNamespace"
              .value=${agent?.memoryNamespace ?? ""}
              placeholder="agent/agent-id"
            />
          </label>
          <label class="field">
            <span>Skill ids</span>
            <input
              name="skillIds"
              .value=${agent?.skillIds.join(", ") ?? ""}
              placeholder="crm, follow-up"
            />
          </label>
        </div>
        <label class="field">
          <span>Description</span>
          <textarea name="description" rows="2" .value=${agent?.description ?? ""}></textarea>
        </label>
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Overlay communication style</span>
            <input
              name="overlayCommunicationStyle"
              .value=${overlay?.communicationStyle ?? ""}
            />
          </label>
          <label class="field">
            <span>Overlay report policy</span>
            <select name="overlayReportPolicy">
              ${["reply", "proactive", "reply_and_proactive", "silent"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(overlay?.reportPolicy ?? "reply") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
          <label class="field" style="justify-content: end;">
            <span>Active</span>
            <input type="checkbox" name="active" ?checked=${agent?.active ?? true} />
          </label>
        </div>
        <label class="field">
          <span>Overlay notes</span>
          <textarea name="overlayNotes" rows="2" .value=${overlay?.notes ?? ""}></textarea>
        </label>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn primary" ?disabled=${props.loading}>
            ${agent ? "Save Agent" : "Create Agent"}
          </button>
          ${
            agent
              ? html`<button
                  type="button"
                  class="btn danger"
                  ?disabled=${props.loading}
                  @click=${() => {
                    if (window.confirm(`Delete agent "${agent.name}"?`)) {
                      void props.onAgentDelete(agent.id);
                    }
                  }}
                >
                  Delete
                </button>`
              : nothing
          }
        </div>
      </form>
    </div>
  `;
}

function renderAgentEditors(
  store: RuntimeUserConsoleStore,
  snapshot: RuntimeDashboardSnapshot | undefined,
  props: RuntimeProps,
) {
  return html`
    ${
      store.agents.length === 0
        ? html`
            <div class="muted">No agents configured yet. Create the first one below.</div>
          `
        : store.agents.map((agent) => renderAgentEditor(store, snapshot, props, agent))
    }
    ${renderAgentEditor(store, snapshot, props)}
  `;
}

function formatEcologyActivityKind(
  kind: RuntimeDashboardSnapshot["agents"][number]["recentActivity"][number]["kind"],
): string {
  switch (kind) {
    case "task":
      return "Task";
    case "intel_delivery":
      return "Intel";
    case "role_optimization":
      return "Role";
    case "coordinator_suggestion":
      return "Coordinator";
    case "surface_policy":
      return "Policy";
    default:
      return kind;
  }
}

function renderEcologyActivityList(
  items: RuntimeDashboardSnapshot["agents"][number]["recentActivity"],
) {
  if (items.length === 0) {
    return html`
      <div class="muted">No recent operating activity recorded yet.</div>
    `;
  }
  return html`
    <div class="list">
      ${items.map(
        (item) => html`
          <div class="list-item" style="padding: 10px 12px;">
            <div class="row" style="justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;">
              <div class="list-main">
                <div class="list-title">${item.title}</div>
                <div class="list-sub">
                  ${formatEcologyActivityKind(item.kind)}
                  ${item.status ? html` · ${item.status}` : nothing}
                  ${item.route ? html` · route ${item.route}` : nothing}
                  ${item.worker ? html` · worker ${item.worker}` : nothing}
                  ${item.domain ? html` · ${item.domain}` : nothing}
                </div>
              </div>
              <div class="muted" style="font-size: 12px;">${formatRelativeTimestamp(item.updatedAt)}</div>
            </div>
            <div class="muted" style="font-size: 12px; margin-top: 6px;">${item.summary}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function formatUserActionKindLabel(
  kind: RuntimeDashboardSnapshot["userConsole"]["actionQueue"][number]["kind"],
): string {
  switch (kind) {
    case "waiting_user_task":
      return "Waiting user";
    case "evolution_candidate_review":
      return "Evolution approval";
    case "evolution_revert_recommendation":
      return "Live optimization review";
    case "user_model_mirror_import":
      return "USER.md import";
    case "user_model_optimization":
      return "User model";
    case "role_optimization":
      return "Role optimization";
    case "federation_package":
      return "Federation package";
    case "coordinator_suggestion":
      return "Coordinator suggestion";
    default:
      return kind;
  }
}

function renderUserConsoleActionItem(
  item: RuntimeDashboardSnapshot["userConsole"]["actionQueue"][number],
  props: RuntimeProps,
) {
  const buttons =
    item.kind === "waiting_user_task" && item.taskId
      ? html`
          <button
            class="btn"
            ?disabled=${props.loading}
            @click=${() => {
              const response =
                window.prompt(
                  "User response for this waiting task",
                  "Proceed with the current plan.",
                ) ?? "";
              if (!response.trim()) {
                return;
              }
              void props.onWaitingUserTaskRespond({
                taskId: item.taskId as string,
                response: response.trim(),
                respondedBy: "runtime-user",
                nextAction: "Replan the task using the latest user response.",
              });
            }}
          >
            Respond + Requeue
          </button>
        `
      : item.kind === "evolution_revert_recommendation" && item.candidateId
        ? html`
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                if (
                  !window.confirm(
                    "Revert this live optimization and invalidate its adopted strategy?",
                  )
                ) {
                  return;
                }
                void props.onEvolutionCandidateStateSet({
                  id: item.candidateId as string,
                  state: "reverted",
                  reason: "Reverted from the user console after post-adoption verification review.",
                });
              }}
            >
              Revert Optimization
            </button>
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                const note = window.prompt(
                  "Optional note for keeping this optimization live",
                  "Keep live for now while collecting more post-adoption evidence.",
                );
                if (note === null) {
                  return;
                }
                void props.onEvolutionVerificationAcknowledge({
                  id: item.candidateId as string,
                  note: note.trim() || undefined,
                });
              }}
            >
              Keep Live For Now
            </button>
          `
        : item.kind === "evolution_candidate_review" && item.candidateId
          ? html`
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                const reason = item.requiresReasonOnAdopt
                  ? window.prompt(
                      "Adoption reason",
                      "Adopt this optimization candidate after local review.",
                    )
                  : "Adopted from the user action queue after local review.";
                if (reason === null || (item.requiresReasonOnAdopt && !reason.trim())) {
                  return;
                }
                void props.onEvolutionCandidateStateSet({
                  id: item.candidateId as string,
                  state: "adopted",
                  reason:
                    reason?.trim() || "Adopted from the user action queue after local review.",
                });
              }}
            >
              Adopt
            </button>
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                const reason = window.prompt(
                  "Reject reason (optional)",
                  "Reject this optimization candidate from the user action queue.",
                );
                if (reason === null) {
                  return;
                }
                void props.onEvolutionCandidateStateSet({
                  id: item.candidateId as string,
                  state: "reverted",
                  reason:
                    reason.trim() ||
                    "Rejected this optimization candidate from the user action queue.",
                });
              }}
            >
              Reject
            </button>
          `
          : item.kind === "user_model_mirror_import"
            ? html`
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                void props.onUserModelMirrorImport();
              }}
            >
              Import USER.md
            </button>
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                if (
                  !window.confirm(
                    "Discard the pending manual USER.md edits and overwrite the mirror from the authoritative Runtime user model?",
                  )
                ) {
                  return;
                }
                void props.onUserModelMirrorSync(true);
              }}
            >
              Discard + Force Sync
            </button>
          `
            : item.kind === "user_model_optimization" && item.candidateId
              ? html`
          <button
            class="btn"
            ?disabled=${props.loading}
            @click=${() => {
              void props.onUserModelOptimizationAdopt(item.candidateId as string);
            }}
          >
            Adopt
          </button>
          <button
            class="btn"
            ?disabled=${props.loading}
            @click=${() => {
              const reason = window.prompt("Reject reason (optional)", "") ?? "";
              void props.onUserModelOptimizationReject({
                id: item.candidateId as string,
                reason: reason.trim() || undefined,
              });
            }}
          >
            Reject
          </button>
        `
              : item.kind === "role_optimization" && item.candidateId
                ? html`
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                void props.onRoleOptimizationAdopt(item.candidateId as string);
              }}
            >
              Adopt
            </button>
            <button
              class="btn"
              ?disabled=${props.loading}
              @click=${() => {
                const reason = window.prompt("Reject reason (optional)", "") ?? "";
                void props.onRoleOptimizationReject({
                  id: item.candidateId as string,
                  reason: reason.trim() || undefined,
                });
              }}
            >
              Reject
            </button>
          `
                : item.kind === "federation_package" && item.packageId
                  ? html`
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  void props.onFederationPackageTransition({
                    id: item.packageId as string,
                    state: "adopted",
                    reason: "Adopted from the user action queue.",
                  });
                }}
              >
                Adopt Package
              </button>
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  const reason = window.prompt("Reject reason (optional)", "") ?? "";
                  void props.onFederationPackageTransition({
                    id: item.packageId as string,
                    state: "rejected",
                    reason: reason.trim() || "Rejected from the user action queue.",
                  });
                }}
              >
                Reject Package
              </button>
            `
                  : item.kind === "coordinator_suggestion"
                    ? html`
                <button
                  class="btn"
                  ?disabled=${props.loading || Boolean(item.actionBlockedReason)}
                  @click=${() => {
                    if (!item.coordinatorSuggestionId || item.actionBlockedReason) {
                      return;
                    }
                    void props.onCoordinatorSuggestionMaterialize(item.coordinatorSuggestionId);
                  }}
                >
                  ${
                    item.escalationTarget === "surface-owner"
                      ? "Create Surface-Owned Task"
                      : "Create Queued Task"
                  }
                </button>
              `
                    : nothing;
  return html`
    <div class="list-item" style="display:grid; gap: 10px;">
      <div class="list-main">
        <div class="list-title">${item.title}</div>
        <div class="list-sub">
          ${formatUserActionKindLabel(item.kind)} · ${item.priority} priority ·
          ${formatRelativeTimestamp(item.updatedAt)}
          ${item.packageType ? html` · ${item.packageType}` : nothing}
        </div>
      </div>
      <div class="muted" style="font-size: 12px;">${item.summary}</div>
      ${item.taskId ? html`<div class="mono" style="font-size: 12px;">task=${item.taskId}</div>` : nothing}
      ${
        item.localTaskId
          ? html`<div class="mono" style="font-size: 12px;">local task=${item.localTaskId}</div>`
          : nothing
      }
      ${
        !item.localTaskId && item.lastLocalTaskId
          ? html`<div class="mono" style="font-size: 12px;">last local task=${item.lastLocalTaskId}</div>`
          : nothing
      }
      ${
        item.localTaskStatus
          ? html`<div class="mono" style="font-size: 12px;">local task status=${item.localTaskStatus}</div>`
          : nothing
      }
      ${
        item.rematerializeReason
          ? html`<div class="muted" style="font-size: 12px;">${item.rematerializeReason}</div>`
          : nothing
      }
      ${item.candidateId ? html`<div class="mono" style="font-size: 12px;">candidate=${item.candidateId}</div>` : nothing}
      ${
        item.candidateState
          ? html`<div class="mono" style="font-size: 12px;">candidate state=${item.candidateState}</div>`
          : nothing
      }
      ${
        item.estimatedImpact
          ? html`<div class="muted" style="font-size: 12px;">Estimated impact: ${item.estimatedImpact}</div>`
          : nothing
      }
      ${
        item.sourceTaskId
          ? html`<div class="mono" style="font-size: 12px;">source task=${item.sourceTaskId}</div>`
          : nothing
      }
      ${
        item.lastVerifiedAt
          ? html`<div class="mono" style="font-size: 12px;">last verified=${formatRelativeTimestamp(item.lastVerifiedAt)}</div>`
          : nothing
      }
      ${
        item.surfaceLabel || item.reportTarget
          ? html`<div class="mono" style="font-size: 12px;">
            notify=${item.reportTarget ?? "runtime-user"}${
              item.surfaceLabel ? ` | surface=${item.surfaceLabel}` : ""
            }${item.taskCreationPolicy ? ` | taskCreation=${item.taskCreationPolicy}` : ""}${
              item.escalationTarget ? ` | escalate=${item.escalationTarget}` : ""
            }
          </div>`
          : nothing
      }
      ${
        item.actionBlockedReason
          ? html`<div class="muted" style="font-size: 12px; color: var(--color-warning-strong);">
            ${item.actionBlockedReason}
          </div>`
          : nothing
      }
      ${
        item.mirrorPath
          ? html`<div class="mono" style="font-size: 12px;">mirror=${item.mirrorPath}</div>`
          : nothing
      }
      ${
        buttons === nothing
          ? nothing
          : html`<div class="row" style="gap: 12px; align-items: center;">${buttons}</div>`
      }
    </div>
  `;
}

function renderUserActionQueue(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const queue = snapshot.userConsole.actionQueue;
  return html`
    <div style="display:grid; gap: 12px;">
      <div class="stat-grid stat-grid--4">
        ${renderStat("Pending", snapshot.userConsole.pendingActionCount)}
        ${renderStat("Waiting user", snapshot.userConsole.waitingUserTaskCount)}
        ${renderStat("Recommended packages", snapshot.userConsole.recommendedFederationPackageCount)}
        ${renderStat("Coordinator queue", snapshot.userConsole.adoptedCoordinatorSuggestionCount)}
      </div>
      <div class="muted" style="font-size: 12px;">
        Unified local action queue for waiting tasks, USER.md mirror imports, recommended preference
        changes, live optimization review, federation review, and coordinator follow-ups.
      </div>
      <div class="list">
        ${
          queue.length === 0
            ? html`
                <div class="muted">No pending user actions right now.</div>
              `
            : queue.map((item) => renderUserConsoleActionItem(item, props))
        }
      </div>
    </div>
  `;
}

function renderUserModelOptimizationCandidate(
  candidate: RuntimeUserConsoleStore["userModelOptimizationCandidates"][number],
  props: RuntimeProps,
) {
  const proposed = candidate.proposedUserModel;
  const proposedValue =
    proposed.communicationStyle ??
    proposed.interruptionThreshold ??
    proposed.reportVerbosity ??
    proposed.confirmationBoundary ??
    proposed.reportPolicy ??
    "unset";
  const adoptable = candidate.state === "recommended" || candidate.state === "shadow";
  return html`
    <div class="list-item" style="display:grid; gap: 10px;">
      <div class="list-main">
        <div class="list-title">${candidate.summary}</div>
        <div class="list-sub">
          ${candidate.state} · ${formatConfidencePercent(candidate.confidence)} · sessions
          ${candidate.observedSessionIds.length}/${candidate.observationCount}
        </div>
      </div>
      <div class="mono" style="font-size: 12px;">
        ${candidate.field} => ${clampText(String(proposedValue), 96)}
      </div>
      <div class="muted" style="font-size: 12px;">
        ${candidate.reasoning.length === 0 ? "No local rationale recorded." : candidate.reasoning.join(" ")}
      </div>
      <div class="muted" style="font-size: 12px;">
        ${
          candidate.observedSessionIds.length === 0
            ? "No observed sessions captured."
            : `Observed sessions: ${candidate.observedSessionIds.join(", ")}`
        }
      </div>
      ${
        adoptable
          ? html`
            <div class="row" style="gap: 12px; align-items: center;">
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  void props.onUserModelOptimizationAdopt(candidate.id);
                }}
              >
                Adopt to User Core
              </button>
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  const reason = window.prompt("Reject reason (optional)", "") ?? "";
                  void props.onUserModelOptimizationReject({
                    id: candidate.id,
                    reason: reason.trim() || undefined,
                  });
                }}
              >
                Reject
              </button>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderUserModelOptimizationSection(
  store: RuntimeUserConsoleStore,
  snapshot: RuntimeDashboardSnapshot | null,
  props: RuntimeProps,
) {
  const candidates = [...store.userModelOptimizationCandidates].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.field.localeCompare(right.field),
  );
  return html`
    <div style="display:grid; gap: 12px;">
      <div class="row" style="gap: 12px; align-items: center;">
        <button
          class="btn"
          ?disabled=${props.loading}
          @click=${() => {
            void props.onUserModelOptimizationReview();
          }}
        >
          Run User Model Review
        </button>
        <div class="muted" style="font-size: 12px;">
          Distill repeated session preferences into adoptable long-term user model suggestions without mutating the user core automatically.
        </div>
      </div>
      <div class="stat-grid stat-grid--3">
        ${renderStat(
          "Recommended",
          snapshot?.userConsole.recommendedUserModelOptimizationCount ?? 0,
        )}
        ${renderStat("Shadow", snapshot?.userConsole.shadowUserModelOptimizationCount ?? 0)}
        ${renderStat("Total", candidates.length)}
      </div>
      <div class="list">
        ${
          candidates.length === 0
            ? html`
                <div class="muted">No user model optimization suggestions yet.</div>
              `
            : candidates.map((candidate) => renderUserModelOptimizationCandidate(candidate, props))
        }
      </div>
    </div>
  `;
}

function renderRoleOptimizationCandidate(
  candidate: RuntimeUserConsoleStore["roleOptimizationCandidates"][number],
  props: RuntimeProps,
) {
  const proposed = candidate.proposedOverlay;
  const proposedParts = [
    proposed.role ? `role=${proposed.role}` : null,
    proposed.businessGoal ? `goal=${clampText(proposed.businessGoal, 56)}` : null,
    proposed.tone ? `tone=${clampText(proposed.tone, 40)}` : null,
    proposed.initiative ? `initiative=${proposed.initiative}` : null,
    proposed.reportTarget ? `report=${proposed.reportTarget}` : null,
    proposed.allowedTopics?.length ? `allow=${proposed.allowedTopics.join("/")}` : null,
    proposed.restrictedTopics?.length ? `restrict=${proposed.restrictedTopics.join("/")}` : null,
    proposed.localBusinessPolicy
      ? `policyKeys=${Object.keys(proposed.localBusinessPolicy).join("/")}`
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  const adoptable = candidate.state === "recommended" || candidate.state === "shadow";
  return html`
    <div class="list-item" style="display:grid; gap: 10px;">
      <div class="list-main">
        <div class="list-title">${candidate.summary}</div>
        <div class="list-sub">
          ${candidate.state} · ${candidate.source} · ${formatConfidencePercent(
            candidate.confidence,
          )} · observed ${candidate.observationCount}x
        </div>
      </div>
      <div class="muted" style="font-size: 12px;">
        ${candidate.reasoning.length === 0 ? "No local rationale recorded." : candidate.reasoning.join(" ")}
      </div>
      <div class="mono" style="font-size: 12px;">
        ${proposedParts.length === 0 ? "No overlay delta." : proposedParts.join(" | ")}
      </div>
      ${
        adoptable
          ? html`
            <div class="row" style="gap: 12px; align-items: center;">
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  void props.onRoleOptimizationAdopt(candidate.id);
                }}
              >
                Adopt Suggestion
              </button>
              <button
                class="btn"
                ?disabled=${props.loading}
                @click=${() => {
                  const reason = window.prompt("Reject reason (optional)", "") ?? "";
                  void props.onRoleOptimizationReject({
                    id: candidate.id,
                    reason: reason.trim() || undefined,
                  });
                }}
              >
                Reject
              </button>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderRoleOptimizationSection(
  store: RuntimeUserConsoleStore,
  snapshot: RuntimeDashboardSnapshot | null,
  props: RuntimeProps,
) {
  const candidates = [...store.roleOptimizationCandidates].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
  return html`
    <div style="display:grid; gap: 12px;">
      <div class="row" style="gap: 12px; align-items: center;">
        <button
          class="btn"
          ?disabled=${props.loading}
          @click=${() => {
            void props.onRoleOptimizationReview();
          }}
        >
          Run Local Role Review
        </button>
        <div class="muted" style="font-size: 12px;">
          Review surface overlays locally and queue federation role packages here before anything touches local role truth.
        </div>
      </div>
      <div class="stat-grid stat-grid--3">
        ${renderStat("Recommended", snapshot?.userConsole.recommendedRoleOptimizationCount ?? 0)}
        ${renderStat("Shadow", snapshot?.userConsole.shadowRoleOptimizationCount ?? 0)}
        ${renderStat("Total", candidates.length)}
      </div>
      <div class="list">
        ${
          candidates.length === 0
            ? html`
                <div class="muted">No role optimization suggestions yet.</div>
              `
            : candidates.map((candidate) => renderRoleOptimizationCandidate(candidate, props))
        }
      </div>
    </div>
  `;
}

function renderCapabilityEntry(
  entry: RuntimeDashboardSnapshot["capabilities"]["entries"][number],
  props: RuntimeProps,
) {
  const source =
    typeof entry.metadata?.source === "string" ? entry.metadata.source : "runtime-governance";
  const configured = entry.metadata?.configured !== false;
  const executionLabel =
    entry.executionMode === "live"
      ? `live:${entry.executionPreferenceLabel}`
      : entry.executionMode === "candidate_only"
        ? "candidate-only"
        : entry.executionMode === "shadow_only"
          ? "shadow-only"
          : "blocked";
  return html`
    <div class="list-item" style="display:grid; gap: 10px;">
      <div class="row" style="justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;">
        <div class="list-main">
          <div class="list-title">${entry.registryType}:${entry.targetId}</div>
          <div class="list-sub">
            ${entry.state} · ${executionLabel} · ${configured ? "configured" : "detached"} · ${source}
          </div>
        </div>
        <div class="badge">${entry.liveEligible ? "live" : executionLabel}</div>
      </div>
      <div class="muted" style="font-size: 12px;">
        ${entry.summary || "No governance summary recorded."}
      </div>
      <div class="muted" style="font-size: 12px;">
        ${entry.executionSummary}
      </div>
      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        ${GOVERNANCE_STATES.map(
          (state) => html`<button
            class="btn btn--sm"
            ?disabled=${props.loading || entry.state === state}
            @click=${() => {
              const reason =
                entry.state === state
                  ? ""
                  : (window.prompt(
                      `Set ${entry.registryType}:${entry.targetId} -> ${state}. Optional reason:`,
                      "",
                    ) ?? "");
              void props.onCapabilityEntrySet({
                id: entry.id,
                registryType: entry.registryType,
                targetId: entry.targetId,
                state,
                summary: entry.summary,
                reason: reason.trim() || undefined,
              });
            }}
          >
            ${state}
          </button>`,
        )}
      </div>
    </div>
  `;
}

function renderCapabilityMcpGrant(
  grant: RuntimeDashboardSnapshot["capabilities"]["mcpGrants"][number],
  props: RuntimeProps,
) {
  return html`
    <div class="list-item" style="display:grid; gap: 10px;">
      <div class="row" style="justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;">
        <div class="list-main">
          <div class="list-title">${grant.agentLabel} -> ${grant.mcpServerId}</div>
          <div class="list-sub">
            agent=${grant.agentId} · state=${grant.state} · updated ${formatRelativeTimestamp(grant.updatedAt)}
          </div>
        </div>
        <div class="badge">${grant.state}</div>
      </div>
      <div class="muted" style="font-size: 12px;">
        ${grant.summary || "No MCP authorization summary recorded."}
      </div>
      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        ${(["allowed", "denied"] as const).map(
          (state) => html`<button
            class="btn btn--sm"
            ?disabled=${props.loading || grant.state === state}
            @click=${() => {
              const reason =
                grant.state === state
                  ? ""
                  : (window.prompt(
                      `Set MCP grant ${grant.agentId}:${grant.mcpServerId} -> ${state}. Optional reason:`,
                      "",
                    ) ?? "");
              void props.onCapabilityMcpGrantSet({
                id: grant.id,
                agentId: grant.agentId,
                mcpServerId: grant.mcpServerId,
                state,
                summary: grant.summary,
                reason: reason.trim() || undefined,
              });
            }}
          >
            ${state}
          </button>`,
        )}
      </div>
    </div>
  `;
}

function renderCapabilitiesSection(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const entries = snapshot.capabilities.entries;
  const mcpGrants = snapshot.capabilities.mcpGrants;
  const recentActivity = snapshot.capabilities.recentActivity;
  return html`
    <div class="stat-grid stat-grid--4">
      ${renderStat("Agents", snapshot.capabilities.agentCount)}
      ${renderStat("Skills", snapshot.capabilities.skillCount)}
      ${renderStat("MCP", snapshot.capabilities.mcpCount)}
      ${renderStat("MCP Grants", snapshot.capabilities.mcpGrantCount)}
      ${renderStat("MCP Allowed", snapshot.capabilities.mcpAllowedGrantCount)}
      ${renderStat("MCP Denied", snapshot.capabilities.mcpDeniedGrantCount)}
      ${renderStat("Overlays", snapshot.capabilities.overlayCount)}
      ${renderStat("Blocked", snapshot.capabilities.governanceStateCounts.blocked)}
      ${renderStat("Shadow", snapshot.capabilities.governanceStateCounts.shadow)}
      ${renderStat("Candidate", snapshot.capabilities.governanceStateCounts.candidate)}
      ${renderStat("Adopted/Core", snapshot.capabilities.governanceStateCounts.adopted + snapshot.capabilities.governanceStateCounts.core)}
    </div>
    <div class="row" style="gap: 12px; align-items: center; margin-top: 16px;">
      <button
        class="btn"
        ?disabled=${props.loading}
        @click=${() => {
          void props.onCapabilitiesSync();
        }}
      >
        Sync Capability Registry
      </button>
      <div class="muted" style="font-size: 12px;">
        Governance stays host-owned. Agents and MCP clients only receive the authorized subset.
      </div>
    </div>
    <div class="list" style="margin-top: 16px;">
      ${
        entries.length === 0
          ? html`
              <div class="muted">No governed capability entries yet.</div>
            `
          : entries.map((entry) => renderCapabilityEntry(entry, props))
      }
    </div>
    <div style="margin-top: 20px;">
      <div class="section-subtitle">MCP Grant Matrix</div>
      <div class="muted" style="font-size: 12px; margin-top: 4px;">
        These grants are host-owned. Agent routes only receive MCP servers that are explicitly allowed here.
      </div>
      <div class="list" style="margin-top: 12px;">
        ${
          mcpGrants.length === 0
            ? html`
                <div class="muted">No MCP grants recorded yet.</div>
              `
            : mcpGrants.map((grant) => renderCapabilityMcpGrant(grant, props))
        }
      </div>
    </div>
    <div style="margin-top: 20px;">
      <div class="section-subtitle">Recent Capability Activity</div>
      <div class="muted" style="font-size: 12px; margin-top: 4px;">
        Local capability changes, host-owned MCP grant updates, and adopted federation policy
        overlays are recorded here as the authoritative audit trail.
      </div>
      <div class="list" style="margin-top: 12px;">
        ${
          recentActivity.length === 0
            ? html`
                <div class="muted">No capability activity recorded yet.</div>
              `
            : recentActivity.map(
                (entry) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${entry.title}</div>
                      <div class="list-sub">
                        ${entry.kind} · ${formatRelativeTimestamp(entry.updatedAt)}
                        ${entry.state ? html` · ${entry.state}` : nothing}
                      </div>
                      <div class="muted" style="font-size: 12px; margin-top: 6px;">
                        ${entry.summary || "Capability audit entry recorded."}
                      </div>
                    </div>
                  </div>
                `,
              )
        }
      </div>
    </div>
  `;
}

function renderSurfaceEditor(
  store: RuntimeUserConsoleStore,
  props: RuntimeProps,
  surface: RuntimeUserConsoleStore["surfaces"][number],
  status?: RuntimeDashboardSnapshot["surfaces"][number],
) {
  const overlay = store.surfaceRoleOverlays.find((entry) => entry.surfaceId === surface.id);
  return html`
    <div class="list-item" style="display:grid; gap: 12px;">
      <div class="list-main">
        <div class="list-title">${surface.label}</div>
        <div class="list-sub">
          ${surface.channel} · ${surface.ownerKind}${surface.ownerId ? `:${surface.ownerId}` : ""} ·
          ${surface.active ? "active" : "off"}
        </div>
      </div>
      ${
        status
          ? html`<div
              class="mono"
              style="display:grid; gap: 6px; font-size: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 10px;"
            >
              <div>
                effective owner=${status.ownerLabel} | role=${status.role ?? "unset"} (${status.roleSource}) |
                tone=${status.tone ?? "unset"} (${status.toneSource})
              </div>
              <div>
                goal=${status.businessGoal ?? "unset"} | initiative=${status.initiative ?? "unset"} |
                report=${status.reportTarget ?? "runtime-user"}
              </div>
              <div>
                allow=${status.allowedTopics.length > 0 ? status.allowedTopics.join("/") : "none"} |
                restrict=${status.restrictedTopics.length > 0 ? status.restrictedTopics.join("/") : "none"} |
                overlay=${status.overlayPresent ? "local" : "derived"}
              </div>
              <div>
                policy=${
                  status.localBusinessPolicy
                    ? `${status.localBusinessPolicy.taskCreation} | escalate=${status.localBusinessPolicy.escalationTarget} | privacy=${status.localBusinessPolicy.privacyBoundary} | scope=${status.localBusinessPolicy.roleScope}`
                    : "none"
                } (${status.localBusinessPolicySource})
              </div>
              <div>
                tasks=${status.openTaskCount} | waiting_user=${status.waitingUserTaskCount} | intel=${
                  status.recentIntelDeliveryCount
                } | role suggestions=${status.pendingRoleOptimizationCount}
              </div>
              <div>
                reports=${status.recentReportCount} | completed=${status.recentCompletionReportCount} |
                follow-up=${status.followUpPressureCount} | blocked=${status.blockedReportCount} |
                waiting_external=${status.waitingExternalReportCount}
              </div>
              <div>
                coordinator pending=${status.pendingCoordinatorSuggestionCount} | materialized=${
                  status.materializedCoordinatorSuggestionCount
                } | latest activity=${
                  status.latestActivityAt
                    ? formatRelativeTimestamp(status.latestActivityAt)
                    : "none"
                }
              </div>
            </div>`
          : nothing
      }
      ${
        status
          ? html`
              <div>
                <div class="muted" style="font-size: 12px; margin-bottom: 8px;">Recent operating activity</div>
                ${renderEcologyActivityList(status.recentActivity)}
              </div>
            `
          : nothing
      }
      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          void props.onSurfaceSave({
            id: surface.id,
            label: readText(formData, "label") || surface.label,
            channel: readText(formData, "channel") || surface.channel,
            accountId: readText(formData, "accountId") || surface.accountId,
            ownerKind: readText(formData, "ownerKind") === "agent" ? "agent" : "user",
            ownerId: readText(formData, "ownerId"),
            active: readChecked(formData, "active"),
          });
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Label</span>
            <input name="label" .value=${surface.label} required />
          </label>
          <label class="field">
            <span>Channel</span>
            <input name="channel" .value=${surface.channel} required />
          </label>
          <label class="field">
            <span>Account id</span>
            <input name="accountId" .value=${surface.accountId} required />
          </label>
          <label class="field">
            <span>Owner kind</span>
            <select name="ownerKind">
              <option value="user" ?selected=${surface.ownerKind === "user"}>user</option>
              <option value="agent" ?selected=${surface.ownerKind === "agent"}>agent</option>
            </select>
          </label>
          <label class="field">
            <span>Owner id</span>
            <select name="ownerId">
              <option value="" ?selected=${!surface.ownerId}>User console</option>
              ${store.agents.map(
                (agent) => html`<option
                  value=${agent.id}
                  ?selected=${surface.ownerId === agent.id}
                >
                  ${agent.name}
                </option>`,
              )}
            </select>
          </label>
          <label class="field" style="justify-content: end;">
            <span>Active</span>
            <input type="checkbox" name="active" ?checked=${surface.active} />
          </label>
        </div>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn primary" ?disabled=${props.loading}>Save Surface</button>
          <div class="muted" style="font-size: 12px;">
            Surfaces bind to the user console or an agent. They never bind to Runtime Core.
          </div>
        </div>
      </form>

      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          const role = readText(formData, "role");
          if (!role) {
            return;
          }
          void props.onSurfaceRoleSave({
            id: overlay?.id,
            surfaceId: surface.id,
            role,
            businessGoal: readText(formData, "businessGoal"),
            tone: readText(formData, "tone"),
            initiative: readInitiative(formData, "initiative"),
            allowedTopics: readStringList(formData, "allowedTopics"),
            restrictedTopics: readStringList(formData, "restrictedTopics"),
            reportTarget: readText(formData, "reportTarget"),
            localBusinessPolicy: {
              taskCreation: readSurfaceTaskCreation(formData, "policyTaskCreation"),
              escalationTarget: readSurfaceEscalationTarget(formData, "policyEscalationTarget"),
              roleScope: readText(formData, "policyRoleScope"),
            },
          });
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Role</span>
            <input name="role" .value=${overlay?.role ?? ""} placeholder="sales_closer" />
          </label>
          <label class="field">
            <span>Business goal</span>
            <input name="businessGoal" .value=${overlay?.businessGoal ?? ""} />
          </label>
          <label class="field">
            <span>Tone</span>
            <input name="tone" .value=${overlay?.tone ?? ""} />
          </label>
          <label class="field">
            <span>Initiative</span>
            <select name="initiative">
              ${["low", "medium", "high"].map(
                (value) => html`<option
                  value=${value}
                  ?selected=${(overlay?.initiative ?? "medium") === value}
                >
                  ${value}
                </option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Report target</span>
            <input name="reportTarget" .value=${overlay?.reportTarget ?? ""} />
          </label>
        </div>
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Allowed topics</span>
            <input
              name="allowedTopics"
              .value=${overlay?.allowedTopics.join(", ") ?? ""}
              placeholder="pricing, delivery"
            />
          </label>
          <label class="field">
            <span>Restricted topics</span>
            <input
              name="restrictedTopics"
              .value=${overlay?.restrictedTopics.join(", ") ?? ""}
              placeholder="refund, legal"
            />
          </label>
        </div>
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Task creation</span>
            <select
              name="policyTaskCreation"
              .value=${
                status?.localBusinessPolicy?.taskCreation ??
                overlay?.localBusinessPolicy?.taskCreation ??
                "recommend_only"
              }
            >
              <option value="recommend_only">recommend_only</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label class="field">
            <span>Escalation target</span>
            <select
              name="policyEscalationTarget"
              .value=${
                status?.localBusinessPolicy?.escalationTarget ??
                overlay?.localBusinessPolicy?.escalationTarget ??
                "runtime-user"
              }
            >
              <option value="runtime-user">runtime-user</option>
              <option value="surface-owner">surface-owner</option>
            </select>
          </label>
          <label class="field">
            <span>Role scope</span>
            <input
              name="policyRoleScope"
              .value=${
                status?.localBusinessPolicy?.roleScope ??
                overlay?.localBusinessPolicy?.roleScope ??
                overlay?.role ??
                status?.role ??
                ""
              }
              placeholder="sales_operator"
            />
          </label>
        </div>
        <div
          class="mono"
          style="display:grid; gap: 6px; font-size: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 10px;"
        >
          <div>runtimeCoreBinding=forbidden | formalMemoryWrite=false | userModelWrite=false</div>
          <div>
            surfaceRoleWrite=false | privacyBoundary=${
              status?.localBusinessPolicy?.privacyBoundary ??
              overlay?.localBusinessPolicy?.privacyBoundary ??
              (surface.ownerKind === "agent" ? "agent-local" : "user-local")
            }
          </div>
          <div class="muted">
            Surface policy is always locally constrained. Runtime Core binding and formal writes stay disabled.
          </div>
        </div>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn" ?disabled=${props.loading}>Save Role Overlay</button>
          <div class="muted" style="font-size: 12px;">
            Service surfaces cannot rewrite the user model. Role overlays stay local and scoped.
          </div>
        </div>
      </form>
    </div>
  `;
}

function renderNewSurfaceForm(store: RuntimeUserConsoleStore, props: RuntimeProps) {
  return html`
    <div class="list-item" style="display:grid; gap: 12px;">
      <div class="list-main">
        <div class="list-title">Create Surface</div>
        <div class="list-sub">Bind a new channel/account surface to the user console or an agent.</div>
      </div>
      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          const label = readText(formData, "label");
          const channel = readText(formData, "channel");
          const accountId = readText(formData, "accountId");
          if (!label || !channel || !accountId) {
            return;
          }
          void props.onSurfaceSave({
            label,
            channel,
            accountId,
            ownerKind: readText(formData, "ownerKind") === "agent" ? "agent" : "user",
            ownerId: readText(formData, "ownerId"),
            active: readChecked(formData, "active"),
          });
          (event.currentTarget as HTMLFormElement).reset();
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Label</span>
            <input name="label" placeholder="WeChat Sales" required />
          </label>
          <label class="field">
            <span>Channel</span>
            <input name="channel" placeholder="wechat" required />
          </label>
          <label class="field">
            <span>Account id</span>
            <input name="accountId" placeholder="wx-sales-01" required />
          </label>
          <label class="field">
            <span>Owner kind</span>
            <select name="ownerKind">
              <option value="user" selected>User</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <label class="field">
            <span>Owner id</span>
            <select name="ownerId">
              <option value="" selected>User console</option>
              ${store.agents.map((agent) => html`<option value=${agent.id}>${agent.name}</option>`)}
            </select>
          </label>
          <label class="field" style="justify-content: end;">
            <span>Active</span>
            <input type="checkbox" name="active" checked />
          </label>
        </div>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn primary" ?disabled=${props.loading}>Create Surface</button>
        </div>
      </form>
    </div>
  `;
}

function renderIntelControls(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  const dailyTargetIds = new Set(snapshot.intel.dailyPushTargets.map((target) => target.id));
  const instantTargetIds = new Set(snapshot.intel.instantPushTargets.map((target) => target.id));
  return html`
    <div style=${STACK_STYLE}>
      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          void props.onIntelConfigure({
            enabled: readChecked(formData, "enabled"),
            digestEnabled: readChecked(formData, "digestEnabled"),
            refreshMinutes: readOptionalNumber(formData, "refreshMinutes"),
            enabledDomainIds: formData
              .getAll("enabledDomainIds")
              .filter(
                (value): value is "military" | "tech" | "ai" | "business" =>
                  value === "military" ||
                  value === "tech" ||
                  value === "ai" ||
                  value === "business",
              ),
            dailyPushEnabled: readChecked(formData, "dailyPushEnabled"),
            dailyPushItemCount: readOptionalNumber(formData, "dailyPushItemCount"),
            dailyPushHourLocal: readOptionalNumber(formData, "dailyPushHourLocal"),
            dailyPushMinuteLocal: readOptionalNumber(formData, "dailyPushMinuteLocal"),
            instantPushEnabled: readChecked(formData, "instantPushEnabled"),
            instantPushMinScore: readOptionalNumber(formData, "instantPushMinScore"),
            dailyPushTargetIds: readMultiText(formData, "dailyPushTargetIds"),
            instantPushTargetIds: readMultiText(formData, "instantPushTargetIds"),
            candidateLimitPerDomain: readOptionalNumber(formData, "candidateLimitPerDomain"),
            digestItemLimitPerDomain: readOptionalNumber(formData, "digestItemLimitPerDomain"),
            exploitItemsPerDigest: readOptionalNumber(formData, "exploitItemsPerDigest"),
            exploreItemsPerDigest: readOptionalNumber(formData, "exploreItemsPerDigest"),
            selectedSourceIds: readMultiText(formData, "selectedSourceIds"),
          });
        }}
      >
        <div style=${FORM_GRID_STYLE}>
          <label class="field" style="justify-content: end;">
            <span>News / Info enabled</span>
            <input type="checkbox" name="enabled" ?checked=${snapshot.intel.enabled} />
          </label>
          <label class="field" style="justify-content: end;">
            <span>Digest enabled</span>
            <input type="checkbox" name="digestEnabled" ?checked=${snapshot.intel.digestEnabled} />
          </label>
          <label class="field">
            <span>Refresh minutes</span>
            <input
              name="refreshMinutes"
              type="number"
              min="5"
              .value=${String(snapshot.intel.refreshMinutes)}
            />
          </label>
          <label class="field" style="justify-content: end;">
            <span>Daily push enabled</span>
            <input
              type="checkbox"
              name="dailyPushEnabled"
              ?checked=${snapshot.intel.dailyPushEnabled}
            />
          </label>
          <label class="field">
            <span>Items per day</span>
            <input
              name="dailyPushItemCount"
              type="number"
              min="1"
              max="50"
              .value=${String(snapshot.intel.dailyPushItemCount)}
            />
          </label>
          <label class="field">
            <span>Push hour</span>
            <input
              name="dailyPushHourLocal"
              type="number"
              min="0"
              max="23"
              .value=${String(snapshot.intel.dailyPushHourLocal)}
            />
          </label>
          <label class="field">
            <span>Push minute</span>
            <input
              name="dailyPushMinuteLocal"
              type="number"
              min="0"
              max="59"
              .value=${String(snapshot.intel.dailyPushMinuteLocal)}
            />
          </label>
          <label class="field" style="justify-content: end;">
            <span>Instant push enabled</span>
            <input
              type="checkbox"
              name="instantPushEnabled"
              ?checked=${snapshot.intel.instantPushEnabled}
            />
          </label>
          <label class="field">
            <span>Instant min score</span>
            <input
              name="instantPushMinScore"
              type="number"
              min="1"
              max="100"
              .value=${String(snapshot.intel.instantPushMinScore)}
            />
          </label>
          <label class="field">
            <span>Candidates / domain</span>
            <input
              name="candidateLimitPerDomain"
              type="number"
              min="1"
              max="100"
              .value=${String(snapshot.intel.candidateLimitPerDomain)}
            />
          </label>
          <label class="field">
            <span>Digest / domain</span>
            <input
              name="digestItemLimitPerDomain"
              type="number"
              min="1"
              max="25"
              .value=${String(snapshot.intel.digestItemLimitPerDomain)}
            />
          </label>
          <label class="field">
            <span>Exploit / digest</span>
            <input
              name="exploitItemsPerDigest"
              type="number"
              min="0"
              max="25"
              .value=${String(snapshot.intel.exploitItemsPerDigest)}
            />
          </label>
          <label class="field">
            <span>Explore / digest</span>
            <input
              name="exploreItemsPerDigest"
              type="number"
              min="0"
              max="25"
              .value=${String(snapshot.intel.exploreItemsPerDigest)}
            />
          </label>
        </div>
        <div style="display:grid; gap: 8px;">
          <div class="muted" style="font-size: 12px;">Enabled categories</div>
          <div style=${FORM_GRID_STYLE}>
            ${snapshot.intel.domains.map(
              (domain) => html`
                <label class="field">
                  <span>${domain.label}</span>
                  <input
                    type="checkbox"
                    name="enabledDomainIds"
                    value=${domain.id}
                    ?checked=${domain.enabled}
                  />
                </label>
              `,
            )}
          </div>
        </div>
        <div style="display:grid; gap: 8px;">
          <div class="muted" style="font-size: 12px;">Enabled sources</div>
          <div style=${FORM_GRID_STYLE}>
            ${snapshot.intel.sources.map(
              (source) => html`
                <label class="field">
                  <span>${source.label}${source.custom ? " (custom)" : ""}</span>
                  <input
                    type="checkbox"
                    name="selectedSourceIds"
                    value=${source.id}
                    ?checked=${source.enabled}
                  />
                </label>
              `,
            )}
          </div>
        </div>
        <div style="display:grid; gap: 8px;">
          <div class="muted" style="font-size: 12px;">Daily digest delivery targets</div>
          <div style=${FORM_GRID_STYLE}>
            ${snapshot.intel.availableTargets.map(
              (target) => html`
                <label class="field">
                  <span>
                    ${target.label}
                    ${target.channel ? html`<span class="muted"> · ${target.channel}</span>` : nothing}
                    ${
                      target.ownerLabel
                        ? html`<span class="muted"> · ${target.ownerLabel}</span>`
                        : nothing
                    }
                  </span>
                  <input
                    type="checkbox"
                    name="dailyPushTargetIds"
                    value=${target.id}
                    ?checked=${dailyTargetIds.has(target.id)}
                  />
                </label>
              `,
            )}
          </div>
          ${
            snapshot.intel.staleDailyTargetIds.length > 0
              ? html`<div class="muted" style="font-size: 12px;">
                Stale daily targets: ${formatList(snapshot.intel.staleDailyTargetIds)}
              </div>`
              : nothing
          }
        </div>
        <div style="display:grid; gap: 8px;">
          <div class="muted" style="font-size: 12px;">Instant alert delivery targets</div>
          <div style=${FORM_GRID_STYLE}>
            ${snapshot.intel.availableTargets.map(
              (target) => html`
                <label class="field">
                  <span>
                    ${target.label}
                    ${target.channel ? html`<span class="muted"> · ${target.channel}</span>` : nothing}
                    ${
                      target.ownerLabel
                        ? html`<span class="muted"> · ${target.ownerLabel}</span>`
                        : nothing
                    }
                  </span>
                  <input
                    type="checkbox"
                    name="instantPushTargetIds"
                    value=${target.id}
                    ?checked=${instantTargetIds.has(target.id)}
                  />
                </label>
              `,
            )}
          </div>
          ${
            snapshot.intel.staleInstantTargetIds.length > 0
              ? html`<div class="muted" style="font-size: 12px;">
                Stale instant targets: ${formatList(snapshot.intel.staleInstantTargetIds)}
              </div>`
              : nothing
          }
        </div>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn primary" ?disabled=${props.loading}>Save News Policy</button>
          <button
            type="button"
            class="btn"
            ?disabled=${props.loading}
            @click=${() => {
              void props.onIntelRefresh();
            }}
          >
            Refresh News Now
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${props.loading || snapshot.intel.pendingDeliveries.length === 0}
            @click=${() => {
              void props.onIntelDispatch();
            }}
          >
            Dispatch Pending Pushes
          </button>
          <div class="muted" style="font-size: 12px;">
            News/info remains independent. It does not auto-create tasks or auto-write formal memory.
          </div>
        </div>
        <div style=${FORM_GRID_STYLE}>
          <div class="field">
            <span>Pending daily digest</span>
            <strong>${snapshot.intel.pendingDailyDigestCount}</strong>
          </div>
          <div class="field">
            <span>Pending instant alerts</span>
            <strong>${snapshot.intel.pendingInstantAlertCount}</strong>
          </div>
          <div class="field">
            <span>Next daily push</span>
            <strong>
              ${
                snapshot.intel.nextDailyPushAt
                  ? formatRelativeTimestamp(snapshot.intel.nextDailyPushAt)
                  : "disabled"
              }
            </strong>
          </div>
          <div class="field">
            <span>Last daily push</span>
            <strong>
              ${
                snapshot.intel.lastDailyPushAt
                  ? formatRelativeTimestamp(snapshot.intel.lastDailyPushAt)
                  : "never"
              }
            </strong>
          </div>
          <div class="field">
            <span>Last instant push</span>
            <strong>
              ${
                snapshot.intel.lastInstantPushAt
                  ? formatRelativeTimestamp(snapshot.intel.lastInstantPushAt)
                  : "never"
              }
            </strong>
          </div>
          <div class="field">
            <span>Daily targets</span>
            <strong>${snapshot.intel.dailyPushTargets.length}</strong>
          </div>
          <div class="field">
            <span>Instant targets</span>
            <strong>${snapshot.intel.instantPushTargets.length}</strong>
          </div>
        </div>
      </form>

      <form
        style=${STACK_STYLE}
        @submit=${(event: Event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget as HTMLFormElement);
          void props.onIntelSourceSave({
            label: readText(formData, "label"),
            domain:
              (readText(formData, "domain") as "military" | "tech" | "ai" | "business") || "tech",
            kind: readText(formData, "kind") === "github_search" ? "github_search" : "rss",
            url: readText(formData, "url") || undefined,
            priority: readOptionalNumber(formData, "priority"),
            enabled: readChecked(formData, "enabled"),
          });
          (event.currentTarget as HTMLFormElement).reset();
        }}
      >
        <div class="muted" style="font-size: 12px;">Add custom source</div>
        <div style=${FORM_GRID_STYLE}>
          <label class="field">
            <span>Label</span>
            <input name="label" required />
          </label>
          <label class="field">
            <span>Domain</span>
            <select name="domain">
              ${snapshot.intel.domains.map(
                (domain) => html`<option value=${domain.id}>${domain.label}</option>`,
              )}
            </select>
          </label>
          <label class="field">
            <span>Kind</span>
            <select name="kind">
              <option value="rss">rss</option>
              <option value="github_search">github_search</option>
            </select>
          </label>
          <label class="field">
            <span>URL</span>
            <input name="url" placeholder="https://example.com/feed.xml" />
          </label>
          <label class="field">
            <span>Priority</span>
            <input name="priority" type="number" min="0.1" max="5" step="0.1" value="1" />
          </label>
          <label class="field" style="justify-content: end;">
            <span>Enabled</span>
            <input type="checkbox" name="enabled" checked />
          </label>
        </div>
        <div class="muted" style="font-size: 12px;">
          Custom RSS and GitHub search sources stay inside the local news/info module and can be removed later.
        </div>
        <div class="row" style="gap: 12px; align-items: center;">
          <button class="btn" ?disabled=${props.loading}>Add Source</button>
        </div>
      </form>

      ${
        snapshot.intel.sources.some((source) => source.custom)
          ? html`
            <div style="display:grid; gap: 8px;">
              <div class="muted" style="font-size: 12px;">Custom sources</div>
              ${snapshot.intel.sources
                .filter((source) => source.custom)
                .map(
                  (source) => html`
                    <div
                      class="row spread"
                      style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
                    >
                      <div style="min-width: 0;">
                        <div><strong>${source.label}</strong></div>
                        <div class="muted" style="font-size: 12px;">
                          ${source.domain} · ${source.kind} · priority ${source.priority}
                        </div>
                        ${
                          source.url
                            ? html`<div class="muted" style="font-size: 12px;">
                              ${clampText(source.url, 108)}
                            </div>`
                            : nothing
                        }
                      </div>
                      <button
                        type="button"
                        class="btn btn--sm"
                        ?disabled=${props.loading}
                        @click=${() => {
                          void props.onIntelSourceDelete(source.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  `,
                )}
            </div>
          `
          : nothing
      }

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Authoritative source profiles</div>
        ${renderIntelSourceProfiles(snapshot)}
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Top topic weights</div>
        ${renderIntelTopicProfiles(snapshot)}
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Recent usefulness signals</div>
        ${renderIntelUsefulnessHistory(snapshot)}
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Digest history</div>
        ${renderIntelDigestHistory(snapshot)}
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Rank-history audit</div>
        ${renderIntelRankHistory(snapshot)}
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Pending delivery queue</div>
        ${
          snapshot.intel.pendingDeliveries.length === 0
            ? html`
                <div class="muted">No pending daily digest or instant alert deliveries.</div>
              `
            : snapshot.intel.pendingDeliveries.map(
                (item) => html`
                <div
                  class="row spread"
                  style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
                >
                  <div style="min-width: 0;">
                    <div>
                      <strong>${item.title}</strong>
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${item.kind === "instant_alert" ? "instant alert" : "daily digest"} ·
                      ${item.domain} · score ${item.score} ·
                      ${formatRelativeTimestamp(item.createdAt)}
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      targets ${item.targetCount} · ${clampText(item.targetLabels.join(", "), 120)}
                    </div>
                    <div class="muted" style="font-size: 12px;">${clampText(item.summary, 160)}</div>
                  </div>
                  <div class="muted" style="font-size: 12px;">
                    ${item.exploit ? "exploit" : "explore"}
                  </div>
                </div>
              `,
              )
        }
      </div>

      <div style="display:grid; gap: 8px;">
        <div class="muted" style="font-size: 12px;">Recent delivery ledger</div>
        ${
          snapshot.intel.recentDeliveries.length === 0
            ? html`
                <div class="muted">No local news/info deliveries recorded yet.</div>
              `
            : snapshot.intel.recentDeliveries.map(
                (entry) => html`
                <div
                  class="row spread"
                  style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
                >
                  <div style="min-width: 0;">
                    <div><strong>${entry.title}</strong></div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.kind === "instant_alert" ? "instant alert" : "daily digest"} ·
                      ${entry.domain} · to ${entry.targetLabel}
                      ${entry.channel ? html` · ${entry.channel}` : nothing}
                    </div>
                  </div>
                  <div class="muted" style="font-size: 12px;">
                    ${formatRelativeTimestamp(entry.deliveredAt)}
                  </div>
                </div>
              `,
              )
        }
      </div>
    </div>
  `;
}

function renderEvolutionControls(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onEvolutionConfigure({
          enabled: readChecked(formData, "enabled"),
          autoApplyLowRisk: readChecked(formData, "autoApplyLowRisk"),
          autoCanaryEvolution: readChecked(formData, "autoCanaryEvolution"),
          reviewIntervalHours: readOptionalNumber(formData, "reviewIntervalHours"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field" style="justify-content: end;">
          <span>Evolution enabled</span>
          <input type="checkbox" name="enabled" ?checked=${snapshot.evolution.enabled} />
        </label>
        <label class="field" style="justify-content: end;">
          <span>Auto apply low risk</span>
          <input
            type="checkbox"
            name="autoApplyLowRisk"
            ?checked=${snapshot.evolution.autoApplyLowRisk}
          />
        </label>
        <label class="field" style="justify-content: end;">
          <span>Auto canary evolution</span>
          <input
            type="checkbox"
            name="autoCanaryEvolution"
            ?checked=${snapshot.evolution.autoCanaryEvolution}
          />
        </label>
        <label class="field">
          <span>Review interval (hours)</span>
          <input
            name="reviewIntervalHours"
            type="number"
            min="1"
            max="168"
            .value=${String(snapshot.evolution.reviewIntervalHours)}
          />
        </label>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn primary" ?disabled=${props.loading}>Save Evolution Policy</button>
        <button
          type="button"
          class="btn"
          ?disabled=${props.loading}
          @click=${() => {
            void props.onEvolutionReview();
          }}
        >
          Run Evolution Review
        </button>
      </div>
    </form>
  `;
}

function requestEvolutionAdoptionReason(
  candidate: RuntimeDashboardSnapshot["evolution"]["candidates"][number],
): string | null {
  if (!candidate.requiresReasonOnAdopt) {
    return "Adopted from the runtime dashboard after local review.";
  }
  const reason = window.prompt(
    "Adoption reason",
    `Adopt ${candidate.summary} after local review because it matches the expected impact and risk boundary.`,
  );
  if (reason === null) {
    return null;
  }
  return reason.trim() || null;
}

function requestEvolutionRejectReason(summary: string): string | null {
  const reason = window.prompt(
    "Reject reason (optional)",
    `Reject ${summary} from the runtime dashboard approval queue.`,
  );
  if (reason === null) {
    return null;
  }
  return reason.trim() || `Rejected ${summary} from the runtime dashboard approval queue.`;
}

function renderEvolutionCandidates(snapshot: RuntimeDashboardSnapshot, props: RuntimeProps) {
  if (snapshot.evolution.candidates.length === 0) {
    return html`
      <div class="muted">No evolution candidates yet.</div>
    `;
  }
  return html`
    <div style=${STACK_STYLE}>
      ${snapshot.evolution.candidates.map(
        (candidate) => html`
          <div class="list-item">
            <div class="row" style="justify-content: space-between; gap: 12px; align-items: flex-start;">
              <div style="display:grid; gap: 6px; min-width: 0; flex: 1;">
                <strong>${candidate.summary}</strong>
                <div class="muted">
                  ${candidate.targetLayer} · ${candidate.candidateType} · ${candidate.state}
                  · risk ${candidate.riskLevel}
                  ${candidate.route ? html` · route ${candidate.route}` : nothing}
                  ${candidate.worker ? html` · worker ${candidate.worker}` : nothing}
                  ${candidate.lane ? html` · ${candidate.lane}` : nothing}
                </div>
                <div class="muted">
                  obs ${candidate.observationCount}
                  · success ${Math.round(candidate.successRate * 100)}%
                  · completion ${Math.round(candidate.averageCompletionScore)}
                  · latency ${formatMs(candidate.averageLatencyMs)}
                  · tokens ≈${Math.round(candidate.averageTokenEstimate)}
                  · interruptions ${candidate.averageInterruptionCount.toFixed(2)}
                  · regression ${Math.round(candidate.regressionRiskScore * 100)}%
                  ${
                    candidate.skillIds.length > 0
                      ? html` · skills ${formatList(candidate.skillIds)}`
                      : nothing
                  }
                  ${
                    candidate.policyHints.length > 0
                      ? html` · policy ${formatList(candidate.policyHints)}`
                      : nothing
                  }
                  ${candidate.baselineRef ? html` · baseline ${candidate.baselineRef}` : nothing}
                  ${
                    candidate.materializedStrategyId
                      ? html` · strategy ${candidate.materializedStrategyId}${
                          candidate.strategyInvalidated ? " (invalidated)" : ""
                        }`
                      : nothing
                  }
                  ${
                    candidate.autoApplyEligible && candidate.autoAdoptReady
                      ? html`
                          · auto-apply ready
                        `
                      : candidate.autoApplyEligible && candidate.autoPromoteReady
                        ? html`
                            · auto-promote ready
                          `
                        : html`
                            · manual adopt review
                          `
                  }
                  ${
                    candidate.verificationStatus
                      ? html`
                          · verify ${candidate.verificationStatus}
                          ${
                            candidate.verificationObservationCount > 0
                              ? html` (${candidate.verificationObservationCount} obs)`
                              : nothing
                          }
                        `
                      : nothing
                  }
                </div>
                <div class="muted">${candidate.riskSummary}</div>
                <div class="muted">Estimated impact: ${candidate.estimatedImpact}</div>
                <div class="muted">${candidate.autoApplySummary}</div>
                ${
                  candidate.verificationStatus
                    ? html`
                      <div class="muted">
                        Verification: ${candidate.verificationSummary}
                        ${
                          candidate.lastVerifiedAt
                            ? html` · checked ${formatRelativeTimestamp(candidate.lastVerifiedAt)}`
                            : nothing
                        }
                      </div>
                    `
                    : nothing
                }
                ${
                  candidate.riskSignals.length > 0
                    ? html`
                      <div class="muted">
                        Signals: ${candidate.riskSignals.join(" · ")}
                      </div>
                    `
                    : nothing
                }
                ${
                  candidate.autoApplyBlockers.length > 0
                    ? html`
                      <div class="muted">
                        Gates: ${candidate.autoApplyBlockers.join(" · ")}
                      </div>
                    `
                    : nothing
                }
                ${
                  candidate.verificationSignals.length > 0
                    ? html`
                      <div class="muted">
                        Verification signals: ${candidate.verificationSignals.join(" · ")}
                      </div>
                    `
                    : nothing
                }
                <div class="muted">
                  updated ${formatRelativeTimestamp(candidate.updatedAt)}
                  ${
                    candidate.sourceTaskIds.length > 0
                      ? html` · tasks ${formatList(candidate.sourceTaskIds)}`
                      : nothing
                  }
                </div>
              </div>
              <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
                ${
                  candidate.state !== "candidate" && candidate.state !== "adopted"
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${props.loading}
                        @click=${() => {
                          void props.onEvolutionCandidateStateSet({
                            id: candidate.id,
                            state: "candidate",
                            reason: "runtime-console-promote",
                          });
                        }}
                      >
                        Promote
                      </button>
                    `
                    : nothing
                }
                ${
                  candidate.state === "candidate"
                    ? html`
                      <button
                        class="btn primary"
                        ?disabled=${props.loading}
                        @click=${() => {
                          const reason = requestEvolutionAdoptionReason(candidate);
                          if (reason == null) {
                            return;
                          }
                          void props.onEvolutionCandidateStateSet({
                            id: candidate.id,
                            state: "adopted",
                            reason,
                          });
                        }}
                      >
                        Adopt
                      </button>
                    `
                    : nothing
                }
                ${
                  candidate.state === "candidate" || candidate.state === "shadow"
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${props.loading}
                        @click=${() => {
                          const reason = requestEvolutionRejectReason(candidate.summary);
                          if (reason == null) {
                            return;
                          }
                          void props.onEvolutionCandidateStateSet({
                            id: candidate.id,
                            state: "reverted",
                            reason,
                          });
                        }}
                      >
                        Reject
                      </button>
                    `
                    : nothing
                }
                ${
                  candidate.state === "adopted"
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${props.loading}
                        @click=${() => {
                          void props.onEvolutionCandidateStateSet({
                            id: candidate.id,
                            state: "reverted",
                            reason: "runtime-console-revert",
                          });
                        }}
                      >
                        Revert
                      </button>
                    `
                    : nothing
                }
              </div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderImportPreview(
  preview: LegacyRuntimeImportReport | null,
  applyResult: LegacyRuntimeImportApplyResult | null,
  importBusy: boolean,
  onImportApply: () => void,
) {
  if (!preview) {
    return html`
      <div class="muted">Migration source preview unavailable.</div>
    `;
  }
  return html`
    <div class="stat-grid stat-grid--4">
      ${renderStat("Detected", preview.detected ? "Yes" : "No")}
      ${renderStat("Tasks", preview.counts.tasks)}
      ${renderStat("Memories", preview.counts.memories)}
      ${renderStat("News digests", preview.counts.intelDigests)}
    </div>
    <div style="margin-top: 16px;">
      <div class="muted" style="font-size: 12px;">Migration source root</div>
      <div class="mono">${preview.legacyRoot}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Extensions</div>
      <div>${preview.legacyExtensions.length ? preview.legacyExtensions.join(", ") : "none"}</div>
    </div>
    ${
      preview.warnings.length
        ? html`<div class="callout warning" style="margin-top: 12px;">
          ${preview.warnings.join(" ")}
        </div>`
        : nothing
    }
    <div class="row" style="gap: 12px; margin-top: 16px; align-items: center;">
      <button class="btn" ?disabled=${importBusy || !preview.detected} @click=${onImportApply}>
        ${importBusy ? "Importing..." : "Import Runtime Snapshot"}
      </button>
      <div class="muted" style="font-size: 12px;">
        Preview only reads the source snapshot. Apply archives it and writes normalized data under the new instance data root.
      </div>
    </div>
    ${
      applyResult
        ? html`<div class="callout ok" style="margin-top: 12px;">
          Imported to <span class="mono">${applyResult.targetRoot}</span> at
          ${formatMs(applyResult.appliedAt)}.
        </div>`
        : nothing
    }
  `;
}

function renderFederationInboxMaintenanceControls(
  snapshot: FederationRuntimeSnapshot,
  props: RuntimeProps,
) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onFederationMaintenanceConfigure({
          enabled: readChecked(formData, "enabled"),
          reviewIntervalHours: readOptionalNumber(formData, "reviewIntervalHours"),
          expireReceivedAfterHours: readOptionalNumber(formData, "expireReceivedAfterHours"),
          expireValidatedAfterHours: readOptionalNumber(formData, "expireValidatedAfterHours"),
          expireShadowedAfterHours: readOptionalNumber(formData, "expireShadowedAfterHours"),
          expireRecommendedAfterHours: readOptionalNumber(formData, "expireRecommendedAfterHours"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field" style="justify-content: end;">
          <span>Inbox maintenance enabled</span>
          <input type="checkbox" name="enabled" ?checked=${snapshot.inbox.maintenance.enabled} />
        </label>
        <label class="field">
          <span>Review interval hours</span>
          <input
            name="reviewIntervalHours"
            type="number"
            min="1"
            max="8760"
            step="1"
            .value=${String(snapshot.inbox.maintenance.reviewIntervalHours)}
          />
        </label>
        <label class="field">
          <span>Expire received after hours</span>
          <input
            name="expireReceivedAfterHours"
            type="number"
            min="1"
            max="8760"
            step="1"
            .value=${String(snapshot.inbox.maintenance.expireAfterHours.received)}
          />
        </label>
        <label class="field">
          <span>Expire validated after hours</span>
          <input
            name="expireValidatedAfterHours"
            type="number"
            min="1"
            max="8760"
            step="1"
            .value=${String(snapshot.inbox.maintenance.expireAfterHours.validated)}
          />
        </label>
        <label class="field">
          <span>Expire shadowed after hours</span>
          <input
            name="expireShadowedAfterHours"
            type="number"
            min="1"
            max="8760"
            step="1"
            .value=${String(snapshot.inbox.maintenance.expireAfterHours.shadowed)}
          />
        </label>
        <label class="field">
          <span>Expire recommended after hours</span>
          <input
            name="expireRecommendedAfterHours"
            type="number"
            min="1"
            max="8760"
            step="1"
            .value=${String(snapshot.inbox.maintenance.expireAfterHours.recommended)}
          />
        </label>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.federationLoading}>
          ${props.federationLoading ? "Saving..." : "Save Inbox Maintenance"}
        </button>
        <div class="muted" style="font-size: 12px;">
          Controls the authoritative inbox review cadence and per-state expiry policy for pending
          federation packages.
        </div>
      </div>
    </form>
  `;
}

function renderFederationPushPolicyControls(
  snapshot: FederationRuntimeSnapshot,
  props: RuntimeProps,
) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onFederationPushPolicyConfigure({
          allowedPushScopes: readMultiText(formData, "allowedPushScopes"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        ${snapshot.shareablePushScopeCatalog.map(
          (scope) => html`
            <label class="field" style="justify-content: end;">
              <span>${scope}</span>
              <input
                type="checkbox"
                name="allowedPushScopes"
                value=${scope}
                ?checked=${snapshot.allowedPushScopes.includes(scope)}
              />
            </label>
          `,
        )}
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.federationLoading}>
          ${props.federationLoading ? "Saving..." : "Save Push Policy"}
        </button>
        <div class="muted" style="font-size: 12px;">
          Runtime-owned export policy for optional federation envelopes. Runtime manifest always
          stays exportable; blocked scopes remain hard-denied.
        </div>
      </div>
    </form>
  `;
}

function renderFederationRemoteMaintenanceControls(
  snapshot: FederationRuntimeSnapshot,
  props: RuntimeProps,
) {
  return html`
    <form
      style=${STACK_STYLE}
      @submit=${(event: Event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        void props.onFederationRemoteMaintenanceConfigure({
          enabled: readChecked(formData, "enabled"),
          syncIntervalMinutes: readOptionalNumber(formData, "syncIntervalMinutes"),
          retryAfterFailureMinutes: readOptionalNumber(formData, "retryAfterFailureMinutes"),
        });
      }}
    >
      <div style=${FORM_GRID_STYLE}>
        <label class="field" style="justify-content: end;">
          <span>Remote maintenance enabled</span>
          <input
            type="checkbox"
            name="enabled"
            ?checked=${snapshot.remoteMaintenance.enabled}
          />
        </label>
        <label class="field">
          <span>Sync interval minutes</span>
          <input
            name="syncIntervalMinutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            .value=${String(snapshot.remoteMaintenance.syncIntervalMinutes)}
          />
        </label>
        <label class="field">
          <span>Retry-after-failure minutes</span>
          <input
            name="retryAfterFailureMinutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            .value=${String(snapshot.remoteMaintenance.retryAfterFailureMinutes)}
          />
        </label>
      </div>
      <div class="row" style="gap: 12px; align-items: center;">
        <button class="btn" type="submit" ?disabled=${props.federationLoading}>
          ${props.federationLoading ? "Saving..." : "Save Remote Maintenance"}
        </button>
        <div class="muted" style="font-size: 12px;">
          Controls the authoritative scheduled managed-sync cadence for remote federation push/pull.
        </div>
      </div>
    </form>
  `;
}

function renderFederation(
  snapshot: FederationRuntimeSnapshot | null,
  error: string | null,
  props: RuntimeProps,
) {
  if (!snapshot) {
    return html`${error ? html`<div class="pill danger">${error}</div>` : nothing}
      <div class="muted">Federation hook status unavailable.</div>`;
  }
  return html`
    <div class="stat-grid stat-grid--4">
      ${renderStat("Enabled", snapshot.enabled ? "Yes" : "No")}
      ${renderStat("Remote configured", snapshot.remoteConfigured ? "Yes" : "No")}
      ${renderStat("Remote sync due", snapshot.remoteMaintenance.due ? "Yes" : "No")}
      ${renderStat("Pending assignments", snapshot.pendingAssignments)}
      ${renderStat("Inbox packages", snapshot.inbox.total)}
      ${renderStat("Recommended", snapshot.inbox.stateCounts.recommended)}
      ${renderStat("Adopted", snapshot.inbox.stateCounts.adopted)}
      ${renderStat("Pending review", snapshot.inbox.maintenance.pendingReviewCount)}
      ${renderStat("Stale packages", snapshot.inbox.maintenance.stalePackageCount)}
      ${renderStat("Shareable reviews", snapshot.outboxEnvelopeCounts.shareableReview)}
      ${renderStat("Shareable memories", snapshot.outboxEnvelopeCounts.shareableMemory)}
      ${renderStat("Strategy outbox", snapshot.outboxEnvelopeCounts.strategyDigest)}
      ${renderStat("News outbox", snapshot.outboxEnvelopeCounts.newsDigest)}
      ${renderStat("Team knowledge", snapshot.outboxEnvelopeCounts.teamKnowledge)}
    </div>
    <div style="margin-top: 16px;">
      <div class="row spread" style="gap: 12px; align-items: center; flex-wrap: wrap;">
        <div>
          <div class="muted" style="font-size: 12px;">Remote maintenance</div>
          <div>
            ${snapshot.remoteMaintenance.enabled ? "enabled" : "disabled"} · every
            ${snapshot.remoteMaintenance.syncIntervalMinutes}m · retry after failure
            ${snapshot.remoteMaintenance.retryAfterFailureMinutes}m
          </div>
          <div class="muted" style="font-size: 12px;">
            next sync
            ${
              snapshot.remoteMaintenance.nextSyncAt
                ? formatRelativeTimestamp(snapshot.remoteMaintenance.nextSyncAt)
                : (snapshot.remoteMaintenance.blockedReason ?? "none")
            } · last success
            ${
              snapshot.remoteMaintenance.lastSuccessfulSyncAt
                ? formatRelativeTimestamp(snapshot.remoteMaintenance.lastSuccessfulSyncAt)
                : "never"
            } · last failure
            ${
              snapshot.remoteMaintenance.lastFailedSyncAt
                ? formatRelativeTimestamp(snapshot.remoteMaintenance.lastFailedSyncAt)
                : "never"
            }
          </div>
          <div class="muted" style="font-size: 12px;">
            last attempt
            ${
              snapshot.remoteMaintenance.lastAttemptAt
                ? `${formatRelativeTimestamp(snapshot.remoteMaintenance.lastAttemptAt)} (${snapshot.remoteMaintenance.lastAttemptStatus ?? "unknown"})`
                : "never"
            } · configured
            ${
              snapshot.remoteMaintenance.configuredAt
                ? formatRelativeTimestamp(snapshot.remoteMaintenance.configuredAt)
                : "defaults"
            }
          </div>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          ${
            snapshot.remoteMaintenance.blockedReason
              ? html`<div class="pill">${snapshot.remoteMaintenance.blockedReason}</div>`
              : nothing
          }
          ${
            snapshot.remoteMaintenance.lastError
              ? html`<div class="pill danger">${snapshot.remoteMaintenance.lastError}</div>`
              : nothing
          }
        </div>
      </div>
    </div>
    <div style="margin-top: 16px;">
      ${renderFederationRemoteMaintenanceControls(snapshot, props)}
    </div>
    <div style="margin-top: 16px;">
      <div class="row spread" style="gap: 12px; align-items: center; flex-wrap: wrap;">
        <div>
          <div class="muted" style="font-size: 12px;">Inbox maintenance</div>
          <div>
            ${snapshot.inbox.maintenance.enabled ? "enabled" : "disabled"} · review every
            ${snapshot.inbox.maintenance.reviewIntervalHours}h · received
            ${snapshot.inbox.maintenance.expireAfterHours.received}h · validated
            ${snapshot.inbox.maintenance.expireAfterHours.validated}h · shadowed
            ${snapshot.inbox.maintenance.expireAfterHours.shadowed}h · recommended
            ${snapshot.inbox.maintenance.expireAfterHours.recommended}h
          </div>
          <div class="muted" style="font-size: 12px;">
            last review
            ${
              snapshot.inbox.maintenance.lastReviewAt
                ? formatRelativeTimestamp(snapshot.inbox.maintenance.lastReviewAt)
                : "never"
            } · last expiry
            ${
              snapshot.inbox.maintenance.lastExpiredAt
                ? `${formatRelativeTimestamp(snapshot.inbox.maintenance.lastExpiredAt)} (${snapshot.inbox.maintenance.lastExpiredCount ?? 0})`
                : "never"
            } · next expiry
            ${
              snapshot.inbox.maintenance.nextExpiryAt
                ? formatRelativeTimestamp(snapshot.inbox.maintenance.nextExpiryAt)
                : "none"
            }
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${props.federationLoading}
          @click=${props.onFederationMaintenanceReview}
        >
          ${props.federationLoading ? "Reviewing..." : "Run Inbox Maintenance"}
        </button>
      </div>
    </div>
    <div style="margin-top: 16px;">
      ${renderFederationInboxMaintenanceControls(snapshot, props)}
    </div>
    <div style="margin-top: 16px;">
      <div class="muted" style="font-size: 12px;">Inbox state counts</div>
      <div>
        received ${snapshot.inbox.stateCounts.received} · validated
        ${snapshot.inbox.stateCounts.validated} · shadowed ${snapshot.inbox.stateCounts.shadowed}
        · recommended ${snapshot.inbox.stateCounts.recommended} · adopted
        ${snapshot.inbox.stateCounts.adopted} · expired ${snapshot.inbox.stateCounts.expired}
      </div>
    </div>
    <div style="margin-top: 16px;">
      <div class="muted" style="font-size: 12px;">Allowed push scopes</div>
      <div>${formatList(snapshot.allowedPushScopes)}</div>
      <div class="muted" style="font-size: 12px; margin-top: 4px;">
        configured
        ${
          snapshot.pushPolicyConfiguredAt
            ? formatRelativeTimestamp(snapshot.pushPolicyConfiguredAt)
            : "from config/defaults"
        }
      </div>
    </div>
    <div style="margin-top: 16px;">
      ${renderFederationPushPolicyControls(snapshot, props)}
    </div>
	    <div style="margin-top: 12px;">
	      <div class="muted" style="font-size: 12px;">Blocked push scopes</div>
	      <div>${formatList(snapshot.blockedPushScopes)}</div>
	      <div class="muted" style="font-size: 12px;">
	        hard blocked ${formatList(snapshot.requiredBlockedPushScopes)}
	      </div>
	    </div>
	    <div style="margin-top: 12px;">
	      <div class="muted" style="font-size: 12px;">Suppressed optional exports</div>
	      ${
          snapshot.suppressedPushScopes.length === 0
            ? html`
                <div class="muted" style="font-size: 12px">None right now.</div>
              `
            : html`${snapshot.suppressedPushScopes.map(
                (entry) => html`
	                <div class="muted" style="font-size: 12px; margin-top: 4px;">
	                  ${entry.scope} · ${entry.envelopeCount} envelopes · ${formatList(entry.envelopeKinds)}
	                </div>
	              `,
              )}`
        }
	    </div>
	    <div style="margin-top: 12px;">
	      <div class="muted" style="font-size: 12px;">Inbox root</div>
	      <div class="mono">${snapshot.inboxRoot}</div>
	    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Assignments root</div>
      <div class="mono">${snapshot.assignmentsRoot}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Last sync</div>
      <div>
        pushed
        ${
          snapshot.syncCursor?.lastPushedAt
            ? formatRelativeTimestamp(snapshot.syncCursor.lastPushedAt)
            : "never"
        } · pulled
        ${
          snapshot.syncCursor?.lastPulledAt
            ? formatRelativeTimestamp(snapshot.syncCursor.lastPulledAt)
            : "never"
        }
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Outbox journal</div>
      <div>
        ${snapshot.outboxJournalEventCount} events · pending ${snapshot.pendingOutboxEventCount}
      </div>
      <div class="muted" style="font-size: 12px;">
        head ${snapshot.localOutboxHeadEventId ?? "none"} · ack
        ${snapshot.acknowledgedOutboxEventId ?? "none"}
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Outbox journal root</div>
      <div class="mono">${snapshot.journalRoot}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Managed sync preview</div>
      ${
        props.federationPreview
          ? html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <strong>${props.federationPreview.ready ? "ready" : "blocked"}</strong>
                  <div class="pill">
                    ${formatRelativeTimestamp(props.federationPreview.generatedAt)}
                  </div>
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${
                    props.federationPreview.pushUrl && props.federationPreview.pullUrl
                      ? html`${props.federationPreview.pushUrl} -> ${props.federationPreview.pullUrl}`
                      : "remote endpoints unavailable"
                  }
                </div>
                <div class="muted" style="font-size: 12px;">
                  allowed ${formatList(props.federationPreview.allowedPushScopes)} · blocked
                  ${formatList(props.federationPreview.blockedPushScopes)} · timeout
                  ${props.federationPreview.timeoutMs ?? "n/a"}ms
                </div>
                <div class="muted" style="font-size: 12px;">
                  envelope keys ${formatList(props.federationPreview.pushedEnvelopeKeys)} · pending
                  ${props.federationPreview.pendingOutboxEventCount}
                </div>
	                <div class="muted" style="font-size: 12px;">
	                  manifest ${props.federationPreview.envelopeCounts.runtimeManifest} · reviews
	                  ${props.federationPreview.envelopeCounts.shareableReviews} · memories
	                  ${props.federationPreview.envelopeCounts.shareableMemories} · strategy
	                  ${props.federationPreview.envelopeCounts.strategyDigest} · news
	                  ${props.federationPreview.envelopeCounts.newsDigest} · telemetry
	                  ${props.federationPreview.envelopeCounts.shadowTelemetry} · governance
	                  ${props.federationPreview.envelopeCounts.capabilityGovernance} · team knowledge
	                  ${props.federationPreview.envelopeCounts.teamKnowledge}
	                </div>
	                ${
                    props.federationPreview.suppressedPushScopes.length === 0
                      ? nothing
                      : html`
	                        <div class="muted" style="font-size: 12px; margin-top: 4px;">
	                          suppressed by push policy
	                          ${props.federationPreview.suppressedPushScopes
                              .map(
                                (entry) =>
                                  `${entry.scope} (${entry.envelopeCount}; ${formatList(entry.envelopeKinds)})`,
                              )
                              .join(" · ")}
	                        </div>
	                      `
                  }
	                <div class="muted" style="font-size: 12px;">
	                  local head ${props.federationPreview.localOutboxHeadEventId ?? "none"} · ack
	                  ${props.federationPreview.acknowledgedOutboxEventId ?? "none"}
	                </div>
                ${
                  props.federationPreview.issue
                    ? html`<div class="pill danger" style="margin-top: 8px;">${props.federationPreview.issue}</div>`
                    : nothing
                }
                ${
                  props.federationPreview.pendingEvents.length === 0
                    ? html`
                        <div class="muted" style="font-size: 12px; margin-top: 8px">
                          No pending journal events would be pushed right now.
                        </div>
                      `
                    : html`${props.federationPreview.pendingEvents.map(
                        (entry) => html`
                          <div class="muted" style="font-size: 12px; margin-top: 8px;">
                            ${entry.summary} · ${entry.operation} ·
                            ${formatRelativeTimestamp(entry.generatedAt)}
                          </div>
                        `,
                      )}`
                }
              </div>
            `
          : props.federationPreviewError
            ? html`<div class="pill danger">${props.federationPreviewError}</div>`
            : html`
                <div class="muted">
                  Run Preview Managed Sync to compute the next outbound batch without contacting the remote.
                </div>
              `
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Recent sync attempts</div>
      ${
        snapshot.latestSyncAttempts.length === 0
          ? html`
              <div class="muted">No remote sync attempts recorded yet.</div>
            `
          : html`${snapshot.latestSyncAttempts.map(
              (attempt) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <strong>${attempt.status}</strong>
                  <div class="pill">${attempt.stage}</div>
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${formatRelativeTimestamp(attempt.completedAt)} · pushed
                  ${attempt.pushedEnvelopeKeys.length} envelopes · pulled
                  ${attempt.pulledPackageCount} packages · inbox processed
                  ${attempt.inboxProcessedCount}
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${attempt.pushUrl ?? "push-url-unavailable"} -> ${attempt.pullUrl ?? "pull-url-unavailable"}
                </div>
                ${
                  attempt.error
                    ? html`<div class="pill danger" style="margin-top: 8px;">${attempt.error}</div>`
                    : nothing
                }
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Outbox root</div>
      <div class="mono">${snapshot.outboxRoot}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Derived outbox artifacts</div>
      <div>
        ${snapshot.outboxEnvelopeCounts.shareableReview} shareable reviews ·
        ${snapshot.outboxEnvelopeCounts.shareableMemory} shareable memories ·
        ${snapshot.outboxEnvelopeCounts.strategyDigest} strategy digests ·
        ${snapshot.outboxEnvelopeCounts.newsDigest} news digests ·
        ${snapshot.outboxEnvelopeCounts.shadowTelemetry} shadow telemetry envelopes ·
        ${snapshot.outboxEnvelopeCounts.capabilityGovernance} governance snapshots ·
        ${snapshot.outboxEnvelopeCounts.teamKnowledge} team knowledge envelopes
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Runtime manifest export</div>
      <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div class="row spread" style="gap: 12px;">
          <strong>${snapshot.outboxPreview.runtimeManifest.instanceId}</strong>
          <div class="pill">
            ${formatRelativeTimestamp(snapshot.outboxPreview.runtimeManifest.generatedAt)}
          </div>
        </div>
        <div class="muted" style="font-size: 12px;">
          ${snapshot.outboxPreview.runtimeManifest.runtimeVersion} · capabilities
          ${snapshot.outboxPreview.runtimeManifest.capabilityCount}
        </div>
        <div class="muted mono" style="font-size: 12px;">
          ${snapshot.outboxPreview.runtimeManifest.workspaceRoot}
        </div>
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Strategy digest preview</div>
      <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div class="row spread" style="gap: 12px;">
          <strong>${snapshot.outboxPreview.latestStrategyDigest.id}</strong>
          <div class="pill">
            ${formatRelativeTimestamp(snapshot.outboxPreview.latestStrategyDigest.generatedAt)}
          </div>
        </div>
        <div class="muted" style="font-size: 12px;">
          ${snapshot.outboxPreview.latestStrategyDigest.strategyCount} strategies · routes
          ${snapshot.outboxPreview.latestStrategyDigest.routeCount}
        </div>
        ${
          snapshot.outboxPreview.latestStrategyDigest.strategies.length === 0
            ? html`
                <div class="muted" style="font-size: 12px; margin-top: 8px">
                  No shareable local strategies are currently in the digest.
                </div>
              `
            : html`${snapshot.outboxPreview.latestStrategyDigest.strategies.map(
                (entry) => html`
                  <div class="muted" style="font-size: 12px; margin-top: 8px;">
                    ${entry.route} -> ${entry.worker} ·
                    ${clampText(entry.summary, 120)} ·
                    ${formatRelativeTimestamp(entry.updatedAt)}
                  </div>
                `,
              )}`
        }
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">News digest preview</div>
      <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div class="row spread" style="gap: 12px;">
          <strong>${snapshot.outboxPreview.latestNewsDigest.sourceRuntimeId}</strong>
          <div class="pill">
            ${formatRelativeTimestamp(snapshot.outboxPreview.latestNewsDigest.generatedAt)}
          </div>
        </div>
        <div class="muted" style="font-size: 12px;">
          ${snapshot.outboxPreview.latestNewsDigest.itemCount} items ·
          ${formatList(snapshot.outboxPreview.latestNewsDigest.domains)}
        </div>
        ${
          snapshot.outboxPreview.latestNewsDigest.items.length === 0
            ? html`
                <div class="muted" style="font-size: 12px; margin-top: 8px">
                  No local digest items are currently queued for export.
                </div>
              `
            : html`${snapshot.outboxPreview.latestNewsDigest.items.map(
                (entry) => html`
                  <div class="muted" style="font-size: 12px; margin-top: 8px;">
                    ${entry.domain} · ${entry.exploit ? "exploit" : "explore"} ·
                    ${clampText(entry.title, 120)} ·
                    ${formatRelativeTimestamp(entry.createdAt)}
                  </div>
                `,
              )}`
        }
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Shareable review preview</div>
      ${
        snapshot.outboxPreview.latestShareableReviews.length === 0
          ? html`
              <div class="muted">No local shareable reviews are queued for export.</div>
            `
          : html`${snapshot.outboxPreview.latestShareableReviews.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div><strong>${entry.summary}</strong></div>
                <div class="muted" style="font-size: 12px;">
                  ${entry.taskId} · ${entry.outcome} ·
                  ${formatRelativeTimestamp(entry.generatedAt)}
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Shareable memory preview</div>
      ${
        snapshot.outboxPreview.latestShareableMemories.length === 0
          ? html`
              <div class="muted">No local shareable memories are queued for export.</div>
            `
          : html`${snapshot.outboxPreview.latestShareableMemories.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div><strong>${entry.summary}</strong></div>
                <div class="muted" style="font-size: 12px;">
                  ${entry.memoryType}${entry.route ? html` · ${entry.route}` : nothing} ·
                  ${formatRelativeTimestamp(entry.generatedAt)}
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Team knowledge preview</div>
      ${
        snapshot.outboxPreview.latestTeamKnowledge.length === 0
          ? html`
              <div class="muted">No derived team knowledge is queued for export.</div>
            `
          : html`${snapshot.outboxPreview.latestTeamKnowledge.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div><strong>${entry.title}</strong></div>
                <div class="muted" style="font-size: 12px;">
                  ${entry.summary}
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${formatList(entry.tags)} · ${formatRelativeTimestamp(entry.updatedAt)}
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Shadow telemetry preview</div>
      ${
        snapshot.outboxPreview.latestShadowTelemetry === null
          ? html`
              <div class="muted">No shadow telemetry envelope is queued for export.</div>
            `
          : html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <strong>${snapshot.outboxPreview.latestShadowTelemetry.id}</strong>
                  <div class="pill">
                    ${formatRelativeTimestamp(snapshot.outboxPreview.latestShadowTelemetry.generatedAt)}
                  </div>
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${snapshot.outboxPreview.latestShadowTelemetry.evaluationCount} evaluations ·
                  observed ${snapshot.outboxPreview.latestShadowTelemetry.stateCounts.observed} ·
                  shadow ${snapshot.outboxPreview.latestShadowTelemetry.stateCounts.shadow} ·
                  promoted ${snapshot.outboxPreview.latestShadowTelemetry.stateCounts.promoted} ·
                  adopted ${snapshot.outboxPreview.latestShadowTelemetry.stateCounts.adopted} ·
                  reverted ${snapshot.outboxPreview.latestShadowTelemetry.stateCounts.reverted}
                </div>
                ${
                  snapshot.outboxPreview.latestShadowTelemetry.candidateTypeCounts.length === 0
                    ? html`
                        <div class="muted" style="font-size: 12px; margin-top: 8px">
                          No candidate-type distribution is available in the latest telemetry snapshot.
                        </div>
                      `
                    : html`<div class="muted" style="font-size: 12px; margin-top: 8px;">
                        ${snapshot.outboxPreview.latestShadowTelemetry.candidateTypeCounts
                          .map((entry) => `${entry.candidateType} (${entry.count})`)
                          .join(" · ")}
                      </div>`
                }
                ${
                  snapshot.outboxPreview.latestShadowTelemetry.evaluations.length === 0
                    ? html`
                        <div class="muted" style="font-size: 12px; margin-top: 8px">
                          No shadow evaluations are present in the latest telemetry payload.
                        </div>
                      `
                    : html`${snapshot.outboxPreview.latestShadowTelemetry.evaluations.map(
                        (entry) => html`
                          <div class="muted" style="font-size: 12px; margin-top: 8px;">
                            ${entry.candidateType} · ${entry.state} · ${entry.targetLayer} ·
                            ${entry.observationCount} observations ·
                            ${formatRelativeTimestamp(entry.updatedAt)}
                          </div>
                        `,
                      )}`
                }
              </div>
            `
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Capability governance export</div>
      ${
        snapshot.outboxPreview.latestCapabilityGovernance === null
          ? html`
              <div class="muted">No capability governance snapshot is queued for export.</div>
            `
          : html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <strong>${snapshot.outboxPreview.latestCapabilityGovernance.id}</strong>
                  <div class="pill">
                    ${formatRelativeTimestamp(snapshot.outboxPreview.latestCapabilityGovernance.generatedAt)}
                  </div>
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${snapshot.outboxPreview.latestCapabilityGovernance.entryCount} registry entries ·
                  ${snapshot.outboxPreview.latestCapabilityGovernance.mcpGrantCount} MCP grants
                  ${
                    snapshot.outboxPreview.latestCapabilityGovernance.preset
                      ? html` · ${snapshot.outboxPreview.latestCapabilityGovernance.preset}`
                      : nothing
                  }
                  ${
                    snapshot.outboxPreview.latestCapabilityGovernance.sandboxMode
                      ? html` · sandbox ${snapshot.outboxPreview.latestCapabilityGovernance.sandboxMode}`
                      : nothing
                  }
                </div>
                <div class="muted" style="font-size: 12px;">
                  agents ${snapshot.outboxPreview.latestCapabilityGovernance.agentCount ?? 0} ·
                  extensions ${snapshot.outboxPreview.latestCapabilityGovernance.extensionCount ?? 0}
                </div>
                ${
                  snapshot.outboxPreview.latestCapabilityGovernance.entryPreview.length === 0
                    ? html`
                        <div class="muted" style="font-size: 12px; margin-top: 8px">
                          No governed registry entries in the latest snapshot.
                        </div>
                      `
                    : html`${snapshot.outboxPreview.latestCapabilityGovernance.entryPreview.map(
                        (entry) => html`
                          <div class="muted" style="font-size: 12px; margin-top: 8px;">
                            ${entry.registryType}:${entry.targetId} · ${entry.state} ·
                            ${formatRelativeTimestamp(entry.updatedAt)}
                          </div>
                        `,
                      )}`
                }
                ${
                  snapshot.outboxPreview.latestCapabilityGovernance.mcpGrantPreview.length === 0
                    ? html`
                        <div class="muted" style="font-size: 12px; margin-top: 8px">
                          No host-owned MCP grants in the latest snapshot.
                        </div>
                      `
                    : html`${snapshot.outboxPreview.latestCapabilityGovernance.mcpGrantPreview.map(
                        (entry) => html`
                          <div class="muted" style="font-size: 12px; margin-top: 8px;">
                            grant ${entry.agentId} -> ${entry.mcpServerId} · ${entry.state} ·
                            ${formatRelativeTimestamp(entry.updatedAt)}
                          </div>
                        `,
                      )}`
                }
              </div>
            `
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Recent outbox journal events</div>
      ${
        snapshot.outboxPreview.latestJournalEvents.length === 0
          ? html`
              <div class="muted">No authoritative outbox journal events are available yet.</div>
            `
          : html`${snapshot.outboxPreview.latestJournalEvents.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <strong>${entry.summary}</strong>
                  <div class=${entry.deliveryState === "pending" ? "pill warn" : "pill"}>
                    ${entry.deliveryState}
                  </div>
                </div>
                <div class="muted" style="font-size: 12px;">
                  ${entry.envelopeType}${entry.envelopeId ? html` · ${entry.envelopeId}` : nothing}
                  · ${entry.operation} · ${formatRelativeTimestamp(entry.generatedAt)}
                </div>
                ${
                  entry.sourceRuntimeId
                    ? html`
                        <div class="muted" style="font-size: 12px;">
                          source runtime ${entry.sourceRuntimeId}
                        </div>
                      `
                    : nothing
                }
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Assignment inbox</div>
      <div>
        pending ${snapshot.assignmentInbox.stateCounts.pending} · materialized
        ${snapshot.assignmentInbox.stateCounts.materialized} · blocked
        ${snapshot.assignmentInbox.stateCounts.blocked} · applied
        ${snapshot.assignmentInbox.stateCounts.applied} · invalid
        ${snapshot.assignmentInbox.stateCounts.invalid}
      </div>
      ${
        snapshot.assignmentInbox.latestAssignments.length === 0
          ? html`
              <div class="muted">No assignment records are staged locally yet.</div>
            `
          : html`${snapshot.assignmentInbox.latestAssignments.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <div style="min-width: 0;">
                    <div><strong>${entry.title}</strong></div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.sourceRuntimeId}
                      ${entry.sourcePackageId ? html` · package ${entry.sourcePackageId}` : nothing}
                      ${entry.sourceTaskId ? html` · source task ${entry.sourceTaskId}` : nothing}
                      ${entry.localTaskId ? html` · local task ${entry.localTaskId}` : nothing}
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.summary}
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.route ? html`${entry.route}` : "unscoped"}
                      ${entry.worker ? html` · ${entry.worker}` : nothing}
                      ${entry.surfaceId ? html` · surface ${entry.surfaceId}` : nothing}
                      ${entry.agentId ? html` · agent ${entry.agentId}` : nothing}
                      ${entry.rawState ? html` · raw ${entry.rawState}` : nothing}
                      ${
                        entry.materializedAt
                          ? html` · materialized ${formatRelativeTimestamp(entry.materializedAt)}`
                          : entry.receivedAt
                            ? html` · received ${formatRelativeTimestamp(entry.receivedAt)}`
                            : html` · updated ${formatRelativeTimestamp(entry.updatedAt)}`
                      }
                    </div>
                    ${
                      entry.blockedReason
                        ? html`
                          <div style="font-size: 12px; color: var(--warn, #b45309);">
                            ${entry.blockedReason}
                          </div>
                        `
                        : nothing
                    }
                    <div class="muted" style="font-size: 12px;">file ${entry.fileName}</div>
                  </div>
                  <div class=${resolveFederationAssignmentPillClass(entry.state)}>
                    ${entry.state}
                  </div>
                </div>
                ${
                  entry.availableActions.length > 0
                    ? html`
                        <div class="row" style="gap: 8px; margin-top: 8px; flex-wrap: wrap;">
                          ${
                            entry.availableActions.includes("materialize")
                              ? html`
                                  <button
                                    class="btn"
                                    type="button"
                                    ?disabled=${props.federationLoading}
                                    @click=${() => {
                                      void props.onFederationAssignmentMaterialize(entry.id);
                                    }}
                                  >
                                    Materialize Task
                                  </button>
                                `
                              : nothing
                          }
                          ${
                            entry.availableActions.includes("block")
                              ? html`
                                  <button
                                    class="btn"
                                    type="button"
                                    ?disabled=${props.federationLoading}
                                    @click=${() => {
                                      const reason =
                                        window.prompt("Block reason (optional)", "") ?? "";
                                      void props.onFederationAssignmentTransition({
                                        id: entry.id,
                                        state: "blocked",
                                        reason: reason.trim() || "Blocked locally from Runtime UI.",
                                      });
                                    }}
                                  >
                                    Block
                                  </button>
                                `
                              : nothing
                          }
                          ${
                            entry.availableActions.includes("reset")
                              ? html`
                                  <button
                                    class="btn"
                                    type="button"
                                    ?disabled=${props.federationLoading}
                                    @click=${() => {
                                      void props.onFederationAssignmentTransition({
                                        id: entry.id,
                                        state: "pending",
                                      });
                                    }}
                                  >
                                    Reset
                                  </button>
                                `
                              : nothing
                          }
                          ${
                            entry.availableActions.includes("mark_applied")
                              ? html`
                                  <button
                                    class="btn"
                                    type="button"
                                    ?disabled=${props.federationLoading}
                                    @click=${() => {
                                      void props.onFederationAssignmentTransition({
                                        id: entry.id,
                                        state: "applied",
                                        reason: "Marked applied from Runtime UI.",
                                      });
                                    }}
                                  >
                                    Mark Applied
                                  </button>
                                `
                              : nothing
                          }
                        </div>
                      `
                    : nothing
                }
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Local adopted artifacts</div>
      <div>
        ${snapshot.inbox.coordinatorSuggestionCount} coordinator suggestions ·
        ${snapshot.inbox.sharedStrategyCount} shared strategies ·
        ${snapshot.inbox.teamKnowledgeCount} team knowledge records
      </div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Coordinator suggestion queue</div>
      ${
        snapshot.inbox.latestCoordinatorSuggestions.length === 0
          ? html`
              <div class="muted">No coordinator suggestions adopted locally yet.</div>
            `
          : html`${snapshot.inbox.latestCoordinatorSuggestions.map(
              (entry) => html`
              <div
                class="row spread"
                style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
              >
                <div style="min-width: 0;">
                  <div><strong>${entry.title}</strong></div>
                  <div class="muted" style="font-size: 12px;">
                    ${entry.sourceRuntimeId} · ${formatRelativeTimestamp(entry.updatedAt)}
                    ${entry.taskId ? html` · source task ${entry.taskId}` : nothing}
                    ${entry.localTaskId ? html` · local task ${entry.localTaskId}` : nothing}
                    ${
                      !entry.localTaskId && entry.lastMaterializedLocalTaskId
                        ? html` · last local task ${entry.lastMaterializedLocalTaskId}`
                        : nothing
                    }
                    ${entry.localTaskStatus ? html` · local status ${entry.localTaskStatus}` : nothing}
                  </div>
                  <div class="muted" style="font-size: 12px;">${entry.summary}</div>
                  ${
                    entry.rematerializeReason
                      ? html`
                          <div style="font-size: 12px; color: var(--warn, #b45309);">
                            ${entry.rematerializeReason}
                          </div>
                        `
                      : nothing
                  }
                </div>
                <div class="pill">
                  ${
                    entry.localTaskId
                      ? entry.localTaskStatus === "completed"
                        ? "completed locally"
                        : "materialized"
                      : entry.rematerializeReason
                        ? "requeued"
                        : "queued"
                  }
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Local shared strategies</div>
      ${
        snapshot.inbox.latestSharedStrategies.length === 0
          ? html`
              <div class="muted">No shared strategies are adopted locally yet.</div>
            `
          : html`${snapshot.inbox.latestSharedStrategies.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <div style="min-width: 0;">
                    <div><strong>${entry.summary}</strong></div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.route} · ${entry.worker} · ${entry.thinkingLane} · confidence
                      ${entry.confidence}%
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.sourceRuntimeId}
                      ${entry.sourcePackageId ? html` · package ${entry.sourcePackageId}` : nothing}
                      ${
                        entry.adoptedAt
                          ? html` · adopted ${formatRelativeTimestamp(entry.adoptedAt)}`
                          : html` · updated ${formatRelativeTimestamp(entry.updatedAt)}`
                      }
                    </div>
                    ${
                      entry.skillIds.length > 0
                        ? html`
                          <div class="muted" style="font-size: 12px;">
                            skills ${clampText(formatList(entry.skillIds), 120)}
                          </div>
                        `
                        : nothing
                    }
                  </div>
                  <div class="pill">${entry.invalidated ? "invalidated" : "strategy-plane"}</div>
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Local team knowledge</div>
      ${
        snapshot.inbox.latestTeamKnowledge.length === 0
          ? html`
              <div class="muted">No team-shareable knowledge is adopted locally yet.</div>
            `
          : html`${snapshot.inbox.latestTeamKnowledge.map(
              (entry) => html`
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="row spread" style="gap: 12px;">
                  <div style="min-width: 0;">
                    <div><strong>${entry.title}</strong></div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.summary}
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.namespace} · ${entry.sourceRuntimeId}
                      ${entry.sourcePackageId ? html` · package ${entry.sourcePackageId}` : nothing}
                      ${
                        entry.adoptedAt
                          ? html` · adopted ${formatRelativeTimestamp(entry.adoptedAt)}`
                          : html` · updated ${formatRelativeTimestamp(entry.updatedAt)}`
                      }
                    </div>
                    <div class="muted" style="font-size: 12px;">
                      ${entry.sourceKind ? html`${entry.sourceKind} · ` : nothing}
                      ${formatList(entry.tags)}
                    </div>
                  </div>
                  <div class="pill">archive-plane</div>
                </div>
              </div>
            `,
            )}`
      }
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Recent inbox packages</div>
      ${
        snapshot.inbox.latestPackages.length === 0
          ? html`
              <div class="muted">No federation packages received yet.</div>
            `
          : html`${snapshot.inbox.latestPackages.map(
              (entry) => html`
              <div
                class="row spread"
                style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);"
              >
                <div style="min-width: 0;">
                  <div><strong>${entry.summary}</strong></div>
                  <div class="muted" style="font-size: 12px;">
                    ${entry.packageType} · ${entry.sourceRuntimeId} ·
                    ${formatRelativeTimestamp(entry.updatedAt)}
                    ${
                      entry.expiresAt
                        ? html` · expires ${formatRelativeTimestamp(entry.expiresAt)}`
                        : nothing
                    }
                  </div>
                  ${
                    entry.stale
                      ? html`
                          <div style="margin-top: 6px; color: var(--warn, #b45309); font-size: 12px">
                            This actionable package is stale and ready to expire on the next maintenance review.
                          </div>
                        `
                      : nothing
                  }
                  ${
                    entry.validationErrorCount > 0
                      ? html`
                        <div
                          style="margin-top: 6px; color: var(--warn, #b45309); font-size: 12px;"
                        >
                          ${entry.validationErrorCount} validation issue${
                            entry.validationErrorCount === 1 ? "" : "s"
                          }
                          ${
                            entry.validationErrors.length > 0
                              ? html`: ${entry.validationErrors.join(" · ")}`
                              : nothing
                          }
                        </div>
                      `
                      : nothing
                  }
                  ${
                    entry.reviewSummary
                      ? html`
                        <div style="margin-top: 6px; font-size: 12px;">
                          <strong>Review:</strong> ${entry.reviewSummary}
                          ${
                            entry.reviewSignals.length > 0
                              ? html` ${entry.reviewSignals.join(" · ")}`
                              : nothing
                          }
                        </div>
                      `
                      : nothing
                  }
                  ${
                    entry.payloadPreview.length > 0
                      ? html`
                        <div style="margin-top: 6px; font-size: 12px;">
                          <strong>Payload:</strong> ${entry.payloadPreview.join(" · ")}
                        </div>
                      `
                      : nothing
                  }
                  ${
                    entry.localLandingSummary
                      ? html`
                        <div style="margin-top: 6px; font-size: 12px;">
                          <strong>Local landing:</strong> ${entry.localLandingSummary}
                        </div>
                      `
                      : nothing
                  }
                </div>
                <div style="display: grid; gap: 8px; justify-items: end;">
                  <div class="row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
                    <div class="pill">${entry.state}</div>
                    ${
                      entry.localLandingLabel
                        ? html`
                            <div class="pill">${entry.localLandingLabel}</div>
                          `
                        : nothing
                    }
                    ${
                      entry.stale
                        ? html`
                            <div class="pill warn">stale</div>
                          `
                        : nothing
                    }
                    ${
                      entry.riskLevel
                        ? html`
                          <div class=${resolveFederationRiskPillClass(entry.riskLevel)}>
                            ${entry.riskLevel} risk
                          </div>
                        `
                        : nothing
                    }
                    ${
                      entry.autoAdoptEligible
                        ? html`
                            <div class="pill">auto-adopt eligible</div>
                          `
                        : nothing
                    }
                  </div>
                  <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
                    ${
                      resolveFederationPrimaryTransition(entry) &&
                      resolveFederationPrimaryLabel(entry)
                        ? html`
                          <button
                            class="btn small"
                            ?disabled=${props.federationLoading}
                            @click=${() =>
                              props.onFederationPackageTransition({
                                id: entry.id,
                                state: resolveFederationPrimaryTransition(entry)!,
                                reason: resolveFederationPrimaryReason(entry),
                              })}
                          >
                            ${resolveFederationPrimaryLabel(entry)}
                          </button>
                        `
                        : nothing
                    }
                    ${
                      entry.state === "received" ||
                      entry.state === "validated" ||
                      entry.state === "shadowed" ||
                      entry.state === "recommended"
                        ? html`
                          <button
                            class="btn small danger"
                            ?disabled=${props.federationLoading}
                            @click=${() =>
                              props.onFederationPackageTransition({
                                id: entry.id,
                                state: "rejected",
                              })}
                          >
                            Reject
                          </button>
                        `
                        : nothing
                    }
                  </div>
                </div>
              </div>
            `,
            )}`
      }
    </div>
  `;
}

export function renderRuntime(props: RuntimeProps) {
  const snapshot = props.snapshot;
  const consoleStore = props.consoleStore;
  const preview = props.importPreview ?? snapshot?.importPreview ?? null;
  const federation = props.federationStatus ?? snapshot?.federation ?? null;

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">ClawMark</div>
        <div class="card-sub">Runtime Core status, storage roots, and execution posture.</div>
        <div class="row" style="margin-top: 16px; gap: 12px; align-items: center;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing..." : t("common.refresh")}
          </button>
          ${props.error ? html`<div class="pill danger">${props.error}</div>` : nothing}
        </div>
        ${
          snapshot
            ? html`
              <div class="stat-grid stat-grid--4" style="margin-top: 16px;">
                ${renderStat(t("common.version"), snapshot.runtimeVersion)}
                ${renderStat("Preset", snapshot.preset)}
                ${renderStat("Runnable tasks", snapshot.tasks.runnableCount)}
                ${renderStat("Formal memories", snapshot.memory.total)}
              </div>
              <div style="margin-top: 16px;">
                <div class="muted" style="font-size: 12px;">Instance root</div>
                <div class="mono">${snapshot.instanceManifest.instanceRoot}</div>
              </div>
              <div style="margin-top: 12px;">
                <div class="muted" style="font-size: 12px;">Runtime root</div>
                <div class="mono">${snapshot.instanceManifest.runtimeRoot}</div>
              </div>
            `
            : html`
                <div class="muted" style="margin-top: 16px">Connect to the gateway to inspect runtime state.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">User Console</div>
        <div class="card-sub">Default web control surface for the local runtime.</div>
        ${
          snapshot && consoleStore
            ? html`
              <div class="stat-grid stat-grid--4">
                ${renderStat("Display name", snapshot.userConsole.model.displayName || "unset")}
                ${renderStat("Report policy", snapshot.userConsole.model.reportPolicy || "reply")}
                ${renderStat("Working sessions", snapshot.userConsole.workingSessionCount)}
                ${renderStat("Review hours", snapshot.userConsole.reviewIntervalHours)}
                ${renderStat(
                  "Last review",
                  snapshot.userConsole.lastReviewAt
                    ? formatRelativeTimestamp(snapshot.userConsole.lastReviewAt)
                    : "Never",
                  snapshot.userConsole.maintenanceEnabled ? "Enabled" : "Disabled",
                )}
                ${renderStat(
                  "Recommended prefs",
                  snapshot.userConsole.recommendedUserModelOptimizationCount,
                )}
                ${renderStat("Shadow prefs", snapshot.userConsole.shadowUserModelOptimizationCount)}
                ${renderStat("User surfaces", snapshot.userConsole.userOwnedSurfaceCount)}
                ${renderStat("Expired sessions", snapshot.userConsole.expiredSessionCount)}
                ${renderStat("Pending actions", snapshot.userConsole.pendingActionCount)}
              </div>
              <div style="margin-top: 12px;" class="muted">
                ${
                  snapshot.userConsole.model.communicationStyle ||
                  "Communication style not customized yet."
                }
                ${
                  snapshot.userConsole.lastSessionCleanupAt
                    ? html` Last session cleanup ${formatRelativeTimestamp(
                        snapshot.userConsole.lastSessionCleanupAt,
                      )}.`
                    : nothing
                }
              </div>
              <div style="margin-top: 16px;">
                ${renderUserConsoleMaintenanceControls(snapshot, props)}
              </div>
              <div class="row" style="margin-top: 16px; gap: 12px; align-items: center;">
                <button
                  class="btn"
                  ?disabled=${props.loading}
                  @click=${() => {
                    void props.onUserConsoleMaintenanceReview();
                  }}
                >
                  Run User Console Maintenance
                </button>
                <div class="muted" style="font-size: 12px;">
                  Applies the same scheduled cleanup and optimization review path that now runs on
                  idle task-loop ticks for the user console.
                </div>
              </div>
              <div style="margin-top: 16px;">${renderUserActionQueue(snapshot, props)}</div>
              <div style="margin-top: 16px;">${renderUserModelForm(consoleStore, snapshot, props)}</div>
              <div style="margin-top: 20px;">
                ${renderUserModelOptimizationSection(consoleStore, snapshot, props)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Session Working Preferences</div>
        <div class="card-sub">
          Temporary session-specific overlays that do not overwrite the long-term user core.
        </div>
        ${
          consoleStore
            ? html`
              <div class="stat-grid stat-grid--3" style="margin-top: 16px;">
                ${renderStat("Active", snapshot?.userConsole.workingSessionCount ?? 0)}
                ${renderStat("Expiring 24h", snapshot?.userConsole.expiringSessionCount ?? 0)}
                ${renderStat("Expired", snapshot?.userConsole.expiredSessionCount ?? 0)}
                ${renderStat("Active agents", snapshot?.userConsole.activeAgentCount ?? 0)}
                ${renderStat(
                  "Last cleanup",
                  snapshot?.userConsole.lastSessionCleanupAt
                    ? formatRelativeTimestamp(snapshot.userConsole.lastSessionCleanupAt)
                    : "Never",
                )}
              </div>
              <div class="list" style="margin-top: 16px;">
                ${renderSessionPreferenceEditors(consoleStore, props)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Agents</div>
        <div class="card-sub">Local ecology objects that can own channel surfaces.</div>
        ${
          consoleStore
            ? html`<div class="list" style="margin-top: 16px;">${renderAgentEditors(consoleStore, snapshot ?? undefined, props)}</div>`
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Surfaces</div>
        <div class="card-sub">Channel/account surfaces bound to the user console or an agent.</div>
        ${
          consoleStore
            ? html`
              <div class="list" style="margin-top: 16px;">
                ${renderRoleOptimizationSection(consoleStore, snapshot, props)}
                ${
                  consoleStore.surfaces.length === 0
                    ? html`
                        <div class="muted">No channel surfaces configured yet.</div>
                      `
                    : consoleStore.surfaces.map((surface) =>
                        renderSurfaceEditor(
                          consoleStore,
                          props,
                          surface,
                          snapshot?.surfaces.find((entry) => entry.id === surface.id),
                        ),
                      )
                }
                ${renderNewSurfaceForm(consoleStore, props)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Tasks</div>
        <div class="card-sub">Canonical task states and the current local task loop backlog.</div>
        ${
          snapshot
            ? html`
              ${renderTaskComposer(snapshot, props)}
              <div style="margin-top: 20px;">${renderTaskLoopControls(snapshot, props)}</div>
              <div style="margin-top: 20px;">${renderRuntimeNotifyLedger(snapshot)}</div>
              <div style="margin-top: 20px;">${renderTaskReviewLedger(snapshot)}</div>
              <div style="margin-top: 20px;">${renderTaskStatusList(snapshot)}</div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Recent Tasks</div>
        <div class="card-sub">Latest managed tasks from the authoritative runtime store.</div>
        ${
          snapshot
            ? renderRecentTasks(snapshot, props)
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Memory</div>
        <div class="card-sub">Formal memories, strategies, and retrieval defaults.</div>
        ${
          snapshot
            ? html`
              <div class="stat-grid stat-grid--4">
                ${renderStat("Strategies", snapshot.memory.strategyCount)}
                ${renderStat("Learnings", snapshot.memory.learningCount)}
                ${renderStat("Stale learnings", snapshot.memory.staleLearningCount)}
                ${renderStat("Evolution", snapshot.memory.evolutionCount)}
                ${renderStat("Stale evolution", snapshot.memory.staleEvolutionCount)}
                ${renderStat("Invalidated", snapshot.memory.invalidatedCount)}
                ${renderStat(
                  "High decay",
                  snapshot.memory.highDecayCount,
                  `Threshold ≥ ${snapshot.memory.lifecyclePolicy.highDecayThreshold}`,
                )}
                ${renderStat("Reinforced 7d", snapshot.memory.reinforcedRecentlyCount)}
                ${renderStat("Review hours", snapshot.memory.reviewIntervalHours)}
                ${renderStat(
                  "Last review",
                  snapshot.memory.lastReviewAt
                    ? formatRelativeTimestamp(snapshot.memory.lastReviewAt)
                    : "Never",
                  snapshot.memory.lifecycleReviewEnabled ? "Enabled" : "Disabled",
                )}
                ${renderStat(
                  "Markdown files",
                  snapshot.memory.markdownMirror.fileCount,
                  snapshot.memory.markdownMirror.lastSyncedAt
                    ? `Last synced ${formatRelativeTimestamp(snapshot.memory.markdownMirror.lastSyncedAt)}`
                    : snapshot.memory.markdownMirror.exists
                      ? "Mirror present"
                      : "Not synced yet",
                )}
                ${renderStat("System1 planes", snapshot.retrieval.system1DefaultPlanes.length)}
                ${renderStat("System2 planes", snapshot.retrieval.system2DefaultPlanes.length)}
              </div>
              <div style="margin-top: 16px;">
                ${renderMemoryLifecycleControls(snapshot, props)}
              </div>
              <div class="muted" style="margin-top: 12px; font-size: 12px;">
                Markdown mirror root:
                <span class="mono">${snapshot.memory.markdownMirror.rootPath}</span>
              </div>
              <div style="margin-top: 16px;">${renderRecentMemories(snapshot, props)}</div>
              <div style="margin-top: 16px; display:grid; gap: 8px;">
                <div class="muted" style="font-size: 12px;">Recent lifecycle ledger</div>
                ${renderMemoryLifecycleEvents(snapshot, props)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">News / Info</div>
        <div class="card-sub">
          Independent info module with category selection and local delivery settings.
        </div>
        ${
          snapshot
            ? html`
              <div class="stat-grid stat-grid--4">
                ${renderStat("Refresh (min)", snapshot.intel.refreshMinutes)}
                ${renderStat("News", snapshot.intel.enabled ? "On" : "Off")}
                ${renderStat("Digest", snapshot.intel.digestEnabled ? "On" : "Off")}
                ${renderStat(
                  "Last refresh",
                  snapshot.intel.lastRefreshAt
                    ? formatRelativeTimestamp(snapshot.intel.lastRefreshAt)
                    : "never",
                  formatIntelRefreshOutcome(snapshot.intel.lastRefreshOutcome),
                )}
                ${renderStat(
                  "Next refresh",
                  snapshot.intel.nextRefreshAt
                    ? formatRelativeTimestamp(snapshot.intel.nextRefreshAt)
                    : snapshot.intel.modulePausedReason || "not scheduled",
                )}
                ${renderStat("Stale domains", snapshot.intel.staleDomainCount)}
                ${renderStat("Error domains", snapshot.intel.errorDomainCount)}
                ${renderStat(
                  "Digest mix",
                  `${snapshot.intel.exploitItemsPerDigest}/${snapshot.intel.exploreItemsPerDigest}`,
                )}
              </div>
              ${
                snapshot.intel.modulePausedReason
                  ? html`<div class="muted" style="margin-top: 12px; font-size: 12px;">
                      ${snapshot.intel.modulePausedReason}
                    </div>`
                  : nothing
              }
              <div style="margin-top: 16px;">${renderIntelControls(snapshot, props)}</div>
              <div style="margin-top: 16px;">${renderIntelDomains(snapshot)}</div>
              <div style="margin-top: 16px;">
                <div class="muted" style="font-size: 12px; margin-bottom: 6px;">
                  Recent digest/candidate items
                </div>
                ${renderIntelRecentItems(snapshot, props)}
              </div>
              <div style="margin-top: 16px;">
                <div class="muted" style="font-size: 12px; margin-bottom: 6px;">Sources</div>
                ${renderIntelSources(snapshot)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Evolution</div>
        <div class="card-sub">
          Shadow evaluation, candidate promotion, and low-risk local optimization review.
        </div>
        ${
          snapshot
            ? html`
              <div class="stat-grid stat-grid--4">
                ${renderStat("Candidates", snapshot.evolution.candidateCount)}
                ${renderStat("Review hours", snapshot.evolution.reviewIntervalHours)}
                ${renderStat("Auto apply", snapshot.evolution.autoApplyLowRisk ? "On" : "Off")}
                ${renderStat("Auto canary", snapshot.evolution.autoCanaryEvolution ? "On" : "Off")}
                ${renderStat(
                  "Last review",
                  snapshot.evolution.lastReviewAt
                    ? formatRelativeTimestamp(snapshot.evolution.lastReviewAt)
                    : "Never",
                  snapshot.evolution.enabled ? "Enabled" : "Disabled",
                )}
              </div>
              <div style="margin-top: 16px;">${renderEvolutionControls(snapshot, props)}</div>
              <div style="margin-top: 16px;" class="muted">
                ${
                  Object.entries(snapshot.evolution.stateCounts)
                    .map(([state, count]) => `${state} ${count}`)
                    .join(" · ") || "No evolution candidates yet."
                }
              </div>
              <div style="margin-top: 16px;">
                ${renderEvolutionCandidates(snapshot, props)}
              </div>
            `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Capabilities</div>
        <div class="card-sub">
          Authoritative governance for skills, agents, and MCP access. This is the local execution gate.
        </div>
        ${
          snapshot
            ? renderCapabilitiesSection(snapshot, props)
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Federation Hooks</div>
        <div class="card-sub">
          Local envelopes, assignment inbox, and push policy derived from the current runtime configuration.
        </div>
        ${
          props.federationLoading && !federation
            ? html`
                <div class="muted">Loading federation status...</div>
              `
            : html`
              <div class="row" style="gap: 12px; margin-bottom: 16px; align-items: center;">
                <button
                  class="btn"
                  ?disabled=${props.federationLoading}
                  @click=${props.onFederationPreview}
                >
                  ${props.federationLoading ? "Working..." : "Preview Managed Sync"}
                </button>
                <button
                  class="btn"
                  ?disabled=${props.federationLoading}
                  @click=${props.onFederationSync}
                >
                  ${props.federationLoading ? "Working..." : "Sync Federation"}
                </button>
              </div>
              ${renderFederation(federation, props.federationError, props)}
            `
        }
      </div>

      <div class="card">
        <div class="card-title">Runtime Migration</div>
        <div class="card-sub">
          One-time migration from an older runtime snapshot into this instance root without mutating the source files.
        </div>
        ${renderImportPreview(preview, props.importApplyResult, props.importBusy, props.onImportApply)}
      </div>
    </section>
  `;
}
