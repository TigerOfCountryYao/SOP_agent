/**
 * SOP 管理页面 HTTP 路由
 *
 * 在 /__openclaw__/sops/ 路径提供 SOP 管理界面。
 * 界面通过 WebSocket 连接 Gateway 的 sop.* RPC 方法获取数据。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export const SOP_UI_PATH = "/__openclaw__/sops";

export function handleSopUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname !== SOP_UI_PATH && pathname !== `${SOP_UI_PATH}/`) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(SOP_PAGE_HTML);
  return true;
}

// ---------------------------------------------------------------------------
// Inline HTML — 单文件 SOP 管理页面
// ---------------------------------------------------------------------------

const SOP_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>OpenClaw · SOP 管理</title>
<style>
:root {
  --bg: #0a0a0f;
  --surface: rgba(255,255,255,0.04);
  --surface-hover: rgba(255,255,255,0.08);
  --border: rgba(255,255,255,0.08);
  --text: #e4e4e7;
  --text-dim: rgba(228,228,231,0.55);
  --accent: #6366f1;
  --accent-dim: rgba(99,102,241,0.15);
  --success: #22c55e;
  --error: #ef4444;
  --warn: #f59e0b;
  --radius: 12px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); }

/* Layout */
.app { max-width: 960px; margin: 0 auto; padding: 24px 20px; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.2px; }
.header .badge { background: var(--accent-dim); color: var(--accent); padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.header .status { margin-left: auto; font-size: 12px; color: var(--text-dim); }
.header .status.ok::before { content: "●"; color: var(--success); margin-right: 4px; }
.header .status.err::before { content: "●"; color: var(--error); margin-right: 4px; }

/* Connection */
.conn-bar { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.conn-bar input { flex: 1; background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; color: var(--text); font: 12px var(--mono); outline: none; }
.conn-bar input:focus { border-color: var(--accent); }
.conn-bar button { background: var(--accent); color: #fff; border: none; padding: 6px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 12px; }
.conn-bar button:hover { opacity: 0.9; }
.conn-bar button:disabled { opacity: 0.4; cursor: not-allowed; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.tab { background: transparent; border: none; color: var(--text-dim); padding: 6px 14px; border-radius: 8px; cursor: pointer; font: 13px/1 var(--font); font-weight: 500; }
.tab:hover { background: var(--surface-hover); color: var(--text); }
.tab.active { background: var(--accent-dim); color: var(--accent); }

/* Cards */
.cards { display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; transition: border-color 0.15s; cursor: default; }
.card:hover { border-color: rgba(255,255,255,0.15); }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.card-header .name { font-weight: 600; font-size: 14px; }
.card-header .version { color: var(--text-dim); font-size: 11px; }
.card-desc { color: var(--text-dim); font-size: 13px; margin-bottom: 8px; }
.card-meta { display: flex; gap: 12px; font-size: 11px; font-family: var(--mono); }
.card-meta span { color: var(--text-dim); }
.card-meta .schedule { color: var(--accent); }
.card-meta .trigger { color:var(--warn); }
.card-actions { margin-top: 10px; display: flex; gap: 6px; }
.btn-sm { background: var(--surface-hover); border: 1px solid var(--border); color: var(--text); padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-weight: 500; }
.btn-sm:hover { background: rgba(255,255,255,0.12); }
.btn-sm.primary { background: var(--accent-dim); border-color: rgba(99,102,241,0.3); color: var(--accent); }
.btn-sm.primary:hover { background: rgba(99,102,241,0.25); }
.btn-sm.danger { color: var(--error); }

/* Status badges */
.status-ok { color: var(--success); }
.status-err { color: var(--error); }
.status-running { color: var(--accent); }

/* History */
.history-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: var(--mono); }
.history-table th { text-align: left; color: var(--text-dim); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.history-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); }

/* Empty */
.empty { text-align: center; padding: 40px; color: var(--text-dim); }
.empty .icon { font-size: 32px; margin-bottom: 8px; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #16161d; border: 1px solid var(--border); border-radius: 16px; padding: 20px; width: min(480px, 90vw); }
.modal h2 { font-size: 16px; margin-bottom: 14px; }
.modal label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; margin-top: 10px; }
.modal input, .modal textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; color: var(--text); font: 13px var(--font); outline: none; }
.modal textarea { min-height: 60px; resize: vertical; }
.modal input:focus, .modal textarea:focus { border-color: var(--accent); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

/* Log */
.log-box { background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; font: 12px/1.5 var(--mono); white-space: pre-wrap; max-height: 300px; overflow-y: auto; margin-top: 8px; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>🦞 SOP 管理</h1>
    <span class="badge">Standard Operating Procedures</span>
    <span id="ws-status" class="status">未连接</span>
  </div>

  <div class="conn-bar">
    <input id="ws-url" placeholder="ws://127.0.0.1:18789"/>
    <input id="ws-token" type="password" placeholder="Gateway Token" style="max-width:180px"/>
    <button id="btn-connect" onclick="toggleConnect()">连接</button>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="list" onclick="switchTab('list')">SOP 列表</button>
    <button class="tab" data-tab="status" onclick="switchTab('status')">调度状态</button>
    <button class="tab" data-tab="history" onclick="switchTab('history')">运行历史</button>
  </div>

  <div id="panel-list" class="cards"></div>
  <div id="panel-status" class="cards" style="display:none"></div>
  <div id="panel-history" style="display:none"></div>
  <div id="modal-root"></div>
</div>

<script>
let ws = null;
let rpcId = 0;
const pending = new Map();

// --- WebSocket ---
function toggleConnect() {
  if (ws && ws.readyState <= 1) { ws.close(); return; }
  const url = document.getElementById('ws-url').value.trim() || 'ws://127.0.0.1:18789';
  const token = document.getElementById('ws-token').value.trim();
  ws = new WebSocket(url);
  setStatus('connecting');

  ws.onopen = () => {
    const auth = { role: 'operator', client: 'sop-ui' };
    if (token) auth.token = token;
    ws.send(JSON.stringify({ method: 'connect', id: 'auth', params: auth }));
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.id === 'auth') {
        if (msg.ok === false) { setStatus('error', msg.error?.message || 'Auth failed'); return; }
        setStatus('ok');
        document.getElementById('btn-connect').textContent = '断开';
        loadSOPs();
        return;
      }
      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
    } catch {}
  };
  ws.onclose = () => { setStatus('disconnected'); document.getElementById('btn-connect').textContent = '连接'; };
  ws.onerror = () => setStatus('error', 'Connection failed');
}

function setStatus(st, msg) {
  const el = document.getElementById('ws-status');
  el.className = 'status ' + (st === 'ok' ? 'ok' : st === 'error' ? 'err' : '');
  el.textContent = st === 'ok' ? '已连接' : st === 'connecting' ? '连接中...' : st === 'error' ? (msg || '错误') : '未连接';
}

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) { reject(new Error('Not connected')); return; }
    const id = 'rpc-' + (++rpcId);
    pending.set(id, (msg) => msg.ok === false ? reject(new Error(msg.error?.message || 'RPC failed')) : resolve(msg.payload));
    ws.send(JSON.stringify({ method, id, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Timeout')); } }, 30000);
  });
}

