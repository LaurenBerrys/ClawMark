(function () {
  const ROUTE_BASE = "__ROUTE_BASE__";
  const API_BASE = ROUTE_BASE + "/api";
  const STORAGE_KEY = "openclaw.codex.control.collapsed";
  const rootId = "openclaw-codex-control-root";
  let loginPollTimer = null;

  function getApp() {
    return document.querySelector("openclaw-app");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getToken() {
    const app = getApp();
    const token = app && app.settings && typeof app.settings.token === "string" ? app.settings.token.trim() : "";
    if (token) return token;
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const tokenFromHash = new URLSearchParams(hash).get("token");
    return tokenFromHash ? tokenFromHash.trim() : "";
  }

  async function api(path, options) {
    const headers = { "content-type": "application/json" };
    const response = await fetch(API_BASE + path, {
      method: options && options.method ? options.method : "GET",
      headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin"
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { rawText: text };
    }
    if (!response.ok) {
      const message = data && data.error && typeof data.error === "object"
        ? data.error.message || JSON.stringify(data.error)
        : data && data.error
          ? String(data.error)
          : text || ("HTTP " + response.status);
      throw new Error(message);
    }
    return data;
  }

  function injectStyles() {
    if (document.getElementById("openclaw-codex-control-style")) return;
    const style = document.createElement("style");
    style.id = "openclaw-codex-control-style";
    style.textContent = `
      #${rootId} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        font-family: "IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif;
        color: #1d1a16;
      }
      #${rootId} * { box-sizing: border-box; }
      #${rootId} .ocx-pill {
        min-width: 220px;
        max-width: min(70vw, 420px);
        border: 1px solid rgba(132, 98, 58, 0.18);
        border-radius: 16px;
        padding: 12px 14px;
        background: rgba(252, 247, 239, 0.92);
        box-shadow: 0 14px 40px rgba(31, 22, 14, 0.16);
        backdrop-filter: blur(14px);
        cursor: pointer;
      }
      #${rootId} .ocx-pill-title {
        font-size: 12px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: #8a5136;
      }
      #${rootId} .ocx-pill-main {
        margin-top: 6px;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
      }
      #${rootId} .ocx-pill-sub {
        margin-top: 4px;
        font-size: 12px;
        color: #6f6457;
        line-height: 1.4;
        word-break: break-word;
      }
      #${rootId} .ocx-panel {
        width: min(420px, calc(100vw - 24px));
        max-height: min(78vh, 880px);
        overflow: auto;
        border: 1px solid rgba(132, 98, 58, 0.16);
        border-radius: 24px;
        padding: 16px;
        background: rgba(250, 245, 237, 0.97);
        box-shadow: 0 24px 60px rgba(31, 22, 14, 0.18);
        backdrop-filter: blur(16px);
      }
      #${rootId} .ocx-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      #${rootId} .ocx-title {
        margin: 0;
        font-size: 20px;
        line-height: 1.1;
      }
      #${rootId} .ocx-muted {
        color: #6f6457;
        font-size: 13px;
        line-height: 1.5;
      }
      #${rootId} .ocx-actions, #${rootId} .ocx-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      #${rootId} .ocx-actions { margin-top: 14px; }
      #${rootId} button {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 9px 12px;
        font: inherit;
        cursor: pointer;
      }
      #${rootId} button:disabled { opacity: .55; cursor: default; }
      #${rootId} .ocx-primary { background: #8a5136; color: #fffaf3; }
      #${rootId} .ocx-secondary { background: rgba(255,255,255,.72); color: #1d1a16; border-color: rgba(132, 98, 58, 0.18); }
      #${rootId} .ocx-card {
        margin-top: 14px;
        border: 1px solid rgba(132, 98, 58, 0.16);
        border-radius: 18px;
        padding: 14px;
        background: rgba(255,255,255,.62);
      }
      #${rootId} .ocx-card-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }
      #${rootId} .ocx-card-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        word-break: break-word;
      }
      #${rootId} .ocx-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      #${rootId} .ocx-badge {
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11px;
        background: rgba(36, 74, 77, 0.1);
        color: #244a4d;
      }
      #${rootId} .ocx-badge.hot { background: rgba(138, 81, 54, 0.12); color: #8a5136; }
      #${rootId} .ocx-badge.ok { background: rgba(48, 110, 74, 0.12); color: #2f6a49; }
      #${rootId} .ocx-badge.warn { background: rgba(165, 112, 17, 0.14); color: #9a6810; }
      #${rootId} .ocx-window {
        margin-top: 10px;
        border-radius: 14px;
        padding: 10px;
        background: rgba(250, 245, 237, 0.86);
        border: 1px solid rgba(36, 74, 77, 0.1);
      }
      #${rootId} .ocx-window-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        color: #6f6457;
      }
      #${rootId} .ocx-bar {
        margin-top: 8px;
        height: 8px;
        border-radius: 999px;
        background: rgba(36, 74, 77, 0.08);
        overflow: hidden;
      }
      #${rootId} .ocx-bar > span {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #244a4d, #8a5136);
      }
      #${rootId} input {
        width: 100%;
        margin-top: 10px;
        border: 1px solid rgba(132, 98, 58, 0.18);
        border-radius: 12px;
        background: rgba(255,255,255,.88);
        padding: 10px 12px;
        font: inherit;
        color: #1d1a16;
      }
      #${rootId} textarea, #${rootId} select {
        width: 100%;
        margin-top: 10px;
        border: 1px solid rgba(132, 98, 58, 0.18);
        border-radius: 12px;
        background: rgba(255,255,255,.88);
        padding: 10px 12px;
        font: inherit;
        color: #1d1a16;
      }
      #${rootId} textarea {
        min-height: 92px;
        resize: vertical;
      }
      #${rootId} .ocx-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      #${rootId} .ocx-grid > * {
        min-width: 0;
      }
      #${rootId} .ocx-footnote {
        margin-top: 14px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(36, 74, 77, 0.08);
        color: #244a4d;
        font-size: 12px;
        line-height: 1.55;
      }
      @media (max-width: 640px) {
        #${rootId} .ocx-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createRoot() {
    let root = document.getElementById(rootId);
    if (root) return root;
    root = document.createElement("div");
    root.id = rootId;
    document.body.appendChild(root);
    return root;
  }

  function readPanelScrollTop(root) {
    const panel = root && root.querySelector ? root.querySelector(".ocx-panel") : null;
    return panel ? panel.scrollTop : 0;
  }

  function restorePanelScrollTop(root, scrollTop) {
    if (!root || !Number.isFinite(scrollTop) || scrollTop <= 0) return;
    const panel = root.querySelector(".ocx-panel");
    if (!panel) return;
    const apply = function () {
      const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
      panel.scrollTop = Math.min(scrollTop, maxScroll);
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  const state = {
    collapsed: localStorage.getItem(STORAGE_KEY) === "1",
    loading: false,
    error: "",
    status: null,
    loginInput: "",
    autopilotTaskTitle: "",
    autopilotTaskGoal: "",
    autopilotTaskDoneCriteria: "",
    autopilotTaskNextRunAt: ""
  };

  function fmtTime(iso) {
    if (!iso) return "未记录";
    try {
      return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  }

  function fmtDateTimeInput(iso) {
    if (!iso) return "";
    try {
      const date = new Date(iso);
      const pad = function (value) { return String(value).padStart(2, "0"); };
      return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
      ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
    } catch {
      return "";
    }
  }

  function autopilotStatusLabel(status) {
    if (status === "queued") return "排队";
    if (status === "planning") return "规划中";
    if (status === "ready") return "就绪";
    if (status === "running") return "运行中";
    if (status === "blocked") return "阻塞";
    if (status === "waiting_external") return "等外部";
    if (status === "waiting_user") return "等你";
    if (status === "completed") return "完成";
    if (status === "cancelled") return "取消";
    return status || "未知";
  }

  function autopilotBudgetLabel(mode) {
    if (mode === "strict") return "极省";
    if (mode === "balanced") return "均衡";
    if (mode === "deep") return "深挖";
    return mode || "未知";
  }

  function autopilotRetrievalLabel(mode) {
    if (mode === "off") return "关闭检索";
    if (mode === "light") return "轻检索";
    if (mode === "deep") return "深检索";
    return mode || "未知";
  }

  function usageWindowHtml(entry) {
    const percent = Math.max(0, Math.min(100, Number(entry.usedPercent || 0)));
    return `
      <div class="ocx-window">
        <div class="ocx-window-top">
          <strong>${entry.label}</strong>
          <span>${percent}%${entry.resetAt ? " · 重置 " + fmtTime(new Date(entry.resetAt).toISOString()) : ""}</span>
        </div>
        <div class="ocx-bar"><span style="width:${Math.max(2, percent)}%"></span></div>
      </div>
    `;
  }

  function badge(text, cls) {
    return `<span class="ocx-badge${cls ? " " + cls : ""}">${text}</span>`;
  }

  function describeCliProfile(entry) {
    if (!entry) return "未连接";
    const parts = [];
    if (entry.email) parts.push(entry.email);
    if (entry.workspaceTitle) parts.push(entry.workspaceTitle);
    if (entry.accountShort) parts.push("account " + entry.accountShort);
    if (entry.plan) parts.push(entry.plan);
    return parts.length ? parts.join(" · ") : "未连接";
  }

  function isTerminalLogin(status) {
    return !status || status === "completed" || status === "error" || status === "cancelled";
  }

  function loginStatusLabel(login) {
    if (!login) return "未开始";
    if (login.status === "awaiting-browser") return "等待浏览器登录";
    if (login.status === "waiting-callback") return "等待回调";
    if (login.status === "waiting-exchange") return "交换令牌中";
    if (login.status === "saving") return "保存凭证中";
    if (login.status === "completed") return "已完成";
    if (login.status === "cancelled") return "已取消";
    if (login.status === "error") return "失败";
    return login.status || "进行中";
  }

  function setLoginStatus(login) {
    if (!state.status) {
      state.status = {
        config: null,
        auth: null,
        profiles: [],
        login: login || null,
        codexCli: null,
        autopilot: null
      };
      return;
    }
    state.status.login = login || null;
  }

  function setCodexCliStatus(codexCli) {
    if (!state.status) {
      state.status = {
        config: null,
        auth: null,
        profiles: [],
        login: null,
        codexCli: codexCli || null,
        autopilot: null
      };
      return;
    }
    state.status.codexCli = codexCli || null;
  }

  function setAutopilotStatus(autopilot) {
    if (!state.status) {
      state.status = {
        config: null,
        auth: null,
        profiles: [],
        login: null,
        codexCli: null,
        autopilot: autopilot || null
      };
      return;
    }
    state.status.autopilot = autopilot || null;
  }

  function scheduleLoginPoll() {
    if (loginPollTimer) {
      window.clearTimeout(loginPollTimer);
      loginPollTimer = null;
    }
    const login = state.status && state.status.login;
    if (login && !isTerminalLogin(login.status)) {
      loginPollTimer = window.setTimeout(refreshLoginOnly, 2000);
    }
  }

  async function refreshLoginOnly() {
    try {
      setLoginStatus(await api("/login/status"));
      if (state.status && state.status.login && state.status.login.status === "completed") {
        await refresh();
        return;
      }
      render();
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
      render();
    } finally {
      scheduleLoginPoll();
    }
  }

  function render() {
    injectStyles();
    const root = createRoot();
    const previousScrollTop = readPanelScrollTop(root);
    const status = state.status;
    const currentProfile = status && status.auth && status.auth.effectiveOrder && status.auth.effectiveOrder[0] ? status.auth.effectiveOrder[0] : "未连接";
    const currentProfileEntry = status && status.profiles
      ? status.profiles.find(function (profile) { return profile.profileId === currentProfile; }) || null
      : null;
    const currentModel = status && status.config ? status.config.defaultModel || "未设置" : "加载中";
    const login = status && status.login ? status.login : null;
    const cli = status && status.codexCli ? status.codexCli : null;
    const cliCurrent = cli && cli.current && cli.current.authFilePresent ? cli.current : null;
    const cliAuthPath = cli && cli.paths && cli.paths.authPath ? cli.paths.authPath : "Codex CLI auth 文件";
    const autopilot = status && status.autopilot ? status.autopilot : null;
    const pill = `
      <div class="ocx-pill" id="ocx-pill">
        <div class="ocx-pill-title">Codex</div>
        <div class="ocx-pill-main">${escapeHtml(currentModel)}</div>
        <div class="ocx-pill-sub">${escapeHtml(currentProfile)}${status && status.auth ? " · " + (status.auth.autoMode ? "自动轮换" : "手动优先") : ""}</div>
      </div>
    `;

    if (state.collapsed) {
      root.innerHTML = pill;
      document.getElementById("ocx-pill").onclick = function () {
        state.collapsed = false;
        localStorage.setItem(STORAGE_KEY, "0");
        render();
      };
      return;
    }

    let cards = "";
    if (status && status.profiles && status.profiles.length) {
      cards = status.profiles.map(function (profile) {
        const flags = [];
        const sameAsCli = cliCurrent && cliCurrent.accountId && profile.accountId && cliCurrent.accountId === profile.accountId;
        if (profile.isNext) flags.push(badge("当前优先", "hot"));
        if (sameAsCli) flags.push(badge("当前 CLI", "ok"));
        if (profile.isPinned) flags.push(badge("手动置顶", "ok"));
        if (profile.isLastGood) flags.push(badge("上次成功", "ok"));
        if (profile.isExpired) flags.push(badge("已过期", "warn"));
        if (profile.isExpiringSoon) flags.push(badge("即将过期", "warn"));
        if (profile.isInCooldown) flags.push(badge("冷却 " + (profile.cooldownIn || ""), "warn"));
        if (profile.expiresIn) flags.push(badge(profile.expiresIn + " 后过期"));

        const usage = profile.usage && profile.usage.windows && profile.usage.windows.length
          ? profile.usage.windows.map(usageWindowHtml).join("")
          : `<div class="ocx-muted" style="margin-top:10px">${profile.usage && profile.usage.error ? "额度读取失败：" + profile.usage.error : "没有额度窗口数据"}</div>`;

        return `
          <section class="ocx-card" data-profile-id="${profile.profileId}">
            <div class="ocx-card-top">
              <div>
                <div class="ocx-card-title">${escapeHtml(profile.profileId)}</div>
                <div class="ocx-muted">${escapeHtml(profile.email || "无邮箱")} · account ${escapeHtml(profile.accountShort || "未知")} · ${escapeHtml(profile.plan || "计划未知")}</div>
              </div>
              <div class="ocx-row">
                <button class="ocx-primary ocx-select" data-profile-id="${profile.profileId}" ${profile.isNext ? "disabled" : ""}>设为优先</button>
                <button class="ocx-secondary ocx-cli-from-openclaw" data-profile-id="${profile.profileId}">切到 CLI</button>
                <button class="ocx-secondary ocx-relogin" data-profile-id="${profile.profileId}">重新登录</button>
              </div>
            </div>
            <div class="ocx-badges">${flags.join("")}</div>
            <div class="ocx-muted" style="margin-top:10px">
              到期：${profile.expiresIso ? fmtTime(profile.expiresIso) : "未知"}<br>
              最近使用：${profile.lastUsedIso ? fmtTime(profile.lastUsedIso) : "未记录"}<br>
              建议别名：<code>${escapeHtml(profile.suggestedAlias)}</code>
            </div>
            ${usage}
            <input class="ocx-alias" data-profile-id="${profile.profileId}" value="${escapeHtml((profile.suggestedAlias || "").replace(/^openai-codex:/, ""))}">
            <div class="ocx-row" style="margin-top:10px">
              <button class="ocx-secondary ocx-rename" data-profile-id="${profile.profileId}">固化 / 重命名</button>
            </div>
          </section>
        `;
      }).join("");
    } else if (status && status.auth && status.auth.profileCount === 0) {
      cards = `<div class="ocx-footnote">还没有检测到 Codex profile。现在可以直接点上面的 <code>新增账号</code>，不用去终端。</div>`;
    }

    let cliCards = "";
    if (cli && cli.profiles && cli.profiles.length) {
      cliCards = cli.profiles.map(function (profile) {
        const flags = [];
        if (profile.isCurrent) flags.push(badge("当前 CLI", "hot"));
        if (profile.isIdTokenExpired) flags.push(badge("ID Token 已过期", "warn"));
        if (profile.isAccessTokenExpired) flags.push(badge("Access 已过期", "warn"));
        if (profile.accessTokenExpiresIn) flags.push(badge(profile.accessTokenExpiresIn + " 后刷新"));
        if (profile.workspaceTitle) flags.push(badge(profile.workspaceTitle, "ok"));
        if (profile.plan) flags.push(badge(profile.plan));
        const usage = profile.usage && profile.usage.windows && profile.usage.windows.length
          ? profile.usage.windows.map(usageWindowHtml).join("")
          : `<div class="ocx-muted" style="margin-top:10px">${profile.usage && profile.usage.error ? "额度读取失败：" + profile.usage.error : "没有额度窗口数据"}</div>`;
        return `
          <section class="ocx-card" data-cli-profile-id="${profile.profileId}">
            <div class="ocx-card-top">
              <div>
                <div class="ocx-card-title">${escapeHtml(profile.profileId)}</div>
                <div class="ocx-muted">${escapeHtml(describeCliProfile(profile))}</div>
              </div>
              <div class="ocx-row">
                <button class="ocx-primary ocx-cli-activate" data-profile-id="${profile.profileId}" ${profile.isCurrent ? "disabled" : ""}>切到这里</button>
                <button class="ocx-secondary ocx-cli-delete" data-profile-id="${profile.profileId}">删除</button>
              </div>
            </div>
            <div class="ocx-badges">${flags.join("")}</div>
            <div class="ocx-muted" style="margin-top:10px">
              workspace：${escapeHtml(profile.workspaceTitle || "未标记")}<br>
              保存时间：${profile.savedIso ? fmtTime(profile.savedIso) : "未记录"}<br>
              最近刷新：${profile.lastRefreshIso ? fmtTime(profile.lastRefreshIso) : "未记录"}<br>
              ID Token 到期：${profile.idTokenExpiresIso ? fmtTime(profile.idTokenExpiresIso) : "未知"}<br>
              Access 到期：${profile.accessTokenExpiresIso ? fmtTime(profile.accessTokenExpiresIso) : "未知"}<br>
              建议别名：<code>${escapeHtml(profile.suggestedAlias || "")}</code>
            </div>
            ${usage}
            <input class="ocx-cli-alias" data-profile-id="${profile.profileId}" value="${escapeHtml((profile.profileId || "").replace(/^codex-cli:/, ""))}">
            <div class="ocx-row" style="margin-top:10px">
              <button class="ocx-secondary ocx-cli-rename" data-profile-id="${profile.profileId}">重命名</button>
            </div>
          </section>
        `;
      }).join("");
    }

    const cliSection = cli ? `
      <div class="ocx-card">
        <div class="ocx-card-title">Codex CLI</div>
        <div class="ocx-muted" style="margin-top:10px">
          当前账号：${escapeHtml(cliCurrent ? describeCliProfile(cliCurrent) : `未检测到 ${cliAuthPath}`)}<br>
          当前快照：${escapeHtml(cliCurrent && cliCurrent.matchedProfileId ? cliCurrent.matchedProfileId : "未保存")}<br>
          CLI 模型：${escapeHtml(cli.config && cli.config.model ? cli.config.model : "未设置")}<br>
          CLI 推理：${escapeHtml(cli.config && cli.config.reasoning ? cli.config.reasoning : "未设置")}<br>
          服务层级：${escapeHtml(cli.config && cli.config.serviceTier ? cli.config.serviceTier : "未设置")}<br>
          最近刷新：${escapeHtml(cliCurrent && cliCurrent.lastRefreshIso ? fmtTime(cliCurrent.lastRefreshIso) : "未记录")}<br>
          ID Token 到期：${escapeHtml(cliCurrent && cliCurrent.idTokenExpiresIso ? fmtTime(cliCurrent.idTokenExpiresIso) : "未知")}<br>
          Access 到期：${escapeHtml(cliCurrent && cliCurrent.accessTokenExpiresIso ? fmtTime(cliCurrent.accessTokenExpiresIso) : "未知")}
        </div>
        ${cliCurrent && cliCurrent.usage && cliCurrent.usage.windows && cliCurrent.usage.windows.length
          ? cliCurrent.usage.windows.map(usageWindowHtml).join("")
          : cliCurrent
            ? `<div class="ocx-muted" style="margin-top:10px">${cliCurrent.usage && cliCurrent.usage.error ? "额度读取失败：" + cliCurrent.usage.error : "没有额度窗口数据"}</div>`
            : ""}
        <div class="ocx-actions">
          <button class="ocx-primary" id="ocx-cli-save"${!cliCurrent || state.loading ? " disabled" : ""}>保存当前 CLI 账号</button>
        </div>
      </div>
      ${!cliCurrent ? `
        <div class="ocx-footnote">还没有检测到 <code>${escapeHtml(cliAuthPath)}</code>。先在终端执行 <code>codex login</code>，完成后回到这里点 <code>保存当前 CLI 账号</code>。</div>
      ` : !cliCurrent.matchedProfileId ? `
        <div class="ocx-footnote">当前 CLI 账号还没纳入切换器。先点 <code>保存当前 CLI 账号</code>，以后就能在这里一键切换。</div>
      ` : `
        <div class="ocx-footnote">你也可以直接在上面的 OpenClaw 账号卡里点 <code>切到 CLI</code>，不用再单独跑一次 <code>codex login</code>。</div>
      `}
      ${cliCards}
    ` : "";

    let autopilotTasks = "";
    if (autopilot && autopilot.tasks && autopilot.tasks.length) {
      autopilotTasks = autopilot.tasks.map(function (task) {
        const flags = [];
        flags.push(badge(
          autopilotStatusLabel(task.status),
          task.status === "running"
            ? "hot"
            : task.status === "completed"
              ? "ok"
              : task.status === "blocked" || task.status === "waiting_user"
                ? "warn"
                : ""
        ));
        flags.push(badge(task.priority === "high" ? "高优先" : task.priority === "low" ? "低优先" : "普通优先"));
        flags.push(badge(autopilotBudgetLabel(task.effectiveBudgetMode)));
        flags.push(badge(autopilotRetrievalLabel(task.effectiveRetrievalMode)));
        if (task.localOnly) flags.push(badge("仅本地", "ok"));
        else if (task.localFirst) flags.push(badge("本地优先", "ok"));
        if (task.isDue) flags.push(badge("到点了", "warn"));
        if (task.nextRunIn) flags.push(badge(task.nextRunIn));
        return `
          <section class="ocx-card" data-autopilot-task-id="${task.id}">
            <div class="ocx-card-top">
              <div>
                <div class="ocx-card-title">${escapeHtml(task.title)}</div>
                <div class="ocx-muted">${escapeHtml(task.assignee)} · ${escapeHtml(task.workspace)} · ${escapeHtml(task.source || "manual")}</div>
              </div>
              <div class="ocx-row">
                <button class="ocx-secondary ocx-task-run" data-task-id="${task.id}">运行中</button>
                <button class="ocx-secondary ocx-task-block" data-task-id="${task.id}">阻塞</button>
                <button class="ocx-secondary ocx-task-wait" data-task-id="${task.id}">等我</button>
                <button class="ocx-primary ocx-task-done" data-task-id="${task.id}">完成</button>
              </div>
            </div>
            <div class="ocx-badges">${flags.join("")}</div>
            <div class="ocx-muted" style="margin-top:10px">
              目标：${escapeHtml(task.goal || "未填写")}<br>
              完成标准：${escapeHtml(task.doneCriteria || "未填写")}<br>
              下次运行：${task.nextRunIso ? fmtTime(task.nextRunIso) : "未设置"}<br>
              最近运行：${task.lastRunIso ? fmtTime(task.lastRunIso) : "未记录"}<br>
              运行次数：${escapeHtml(String(task.runCount || 0))}
              ${task.lastError ? "<br>最近错误：" + escapeHtml(task.lastError) : ""}
            </div>
            <div class="ocx-row" style="margin-top:10px">
              <button class="ocx-secondary ocx-task-queue" data-task-id="${task.id}">重新排队</button>
              <button class="ocx-secondary ocx-task-delete" data-task-id="${task.id}">删除</button>
            </div>
          </section>
        `;
      }).join("");
    }

    const autopilotSection = autopilot ? `
      <div class="ocx-card">
        <div class="ocx-card-title">Autopilot</div>
        <div class="ocx-muted" style="margin-top:10px">
          模式：${autopilot.config && autopilot.config.enabled ? "启用" : "暂停"}<br>
          本地优先：${autopilot.config && autopilot.config.localFirst ? "是" : "否"}<br>
          默认预算：${escapeHtml(autopilotBudgetLabel(autopilot.config && autopilot.config.defaultBudgetMode))}<br>
          默认检索：${escapeHtml(autopilotRetrievalLabel(autopilot.config && autopilot.config.defaultRetrievalMode))}<br>
          单轮输入上限：${escapeHtml(String(autopilot.config && autopilot.config.maxInputTokensPerTurn || 0))} tokens<br>
          单任务远程调用：${escapeHtml(String(autopilot.config && autopilot.config.maxRemoteCallsPerTask || 0))} 次<br>
          单日远程预算：${escapeHtml(String(autopilot.config && autopilot.config.dailyRemoteTokenBudget || 0))} tokens<br>
          最近 tick：${escapeHtml(autopilot.scheduler && autopilot.scheduler.lastTickIso ? fmtTime(autopilot.scheduler.lastTickIso) : "未记录")}
          ${autopilot.scheduler && autopilot.scheduler.lastError ? "<br>调度错误：" + escapeHtml(autopilot.scheduler.lastError) : ""}
        </div>
        <div class="ocx-badges">
          ${badge("总任务 " + String(autopilot.stats && autopilot.stats.total || 0))}
          ${badge("到期 " + String(autopilot.stats && autopilot.stats.due || 0), (autopilot.stats && autopilot.stats.due) ? "warn" : "ok")}
          ${badge("就绪 " + String(autopilot.stats && autopilot.stats.ready || 0), (autopilot.stats && autopilot.stats.ready) ? "ok" : "")}
          ${badge("运行中 " + String(autopilot.stats && autopilot.stats.running || 0), (autopilot.stats && autopilot.stats.running) ? "hot" : "")}
          ${badge("阻塞 " + String(autopilot.stats && autopilot.stats.blocked || 0), (autopilot.stats && autopilot.stats.blocked) ? "warn" : "")}
          ${badge("等你 " + String(autopilot.stats && autopilot.stats.waitingUser || 0), (autopilot.stats && autopilot.stats.waitingUser) ? "warn" : "")}
          ${badge("完成 " + String(autopilot.stats && autopilot.stats.completed || 0), "ok")}
        </div>
        <div class="ocx-grid" style="margin-top:10px">
          <label class="ocx-muted">开关
            <select id="ocx-autopilot-enabled">
              <option value="false"${autopilot.config && !autopilot.config.enabled ? " selected" : ""}>暂停</option>
              <option value="true"${autopilot.config && autopilot.config.enabled ? " selected" : ""}>启用</option>
            </select>
          </label>
          <label class="ocx-muted">本地优先
            <select id="ocx-autopilot-local-first">
              <option value="true"${autopilot.config && autopilot.config.localFirst ? " selected" : ""}>是</option>
              <option value="false"${autopilot.config && !autopilot.config.localFirst ? " selected" : ""}>否</option>
            </select>
          </label>
          <label class="ocx-muted">默认预算
            <select id="ocx-autopilot-budget-mode">
              <option value="strict"${autopilot.config && autopilot.config.defaultBudgetMode === "strict" ? " selected" : ""}>极省</option>
              <option value="balanced"${autopilot.config && autopilot.config.defaultBudgetMode === "balanced" ? " selected" : ""}>均衡</option>
              <option value="deep"${autopilot.config && autopilot.config.defaultBudgetMode === "deep" ? " selected" : ""}>深挖</option>
            </select>
          </label>
          <label class="ocx-muted">默认检索
            <select id="ocx-autopilot-retrieval-mode">
              <option value="off"${autopilot.config && autopilot.config.defaultRetrievalMode === "off" ? " selected" : ""}>关闭检索</option>
              <option value="light"${autopilot.config && autopilot.config.defaultRetrievalMode === "light" ? " selected" : ""}>轻检索</option>
              <option value="deep"${autopilot.config && autopilot.config.defaultRetrievalMode === "deep" ? " selected" : ""}>深检索</option>
            </select>
          </label>
          <label class="ocx-muted">单轮输入上限
            <input id="ocx-autopilot-max-input" type="number" min="500" step="500" value="${escapeHtml(String(autopilot.config && autopilot.config.maxInputTokensPerTurn || 6000))}">
          </label>
          <label class="ocx-muted">单任务远程调用
            <input id="ocx-autopilot-max-calls" type="number" min="1" step="1" value="${escapeHtml(String(autopilot.config && autopilot.config.maxRemoteCallsPerTask || 6))}">
          </label>
          <label class="ocx-muted">上下文字符上限
            <input id="ocx-autopilot-max-context" type="number" min="1000" step="500" value="${escapeHtml(String(autopilot.config && autopilot.config.maxContextChars || 9000))}">
          </label>
          <label class="ocx-muted">单日远程预算
            <input id="ocx-autopilot-daily-budget" type="number" min="10000" step="10000" value="${escapeHtml(String(autopilot.config && autopilot.config.dailyRemoteTokenBudget || 250000))}">
          </label>
        </div>
        <div class="ocx-actions">
          <button class="ocx-primary" id="ocx-autopilot-save">保存 Autopilot 策略</button>
        </div>
        <div class="ocx-grid" style="margin-top:14px">
          <label class="ocx-muted">任务标题
            <input id="ocx-task-title" value="${escapeHtml(state.autopilotTaskTitle)}" placeholder="比如：每日检查 Codex 额度并自动切号">
          </label>
          <label class="ocx-muted">下次运行
            <input id="ocx-task-next-run" type="datetime-local" value="${escapeHtml(state.autopilotTaskNextRunAt)}">
          </label>
        </div>
        <label class="ocx-muted">任务目标
          <textarea id="ocx-task-goal" placeholder="写清楚它要持续做什么、做到什么算完成">${escapeHtml(state.autopilotTaskGoal)}</textarea>
        </label>
        <label class="ocx-muted">完成标准
          <input id="ocx-task-done" value="${escapeHtml(state.autopilotTaskDoneCriteria)}" placeholder="比如：发现限额后 3 分钟内完成切号并恢复任务">
        </label>
        <div class="ocx-actions">
          <button class="ocx-primary" id="ocx-task-add">新增任务</button>
        </div>
      </div>
      ${autopilotTasks || `<div class="ocx-footnote">还没有任务账本。先在这里把长期任务写进去，别再让任务只活在聊天记录里。</div>`}
    ` : "";

    const priorityWarning = currentProfileEntry && currentProfileEntry.isExpired
      ? `
        <div class="ocx-footnote" style="background:rgba(170,68,42,.1);color:#8a5136">
          当前优先 profile 已过期，建议立即重新登录。
          <div class="ocx-actions" style="margin-top:10px">
            <button class="ocx-primary" id="ocx-relogin-current">重新登录当前</button>
          </div>
        </div>
      `
      : currentProfileEntry && currentProfileEntry.isExpiringSoon
        ? `
          <div class="ocx-footnote" style="background:rgba(165,112,17,.12);color:#9a6810">
            当前优先 profile 快过期了，建议提前重登，避免跑任务时突然掉线。
            <div class="ocx-actions" style="margin-top:10px">
              <button class="ocx-primary" id="ocx-relogin-current">提前重登当前</button>
            </div>
          </div>
        `
        : "";

    const loginSection = login ? `
      <div class="ocx-card">
        <div class="ocx-card-title">网页登录</div>
        <div class="ocx-muted" style="margin-top:10px">
          状态：${escapeHtml(loginStatusLabel(login))}<br>
          ${login.progress ? "进度：" + escapeHtml(login.progress) + "<br>" : ""}
          ${login.error ? "错误：" + escapeHtml(login.error) + "<br>" : ""}
          ${login.result && login.result.profileId ? "目标 profile：" + escapeHtml(login.result.profileId) + "<br>" : ""}
          ${login.result && login.result.preservedProfileId ? "旧 profile 已固化为：" + escapeHtml(login.result.preservedProfileId) + "<br>" : ""}
          ${login.instructions ? escapeHtml(login.instructions) : "浏览器能自动回调最好；如果没自动完成，就把最终回调 URL 粘贴到下面。"}
        </div>
        ${login.authUrl ? `
          <div class="ocx-actions">
            <button class="ocx-primary" id="ocx-open-login">打开登录页</button>
          </div>
        ` : ""}
        ${!isTerminalLogin(login.status) ? `
          <input id="ocx-login-input" placeholder="如果没有自动完成，把最终回调 URL 或 code 粘贴到这里" value="${escapeHtml(state.loginInput)}">
          <div class="ocx-row" style="margin-top:10px">
            <button class="ocx-primary" id="ocx-submit-login">提交回调</button>
            <button class="ocx-secondary" id="ocx-cancel-login">取消登录</button>
          </div>
        ` : ""}
      </div>
    ` : "";

    root.innerHTML = `
      <div class="ocx-panel">
        <div class="ocx-head">
          <div>
            <h3 class="ocx-title">Codex 切换器</h3>
            <div class="ocx-muted">直接挂在 OpenClaw 原网页里。这里看当前模型、当前优先 profile，以及自动轮换状态。</div>
          </div>
          <button class="ocx-secondary" id="ocx-close">收起</button>
        </div>

        <div class="ocx-actions">
          <button class="ocx-primary" id="ocx-refresh"${state.loading ? " disabled" : ""}>刷新</button>
          <button class="ocx-secondary" id="ocx-add-account"${state.loading ? " disabled" : ""}>新增账号</button>
          <button class="ocx-secondary" id="ocx-auto"${state.loading ? " disabled" : ""}>恢复自动轮换</button>
        </div>

        <div class="ocx-card">
          <div class="ocx-card-title">当前状态</div>
          <div class="ocx-muted" style="margin-top:10px">
            默认模型：${status && status.config ? escapeHtml(status.config.defaultModel || "未设置") : "加载中"}<br>
            图片模型：${status && status.config ? escapeHtml(status.config.imageModel || "未设置") : "加载中"}<br>
            思考强度：${status && status.config ? escapeHtml(status.config.thinkingDefault || "未设置") : "加载中"}<br>
            当前优先：${escapeHtml(currentProfile)}<br>
            模式：${status && status.auth ? (status.auth.autoMode ? "自动轮换" : "手动优先") : "未知"}<br>
            登录状态：${login ? escapeHtml(loginStatusLabel(login)) : "空闲"}
          </div>
        </div>

        ${autopilotSection}
        ${cliSection}
        ${state.error ? `<div class="ocx-footnote" style="background:rgba(170,68,42,.1);color:#8a5136">${state.error}</div>` : ""}
        ${priorityWarning}
        ${loginSection}
        ${cards}

        <div class="ocx-footnote">
          同邮箱多 workspace 现在会自动保留旧 profile，不会因为新登录直接把旧 workspace 覆盖掉。
          为了后面更好分辨，还是建议你把它们改成清晰别名，比如 <code>work-a</code>、<code>work-b</code>。
        </div>
      </div>
    `;

    restorePanelScrollTop(root, previousScrollTop);

    document.getElementById("ocx-close").onclick = function () {
      state.collapsed = true;
      localStorage.setItem(STORAGE_KEY, "1");
      render();
    };
    document.getElementById("ocx-refresh").onclick = function () { refresh(); };
    document.getElementById("ocx-add-account").onclick = function () { actionLoginStart(""); };
    document.getElementById("ocx-auto").onclick = function () { actionAuto(); };
    if (document.getElementById("ocx-task-title")) {
      document.getElementById("ocx-task-title").oninput = function (event) {
        state.autopilotTaskTitle = event && event.target ? event.target.value : "";
      };
    }
    if (document.getElementById("ocx-task-goal")) {
      document.getElementById("ocx-task-goal").oninput = function (event) {
        state.autopilotTaskGoal = event && event.target ? event.target.value : "";
      };
    }
    if (document.getElementById("ocx-task-done")) {
      document.getElementById("ocx-task-done").oninput = function (event) {
        state.autopilotTaskDoneCriteria = event && event.target ? event.target.value : "";
      };
    }
    if (document.getElementById("ocx-task-next-run")) {
      document.getElementById("ocx-task-next-run").oninput = function (event) {
        state.autopilotTaskNextRunAt = event && event.target ? event.target.value : "";
      };
    }
    if (document.getElementById("ocx-autopilot-save")) {
      document.getElementById("ocx-autopilot-save").onclick = function () { actionAutopilotSave(); };
    }
    if (document.getElementById("ocx-task-add")) {
      document.getElementById("ocx-task-add").onclick = function () { actionAutopilotTaskAdd(); };
    }
    if (document.getElementById("ocx-cli-save")) {
      document.getElementById("ocx-cli-save").onclick = function () { actionCliSaveCurrent(); };
    }
    if (document.getElementById("ocx-relogin-current")) {
      document.getElementById("ocx-relogin-current").onclick = function () {
        actionLoginStart(currentProfile);
      };
    }
    if (document.getElementById("ocx-open-login")) {
      document.getElementById("ocx-open-login").onclick = function () {
        if (login && login.authUrl) window.open(login.authUrl, "_blank", "noopener");
      };
    }
    if (document.getElementById("ocx-login-input")) {
      document.getElementById("ocx-login-input").oninput = function (event) {
        state.loginInput = event && event.target ? event.target.value : "";
      };
    }
    if (document.getElementById("ocx-submit-login")) {
      document.getElementById("ocx-submit-login").onclick = function () { actionLoginSubmit(); };
    }
    if (document.getElementById("ocx-cancel-login")) {
      document.getElementById("ocx-cancel-login").onclick = function () { actionLoginCancel(); };
    }

    root.querySelectorAll(".ocx-select").forEach(function (button) {
      button.onclick = function () {
        actionSelect(button.getAttribute("data-profile-id"));
      };
    });
    root.querySelectorAll(".ocx-relogin").forEach(function (button) {
      button.onclick = function () {
        actionLoginStart(button.getAttribute("data-profile-id"));
      };
    });
    root.querySelectorAll(".ocx-cli-from-openclaw").forEach(function (button) {
      button.onclick = function () {
        actionCliFromOpenClaw(button.getAttribute("data-profile-id"));
      };
    });
    root.querySelectorAll(".ocx-rename").forEach(function (button) {
      button.onclick = function () {
        const profileId = button.getAttribute("data-profile-id");
        const input = root.querySelector('.ocx-alias[data-profile-id="' + CSS.escape(profileId) + '"]');
        actionRename(profileId, input ? input.value : "");
      };
    });
    root.querySelectorAll(".ocx-cli-activate").forEach(function (button) {
      button.onclick = function () {
        actionCliActivate(button.getAttribute("data-profile-id"));
      };
    });
    root.querySelectorAll(".ocx-cli-rename").forEach(function (button) {
      button.onclick = function () {
        const profileId = button.getAttribute("data-profile-id");
        const input = root.querySelector('.ocx-cli-alias[data-profile-id="' + CSS.escape(profileId) + '"]');
        actionCliRename(profileId, input ? input.value : "");
      };
    });
    root.querySelectorAll(".ocx-cli-delete").forEach(function (button) {
      button.onclick = function () {
        actionCliDelete(button.getAttribute("data-profile-id"));
      };
    });
    root.querySelectorAll(".ocx-task-run").forEach(function (button) {
      button.onclick = function () { actionAutopilotTaskTransition(button.getAttribute("data-task-id"), "running"); };
    });
    root.querySelectorAll(".ocx-task-block").forEach(function (button) {
      button.onclick = function () { actionAutopilotTaskTransition(button.getAttribute("data-task-id"), "blocked"); };
    });
    root.querySelectorAll(".ocx-task-wait").forEach(function (button) {
      button.onclick = function () { actionAutopilotTaskTransition(button.getAttribute("data-task-id"), "waiting_user"); };
    });
    root.querySelectorAll(".ocx-task-done").forEach(function (button) {
      button.onclick = function () { actionAutopilotTaskTransition(button.getAttribute("data-task-id"), "completed"); };
    });
    root.querySelectorAll(".ocx-task-queue").forEach(function (button) {
      button.onclick = function () {
        actionAutopilotTaskTransition(button.getAttribute("data-task-id"), "queued");
      };
    });
    root.querySelectorAll(".ocx-task-delete").forEach(function (button) {
      button.onclick = function () { actionAutopilotTaskDelete(button.getAttribute("data-task-id")); };
    });
  }

  async function refresh() {
    state.loading = true;
    state.error = "";
    render();
    try {
      state.status = await api("/status");
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionSelect(profileId) {
    if (!profileId) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      state.status = await api("/profile/select", { method: "POST", body: { profileId: profileId } });
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionAuto() {
    state.loading = true;
    state.error = "";
    render();
    try {
      state.status = await api("/profile/auto", { method: "POST" });
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionAutopilotSave() {
    state.loading = true;
    state.error = "";
    render();
    try {
      setAutopilotStatus(await api("/autopilot/config", {
        method: "POST",
        body: {
          config: {
            enabled: document.getElementById("ocx-autopilot-enabled").value === "true",
            localFirst: document.getElementById("ocx-autopilot-local-first").value === "true",
            defaultBudgetMode: document.getElementById("ocx-autopilot-budget-mode").value,
            defaultRetrievalMode: document.getElementById("ocx-autopilot-retrieval-mode").value,
            maxInputTokensPerTurn: Number(document.getElementById("ocx-autopilot-max-input").value),
            maxRemoteCallsPerTask: Number(document.getElementById("ocx-autopilot-max-calls").value),
            maxContextChars: Number(document.getElementById("ocx-autopilot-max-context").value),
            dailyRemoteTokenBudget: Number(document.getElementById("ocx-autopilot-daily-budget").value)
          }
        }
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionAutopilotTaskAdd() {
    if (!state.autopilotTaskTitle.trim()) {
      state.error = "任务标题不能为空";
      render();
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      setAutopilotStatus(await api("/autopilot/task/upsert", {
        method: "POST",
        body: {
          task: {
            title: state.autopilotTaskTitle,
            goal: state.autopilotTaskGoal,
            doneCriteria: state.autopilotTaskDoneCriteria,
            nextRunAt: state.autopilotTaskNextRunAt || null
          }
        }
      }));
      state.autopilotTaskTitle = "";
      state.autopilotTaskGoal = "";
      state.autopilotTaskDoneCriteria = "";
      state.autopilotTaskNextRunAt = "";
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionAutopilotTaskTransition(taskId, statusValue, nextRunAtValue) {
    if (!taskId) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      const body = {
        taskId: taskId,
        status: statusValue
      };
      if (nextRunAtValue) body.nextRunAt = nextRunAtValue;
      setAutopilotStatus(await api("/autopilot/task/transition", {
        method: "POST",
        body: body
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionAutopilotTaskDelete(taskId) {
    if (!taskId) return;
    if (!window.confirm("删除这个任务？")) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      setAutopilotStatus(await api("/autopilot/task/delete", {
        method: "POST",
        body: { taskId: taskId }
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionRename(profileId, alias) {
    if (!profileId || !alias) {
      state.error = "别名不能为空";
      render();
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      state.status = await api("/profile/rename", {
        method: "POST",
        body: { profileId: profileId, alias: alias }
      });
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionLoginStart(targetProfileId) {
    state.loading = true;
    state.error = "";
    render();
    const popup = window.open("about:blank", "_blank");
    if (popup && popup.document) {
      try {
        popup.document.title = "OpenClaw Codex Login";
        popup.document.body.innerHTML = "<p style='font-family:sans-serif;padding:24px'>正在跳转到 OpenAI 登录页…</p>";
      } catch {}
    }
    try {
      setLoginStatus(await api("/login/start", {
        method: "POST",
        body: targetProfileId ? { targetProfileId: targetProfileId } : {}
      }));
      if (popup) {
        if (state.status && state.status.login && state.status.login.authUrl) popup.location.replace(state.status.login.authUrl);
        else popup.close();
      } else if (state.status && state.status.login && state.status.login.authUrl) {
        window.open(state.status.login.authUrl, "_blank");
      }
    } catch (error) {
      if (popup) popup.close();
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionLoginSubmit() {
    if (!state.loginInput.trim()) {
      state.error = "请输入回调 URL 或 code";
      render();
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      setLoginStatus(await api("/login/submit", {
        method: "POST",
        body: { input: state.loginInput }
      }));
      state.loginInput = "";
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionLoginCancel() {
    state.loading = true;
    state.error = "";
    render();
    try {
      setLoginStatus(await api("/login/cancel", { method: "POST" }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  async function actionCliSaveCurrent() {
    state.loading = true;
    state.error = "";
    render();
    try {
      setCodexCliStatus(await api("/codex-cli/save-current", { method: "POST", body: {} }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionCliActivate(profileId) {
    if (!profileId) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      setCodexCliStatus(await api("/codex-cli/activate", {
        method: "POST",
        body: { profileId: profileId }
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionCliRename(profileId, alias) {
    if (!profileId || !alias) {
      state.error = "CLI 别名不能为空";
      render();
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      setCodexCliStatus(await api("/codex-cli/rename", {
        method: "POST",
        body: { profileId: profileId, alias: alias }
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionCliDelete(profileId) {
    if (!profileId) return;
    const cli = state.status && state.status.codexCli ? state.status.codexCli : null;
    const cliAuthPath = cli && cli.paths && cli.paths.authPath ? cli.paths.authPath : "Codex CLI auth 文件";
    if (!window.confirm(`删除这个已保存的 Codex CLI 账号快照？当前 ${cliAuthPath} 不会被删除。`)) {
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      setCodexCliStatus(await api("/codex-cli/delete", {
        method: "POST",
        body: { profileId: profileId }
      }));
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function actionCliFromOpenClaw(profileId) {
    if (!profileId) return;
    const setOpenClawCurrent = window.confirm("同时把这个账号设成当前 OpenClaw 优先账号吗？点击“确定”会同时切换 OpenClaw 和 Codex CLI；点击“取消”只切换 Codex CLI。");
    state.loading = true;
    state.error = "";
    render();
    try {
      state.status = await api("/codex-cli/activate-from-openclaw", {
        method: "POST",
        body: {
          profileId: profileId,
          setOpenClawCurrent: setOpenClawCurrent
        }
      });
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
      scheduleLoginPoll();
    }
  }

  function start() {
    render();
    refresh();
    window.setInterval(refresh, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
