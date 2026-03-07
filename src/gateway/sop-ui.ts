import type { IncomingMessage, ServerResponse } from "node:http";

export const SOP_UI_PATH = "/__openclaw__/sops";

export function handleSopUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== SOP_UI_PATH && url.pathname !== `${SOP_UI_PATH}/`) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(SOP_PAGE_HTML);
  return true;
}

const SOP_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenClaw SOP</title>
<style>
:root {
  --bg: #0f1115;
  --panel: #181b22;
  --panel-soft: #20242d;
  --border: #2d3442;
  --text: #eef2f7;
  --muted: #97a3b6;
  --accent: #55c36f;
  --danger: #e35d6a;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  background: linear-gradient(180deg, #101319 0%, #0a0d12 100%);
  color: var(--text);
  font: 14px/1.5 "Segoe UI", sans-serif;
}
.app { max-width: 980px; margin: 0 auto; }
.row { display: flex; gap: 8px; align-items: center; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.muted { color: var(--muted); }
.title { font-size: 24px; font-weight: 700; margin: 0 0 6px; }
.sub { color: var(--muted); margin: 0; }
.tabs { display: flex; gap: 6px; margin-top: 16px; }
.tab, .btn {
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
.tab.active, .btn.primary {
  background: rgba(85, 195, 111, 0.16);
  border-color: rgba(85, 195, 111, 0.45);
  color: #d9ffe2;
}
.btn:disabled { opacity: 0.5; cursor: default; }
input, textarea {
  width: 100%;
  background: #0f1319;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 10px;
}
textarea { min-height: 90px; resize: vertical; }
.list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.item {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
}
.item-head { display: flex; justify-content: space-between; gap: 12px; }
.item-name { font-weight: 700; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--muted);
  font-size: 12px;
}
.chip.danger {
  color: #ffd4da;
  border-color: rgba(227, 93, 106, 0.45);
  background: rgba(227, 93, 106, 0.12);
}
.day-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.day-option {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #0f1319;
}
.callout {
  margin-top: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
}
.callout.danger {
  border-color: rgba(227, 93, 106, 0.45);
  background: rgba(227, 93, 106, 0.1);
}
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
@media (max-width: 720px) {
  body { padding: 16px; }
  .item-head, .row { flex-direction: column; align-items: stretch; }
  .day-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
</head>
<body>
<div class="app stack">
  <section class="card">
    <div class="row" style="justify-content: space-between;">
      <div>
        <h1 class="title">SOP</h1>
        <p class="sub">Executable SOP workflows with weekly scheduling and self-healing.</p>
      </div>
      <div id="status" class="muted">Disconnected</div>
    </div>

    <div class="row" style="margin-top: 16px;">
      <input id="ws-url" placeholder="ws://127.0.0.1:18789" />
      <input id="ws-token" type="password" placeholder="Gateway token" style="max-width: 220px;" />
      <button id="connect-btn" class="btn primary" onclick="toggleConnect()">Connect</button>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="list" onclick="switchTab('list')">SOPs</button>
      <button class="tab" data-tab="status" onclick="switchTab('status')">Schedule</button>
      <button class="tab" data-tab="history" onclick="switchTab('history')">History</button>
    </div>
  </section>

  <section id="panel-list" class="card"></section>
  <section id="panel-status" class="card" style="display:none"></section>
  <section id="panel-history" class="card" style="display:none"></section>
</div>

<script>
let ws = null;
let rpcId = 0;
const pending = new Map();
const weekdays = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"],
];

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function toggleConnect() {
  if (ws && ws.readyState <= 1) {
    ws.close();
    return;
  }
  const url = document.getElementById("ws-url").value.trim() || "ws://127.0.0.1:18789";
  const token = document.getElementById("ws-token").value.trim();
  ws = new WebSocket(url);
  setStatus("Connecting...");

  ws.onopen = function () {
    const params = { role: "operator", client: "sop-ui" };
    if (token) params.token = token;
    ws.send(JSON.stringify({ method: "connect", id: "auth", params: params }));
  };

  ws.onmessage = function (event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id === "auth") {
        if (msg.ok === false) {
          setStatus("Auth failed");
          return;
        }
        setStatus("Connected");
        document.getElementById("connect-btn").textContent = "Disconnect";
        loadList();
        return;
      }
      const callback = pending.get(msg.id);
      if (callback) {
        pending.delete(msg.id);
        callback(msg);
      }
    } catch (error) {
      setStatus("Message parse error");
    }
  };

  ws.onclose = function () {
    setStatus("Disconnected");
    document.getElementById("connect-btn").textContent = "Connect";
  };
  ws.onerror = function () {
    setStatus("Connection error");
  };
}

