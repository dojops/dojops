/* global document, fetch, navigator, setTimeout, setInterval, clearInterval, sessionStorage */

const API = "/api";

// ── Auth Helpers ─────────────────────────────────────────

function getStoredApiKey() {
  try {
    return sessionStorage.getItem("dojops-api-key") || "";
  } catch {
    return "";
  }
}

function setStoredApiKey(key) {
  try {
    sessionStorage.setItem("dojops-api-key", key);
  } catch {
    /* ignore */
  }
}

function clearStoredApiKey() {
  try {
    sessionStorage.removeItem("dojops-api-key");
  } catch {
    /* ignore */
  }
}

// ── Helpers ──────────────────────────────────────────────

async function apiCall(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401 || res.status === 403) {
    clearStoredApiKey();
    showLoginOverlay();
    throw new Error("Authentication required");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Copy to Clipboard ────────────────────────────────────

const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function wrapCodeBlock(preHtml, rawText, id) {
  return `<div class="code-block">
    <button class="copy-btn" data-action="copyCode" data-id="${id}" id="copy-${id}">
      ${copyIcon}<span>Copy</span>
    </button>
    ${preHtml}
    <textarea id="raw-${id}" style="display:none">${escapeHtml(rawText)}</textarea>
  </div>`;
}

let copyCounter = 0;
function nextCopyId() {
  return "cb-" + ++copyCounter;
}

function copyCode(id) {
  const raw = $("raw-" + id);
  const btn = $("copy-" + id);
  if (!raw || !btn) return;

  const text = raw.value;
  navigator.clipboard.writeText(text).then(
    () => {
      btn.innerHTML = `${checkIcon}<span>Copied!</span>`;
      btn.classList.add("copied");
      toast("success", "Copied to clipboard", "");
      setTimeout(() => {
        btn.innerHTML = `${copyIcon}<span>Copy</span>`;
        btn.classList.remove("copied");
      }, 2000);
    },
    () => {
      // Fallback for older browsers
      raw.style.display = "block";
      raw.select();
      document.execCommand("copy");
      raw.style.display = "none";
      btn.innerHTML = `${checkIcon}<span>Copied!</span>`;
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = `${copyIcon}<span>Copy</span>`;
        btn.classList.remove("copied");
      }, 2000);
    },
  );
}

globalThis.copyCode = copyCode;

// ── Toast Notification System ────────────────────────────

