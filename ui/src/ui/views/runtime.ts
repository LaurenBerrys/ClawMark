import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { clampText, formatList, formatMs, formatRelativeTimestamp } from "../format.ts";
import type {
  FederationRuntimeSnapshot,
  LegacyRuntimeImportApplyResult,
  LegacyRuntimeImportReport,
  RuntimeDashboardSnapshot,
} from "../types.ts";

type RuntimeProps = {
  loading: boolean;
  error: string | null;
  snapshot: RuntimeDashboardSnapshot | null;
  importPreview: LegacyRuntimeImportReport | null;
  importBusy: boolean;
  importApplyResult: LegacyRuntimeImportApplyResult | null;
  federationLoading: boolean;
  federationError: string | null;
  federationStatus: FederationRuntimeSnapshot | null;
  onRefresh: () => void;
  onImportApply: () => void;
  onFederationSync: () => void;
};

function formatConfidencePercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
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

function renderTaskStatusList(snapshot: RuntimeDashboardSnapshot) {
  const rows = Object.entries(snapshot.tasks.statusCounts).filter(([, count]) => Number(count) > 0);
  return rows.length === 0
    ? html`
        <div class="muted">No managed tasks detected.</div>
      `
    : html`${rows.map(
        ([status, count]) => html`
          <div class="row spread" style="padding: 6px 0; border-bottom: 1px solid var(--line);">
            <span class="mono">${status}</span>
            <strong>${count}</strong>
          </div>
        `,
      )}`;
}

function renderRecentTasks(snapshot: RuntimeDashboardSnapshot) {
  const tasks = snapshot.tasks.tasks.slice(0, 5);
  return tasks.length === 0
    ? html`
        <div class="muted">No task history in the authoritative store yet.</div>
      `
    : html`${tasks.map(
        (task) => html`
          <div class="row spread" style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
            <div style="min-width: 0;">
              <div><strong>${clampText(task.title, 72)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${task.route} · ${task.status} · updated ${formatRelativeTimestamp(task.updatedAt)}
              </div>
            </div>
            <div class="pill">${task.priority}</div>
          </div>
        `,
      )}`;
}

function renderRecentMemories(snapshot: RuntimeDashboardSnapshot) {
  const memories = snapshot.memory.memories.slice(0, 5);
  return memories.length === 0
    ? html`
        <div class="muted">No formal memories in the authoritative store yet.</div>
      `
    : html`${memories.map(
        (memory) => html`
          <div class="row spread" style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
            <div style="min-width: 0;">
              <div><strong>${clampText(memory.summary, 96)}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${memory.memoryType}${memory.route ? html` · ${memory.route}` : nothing} ·
                ${formatRelativeTimestamp(memory.updatedAt)}
              </div>
            </div>
            <div class="pill">${formatConfidencePercent(memory.confidence)}</div>
          </div>
        `,
      )}`;
}

function renderAgents(snapshot: RuntimeDashboardSnapshot) {
  const agents = snapshot.agents.slice(0, 6);
  return agents.length === 0
    ? html`
        <div class="muted">No agents configured yet.</div>
      `
    : html`${agents.map(
        (agent) => html`
          <div class="row spread" style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
            <div style="min-width: 0;">
              <div><strong>${agent.name}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${agent.roleBase ? `${agent.roleBase} · ` : nothing}${agent.surfaceCount} surfaces ·
                ${agent.skillCount} skills
              </div>
            </div>
            <div class="pill">${agent.active ? "active" : "paused"}</div>
          </div>
        `,
      )}`;
}

function renderSurfaces(snapshot: RuntimeDashboardSnapshot) {
  const surfaces = snapshot.surfaces.slice(0, 6);
  return surfaces.length === 0
    ? html`
        <div class="muted">No channel surfaces configured yet.</div>
      `
    : html`${surfaces.map(
        (surface) => html`
          <div class="row spread" style="gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
            <div style="min-width: 0;">
              <div><strong>${surface.label}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${surface.channel} · ${surface.ownerKind}${surface.role ? ` · ${surface.role}` : ""}
              </div>
            </div>
            <div class="pill">${surface.active ? "active" : "off"}</div>
          </div>
        `,
      )}`;
}

function renderIntelDomains(snapshot: RuntimeDashboardSnapshot) {
  return html`${snapshot.intel.domains.map(
    (domain) => html`
      <div class="row spread" style="padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div>
          <strong>${domain.label}</strong>
          <div class="muted" style="font-size: 12px;">
            sources ${domain.enabledSourceCount}/${domain.sourceCount} · candidates ${domain.candidateCount}
            · selected ${domain.selectedCount} · pushed ${domain.digestCount}
          </div>
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
  const sources = snapshot.intel.sources.slice(0, 8);
  return sources.length === 0
    ? html`
        <div class="muted">No configured sources.</div>
      `
    : html`${sources.map(
        (source) => html`
          <div class="row spread" style="padding: 6px 0; border-bottom: 1px solid var(--line); gap: 12px;">
            <div style="min-width: 0;">
              <div><strong>${source.label}</strong></div>
              <div class="muted" style="font-size: 12px;">
                ${source.domain} · ${source.kind} · priority ${source.priority}
              </div>
            </div>
            <div class="pill">${source.enabled ? "enabled" : "off"}</div>
          </div>
        `,
      )}`;
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
      ${renderStat("Intel digests", preview.counts.intelDigests)}
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

function renderFederation(snapshot: FederationRuntimeSnapshot | null, error: string | null) {
  if (!snapshot) {
    return html`${error ? html`<div class="pill danger">${error}</div>` : nothing}
      <div class="muted">Federation hook status unavailable.</div>`;
  }
  return html`
    <div class="stat-grid stat-grid--4">
      ${renderStat("Enabled", snapshot.enabled ? "Yes" : "No")}
      ${renderStat("Remote configured", snapshot.remoteConfigured ? "Yes" : "No")}
      ${renderStat("Pending assignments", snapshot.pendingAssignments)}
      ${renderStat("Inbox packages", snapshot.inbox.total)}
      ${renderStat("Recommended", snapshot.inbox.stateCounts.recommended)}
      ${renderStat("Adopted", snapshot.inbox.stateCounts.adopted)}
      ${renderStat("Strategy outbox", snapshot.outboxEnvelopeCounts.strategyDigest)}
      ${renderStat("News outbox", snapshot.outboxEnvelopeCounts.newsDigest)}
    </div>
    <div style="margin-top: 16px;">
      <div class="muted" style="font-size: 12px;">Inbox state counts</div>
      <div>
        received ${snapshot.inbox.stateCounts.received} · validated
        ${snapshot.inbox.stateCounts.validated} · shadowed ${snapshot.inbox.stateCounts.shadowed}
        · recommended ${snapshot.inbox.stateCounts.recommended} · adopted
        ${snapshot.inbox.stateCounts.adopted}
      </div>
    </div>
    <div style="margin-top: 16px;">
      <div class="muted" style="font-size: 12px;">Allowed push scopes</div>
      <div>${formatList(snapshot.allowedPushScopes)}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Blocked push scopes</div>
      <div>${formatList(snapshot.blockedPushScopes)}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Inbox root</div>
      <div class="mono">${snapshot.inboxRoot}</div>
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
      <div class="muted" style="font-size: 12px;">Outbox root</div>
      <div class="mono">${snapshot.outboxRoot}</div>
    </div>
    <div style="margin-top: 12px;">
      <div class="muted" style="font-size: 12px;">Local adopted artifacts</div>
      <div>
        ${snapshot.inbox.sharedStrategyCount} shared strategies ·
        ${snapshot.inbox.teamKnowledgeCount} team knowledge records
      </div>
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
                    </div>
                  </div>
                  <div class="pill">${entry.state}</div>
                </div>
              `,
            )}`
      }
    </div>
  `;
}