function rpc(method, params) {
  return new Promise(function (resolve, reject) {
    if (!ws || ws.readyState !== 1) {
      reject(new Error("Not connected"));
      return;
    }
    const id = "rpc-" + (++rpcId);
    pending.set(id, function (msg) {
      if (msg.ok === false) {
        reject(new Error(msg.error && msg.error.message ? msg.error.message : "RPC failed"));
        return;
      }
      resolve(msg.payload);
    });
    ws.send(JSON.stringify({ method: method, id: id, params: params || {} }));
    setTimeout(function () {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Timeout"));
      }
    }, 30000);
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(function (node) {
    node.classList.toggle("active", node.dataset.tab === tab);
  });
  ["list", "status", "history"].forEach(function (name) {
    document.getElementById("panel-" + name).style.display = name === tab ? "" : "none";
  });
  if (tab === "list") loadList();
  if (tab === "status") loadStatus();
  if (tab === "history") renderHistoryQuery("");
}

function runTargetId(name) {
  return "run-" + cssId(name);
}

function renderSopItem(sop) {
  const chips = [];
  if (sop.scheduleLabel) chips.push('<span class="chip">Schedule: ' + escapeHtml(sop.scheduleLabel) + "</span>");
  if (sop.triggers && sop.triggers.length) chips.push('<span class="chip">Triggers: ' + escapeHtml(sop.triggers.join(", ")) + "</span>");
  if (sop.status === "validated") chips.push('<span class="chip">Ready</span>');
  if (sop.status === "draft") chips.push('<span class="chip">Validating</span>');
  if (sop.status === "repairing") chips.push('<span class="chip">Repairing</span>');
  if (sop.status === "failed") chips.push('<span class="chip danger">Needs attention</span>');
  if (sop.loadError) chips.push('<span class="chip danger">Load error</span>');

  return [
    '<div class="item">',
    '  <div class="item-head">',
    "    <div>",
    '      <div class="item-name">' + escapeHtml(sop.name) + "</div>",
    '      <div class="muted">' + escapeHtml(sop.description || "No description.") + "</div>",
    '      <div class="chips">' + chips.join("") + "</div>",
    "    </div>",
    '    <div class="row">',
    '      <button class="btn primary" onclick="runSOP(' + JSON.stringify(sop.name) + ')">Run</button>',
    '      <button class="btn" onclick="showHistory(' + JSON.stringify(sop.name) + ')">History</button>',
    "    </div>",
    "  </div>",
    '  <div id="' + runTargetId(sop.name) + '"></div>',
    "</div>",
  ].join("");
}

async function loadList() {
  const panel = document.getElementById("panel-list");
  panel.innerHTML = '<div class="muted">Loading SOPs...</div>';
  try {
    const data = await rpc("sop.list", {});
    const items = (data.sops || []).map(renderSopItem).join("");
    panel.innerHTML = [
      '<div class="row" style="justify-content: space-between;">',
      '  <div class="muted">' + escapeHtml(String(data.count || 0)) + " SOPs</div>",
      '  <button class="btn primary" onclick="renderCreateForm()">Capture SOP</button>',
      "</div>",
      '<div id="create-form"></div>',
      '<div class="list">' + (items || '<div class="muted">No SOPs found.</div>') + "</div>",
    ].join("");
  } catch (error) {
    panel.innerHTML = '<div class="callout danger">' + escapeHtml(error.message) + "</div>";
  }
}

async function runSOP(name) {
  const target = document.getElementById(runTargetId(name));
  target.innerHTML = '<div class="callout">Running...</div>';
  try {
    const result = await rpc("sop.run", { name: name });
    const lines = [
      '<div class="callout ' + (result.status === "ok" ? "" : "danger") + '">',
      "  <strong>" + escapeHtml(result.status) + "</strong>",
      '  <div class="muted">steps ' + escapeHtml(String(result.stepsCount || 0)) + ", logs " + escapeHtml(String(result.logsCount || 0)) + ", duration " + escapeHtml(String(result.durationMs || 0)) + "ms</div>",
    ];
    if (result.repairTriggered && result.repair) {
      lines.push('  <div class="muted">repair ' + escapeHtml(result.repair.healStrategy) + " #" + escapeHtml(String(result.repair.attempt)) + "</div>");
    }
    if (result.error) {
      lines.push('  <div class="muted">error ' + escapeHtml(result.error) + "</div>");
    }
    lines.push("</div>");
    target.innerHTML = lines.join("");
  } catch (error) {
    target.innerHTML = '<div class="callout danger">' + escapeHtml(error.message) + "</div>";
  }
}

async function loadStatus() {
  const panel = document.getElementById("panel-status");
  panel.innerHTML = '<div class="muted">Loading schedule status...</div>';
  try {
    const data = await rpc("sop.status", {});
    const scheduled = (data.scheduledSOPs || []).map(function (entry) {
      return [
        '<div class="item">',
        '  <div class="item-head">',
        "    <div>",
        '      <div class="item-name">' + escapeHtml(entry.name) + "</div>",
        '      <div class="muted">' + escapeHtml(entry.scheduleLabel) + "</div>",
        "    </div>",
        "  </div>",
        "</div>",
      ].join("");
    }).join("");
    const triggered = (data.triggeredSOPs || []).map(function (entry) {
      return [
        '<div class="item">',
        '  <div class="item-head">',
        "    <div>",
        '      <div class="item-name">' + escapeHtml(entry.name) + "</div>",
        '      <div class="muted">' + escapeHtml(entry.triggers.join(", ")) + "</div>",
        "    </div>",
        "  </div>",
        "</div>",
      ].join("");
    }).join("");

    panel.innerHTML = [
      '<div class="muted">Total SOPs: ' + escapeHtml(String(data.totalSOPs || 0)) + "</div>",
      '<div class="list">' + (scheduled || '<div class="muted">No weekly schedules.</div>') + "</div>",
      triggered ? '<div class="list">' + triggered + "</div>" : "",
    ].join("");
  } catch (error) {
    panel.innerHTML = '<div class="callout danger">' + escapeHtml(error.message) + "</div>";
  }
}

function renderHistoryQuery(name) {
  const panel = document.getElementById("panel-history");
  panel.innerHTML = [
    '<div class="row">',
    '  <input id="history-name" placeholder="SOP name" value="' + escapeAttr(name || "") + '" />',
    '  <button class="btn primary" onclick="loadHistory()">Load</button>',
    "</div>",
    '<div id="history-result"></div>',
  ].join("");
  if (name) {
    loadHistory();
  }
}

function showHistory(name) {
  switchTab("history");
  renderHistoryQuery(name);
}

async function loadHistory() {
  const name = document.getElementById("history-name").value.trim();
  const target = document.getElementById("history-result");
  if (!name) {
    target.innerHTML = '<div class="callout danger">SOP name is required.</div>';
    return;
  }

  target.innerHTML = '<div class="muted">Loading history...</div>';
  try {
    const data = await rpc("sop.history", { name: name });
    const rows = (data.runs || []).slice().reverse().map(function (run) {
      return [
        "<tr>",
        "  <td>" + escapeHtml((run.startedAt || "").replace("T", " ").slice(0, 19)) + "</td>",
        "  <td>" + escapeHtml(run.status) + "</td>",
        "  <td>" + escapeHtml(String(run.durationMs || 0)) + "ms</td>",
        "  <td>" + escapeHtml(String(run.stepsCount || 0)) + "</td>",
        "  <td>" + escapeHtml(String(run.logsCount || 0)) + "</td>",
        "  <td>" + escapeHtml(run.repair ? run.repair.healStrategy + " #" + run.repair.attempt : "-") + "</td>",
        "  <td>" + escapeHtml(run.error || "-") + "</td>",
        "</tr>",
      ].join("");
    }).join("");

    if (!rows) {
      target.innerHTML = '<div class="muted" style="margin-top: 12px;">No runs recorded.</div>';
      return;
    }

    target.innerHTML = [
      "<table>",
      "  <thead>",
      "    <tr>",
      "      <th>Time</th>",
      "      <th>Status</th>",
      "      <th>Duration</th>",
      "      <th>Steps</th>",
      "      <th>Logs</th>",
      "      <th>Repair</th>",
      "      <th>Error</th>",
      "    </tr>",
      "  </thead>",
      "  <tbody>",
      rows,
      "  </tbody>",
      "</table>",
    ].join("");
  } catch (error) {
    target.innerHTML = '<div class="callout danger">' + escapeHtml(error.message) + "</div>";
  }
}

function renderCreateForm() {
  const options = weekdays.map(function (pair) {
    return [
      '<label class="day-option">',
      '  <input type="checkbox" value="' + pair[0] + '" />',
      "  <span>" + pair[1] + "</span>",
      "</label>",
    ].join("");
  }).join("");

  document.getElementById("create-form").innerHTML = [
    '<div class="callout">',
    '  <div class="stack">',
    '    <input id="create-name" placeholder="SOP name" />',
    '    <input id="create-session-key" placeholder="Session key (for example agent:main:main)" />',
    '    <input id="create-run-id" placeholder="Run ID (optional)" />',
    '    <div class="day-grid">' + options + "</div>",
    '    <input id="create-time" placeholder="09:00" />',
    '    <div class="row">',
      '      <button class="btn primary" onclick="createSOP()">Capture</button>',
    '      <button class="btn" onclick="clearCreateForm()">Cancel</button>',
    "    </div>",
    "  </div>",
    "</div>",
  ].join("");
}

function clearCreateForm() {
  document.getElementById("create-form").innerHTML = "";
}

async function createSOP() {
  const name = document.getElementById("create-name").value.trim();
  const sessionKey = document.getElementById("create-session-key").value.trim();
  const runId = document.getElementById("create-run-id").value.trim();
  const scheduleTime = document.getElementById("create-time").value.trim();
  const scheduleDays = Array.from(document.querySelectorAll(".day-grid input:checked")).map(function (node) {
    return node.value;
  });

  if (!name || !sessionKey) {
    alert("Name and session key are required.");
    return;
  }

  try {
    await rpc("sop.createFromRun", {
      name: name,
      sessionKey: sessionKey,
      runId: runId || undefined,
      scheduleDays: scheduleDays.length ? scheduleDays : undefined,
      scheduleTime: scheduleTime || undefined,
    });
    clearCreateForm();
    loadList();
  } catch (error) {
    alert(error.message);
  }
}

function cssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value).split(String.fromCharCode(96)).join("&#96;");
}

(function init() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  document.getElementById("ws-url").value = proto + "//" + window.location.host;
})();
</script>
</body>
</html>`;