// --- Tabs ---
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['list','status','history'].forEach(t => {
    const el = document.getElementById('panel-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'list') loadSOPs();
  else if (tab === 'status') loadStatus();
  else if (tab === 'history') loadHistory();
}

// --- SOP List ---
async function loadSOPs() {
  const panel = document.getElementById('panel-list');
  try {
    const data = await rpc('sop.list');
    if (!data.sops || data.sops.length === 0) {
      panel.innerHTML = '<div class="empty"><div class="icon">📋</div>暂无 SOP<br><button class="btn-sm primary" style="margin-top:12px" onclick="showCreateModal()">创建第一个 SOP</button></div>';
      return;
    }
    panel.innerHTML = data.sops.map(s => \`
      <div class="card">
        <div class="card-header">
          <span class="name">\${esc(s.name)}</span>
          \${s.version ? '<span class="version">v' + esc(s.version) + '</span>' : ''}
          \${s.loadError ? '<span class="status-err">⚠ 加载失败</span>' : ''}
        </div>
        <div class="card-desc">\${esc(s.description || '无描述')}</div>
        <div class="card-meta">
          \${s.schedule ? '<span class="schedule">⏱ ' + esc(s.schedule) + '</span>' : ''}
          \${s.triggers?.length ? '<span class="trigger">⚡ ' + s.triggers.map(esc).join(', ') + '</span>' : ''}
        </div>
        <div class="card-actions">
          <button class="btn-sm primary" onclick="runSOP('\${esc(s.name)}')">▶ 执行</button>
          <button class="btn-sm" onclick="showHistory('\${esc(s.name)}')">📊 历史</button>
        </div>
      </div>
    \`).join('') + '<div style="margin-top:12px"><button class="btn-sm primary" onclick="showCreateModal()">+ 创建 SOP</button></div>';
  } catch (e) {
    panel.innerHTML = '<div class="empty"><div class="icon">⚠️</div>' + esc(e.message) + '</div>';
  }
}

// --- Run SOP ---
async function runSOP(name) {
  const panel = document.getElementById('panel-list');
  const logId = 'run-log-' + Date.now();
  panel.insertAdjacentHTML('beforeend', '<div id="' + logId + '" class="log-box">正在执行 ' + esc(name) + '...</div>');
  try {
    const r = await rpc('sop.run', { name });
    const log = document.getElementById(logId);
    if (log) {
      const cls = r.status === 'ok' ? 'status-ok' : 'status-err';
      log.innerHTML = '<span class="' + cls + '">[' + r.status + ']</span> ' + esc(name) +
        '\\n  运行ID: ' + (r.runId || '-') +
        '\\n  步骤: ' + (r.stepsCount ?? 0) +
        '\\n  耗时: ' + (r.durationMs ?? 0) + 'ms' +
        (r.error ? '\\n  错误: ' + esc(r.error) : '') +
        (r.result ? '\\n  结果: ' + esc(JSON.stringify(r.result)) : '');
    }
  } catch (e) {
    const log = document.getElementById(logId);
    if (log) log.innerHTML = '<span class="status-err">执行失败:</span> ' + esc(e.message);
  }
}

// --- Status ---
async function loadStatus() {
  const panel = document.getElementById('panel-status');
  try {
    const data = await rpc('sop.status');
    let html = '<div class="card"><div class="card-header"><span class="name">SOP 总览</span></div>';
    html += '<div class="card-meta"><span>总计: ' + (data.totalSOPs ?? 0) + ' 个</span>';
    html += '<span class="schedule">定时: ' + (data.scheduledSOPs?.length ?? 0) + ' 个</span>';
    html += '<span class="trigger">触发: ' + (data.triggeredSOPs?.length ?? 0) + ' 个</span></div></div>';
    if (data.scheduledSOPs?.length > 0) {
      html += '<div class="card"><div class="card-header"><span class="name">⏱ 定时 SOP</span></div>';
      html += data.scheduledSOPs.map(s => '<div class="card-meta" style="margin-top:4px"><span class="name">' + esc(s.name) + '</span> <span class="schedule">' + esc(s.schedule) + '</span></div>').join('');
      html += '</div>';
    }
    if (data.triggeredSOPs?.length > 0) {
      html += '<div class="card"><div class="card-header"><span class="name">⚡ 事件触发 SOP</span></div>';
      html += data.triggeredSOPs.map(s => '<div class="card-meta" style="margin-top:4px"><span class="name">' + esc(s.name) + '</span> <span class="trigger">' + s.triggers.map(esc).join(', ') + '</span></div>').join('');
      html += '</div>';
    }
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
  }
}

// --- History ---
async function loadHistory() {
  const panel = document.getElementById('panel-history');
  panel.innerHTML = '<div class="card"><label>SOP 名称</label><div style="display:flex;gap:8px;margin-top:4px"><input id="hist-name" placeholder="example"/><button class="btn-sm primary" onclick="fetchHistory()">查询</button></div></div>';
}

async function showHistory(name) {
  switchTab('history');
  setTimeout(() => { document.getElementById('hist-name').value = name; fetchHistory(); }, 50);
}

async function fetchHistory() {
  const name = document.getElementById('hist-name').value.trim();
  if (!name) return;
  const panel = document.getElementById('panel-history');
  try {
    const data = await rpc('sop.history', { name });
    let html = '<div class="card"><div class="card-header"><span class="name">' + esc(name) + '</span><span class="version">共 ' + (data.totalRuns ?? 0) + ' 次运行</span></div>';
    if (data.runs?.length > 0) {
      html += '<table class="history-table"><tr><th>时间</th><th>状态</th><th>耗时</th><th>步骤</th><th>错误</th></tr>';
      html += data.runs.reverse().map(r => '<tr><td>' + esc(r.startedAt?.replace('T', ' ').slice(0, 19) || '-') + '</td><td class="' + (r.status === 'ok' ? 'status-ok' : 'status-err') + '">' + esc(r.status) + '</td><td>' + (r.durationMs ?? 0) + 'ms</td><td>' + (r.stepsCount ?? 0) + '</td><td>' + esc(r.error || '-') + '</td></tr>').join('');
      html += '</table>';
    } else {
      html += '<div class="empty" style="padding:16px">暂无运行记录</div>';
    }
    html += '</div>';
    panel.innerHTML = '<div class="card"><label>SOP 名称</label><div style="display:flex;gap:8px;margin-top:4px"><input id="hist-name" value="' + esc(name) + '"/><button class="btn-sm primary" onclick="fetchHistory()">查询</button></div></div>' + html;
  } catch (e) {
    panel.insertAdjacentHTML('beforeend', '<div class="empty">' + esc(e.message) + '</div>');
  }
}

// --- Create Modal ---
function showCreateModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = \`
  <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>创建新 SOP</h2>
      <label>名称 *</label><input id="cr-name" placeholder="my-sop"/>
      <label>描述 *</label><textarea id="cr-desc" placeholder="这个 SOP 做什么..."></textarea>
      <label>执行步骤 (每行一步)</label><textarea id="cr-steps" placeholder="打开浏览器\\n导航到目标页面\\n截图保存"></textarea>
      <label>Cron 表达式 (可选)</label><input id="cr-schedule" placeholder="0 9 * * *"/>
      <div class="modal-actions">
        <button class="btn-sm" onclick="closeModal()">取消</button>
        <button class="btn-sm primary" onclick="doCreate()">创建</button>
      </div>
    </div>
  </div>\`;
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

async function doCreate() {
  const name = document.getElementById('cr-name').value.trim();
  const desc = document.getElementById('cr-desc').value.trim();
  const stepsRaw = document.getElementById('cr-steps').value.trim();
  const schedule = document.getElementById('cr-schedule').value.trim() || undefined;
  if (!name || !desc) { alert('名称和描述必填'); return; }
  const steps = stepsRaw ? stepsRaw.split('\\n').map(s => s.trim()).filter(Boolean) : [];
  try {
    await rpc('sop.create', { name, description: desc, steps, schedule });
    closeModal();
    loadSOPs();
  } catch (e) { alert('创建失败: ' + e.message); }
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

// Auto-detect gateway URL
(function() {
  const loc = window.location;
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  document.getElementById('ws-url').value = wsProto + '//' + loc.host;
})();
</script>
</body>
</html>`;
