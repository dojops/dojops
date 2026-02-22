/* global document, fetch, navigator, setTimeout, setInterval, clearInterval */

const API = "/api";

// ── Helpers ──────────────────────────────────────────────

async function apiCall(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function show(el) {
  el.classList.add("active");
}

function hide(el) {
  el.classList.remove("active");
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
    <button class="copy-btn" onclick="copyCode('${id}')" id="copy-${id}">
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
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $("panel-" + item.dataset.tab);
    if (panel) panel.classList.add("active");

    if (item.dataset.tab === "agents") loadAgents();
    if (item.dataset.tab === "history") loadHistory();
    if (item.dataset.tab === "overview") loadOverview();
    if (item.dataset.tab === "security") loadSecurity();
    if (item.dataset.tab === "audit") loadAudit();

    // Manage auto-refresh for metrics tabs
    updateAutoRefresh(item.dataset.tab);

    closeSidebar();
  });
});

// ── Temperature slider ───────────────────────────────────

$("gen-temp").addEventListener("input", (e) => {
  $("gen-temp-val").textContent = e.target.value;
});

// ── Generate ─────────────────────────────────────────────

$("gen-submit").addEventListener("click", async () => {
  const prompt = $("gen-prompt").value.trim();
  if (!prompt) {
    toast("warning", "Empty prompt", "Please enter a prompt before generating.");
    return;
  }

  const spinner = $("gen-spinner");
  const result = $("gen-result");
  const btn = $("gen-submit");

  btn.disabled = true;
  btn.classList.add("loading");
  result.innerHTML = "";
  show(spinner);

  toast("info", "Generating...", "Routing your prompt to a specialist agent.");

  try {
    const data = await apiCall("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        temperature: parseFloat($("gen-temp").value),
      }),
    });

    toast(
      "success",
      "Generation complete",
      `Routed to ${data.agent.name} (${(data.agent.confidence * 100).toFixed(0)}% confidence)`,
    );

    const cid = nextCopyId();
    result.innerHTML = `
      <div class="result-card">
        <div class="result-meta">
          <span class="chip chip--cyan">${escapeHtml(data.agent.name)}</span>
          <span class="chip chip--muted">${escapeHtml(data.agent.domain)}</span>
          <span style="color:var(--text-muted);font-size:12px;font-family:var(--font-mono)">
            ${(data.agent.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        ${wrapCodeBlock(`<pre>${escapeHtml(data.content)}</pre>`, data.content, cid)}
      </div>`;
  } catch (err) {
    toast("error", "Generation failed", err.message);
    result.innerHTML = `<div class="error-card"><pre>${escapeHtml(err.message)}</pre></div>`;
  } finally {
    hide(spinner);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

// ── Plan ─────────────────────────────────────────────────

$("plan-submit").addEventListener("click", async () => {
  const goal = $("plan-goal").value.trim();
  if (!goal) {
    toast("warning", "Empty goal", "Please enter a goal before decomposing.");
    return;
  }

  const spinner = $("plan-spinner");
  const result = $("plan-result");
  const btn = $("plan-submit");
  const isExecute = $("plan-execute").checked;

  btn.disabled = true;
  btn.classList.add("loading");
  result.innerHTML = "";
  show(spinner);

  toast(
    "info",
    isExecute ? "Planning & executing..." : "Decomposing...",
    `Breaking down: "${goal.slice(0, 60)}${goal.length > 60 ? "..." : ""}"`,
  );

  try {
    const data = await apiCall("/plan", {
      method: "POST",
      body: JSON.stringify({
        goal,
        execute: isExecute,
        autoApprove: $("plan-approve").checked,
      }),
    });

    const taskCount = data.graph.tasks.length;
    if (data.result) {
      const completed = data.result.results.filter((r) => r.status === "completed").length;
      const failed = data.result.results.filter((r) => r.status === "failed").length;
      toast(
        data.result.success ? "success" : "warning",
        "Execution complete",
        `${completed}/${taskCount} tasks completed${failed ? `, ${failed} failed` : ""}`,
      );
    } else {
      toast("success", "Plan ready", `Decomposed into ${taskCount} tasks.`);
    }

    result.innerHTML = renderTaskGraph(data.graph, data.result);
  } catch (err) {
    toast("error", "Plan failed", err.message);
    result.innerHTML = `<div class="error-card"><pre>${escapeHtml(err.message)}</pre></div>`;
  } finally {
    hide(spinner);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
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
        <button class="task-node__output-toggle" id="${toggleId}" onclick="toggleTaskOutput('${outputId}', '${toggleId}')">
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

// ── Debug CI ─────────────────────────────────────────────

$("ci-submit").addEventListener("click", async () => {
  const log = $("ci-log").value.trim();
  if (!log) {
    toast("warning", "Empty log", "Please paste CI/CD log output before diagnosing.");
    return;
  }

  const spinner = $("ci-spinner");
  const result = $("ci-result");
  const btn = $("ci-submit");

  btn.disabled = true;
  btn.classList.add("loading");
  result.innerHTML = "";
  show(spinner);

  toast("info", "Analyzing CI log...", "Looking for errors and root causes.");

  try {
    const data = await apiCall("/debug-ci", {
      method: "POST",
      body: JSON.stringify({ log }),
    });

    toast(
      "success",
      "Diagnosis complete",
      `${data.diagnosis.errorType}: ${data.diagnosis.summary.slice(0, 60)}`,
    );

    result.innerHTML = renderDiagnosis(data.diagnosis);
  } catch (err) {
    toast("error", "Diagnosis failed", err.message);
    result.innerHTML = `<div class="error-card"><pre>${escapeHtml(err.message)}</pre></div>`;
  } finally {
    hide(spinner);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

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
    <button class="copy-btn" onclick="copyCode('${diagCid}')" id="copy-${diagCid}" style="position:absolute;top:12px;right:12px;opacity:1">
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

// ── Infra Diff ───────────────────────────────────────────

$("diff-submit").addEventListener("click", async () => {
  const diff = $("diff-content").value.trim();
  if (!diff) {
    toast("warning", "Empty diff", "Please paste a diff or plan output before analyzing.");
    return;
  }

  const spinner = $("diff-spinner");
  const result = $("diff-result");
  const btn = $("diff-submit");

  btn.disabled = true;
  btn.classList.add("loading");
  result.innerHTML = "";
  show(spinner);

  const body = { diff };
  const before = $("diff-before").value.trim();
  const after = $("diff-after").value.trim();
  if (before && after) {
    body.before = before;
    body.after = after;
  }

  toast("info", "Analyzing diff...", "Checking risk, cost, and security impact.");

  try {
    const data = await apiCall("/diff", {
      method: "POST",
      body: JSON.stringify(body),
    });

    toast("success", "Analysis complete", `Risk level: ${data.analysis.riskLevel}`);

    result.innerHTML = renderAnalysis(data.analysis);
  } catch (err) {
    toast("error", "Analysis failed", err.message);
    result.innerHTML = `<div class="error-card"><pre>${escapeHtml(err.message)}</pre></div>`;
  } finally {
    hide(spinner);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

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
    <button class="copy-btn" onclick="copyCode('${diffCid}')" id="copy-${diffCid}" style="position:absolute;top:12px;right:12px;opacity:1">
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

async function loadAgents() {
  const grid = $("agents-grid");
  try {
    const data = await apiCall("/agents");
    grid.innerHTML = renderAgents(data.agents);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderAgents(agents) {
  if (!agents.length) {
    return `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <div>No agents available</div>
    </div>`;
  }

  return agents
    .map(
      (a, i) => `
    <div class="agent-card" style="animation-delay: ${i * 0.04}s">
      <h4>${escapeHtml(a.name)}</h4>
      <div class="agent-domain">${escapeHtml(a.domain)}</div>
      <div class="keywords">${a.keywords.map((k) => `<span class="kw">${escapeHtml(k)}</span>`).join("")}</div>
    </div>`,
    )
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
        <div class="history-row" onclick="toggleDetail('detail-${e.id}')">
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
    await apiCall("/history", { method: "DELETE" });
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
        "Start the server from a project directory with .oda/ to see metrics.",
      );
    } else {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + "</div>";
    }
  }
}

function renderOverview(data) {
  let html = '<div class="stat-grid">';

  html += renderStatCard(data.totalPlans, "Total Plans", "");
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
  html += renderStatCard(
    data.criticalFindings,
    "Critical Issues",
    data.criticalFindings > 0 ? "error" : "success",
  );
  html += "</div>";

  // Recent activity
  if (data.recentActivity.length > 0) {
    html += '<div class="metrics-section">';
    html += '<div class="metrics-section__title">Recent Activity</div>';
    html += '<div class="timeline-list">';
    for (const item of data.recentActivity.slice(0, 10)) {
      const statusChip =
        item.status === "success"
          ? '<span class="chip chip--success">ok</span>'
          : item.status === "failure"
            ? '<span class="chip chip--error">fail</span>'
            : '<span class="chip chip--muted">' + escapeHtml(item.status) + "</span>";
      html +=
        '<div class="timeline-entry">' +
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

  // Top issues table
  if (data.topIssues.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Top Issues</div>';
    html +=
      '<table class="metric-table"><thead><tr><th>Issue</th><th>Severity</th><th>Tool</th><th>Count</th></tr></thead><tbody>';
    for (var j = 0; j < data.topIssues.length; j++) {
      var issue = data.topIssues[j];
      var sevClass = "severity-" + issue.severity;
      html +=
        "<tr>" +
        '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
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
        "</td>" +
        "</tr>";
    }
    html += "</tbody></table></div>";
  }

  // Scan history
  if (data.scanHistory.length > 0) {
    html += '<div class="metrics-section glass-card">';
    html += '<div class="metrics-section__title">Scan History</div>';
    html +=
      '<table class="metric-table"><thead><tr><th>ID</th><th>Time</th><th>Total</th><th>Critical</th><th>High</th><th>Duration</th></tr></thead><tbody>';
    for (var k = 0; k < data.scanHistory.length; k++) {
      var scan = data.scanHistory[k];
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
        "</td>" +
        "</tr>";
    }
    html += "</tbody></table></div>";
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
        "Start using ODA commands to build an audit trail.",
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
      "Execute ODA commands to populate the audit trail.",
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

  // Timeline
  if (data.timeline.length > 0) {
    html += '<div class="metrics-section">';
    html += '<div class="metrics-section__title">Timeline</div>';
    html += '<div class="timeline-list">';
    var max = Math.min(data.timeline.length, 30);
    for (var j = 0; j < max; j++) {
      var entry = data.timeline[j];
      var statusChip =
        entry.status === "success"
          ? '<span class="chip chip--success">ok</span>'
          : entry.status === "failure"
            ? '<span class="chip chip--error">fail</span>'
            : '<span class="chip chip--muted">' + escapeHtml(entry.status) + "</span>";
      html +=
        '<div class="timeline-entry" style="animation-delay:' +
        j * 0.02 +
        's">' +
        '<span class="timeline-entry__time">' +
        escapeHtml(new Date(entry.timestamp).toLocaleString()) +
        "</span>" +
        '<span class="timeline-entry__cmd">' +
        escapeHtml(entry.command) +
        "</span>" +
        '<span class="timeline-entry__action">' +
        escapeHtml(entry.action) +
        "</span>" +
        statusChip +
        (entry.planId
          ? '<span class="chip chip--muted">' + escapeHtml(entry.planId) + "</span>"
          : "") +
        "</div>";
    }
    html += "</div></div>";
  }

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

async function init() {
  try {
    const health = await apiCall("/health");
    setProviderStatus(health.provider, true);
    toast("success", "Connected", `Provider: ${health.provider}`);
  } catch {
    setProviderStatus("offline", false);
    toast("error", "Connection failed", "Could not reach API. Is the server running?");
  }
}

init();