export function renderRuntime(props: RuntimeProps) {
  const snapshot = props.snapshot;
  const preview = props.importPreview ?? snapshot?.importPreview ?? null;
  const federation = props.federationStatus ?? snapshot?.federation ?? null;

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Managed Runtime</div>
        <div class="card-sub">
          Runtime Core status, storage roots, and execution posture.
        </div>
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
          snapshot
            ? html`
                <div class="stat-grid stat-grid--4">
                  ${renderStat("Display name", snapshot.userConsole.model.displayName || "unset")}
                  ${renderStat("Report policy", snapshot.userConsole.model.reportPolicy || "reply")}
                  ${renderStat("Active agents", snapshot.userConsole.activeAgentCount)}
                  ${renderStat("User surfaces", snapshot.userConsole.userOwnedSurfaceCount)}
                </div>
                <div style="margin-top: 12px;" class="muted">
                  ${snapshot.userConsole.model.communicationStyle || "Communication style not customized yet."}
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
          snapshot
            ? renderAgents(snapshot)
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Surfaces</div>
        <div class="card-sub">Channel/account surfaces bound to the user console or an agent.</div>
        ${
          snapshot
            ? renderSurfaces(snapshot)
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
            ? renderTaskStatusList(snapshot)
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
            ? renderRecentTasks(snapshot)
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
                  ${renderStat("System1 planes", snapshot.retrieval.system1DefaultPlanes.length)}
                  ${renderStat("System2 planes", snapshot.retrieval.system2DefaultPlanes.length)}
                </div>
                <div style="margin-top: 16px;">${renderRecentMemories(snapshot)}</div>
              `
            : html`
                <div class="muted">No data.</div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Intel</div>
        <div class="card-sub">Independent info panel with source selection and daily push settings.</div>
        ${
          snapshot
            ? html`
                <div class="stat-grid stat-grid--4">
                  ${renderStat("Refresh (min)", snapshot.intel.refreshMinutes)}
                  ${renderStat("Daily push", snapshot.intel.dailyPushEnabled ? "On" : "Off")}
                  ${renderStat("Items / day", snapshot.intel.dailyPushItemCount)}
                  ${renderStat(
                    "Push time",
                    `${String(snapshot.intel.dailyPushHourLocal).padStart(2, "0")}:${String(snapshot.intel.dailyPushMinuteLocal).padStart(2, "0")}`,
                  )}
                </div>
                <div style="margin-top: 16px;">${renderIntelDomains(snapshot)}</div>
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
                    @click=${props.onFederationSync}
                  >
                    ${props.federationLoading ? "Syncing..." : "Sync Federation"}
                  </button>
                </div>
                ${renderFederation(federation, props.federationError)}
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