const toastIcons = {
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

function getToastContainer() {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function toast(type, title, msg, duration = 4000) {
  const container = getToastContainer();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <div class="toast__icon">${toastIcons[type] || toastIcons.info}</div>
    <div class="toast__body">
      <div class="toast__title">${escapeHtml(title)}</div>
      ${msg ? `<div class="toast__msg">${escapeHtml(msg)}</div>` : ""}
    </div>`;

  el.addEventListener("click", () => dismissToast(el));
  container.appendChild(el);

  if (duration > 0) {
    setTimeout(() => dismissToast(el), duration);
  }
}

function dismissToast(el) {
  if (el.classList.contains("removing")) return;
  el.classList.add("removing");
  el.addEventListener("animationend", () => el.remove());
}

// ── Sidebar & Navigation ─────────────────────────────────

const sidebar = $("sidebar");
const overlay = $("overlay");
const menuToggle = $("menu-toggle");

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("active");
}

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("active");
}

menuToggle.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

overlay.addEventListener("click", closeSidebar);

// Tab switching
function navigateToTab(tab) {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const navBtn = document.querySelector('.nav-item[data-tab="' + tab + '"]');
  if (navBtn) navBtn.classList.add("active");

  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  const panel = $("panel-" + tab);
  if (panel) panel.classList.add("active");

  if (tab === "agents") loadAgents();
  if (tab === "history") loadHistory();
  if (tab === "overview") loadOverview();
  if (tab === "security") loadSecurity();
  if (tab === "audit") loadAudit();

  updateAutoRefresh(tab);
  closeSidebar();
}

globalThis.navigateToTab = navigateToTab;

// Logo click handlers (CSP-compliant, no inline onclick)
if ($("sidebar-logo")) $("sidebar-logo").addEventListener("click", () => navigateToTab("overview"));
if ($("topbar-logo")) $("topbar-logo").addEventListener("click", () => navigateToTab("overview"));

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    navigateToTab(item.dataset.tab);
  });
});

function renderTaskGraph(graph, planResult) {
  let html = `<div class="result-card"><div class="task-graph">`;
  html += `<div class="task-graph__title">${escapeHtml(graph.goal)}</div>`;

  graph.tasks.forEach((task, i) => {
    const resultInfo = planResult ? planResult.results.find((r) => r.taskId === task.id) : null;

    let statusChip = "";
    if (resultInfo) {
      const chipClass =
        resultInfo.status === "completed"
          ? "chip--success"
          : resultInfo.status === "failed"
            ? "chip--error"
            : "chip--muted";
      statusChip = `<span class="chip ${chipClass}">${escapeHtml(resultInfo.status)}</span>`;
    }

    // Determine if there's output to show
    const hasOutput = resultInfo && resultInfo.output;
    const hasError = resultInfo && resultInfo.error;
    const outputId = `task-output-${i}`;
    const toggleId = `task-toggle-${i}`;

    html += `
      <div class="task-node" style="animation-delay: ${i * 0.06}s">
        <div class="task-node__header">
          <span class="task-node__id">${escapeHtml(task.id)}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="task-node__tool">${escapeHtml(task.tool)}</span>
            ${statusChip}
          </div>
        </div>
        <div class="task-node__desc">${escapeHtml(task.description)}</div>
        ${task.dependsOn.length ? `<div class="task-node__deps">depends on: ${task.dependsOn.map(escapeHtml).join(", ")}</div>` : ""}`;

    // Show expand button for task output
    if (hasOutput) {
      const taskCid = nextCopyId();
      const outputText =
        typeof resultInfo.output === "string"
          ? resultInfo.output
          : JSON.stringify(resultInfo.output, null, 2);
      html += `
        <button class="task-node__output-toggle" id="${toggleId}" data-action="toggleTaskOutput" data-output-id="${outputId}" data-toggle-id="${toggleId}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          View output
        </button>
        <div class="task-node__output" id="${outputId}">
          ${wrapCodeBlock(`<pre>${escapeHtml(outputText)}</pre>`, outputText, taskCid)}
        </div>`;
    }

    // Show error details
    if (hasError) {
      html += `
        <div class="task-node__output visible" style="margin-top:8px">
          <pre style="color:var(--error);background:var(--error-bg);border-color:rgba(239,68,68,0.15)">${escapeHtml(resultInfo.error)}</pre>
        </div>`;
    }

    html += `</div>`;
  });

  // Summary bar
  if (planResult) {
    const completed = planResult.results.filter((r) => r.status === "completed").length;
    const failed = planResult.results.filter((r) => r.status === "failed").length;
    const skipped = planResult.results.filter((r) => r.status === "skipped").length;

    html += `<div class="plan-summary">
      <span class="plan-summary__label">Execution result:</span>
      <span class="chip ${planResult.success ? "chip--success" : "chip--error"}">${planResult.success ? "All passed" : "Has failures"}</span>
      <div class="plan-summary__stats">
        ${completed ? `<span class="stat-badge stat-badge--completed">${completed} completed</span>` : ""}
        ${failed ? `<span class="stat-badge stat-badge--failed">${failed} failed</span>` : ""}
        ${skipped ? `<span class="stat-badge stat-badge--skipped">${skipped} skipped</span>` : ""}
      </div>
    </div>`;
  }

  html += `</div></div>`;
  return html;
}

function toggleTaskOutput(outputId, toggleId) {
  const output = $(outputId);
  const toggle = $(toggleId);
  if (!output || !toggle) return;

  const isVisible = output.classList.contains("visible");
  if (isVisible) {
    output.classList.remove("visible");
    toggle.classList.remove("expanded");
    toggle.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg> View output`;
  } else {
    output.classList.add("visible");
    toggle.classList.add("expanded");
    toggle.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg> Hide output`;
  }
}

globalThis.toggleTaskOutput = toggleTaskOutput;

function renderDiagnosis(d) {
  const diagCid = nextCopyId();
  const fullDiag = [
    `Error Type: ${d.errorType}`,
    `Summary: ${d.summary}`,
    `Root Cause: ${d.rootCause}`,
    `Confidence: ${(d.confidence * 100).toFixed(0)}%`,
    d.affectedFiles?.length ? `Affected Files: ${d.affectedFiles.join(", ")}` : "",
    d.suggestedFixes?.length
      ? `Suggested Fixes:\n${d.suggestedFixes.map((f) => `  - ${f.description}${f.command ? ` (${f.command})` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let html = `<div class="result-card">
    <button class="copy-btn" data-action="copyCode" data-id="${diagCid}" id="copy-${diagCid}" style="position:absolute;top:12px;right:12px;opacity:1">
      ${copyIcon}<span>Copy all</span>
    </button>
    <textarea id="raw-${diagCid}" style="display:none">${escapeHtml(fullDiag)}</textarea>
    <div style="position:relative">`;

  html += `
    <div class="field-group">
      <div class="field-label">Error Type</div>
      <div class="field-value"><span class="chip chip--error">${escapeHtml(d.errorType)}</span></div>
    </div>
    <div class="field-group">
      <div class="field-label">Summary</div>
      <div class="field-value">${escapeHtml(d.summary)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">Root Cause</div>
      <div class="field-value">${escapeHtml(d.rootCause)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">Confidence</div>
      <div class="field-value" style="font-family:var(--font-mono);color:var(--cyan)">${(d.confidence * 100).toFixed(0)}%</div>
    </div>`;

  if (d.affectedFiles && d.affectedFiles.length > 0) {
    html += `
      <div class="field-group">
        <div class="field-label">Affected Files</div>
        <div class="field-value">${d.affectedFiles.map((f) => `<code style="font-family:var(--font-mono);font-size:12px;color:var(--warning);background:var(--warning-bg);padding:2px 6px;border-radius:3px">${escapeHtml(f)}</code>`).join(" ")}</div>
      </div>`;
  }

  if (d.suggestedFixes && d.suggestedFixes.length > 0) {
    html += '<div class="field-group"><div class="field-label">Suggested Fixes</div>';
    for (const fix of d.suggestedFixes) {
      html += `
        <div class="fix-card">
          <div class="fix-card__desc">
            <span class="chip chip--muted">${(fix.confidence * 100).toFixed(0)}%</span>
            ${escapeHtml(fix.description)}
          </div>
          ${fix.command ? `<code>$ ${escapeHtml(fix.command)}</code>` : ""}
          ${fix.file ? `<div class="fix-card__meta">File: ${escapeHtml(fix.file)}</div>` : ""}
        </div>`;
    }
    html += "</div>";
  }

  html += "</div></div>";
  return html;
}

function renderAnalysis(a) {
  const riskClass =
    { low: "risk--low", medium: "risk--medium", high: "risk--high", critical: "risk--critical" }[
      a.riskLevel
    ] || "";

  const diffCid = nextCopyId();
  const fullAnalysis = [
    `Summary: ${a.summary}`,
    `Risk Level: ${a.riskLevel}`,
    `Cost Impact: ${a.costImpact.direction} — ${a.costImpact.details}`,
    `Rollback Complexity: ${a.rollbackComplexity}`,
    `Confidence: ${(a.confidence * 100).toFixed(0)}%`,
    a.riskFactors?.length
      ? `Risk Factors:\n${a.riskFactors.map((r) => `  - ${r}`).join("\n")}`
      : "",
    a.securityImpact?.length
      ? `Security Impact:\n${a.securityImpact.map((s) => `  - ${s}`).join("\n")}`
      : "",
    a.recommendations?.length
      ? `Recommendations:\n${a.recommendations.map((r) => `  - ${r}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let html = `<div class="result-card" style="position:relative">
    <button class="copy-btn" data-action="copyCode" data-id="${diffCid}" id="copy-${diffCid}" style="position:absolute;top:12px;right:12px;opacity:1">
      ${copyIcon}<span>Copy all</span>
    </button>
    <textarea id="raw-${diffCid}" style="display:none">${escapeHtml(fullAnalysis)}</textarea>`;

  html += `
    <div class="field-group">
      <div class="field-label">Summary</div>
      <div class="field-value">${escapeHtml(a.summary)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">Risk Level</div>
      <div class="field-value"><span class="${riskClass}" style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(a.riskLevel)}</span></div>
    </div>
    <div class="field-group">
      <div class="field-label">Cost Impact</div>
      <div class="field-value">${escapeHtml(a.costImpact.direction)} &mdash; ${escapeHtml(a.costImpact.details)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">Rollback Complexity</div>
      <div class="field-value">${escapeHtml(a.rollbackComplexity)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">Confidence</div>
      <div class="field-value" style="font-family:var(--font-mono);color:var(--cyan)">${(a.confidence * 100).toFixed(0)}%</div>
    </div>`;

  if (a.changes && a.changes.length > 0) {
    html += '<div class="field-group"><div class="field-label">Changes</div>';
    for (const c of a.changes) {
      const attr = c.attribute ? ` (${escapeHtml(c.attribute)})` : "";
      html += `<div style="font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
        <span class="chip chip--muted">${escapeHtml(c.action)}</span>
        <span>${escapeHtml(c.resource)}${attr}</span>
      </div>`;
    }
    html += "</div>";
  }

  if (a.riskFactors && a.riskFactors.length > 0) {
    html += `
      <div class="field-group">
        <div class="field-label">Risk Factors</div>
        <ul style="margin-left:16px;color:var(--text-secondary)">${a.riskFactors.map((r) => `<li style="margin-bottom:4px">${escapeHtml(r)}</li>`).join("")}</ul>
      </div>`;
  }

  if (a.securityImpact && a.securityImpact.length > 0) {
    html += `
      <div class="field-group">
        <div class="field-label">Security Impact</div>
        <ul style="margin-left:16px;color:var(--text-secondary)">${a.securityImpact.map((s) => `<li style="margin-bottom:4px">${escapeHtml(s)}</li>`).join("")}</ul>
      </div>`;
  }

  if (a.recommendations && a.recommendations.length > 0) {
    html += `
      <div class="field-group">
        <div class="field-label">Recommendations</div>
        <ul style="margin-left:16px;color:var(--text-secondary)">${a.recommendations.map((r) => `<li style="margin-bottom:4px">${escapeHtml(r)}</li>`).join("")}</ul>
      </div>`;
  }

  html += "</div>";
  return html;
}

// ── Agents ───────────────────────────────────────────────

const DOMAIN_ICONS = {
  infrastructure:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  security:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  observability:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  networking:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  "ci-cd":
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  containers:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  database:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  automation:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  orchestration:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

const DOMAIN_DESCRIPTIONS = {
  "ops-cortex": "Central orchestration agent for multi-domain DevOps tasks",
  terraform: "Infrastructure as Code using HashiCorp Terraform",
  kubernetes: "Container orchestration and Kubernetes manifests",
  cicd: "CI/CD pipeline configuration and optimization",
  "security-auditor": "Security vulnerability scanning and compliance",
  observability: "Monitoring, logging, and observability stacks",
  docker: "Docker container and image management",
  "cloud-architect": "Cloud infrastructure design and best practices",
  network: "Network configuration, load balancing, and DNS",
  database: "Database setup, optimization, and migrations",
  gitops: "GitOps workflows and deployment automation",
  "compliance-auditor": "Regulatory compliance and policy enforcement",
  "ci-debugger": "CI/CD failure analysis and debugging",
  appsec: "Application security and OWASP vulnerability prevention",
  shell: "Shell scripting and system automation",
  python: "Python scripting and automation tools",
};

const DOMAIN_ICON_CLASS = {
  infrastructure: "infrastructure",
  security: "security",
  observability: "observability",
  networking: "networking",
  "ci-cd": "ci-cd",
  containers: "containers",
  database: "database",
  automation: "automation",
  orchestration: "orchestration",
  general: "general",
};

function getDomainCategory(domain) {
  const map = {
    infrastructure: "infrastructure",
    "cloud-architecture": "infrastructure",
    terraform: "infrastructure",
    security: "security",
    "security-audit": "security",
    "compliance-audit": "security",
    appsec: "security",
    observability: "observability",
    monitoring: "observability",
    networking: "networking",
    "ci-cd": "ci-cd",
    cicd: "ci-cd",
    "ci-debug": "ci-cd",
    containers: "containers",
    docker: "containers",
    kubernetes: "containers",
    orchestration: "orchestration",
    gitops: "orchestration",
    database: "database",
    automation: "automation",
    shell: "automation",
    python: "automation",
  };
  const d = (domain || "").toLowerCase().replace(/\s+/g, "-");
  return map[d] || "general";
}

let allAgents = [];
let activeFilter = null;

async function loadAgents() {
  const grid = $("agents-grid");
  try {
    const data = await apiCall("/agents");
    allAgents = data.agents || [];
    renderDomainFilters(allAgents);
    renderAgentsFiltered();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderDomainFilters(agents) {
  const container = $("agents-domain-filters");
  if (!container) return;

  const domains = [...new Set(agents.map((a) => a.domain))].sort();

  let html = `<button class="domain-filter${activeFilter === null ? " active" : ""}" data-domain="">All</button>`;
  for (const d of domains) {
    html += `<button class="domain-filter${activeFilter === d ? " active" : ""}" data-domain="${escapeHtml(d)}">${escapeHtml(d)}</button>`;
  }
  container.innerHTML = html;

  container.querySelectorAll(".domain-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.domain || null;
      container.querySelectorAll(".domain-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderAgentsFiltered();
    });
  });
}

function renderAgentsFiltered() {
  const searchEl = $("agents-search");
  const search = searchEl ? searchEl.value.toLowerCase().trim() : "";

  let filtered = allAgents;
  if (activeFilter) {
    filtered = filtered.filter((a) => a.domain === activeFilter);
  }
  if (search) {
    filtered = filtered.filter(
      (a) =>
        a.name.toLowerCase().includes(search) ||
        a.domain.toLowerCase().includes(search) ||
        a.keywords.some((k) => k.toLowerCase().includes(search)),
    );
  }

  const countEl = $("agents-count");
  if (countEl) {
    countEl.textContent =
      filtered.length === allAgents.length
        ? `${allAgents.length} agents`
        : `${filtered.length} of ${allAgents.length} agents`;
  }

  const grid = $("agents-grid");
  grid.innerHTML = renderAgents(filtered);
}

function renderAgents(agents) {
  if (!agents.length) {
    return `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <div>No agents match your search</div>
    </div>`;
  }

  return agents
    .map((a, i) => {
      const cat = getDomainCategory(a.domain);
      const icon = DOMAIN_ICONS[cat] || DOMAIN_ICONS.automation;
      const iconClass = DOMAIN_ICON_CLASS[cat] || "general";
      const desc = DOMAIN_DESCRIPTIONS[a.name] || `Specialist agent for ${a.domain}`;
      const maxKw = 6;
      const visibleKw = a.keywords.slice(0, maxKw);
      const moreCount = a.keywords.length - maxKw;

      return `
    <div class="agent-card" style="animation-delay: ${i * 0.04}s">
      <div class="agent-card__header">
        <div class="agent-card__icon agent-card__icon--${iconClass}">${icon}</div>
        <div class="agent-card__info">
          <div class="agent-card__name">${escapeHtml(a.name)}</div>
          <div class="agent-domain">${escapeHtml(a.domain)}</div>
        </div>
      </div>
      <div class="agent-card__description">${escapeHtml(desc)}</div>
      <div class="agent-card__kw">${visibleKw.map((k) => `<span class="kw">${escapeHtml(k)}</span>`).join("")}${moreCount > 0 ? `<span class="kw kw--more">+${moreCount} more</span>` : ""}</div>
    </div>`;
    })
    .join("");
}

// ── History ──────────────────────────────────────────────

async function loadHistory() {
  const container = $("history-table");
  const type = $("history-type").value;
  const query = type ? `?type=${type}` : "";

  try {
    const data = await apiCall(`/history${query}`);
    container.innerHTML = renderHistory(data.entries);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderHistory(entries) {
  if (!entries.length) {
    return `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
      <div>No history entries</div>
    </div>`;
  }

  let html = '<div class="history-list">';

  for (const e of entries) {
    const time = new Date(e.timestamp).toLocaleString();
    const statusChip = e.success
      ? '<span class="chip chip--success">ok</span>'
      : '<span class="chip chip--error">error</span>';

    html += `
      <div>
        <div class="history-row" data-action="toggleDetail" data-detail-id="detail-${e.id}">
          <span class="history-row__id">${escapeHtml(e.id)}</span>
          <span class="chip chip--muted">${escapeHtml(e.type)}</span>
          <span class="history-row__time">${escapeHtml(time)}</span>
          ${statusChip}
          <span class="history-row__duration">${e.durationMs}ms</span>
        </div>
        <div id="detail-${e.id}" class="history-detail">
          ${renderHistoryDetail(e)}
        </div>
      </div>`;
  }

  html += "</div>";
  return html;
}

function renderHistoryDetail(entry) {
  const r = entry.response;
  if (!r) {
    const errCid = nextCopyId();
    return wrapCodeBlock(
      `<pre style="color:var(--error)">${escapeHtml(entry.error || "No response")}</pre>`,
      entry.error || "No response",
      errCid,
    );
  }

  // Generate type: agent info + content
  if (entry.type === "generate" && r.content != null) {
    const cid = nextCopyId();
    let html = '<div class="result-card" style="margin:0">';
    if (r.agent) {
      html += `<div class="result-meta" style="margin-bottom:12px">
        <span class="chip chip--cyan">${escapeHtml(r.agent.name)}</span>
        <span class="chip chip--muted">${escapeHtml(r.agent.domain)}</span>
        <span style="color:var(--text-muted);font-size:12px;font-family:var(--font-mono)">
          ${(r.agent.confidence * 100).toFixed(0)}% confidence
        </span>
      </div>`;
    }
    html += wrapCodeBlock(`<pre>${escapeHtml(r.content)}</pre>`, r.content, cid);
    html += "</div>";
    return html;
  }

  // Plan type: task graph
  if (entry.type === "plan" && r.graph) {
    return renderTaskGraph(r.graph, r.result);
  }

  // Debug CI type: diagnosis
  if (entry.type === "debug-ci" && r.diagnosis) {
    return renderDiagnosis(r.diagnosis);
  }

  // Diff type: analysis
  if (entry.type === "diff" && r.analysis) {
    return renderAnalysis(r.analysis);
  }

  // Fallback: pretty-print JSON with labels
  const cid = nextCopyId();
  const pretty = JSON.stringify(r, null, 2);
  return wrapCodeBlock(`<pre>${escapeHtml(pretty)}</pre>`, pretty, cid);
}

function toggleDetail(id) {
  const el = $(id);
  if (el) {
    el.classList.toggle("active");
  }
}

globalThis.toggleDetail = toggleDetail;

$("history-type").addEventListener("change", loadHistory);

$("history-clear").addEventListener("click", async () => {
  try {
    await apiCall("/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Confirm": "clear" },
    });
    toast("success", "History cleared", "All entries have been removed.");
    loadHistory();
  } catch {
    toast("error", "Clear failed", "Could not clear history.");
  }
});

// ── Auto-refresh for metrics tabs ─────────────────────

let autoRefreshTimer = null;
const REFRESH_INTERVAL = 30000;
const metricsTabLoaders = {
  overview: () => loadOverview(true),
  security: () => loadSecurity(true),
  audit: () => loadAudit(true),
};

function updateAutoRefresh(tab) {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  // Deactivate all refresh indicators
  for (const id of ["overview-refresh", "security-refresh", "audit-refresh"]) {
    const el = $(id);
    if (el) el.classList.remove("active");
  }

  const loader = metricsTabLoaders[tab];
  if (loader) {
    const indicator = $(tab + "-refresh");
    if (indicator) indicator.classList.add("active");
    autoRefreshTimer = setInterval(loader, REFRESH_INTERVAL);
  }
}

// ── Overview ──────────────────────────────────────────

async function loadOverview() {
  const container = $("overview-content");
  try {
    const data = await apiCall("/metrics/overview");
    container.innerHTML = renderOverview(data);
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("Cannot GET")) {
      container.innerHTML = renderMetricsEmpty(
        "No project data",
        "Start the server from a project directory with .dojops/ to see metrics.",
      );
    } else {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + "</div>";
    }
  }
}

function renderOverview(data) {
  let html = "";

  // Health banner
  const healthLevel =
    data.criticalFindings > 0 ? "critical" : data.successRate < 50 ? "warning" : "healthy";
  const healthIcons = {
    healthy:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warning:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    critical:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  const healthLabels = {
    healthy: "System Healthy",
    warning: "Needs Attention",
    critical: "Critical Issues Detected",
  };
  const critDesc = [];
  if (data.criticalFindings > 0) critDesc.push(data.criticalFindings + " critical");
  if (data.highFindings > 0) critDesc.push(data.highFindings + " high");
  const critSummary = critDesc.length ? critDesc.join(" and ") + " severity" : "";
  const healthDetails = {
    healthy: `${data.successRate}% success rate across ${data.totalPlans} plans`,
    warning: `Success rate at ${data.successRate}% — review recent failures`,
    critical: `${data.totalFindings} security finding${data.totalFindings !== 1 ? "s" : ""} detected (${critSummary}) — includes vulnerabilities and dependency issues`,
  };
  html +=
    '<div class="health-banner health-banner--' +
    healthLevel +
    '">' +
    '<div class="health-banner__icon">' +
    healthIcons[healthLevel] +
    "</div>" +
    "<div>" +
    '<div class="health-banner__text">' +
    healthLabels[healthLevel] +
    "</div>" +
    '<div class="health-banner__detail">' +
    healthDetails[healthLevel] +
    "</div>" +
    "</div>" +
    (healthLevel === "critical"
      ? '<a class="health-banner__link" data-action="navigateToTab" data-tab="security" style="margin-left:auto;cursor:pointer;color:var(--error);font-size:12px;font-weight:600;text-decoration:underline;white-space:nowrap">View Security &rarr;</a>'
      : "") +
    "</div>";

  // 6 stat cards
  html += '<div class="stat-grid--6">';
  html += renderStatCard(data.totalPlans, "Total Plans", "");
  html += renderStatCard(
    data.totalExecutions !== undefined ? data.totalExecutions : "—",
    "Executions",
    "",
  );
  html += renderStatCard(
    data.successRate + "%",
    "Success Rate",
    data.successRate >= 80 ? "success" : data.successRate >= 50 ? "warning" : "error",
  );
  html += renderStatCard(
    data.avgExecutionTimeMs > 0 ? formatDuration(data.avgExecutionTimeMs) : "N/A",
    "Avg Exec Time",
    "",
  );
  html += renderStatCard(data.totalScans !== undefined ? data.totalScans : "—", "Total Scans", "");
  html += renderStatCard(
    data.totalFindings,
    "Total Findings",
    data.criticalFindings > 0 ? "error" : data.totalFindings > 0 ? "warning" : "success",
  );
  html += "</div>";

  // Findings summary (if findings > 0)
  if (data.criticalFindings > 0 || (data.highFindings && data.highFindings > 0)) {
    html += '<div class="findings-summary">';
    if (data.criticalFindings > 0) {
      html +=
        '<div class="findings-summary__item">' +
        '<span class="findings-summary__count findings-summary__count--critical">' +
        data.criticalFindings +
        "</span>" +
        '<span style="color:var(--text-secondary);font-size:12px">Critical</span></div>';
    }
    if (data.highFindings && data.highFindings > 0) {
      html +=
        '<div class="findings-summary__item">' +
        '<span class="findings-summary__count findings-summary__count--high">' +
        data.highFindings +
        "</span>" +
        '<span style="color:var(--text-secondary);font-size:12px">High</span></div>';
    }
    html += "</div>";
  }

  // Recent activity with colored dots
  if (data.recentActivity.length > 0) {
    html += '<div class="metrics-section">';
    html += '<div class="metrics-section__title">Recent Activity</div>';
    html += '<div class="timeline-list">';
    for (const item of data.recentActivity.slice(0, 10)) {
      const dotClass =
        item.status === "success"
          ? "timeline-entry__dot--success"
          : item.status === "failure"
            ? "timeline-entry__dot--failure"
            : "timeline-entry__dot--unknown";
      const statusChip =
        item.status === "success"
          ? '<span class="chip chip--success">ok</span>'
          : item.status === "failure"
            ? '<span class="chip chip--error">fail</span>'
            : '<span class="chip chip--muted">' + escapeHtml(item.status) + "</span>";
      html +=
        '<div class="timeline-entry">' +
        '<span class="timeline-entry__dot ' +
        dotClass +
        '"></span>' +
        '<span class="timeline-entry__time">' +
        escapeHtml(new Date(item.timestamp).toLocaleString()) +
        "</span>" +
        '<span class="timeline-entry__action">' +
        escapeHtml(item.action) +
        "</span>" +
        statusChip +
        (item.planId
          ? '<span class="chip chip--muted">' + escapeHtml(item.planId) + "</span>"
          : "") +
        "</div>";
    }
    html += "</div></div>";
  }

  // Two-column layout for agent usage and failure reasons
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">';

  // Most used agents
  if (data.mostUsedAgents.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Most Used Commands</div>';
    html +=
      '<table class="metric-table"><thead><tr><th>Command</th><th>Count</th></tr></thead><tbody>';
    for (const item of data.mostUsedAgents.slice(0, 8)) {
      html +=
        '<tr><td><code style="font-family:var(--font-mono);font-size:12px;color:var(--cyan)">' +
        escapeHtml(item.agent) +
        '</code></td><td style="font-family:var(--font-mono)">' +
        item.count +
        "</td></tr>";
    }
    html += "</tbody></table></div>";
  }

  // Failure reasons
  if (data.failureReasons.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Failure Reasons</div>';
    html +=
      '<table class="metric-table"><thead><tr><th>Reason</th><th>Count</th></tr></thead><tbody>';
    for (const item of data.failureReasons.slice(0, 8)) {
      html +=
        '<tr><td style="color:var(--error)">' +
        escapeHtml(item.reason) +
        '</td><td style="font-family:var(--font-mono)">' +
        item.count +
        "</td></tr>";
    }
    html += "</tbody></table></div>";
  } else {
    html +=
      '<div class="metrics-section glass-card"><div class="metrics-section__title">Failure Reasons</div><div style="color:var(--text-muted);font-size:13px;padding:8px 0">No failures recorded</div></div>';
  }

  html += "</div>";
  return html;
}

function renderStatCard(value, label, variant) {
  const cls = variant ? " stat-card__value--" + variant : "";
  return (
    '<div class="stat-card">' +
    '<div class="stat-card__value' +
    cls +
    '">' +
    escapeHtml(String(value)) +
    "</div>" +
    '<div class="stat-card__label">' +
    escapeHtml(label) +
    "</div>" +
    "</div>"
  );
}

function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return (ms / 60000).toFixed(1) + "m";
}

// ── Security ──────────────────────────────────────────

async function loadSecurity() {
  const container = $("security-content");
  try {
    const data = await apiCall("/metrics/security");
    container.innerHTML = renderSecurity(data);
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("Cannot GET")) {
      container.innerHTML = renderMetricsEmpty(
        "No security data",
        "Run scans to populate security metrics.",
      );
    } else {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + "</div>";
    }
  }
}

function renderSecurity(data) {
  if (data.totalScans === 0) {
    return renderMetricsEmpty("No scans yet", "Run a security scan to see findings here.");
  }

  let html = '<div class="stat-grid">';
  html += renderStatCard(data.totalScans, "Total Scans", "");
  html += renderStatCard(
    data.totalFindings,
    "Total Findings",
    data.totalFindings > 0 ? "warning" : "success",
  );
  html += renderStatCard(
    data.bySeverity.critical,
    "Critical",
    data.bySeverity.critical > 0 ? "error" : "success",
  );
  html += renderStatCard(
    data.bySeverity.high,
    "High",
    data.bySeverity.high > 0 ? "warning" : "success",
  );
  html += "</div>";

  // Severity bar
  var total = data.totalFindings || 1;
  html += '<div class="metrics-section">';
  html += '<div class="metrics-section__title">Severity Distribution</div>';
  html += '<div class="severity-bar">';
  html +=
    '<div class="severity-bar__seg severity-bar__seg--critical" style="width:' +
    (data.bySeverity.critical / total) * 100 +
    '%"></div>';
  html +=
    '<div class="severity-bar__seg severity-bar__seg--high" style="width:' +
    (data.bySeverity.high / total) * 100 +
    '%"></div>';
  html +=
    '<div class="severity-bar__seg severity-bar__seg--medium" style="width:' +
    (data.bySeverity.medium / total) * 100 +
    '%"></div>';
  html +=
    '<div class="severity-bar__seg severity-bar__seg--low" style="width:' +
    (data.bySeverity.low / total) * 100 +
    '%"></div>';
  html += "</div>";
  html += '<div class="severity-legend">';
  html +=
    '<div class="severity-legend__item"><span class="severity-legend__dot severity-legend__dot--critical"></span>Critical (' +
    data.bySeverity.critical +
    ")</div>";
  html +=
    '<div class="severity-legend__item"><span class="severity-legend__dot severity-legend__dot--high"></span>High (' +
    data.bySeverity.high +
    ")</div>";
  html +=
    '<div class="severity-legend__item"><span class="severity-legend__dot severity-legend__dot--medium"></span>Medium (' +
    data.bySeverity.medium +
    ")</div>";
  html +=
    '<div class="severity-legend__item"><span class="severity-legend__dot severity-legend__dot--low"></span>Low (' +
    data.bySeverity.low +
    ")</div>";
  html += "</div></div>";

  // Category breakdown
  if (data.byCategory) {
    html += '<div class="metrics-section">';
    html += '<div class="metrics-section__title">Category Breakdown</div>';
    html += '<div class="category-grid">';

    const categories = [
      {
        key: "security",
        label: "Security",
        iconClass: "security",
        icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      },
      {
        key: "dependency",
        label: "Dependencies",
        iconClass: "dependencies",
        icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
      },
      {
        key: "iac",
        label: "IaC",
        iconClass: "iac",
        icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
      },
      {
        key: "secrets",
        label: "Secrets",
        iconClass: "secrets",
        icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      },
    ];

    for (const cat of categories) {
      const count = data.byCategory[cat.key] || 0;
      html +=
        '<div class="category-card">' +
        '<div class="category-card__icon category-card__icon--' +
        cat.iconClass +
        '">' +
        cat.icon +
        "</div>" +
        '<div class="category-card__count">' +
        count +
        "</div>" +
        '<div class="category-card__label">' +
        cat.label +
        "</div></div>";
    }

    html += "</div></div>";
  }

  // Findings trend chart
  if (data.findingsTrend.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Findings Trend</div>';
    var maxVal = Math.max(
      1,
      ...data.findingsTrend.map(function (d) {
        return d.critical + d.high + d.medium + d.low;
      }),
    );
    html += '<div class="trend-chart">';
    for (var i = 0; i < data.findingsTrend.length; i++) {
      var point = data.findingsTrend[i];
      var cH = (point.critical / maxVal) * 100;
      var hH = (point.high / maxVal) * 100;
      var mH = (point.medium / maxVal) * 100;
      var lH = (point.low / maxVal) * 100;
      html += '<div class="trend-chart__bar-group">';
      if (point.low > 0)
        html +=
          '<div class="trend-chart__bar trend-chart__bar--low" style="height:' + lH + '%"></div>';
      if (point.medium > 0)
        html +=
          '<div class="trend-chart__bar trend-chart__bar--medium" style="height:' +
          mH +
          '%"></div>';
      if (point.high > 0)
        html +=
          '<div class="trend-chart__bar trend-chart__bar--high" style="height:' + hH + '%"></div>';
      if (point.critical > 0)
        html +=
          '<div class="trend-chart__bar trend-chart__bar--critical" style="height:' +
          cH +
          '%"></div>';
      html += '<span class="trend-chart__label">' + escapeHtml(point.date.slice(5)) + "</span>";
      html += "</div>";
    }
    html += "</div></div>";
  }

  // All issues table with pagination and filtering
  if (data.topIssues.length > 0) {
    // Extract unique severities and tools for filter dropdowns
    var severities = [
      ...new Set(
        data.topIssues.map(function (i) {
          return i.severity;
        }),
      ),
    ].sort();
    var tools = [
      ...new Set(
        data.topIssues.map(function (i) {
          return i.tool;
        }),
      ),
    ].sort();

    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">All Issues (' + data.topIssues.length + ")</div>";

    // Filter toolbar
    html += '<div class="filter-toolbar">';
    html += '<div class="filter-group">';
    html += '<label class="filter-label">Severity</label>';
    html += '<select id="issues-sev-filter" class="filter-select" onchange="filterIssuesTable()">';
    html += '<option value="">All</option>';
    for (var si = 0; si < severities.length; si++) {
      html +=
        '<option value="' +
        escapeHtml(severities[si]) +
        '">' +
        escapeHtml(severities[si]) +
        "</option>";
    }
    html += "</select></div>";
    html += '<div class="filter-group">';
    html += '<label class="filter-label">Tool</label>';
    html += '<select id="issues-tool-filter" class="filter-select" onchange="filterIssuesTable()">';
    html += '<option value="">All</option>';
    for (var ti = 0; ti < tools.length; ti++) {
      html +=
        '<option value="' + escapeHtml(tools[ti]) + '">' + escapeHtml(tools[ti]) + "</option>";
    }
    html += "</select></div></div>";

    html += '<div id="issues-table-wrap"></div>';
    html += '<div id="issues-pagination" class="pagination"></div>';
    html += "</div>";

    // Store data globally for filtering/pagination
    globalThis._issuesData = data.topIssues;
    globalThis._issuesPage = 1;
    setTimeout(function () {
      filterIssuesTable();
    }, 0);
  }

  // Scan history with pagination (sorted by time, newest first)
  if (data.scanHistory.length > 0) {
    var sortedScans = data.scanHistory.slice().sort(function (a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Scan History (' + sortedScans.length + ")</div>";
    html += '<div id="scan-history-table-wrap"></div>';
    html += '<div id="scan-history-pagination" class="pagination"></div>';
    html += "</div>";

    globalThis._scanHistoryData = sortedScans;
    globalThis._scanHistoryPage = 1;
    setTimeout(function () {
      renderScanHistoryPage();
    }, 0);
  }

  return html;
}

// ── Audit ─────────────────────────────────────────────

async function loadAudit() {
  const container = $("audit-content");
  try {
    const data = await apiCall("/metrics/audit");
    container.innerHTML = renderAudit(data);
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("Cannot GET")) {
      container.innerHTML = renderMetricsEmpty(
        "No audit data",
        "Start using DojOps commands to build an audit trail.",
      );
    } else {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + "</div>";
    }
  }
}

function renderAudit(data) {
  if (data.totalEntries === 0) {
    return renderMetricsEmpty(
      "No audit entries",
      "Execute DojOps commands to populate the audit trail.",
    );
  }

  let html = "";

  // Chain integrity badge
  var valid = data.chainIntegrity.valid;
  var badgeClass = valid ? "integrity-badge--valid" : "integrity-badge--invalid";
  var badgeIcon = valid
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  html +=
    '<div class="integrity-badge ' +
    badgeClass +
    '">' +
    '<div class="integrity-badge__icon">' +
    badgeIcon +
    "</div>" +
    "<div>" +
    '<div class="integrity-badge__text">' +
    (valid ? "Chain Integrity Valid" : "Chain Integrity Broken") +
    "</div>" +
    '<div class="integrity-badge__detail">' +
    data.chainIntegrity.totalEntries +
    " entries, " +
    data.chainIntegrity.errors +
    " error(s)</div>" +
    "</div></div>";

  // Status breakdown
  html += '<div class="status-breakdown">';
  html +=
    '<div class="status-breakdown__item"><span class="status-breakdown__count status-breakdown__count--success">' +
    data.byStatus.success +
    '</span><span class="status-breakdown__label">Success</span></div>';
  html +=
    '<div class="status-breakdown__item"><span class="status-breakdown__count status-breakdown__count--failure">' +
    data.byStatus.failure +
    '</span><span class="status-breakdown__label">Failure</span></div>';
  html +=
    '<div class="status-breakdown__item"><span class="status-breakdown__count status-breakdown__count--cancelled">' +
    data.byStatus.cancelled +
    '</span><span class="status-breakdown__label">Cancelled</span></div>';
  html += "</div>";

  // Integrity detail
  html +=
    '<div class="integrity-detail">' +
    '<div class="integrity-detail__item">' +
    '<span class="integrity-detail__label">Entries:</span>' +
    '<span class="integrity-detail__value">' +
    data.chainIntegrity.totalEntries +
    "</span></div>" +
    '<div class="integrity-detail__item">' +
    '<span class="integrity-detail__label">Errors:</span>' +
    '<span class="integrity-detail__value" style="color:' +
    (data.chainIntegrity.errors > 0 ? "var(--error)" : "var(--success)") +
    '">' +
    data.chainIntegrity.errors +
    "</span></div>" +
    (data.chainIntegrity.latestHash
      ? '<div class="integrity-detail__item">' +
        '<span class="integrity-detail__label">Latest hash:</span>' +
        '<span class="integrity-detail__value integrity-detail__value--hash" title="' +
        escapeHtml(data.chainIntegrity.latestHash) +
        '">' +
        escapeHtml(data.chainIntegrity.latestHash) +
        "</span></div>"
      : "") +
    "</div>";

  // Command distribution
  if (data.byCommand.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Command Distribution</div>';
    html +=
      '<table class="metric-table"><thead><tr><th>Command</th><th>Count</th></tr></thead><tbody>';
    for (var i = 0; i < data.byCommand.length; i++) {
      var item = data.byCommand[i];
      html +=
        '<tr><td><code style="font-family:var(--font-mono);font-size:12px;color:var(--cyan)">' +
        escapeHtml(item.command) +
        '</code></td><td style="font-family:var(--font-mono)">' +
        item.count +
        "</td></tr>";
    }
    html += "</tbody></table></div>";
  }

  // Recent entries with hash chain
  if (data.timeline.length > 0) {
    html += '<div class="metrics-section">';
    html += '<div class="metrics-section__title">Recent Entries</div>';
    html += '<div class="audit-entries-grid">';
    var max = Math.min(data.timeline.length, 20);
    for (var j = 0; j < max; j++) {
      var entry = data.timeline[j];
      var statusChip =
        entry.status === "success"
          ? '<span class="chip chip--success">ok</span>'
          : entry.status === "failure"
            ? '<span class="chip chip--error">fail</span>'
            : '<span class="chip chip--muted">' + escapeHtml(entry.status) + "</span>";
      var hashDisplay = entry.hash
        ? '<span class="audit-entry-card__hash" title="' +
          escapeHtml(entry.hash) +
          '">' +
          escapeHtml(entry.hash.slice(0, 12)) +
          "...</span>"
        : "";
      html +=
        '<div class="audit-entry-card" style="animation-delay:' +
        j * 0.02 +
        's">' +
        '<span class="audit-entry-card__cmd">' +
        escapeHtml(entry.command) +
        "</span>" +
        '<span class="audit-entry-card__action">' +
        escapeHtml(entry.action) +
        "</span>" +
        statusChip +
        hashDisplay +
        "</div>";
      if (j < max - 1 && entry.hash) {
        html += '<div class="audit-entry-card__chain-arrow">&#x25BC;</div>';
      }
    }
    html += "</div></div>";
  }

  return html;
}

// ── Issues table filtering & pagination ───────────────

var ISSUES_PER_PAGE = 10;

function filterIssuesTable() {
  var sevFilter = $("issues-sev-filter");
  var toolFilter = $("issues-tool-filter");
  var sev = sevFilter ? sevFilter.value : "";
  var tool = toolFilter ? toolFilter.value : "";

  var filtered = (globalThis._issuesData || []).filter(function (issue) {
    if (sev && issue.severity !== sev) return false;
    if (tool && issue.tool !== tool) return false;
    return true;
  });

  globalThis._filteredIssues = filtered;
  globalThis._issuesPage = 1;
  renderIssuesPage();
}

globalThis.filterIssuesTable = filterIssuesTable;

function renderIssuesPage() {
  var items = globalThis._filteredIssues || [];
  var page = globalThis._issuesPage || 1;
  var totalPages = Math.max(1, Math.ceil(items.length / ISSUES_PER_PAGE));
  if (page > totalPages) page = totalPages;

  var start = (page - 1) * ISSUES_PER_PAGE;
  var pageItems = items.slice(start, start + ISSUES_PER_PAGE);

  var wrap = $("issues-table-wrap");
  if (!wrap) return;

  var html =
    '<table class="metric-table"><thead><tr><th>Issue</th><th>Severity</th><th>Tool</th><th>Count</th></tr></thead><tbody>';
  if (pageItems.length === 0) {
    html +=
      '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No issues match the selected filters</td></tr>';
  }
  for (var j = 0; j < pageItems.length; j++) {
    var issue = pageItems[j];
    var sevClass = "severity-" + issue.severity;
    html +=
      "<tr>" +
      '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
      escapeHtml(issue.message) +
      '">' +
      escapeHtml(issue.message) +
      "</td>" +
      '<td class="' +
      sevClass +
      '">' +
      escapeHtml(issue.severity) +
      "</td>" +
      '<td><code style="font-family:var(--font-mono);font-size:11px">' +
      escapeHtml(issue.tool) +
      "</code></td>" +
      '<td style="font-family:var(--font-mono)">' +
      issue.count +
      "</td></tr>";
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;

  // Pagination controls
  var pag = $("issues-pagination");
  if (pag) {
    pag.innerHTML = renderPagination(page, totalPages, items.length, "goIssuesPage");
  }
}

function goIssuesPage(p) {
  globalThis._issuesPage = p;
  renderIssuesPage();
}

globalThis.goIssuesPage = goIssuesPage;

// ── Scan history pagination ───────────────────────────

var SCANS_PER_PAGE = 10;

function renderScanHistoryPage() {
  var items = globalThis._scanHistoryData || [];
  var page = globalThis._scanHistoryPage || 1;
  var totalPages = Math.max(1, Math.ceil(items.length / SCANS_PER_PAGE));
  if (page > totalPages) page = totalPages;

  var start = (page - 1) * SCANS_PER_PAGE;
  var pageItems = items.slice(start, start + SCANS_PER_PAGE);

  var wrap = $("scan-history-table-wrap");
  if (!wrap) return;

  var html =
    '<table class="metric-table"><thead><tr><th>ID</th><th>Time</th><th>Total</th><th>Critical</th><th>High</th><th>Duration</th></tr></thead><tbody>';
  for (var k = 0; k < pageItems.length; k++) {
    var scan = pageItems[k];
    html +=
      "<tr>" +
      '<td><code style="font-family:var(--font-mono);font-size:11px;color:var(--cyan)">' +
      escapeHtml(scan.id) +
      "</code></td>" +
      "<td>" +
      escapeHtml(new Date(scan.timestamp).toLocaleString()) +
      "</td>" +
      '<td style="font-family:var(--font-mono)">' +
      scan.total +
      "</td>" +
      '<td class="severity-critical" style="font-family:var(--font-mono)">' +
      scan.critical +
      "</td>" +
      '<td class="severity-high" style="font-family:var(--font-mono)">' +
      scan.high +
      "</td>" +
      '<td style="font-family:var(--font-mono);color:var(--text-muted)">' +
      formatDuration(scan.durationMs) +
      "</td></tr>";
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;

  var pag = $("scan-history-pagination");
  if (pag) {
    pag.innerHTML = renderPagination(page, totalPages, items.length, "goScanHistoryPage");
  }
}

function goScanHistoryPage(p) {
  globalThis._scanHistoryPage = p;
  renderScanHistoryPage();
}

globalThis.goScanHistoryPage = goScanHistoryPage;

// ── Shared pagination renderer ────────────────────────

function renderPagination(currentPage, totalPages, totalItems, goFnName) {
  if (totalPages <= 1)
    return (
      '<span class="pagination__info">' +
      totalItems +
      " item" +
      (totalItems !== 1 ? "s" : "") +
      "</span>"
    );

  var html =
    '<span class="pagination__info">' +
    totalItems +
    " item" +
    (totalItems !== 1 ? "s" : "") +
    " &middot; Page " +
    currentPage +
    " of " +
    totalPages +
    "</span>";
  html += '<div class="pagination__btns">';

  html +=
    '<button class="pagination__btn" data-action="paginate" data-fn="' +
    goFnName +
    '" data-page="1"' +
    (currentPage <= 1 ? " disabled" : "") +
    ">&laquo;</button>";
  html +=
    '<button class="pagination__btn" data-action="paginate" data-fn="' +
    goFnName +
    '" data-page="' +
    (currentPage - 1) +
    '"' +
    (currentPage <= 1 ? " disabled" : "") +
    ">&lsaquo;</button>";

  // Show page numbers (max 5)
  var startP = Math.max(1, currentPage - 2);
  var endP = Math.min(totalPages, startP + 4);
  if (endP - startP < 4) startP = Math.max(1, endP - 4);

  for (var p = startP; p <= endP; p++) {
    html +=
      '<button class="pagination__btn' +
      (p === currentPage ? " pagination__btn--active" : "") +
      '" data-action="paginate" data-fn="' +
      goFnName +
      '" data-page="' +
      p +
      '">' +
      p +
      "</button>";
  }

  html +=
    '<button class="pagination__btn" data-action="paginate" data-fn="' +
    goFnName +
    '" data-page="' +
    (currentPage + 1) +
    '"' +
    (currentPage >= totalPages ? " disabled" : "") +
    ">&rsaquo;</button>";
  html +=
    '<button class="pagination__btn" data-action="paginate" data-fn="' +
    goFnName +
    '" data-page="' +
    totalPages +
    '"' +
    (currentPage >= totalPages ? " disabled" : "") +
    ">&raquo;</button>";
  html += "</div>";
  return html;
}

// ── Shared metrics helpers ────────────────────────────

function renderMetricsEmpty(title, detail) {
  return (
    '<div class="metrics-empty">' +
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>' +
    '<div class="metrics-empty__title">' +
    escapeHtml(title) +
    "</div>" +
    "<div>" +
    escapeHtml(detail) +
    "</div>" +
    "</div>"
  );
}

// ── Init ─────────────────────────────────────────────────

function setProviderStatus(text, online) {
  const chips = [$("provider-badge"), $("provider-badge-mobile")];

  for (const chip of chips) {
    if (!chip) continue;
    const textEl = chip.querySelector(".status-text");
    if (textEl) textEl.textContent = text;
    chip.classList.remove("online", "offline");
    chip.classList.add(online ? "online" : "offline");
  }
}

// ── Login Overlay ────────────────────────────────────────

function showLoginOverlay() {
  // Remove existing overlay if present
  var existing = $("auth-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = "auth-overlay";
  overlay.className = "auth-overlay";
  overlay.innerHTML =
    '<div class="auth-card">' +
    '<h2 class="auth-title">Authentication Required</h2>' +
    '<p class="auth-hint">Enter your API key to access the dashboard.<br>' +
    "Generate one with: <code>dojops serve credentials</code></p>" +
    '<input type="password" id="auth-key-input" class="auth-input" placeholder="API Key" autocomplete="off" />' +
    '<button id="auth-submit-btn" class="btn btn--primary auth-submit" data-action="authSubmit">Sign In</button>' +
    '<p id="auth-error" class="auth-error" style="display:none"></p>' +
    "</div>";
  document.body.appendChild(overlay);

  var input = $("auth-key-input");
  if (input) {
    input.focus();
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") attemptLogin();
    });
  }
}

function hideLoginOverlay() {
  var overlay = $("auth-overlay");
  if (overlay) overlay.remove();
}

async function attemptLogin() {
  var input = $("auth-key-input");
  var errorEl = $("auth-error");
  if (!input) return;
  var key = input.value.trim();
  if (!key) {
    if (errorEl) {
      errorEl.textContent = "Please enter an API key";
      errorEl.style.display = "block";
    }
    return;
  }
  try {
    // Test key against agents endpoint
    var res = await fetch(API + "/agents", {
      headers: { "X-API-Key": key },
    });
    if (res.ok) {
      setStoredApiKey(key);
      hideLoginOverlay();
      showLogoutButton();
      init();
    } else {
      if (errorEl) {
        errorEl.textContent = "Invalid API key. Please try again.";
        errorEl.style.display = "block";
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = "Connection error. Is the server running?";
      errorEl.style.display = "block";
    }
  }
}

function showLogoutButton() {
  var footer = document.querySelector(".sidebar__footer");
  if (!footer || $("logout-btn")) return;
  var btn = document.createElement("button");
  btn.id = "logout-btn";
  btn.className = "btn btn--ghost logout-btn";
  btn.textContent = "Logout";
  btn.dataset.action = "authLogout";
  footer.appendChild(btn);
}

function hideLogoutButton() {
  var btn = $("logout-btn");
  if (btn) btn.remove();
}

function doLogout() {
  clearStoredApiKey();
  hideLogoutButton();
  showLoginOverlay();
}

async function init() {
  // Check health (raw fetch, no auth needed for minimal payload)
  try {
    var healthRes = await fetch(API + "/health");
    var health = await healthRes.json();

    if (health.authRequired && !getStoredApiKey()) {
      showLoginOverlay();
      return;
    }

    // Full health check with auth
    var fullHealth = await apiCall("/health");
    setProviderStatus(fullHealth.provider, true);
    toast("success", "Connected", "Provider: " + fullHealth.provider);

    if (health.authRequired) {
      showLogoutButton();
    }
  } catch (err) {
    if (err && err.message === "Authentication required") return;
    setProviderStatus("offline", false);
    toast("error", "Connection failed", "Could not reach API. Is the server running?");
  }

  // Load Overview as default tab
  loadOverview();
  updateAutoRefresh("overview");

  // Agents search listener
  var searchEl = $("agents-search");
  if (searchEl) {
    searchEl.addEventListener("input", renderAgentsFiltered);
  }
}

// ── CSP-safe event delegation ────────────────────────────
// Replaces all inline onclick handlers with data-action attributes
document.addEventListener("click", function (e) {
  var target = e.target.closest("[data-action]");
  if (!target) return;
  var action = target.dataset.action;
  if (action === "copyCode") {
    copyCode(target.dataset.id);
  } else if (action === "toggleTaskOutput") {
    toggleTaskOutput(target.dataset.outputId, target.dataset.toggleId);
  } else if (action === "toggleDetail") {
    toggleDetail(target.dataset.detailId);
  } else if (action === "navigateToTab") {
    navigateToTab(target.dataset.tab);
  } else if (action === "paginate") {
    var fn = globalThis[target.dataset.fn];
    if (typeof fn === "function") fn(parseInt(target.dataset.page, 10));
  } else if (action === "authSubmit") {
    attemptLogin();
  } else if (action === "authLogout") {
    doLogout();
  }
});

init();
