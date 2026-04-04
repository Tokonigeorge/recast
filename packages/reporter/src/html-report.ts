import type { ClassifiedViolation, Patch } from "@recast-a11y/classifier";

interface ReportViolation {
  index: number;
  ruleId: string;
  impact: string;
  description: string;
  target: string;
  html: string;
  level: string;
  fixType: string;
  reasoning: string;
  confidence: number;
  diff: { file: string; line: number; original: string; fixed: string } | null;
}

export interface ReportData {
  target: string;
  timestamp: string;
  violations: ReportViolation[];
  summary: {
    total: number;
    auto: number;
    llm: number;
    skipped: number;
  };
}

export function buildReportData(
  target: string,
  high: ClassifiedViolation[],
  low: ClassifiedViolation[],
  skipped: ClassifiedViolation[],
  patches: Array<{ cv: ClassifiedViolation; patch: Patch }>,
): ReportData {
  const patchMap = new Map<string, Patch>();
  for (const { cv, patch } of patches) {
    patchMap.set(`${cv.violation.ruleId}::${cv.violation.target}`, patch);
  }

  let idx = 0;
  const mapViolation = (cv: ClassifiedViolation): ReportViolation => {
    const key = `${cv.violation.ruleId}::${cv.violation.target}`;
    const patch = patchMap.get(key);
    return {
      index: idx++,
      ruleId: cv.violation.ruleId,
      impact: cv.violation.impact,
      description: cv.violation.description,
      target: cv.violation.target,
      html: cv.violation.html.slice(0, 200),
      level: cv.level,
      fixType: cv.fix.type,
      reasoning: cv.fix.reasoning,
      confidence: cv.fix.confidence,
      diff: patch ? {
        file: patch.sourceRef.file,
        line: patch.sourceRef.line,
        original: patch.originalCode,
        fixed: patch.fixedCode,
      } : null,
    };
  };

  return {
    target,
    timestamp: new Date().toISOString(),
    violations: [...high.map(mapViolation), ...low.map(mapViolation), ...skipped.map(mapViolation)],
    summary: {
      total: high.length + low.length + skipped.length,
      auto: high.length,
      llm: low.length,
      skipped: skipped.length,
    },
  };
}

export function generateHtmlReport(data: ReportData): string {
  const dataJson = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recast Report — ${esc(data.target)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; padding-bottom: 80px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 20px; min-width: 120px; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-label { font-size: 12px; color: #8b949e; margin-top: 2px; }
  .stat-auto .stat-value { color: #3fb950; }
  .stat-llm .stat-value { color: #d29922; }
  .stat-skip .stat-value { color: #8b949e; }
  .controls { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
  .controls label { font-size: 13px; color: #8b949e; }
  .controls select, .controls input { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 10px; border-radius: 6px; font-size: 13px; }
  .btn { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .btn:hover { background: #2ea043; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-outline { background: transparent; border: 1px solid #30363d; color: #c9d1d9; }
  .btn-outline:hover { border-color: #8b949e; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; font-size: 12px; color: #8b949e; border-bottom: 1px solid #30363d; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; font-size: 13px; vertical-align: top; }
  tr:hover { background: #161b22; }
  tr.selected { background: #1a2233; }
  tr.row-skip { opacity: 0.5; }
  .impact { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .impact-critical { background: #da3633; color: #fff; }
  .impact-serious { background: #d29922; color: #000; }
  .impact-moderate { background: #1f6feb; color: #fff; }
  .impact-minor { background: #30363d; color: #8b949e; }
  .fix-badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; }
  .fix-auto { background: #1a3a2a; color: #3fb950; }
  .fix-llm { background: #3a2a1a; color: #d29922; }
  .fix-skip { background: #21262d; color: #8b949e; }
  .diff-row { display: none; }
  .diff-row.open { display: table-row; }
  .diff-row td { padding: 0; }
  .diff-block { background: #161b22; padding: 12px 16px; font-family: "SF Mono", Consolas, monospace; font-size: 12px; line-height: 1.6; border-left: 3px solid #30363d; margin: 4px 12px 12px; border-radius: 4px; overflow-x: auto; max-width: 100%; }
  .diff-del { color: #f85149; white-space: pre-wrap; word-break: break-all; }
  .diff-add { color: #3fb950; white-space: pre-wrap; word-break: break-all; }
  .diff-meta { color: #8b949e; margin-bottom: 4px; }
  .check { width: 16px; height: 16px; accent-color: #238636; cursor: pointer; }
  .check:disabled { opacity: 0.3; cursor: not-allowed; }
  .reasoning { color: #8b949e; font-size: 12px; margin-top: 2px; }
  .select-all { margin-right: 8px; }
  .status-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #161b22; border-top: 1px solid #30363d; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 10; }
  .status-bar .count { font-size: 14px; }
  #toast { position: fixed; bottom: 60px; right: 24px; background: #238636; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; display: none; z-index: 20; }
  #toast.show { display: block; animation: fadeout 0.5s 2s forwards; }
  @keyframes fadeout { to { opacity: 0; } }
  .color-hint { font-size: 11px; margin-top: 4px; color: #8b949e; }
  .color-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; border: 1px solid #444; vertical-align: middle; margin: 0 3px; }
</style>
</head>
<body>
<h1>recast</h1>
<p class="subtitle">${esc(data.target)} — ${data.timestamp.split("T")[0]}</p>

<div class="summary">
  <div class="stat"><div class="stat-value">${data.summary.total}</div><div class="stat-label">violations</div></div>
  <div class="stat stat-auto"><div class="stat-value">${data.summary.auto}</div><div class="stat-label">auto-fixable</div></div>
  <div class="stat stat-llm"><div class="stat-value">${data.summary.llm}</div><div class="stat-label">need LLM</div></div>
  <div class="stat stat-skip"><div class="stat-value">${data.summary.skipped}</div><div class="stat-label">skipped</div></div>
</div>

<div class="controls">
  <label>Filter:</label>
  <select id="filterImpact">
    <option value="">All impacts</option>
    <option value="critical">Critical</option>
    <option value="serious">Serious</option>
    <option value="moderate">Moderate</option>
    <option value="minor">Minor</option>
  </select>
  <select id="filterLevel">
    <option value="">All types</option>
    <option value="high">Auto-fixable</option>
    <option value="low">Needs LLM</option>
    <option value="skip">Skipped</option>
  </select>
  <input id="filterSearch" placeholder="Search rules..." style="width:180px">
</div>

<table>
<thead>
<tr>
  <th><input type="checkbox" class="check select-all" checked></th>
  <th>#</th>
  <th>Rule</th>
  <th>Impact</th>
  <th>Fix</th>
  <th>Element</th>
</tr>
</thead>
<tbody id="violations"></tbody>
</table>

<div class="status-bar">
  <span class="count"><strong id="selectedCount">0</strong> selected</span>
  <div style="display:flex;gap:8px">
    <button class="btn btn-outline" id="expandBtn" onclick="toggleExpandAll()">Expand all diffs</button>
    <button class="btn" id="fixBtn" onclick="fixSelected()">Fix selected</button>
  </div>
</div>

<div id="toast"></div>

<script>
const DATA = ${dataJson};
const violations = DATA.violations;
const tbody = document.getElementById("violations");
let ws = null;
let allExpanded = false;

function render(filter) {
  tbody.innerHTML = "";
  const filtered = violations.filter(v => {
    if (filter?.impact && v.impact !== filter.impact) return false;
    if (filter?.level && v.level !== filter.level) return false;
    if (filter?.search && !v.ruleId.includes(filter.search)) return false;
    return true;
  });

  filtered.forEach((v) => {
    const hasDiff = v.diff !== null;
    const hasElement = v.html && v.html.length > 0;
    const expandable = hasDiff || hasElement;
    const isSkip = v.level === "skip";
    const tr = document.createElement("tr");
    tr.dataset.index = v.index;
    tr.className = isSkip ? "row-skip" : "selected";

    tr.innerHTML =
      '<td><input type="checkbox" class="check row-check" data-index="' + v.index + '"' +
        (isSkip ? ' disabled' : ' checked') + '></td>' +
      '<td style="color:#8b949e">' + (v.index + 1) + '</td>' +
      '<td><strong>' + esc(v.ruleId) + '</strong><div class="reasoning">' + esc(v.description || v.reasoning) + '</div></td>' +
      '<td><span class="impact impact-' + v.impact + '">' + v.impact + '</span></td>' +
      '<td><span class="fix-badge fix-' + v.level + '">' + (v.level === "high" ? "auto" : v.level === "low" ? "LLM" : "skip") + '</span></td>' +
      '<td style="font-family:monospace;font-size:12px;color:#8b949e;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:' +
        (expandable ? 'pointer" onclick="toggleDiff(' + v.index + ')"' : 'default"') + '>' + esc(v.target) + '</td>';
    tbody.appendChild(tr);

    if (expandable) {
      const detailTr = document.createElement("tr");
      detailTr.className = "diff-row" + (allExpanded ? " open" : "");
      detailTr.id = "diff-" + v.index;

      if (hasDiff) {
        detailTr.innerHTML = '<td colspan="6"><div class="diff-block">' +
          '<div class="diff-meta">' + esc(v.diff.file) + ':' + v.diff.line + '</div>' +
          '<div class="diff-del">- ' + esc(v.diff.original.trim()) + '</div>' +
          '<div class="diff-add">+ ' + esc(v.diff.fixed.trim()) + '</div>' +
          '</div></td>';
      } else {
        detailTr.innerHTML = '<td colspan="6"><div class="diff-block">' +
          '<div class="diff-meta">Element HTML</div>' +
          '<div style="color:#c9d1d9">' + esc(v.html) + '</div>' +
          (v.level === "low" ? '<div style="color:#d29922;margin-top:8px">Needs LLM to generate fix — choose "Fix all" from the CLI</div>' : '') +
          '</div></td>';
      }
      tbody.appendChild(detailTr);
    }
  });

  updateCount();
}

function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function toggleDiff(idx) {
  const row = document.getElementById("diff-" + idx);
  if (row) row.classList.toggle("open");
}

function toggleExpandAll() {
  allExpanded = !allExpanded;
  const btn = document.getElementById("expandBtn");
  if (allExpanded) {
    document.querySelectorAll(".diff-row").forEach(r => r.classList.add("open"));
    btn.textContent = "Collapse all diffs";
  } else {
    document.querySelectorAll(".diff-row").forEach(r => r.classList.remove("open"));
    btn.textContent = "Expand all diffs";
  }
}

function updateCount() {
  const checked = document.querySelectorAll(".row-check:checked").length;
  document.getElementById("selectedCount").textContent = checked;
  document.getElementById("fixBtn").disabled = checked === 0;
}

document.querySelector(".select-all").addEventListener("change", (e) => {
  document.querySelectorAll(".row-check:not(:disabled)").forEach(cb => { cb.checked = e.target.checked; });
  updateCount();
});

tbody.addEventListener("change", updateCount);

document.getElementById("filterImpact").addEventListener("change", applyFilters);
document.getElementById("filterLevel").addEventListener("change", applyFilters);
document.getElementById("filterSearch").addEventListener("input", applyFilters);

function applyFilters() {
  render({
    impact: document.getElementById("filterImpact").value,
    level: document.getElementById("filterLevel").value,
    search: document.getElementById("filterSearch").value,
  });
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show";
  setTimeout(() => t.className = "", 2500);
}

function fixSelected() {
  const indices = [...document.querySelectorAll(".row-check:checked")].map(cb => parseInt(cb.dataset.index));
  if (indices.length === 0) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "fix", indices }));
    toast("Applying " + indices.length + " fixes...");
  } else {
    toast("Not connected to recast CLI — copy the diff and apply manually");
  }
}

// Connect to CLI websocket
try {
  const port = new URLSearchParams(location.search).get("ws") || location.port;
  ws = new WebSocket("ws://localhost:" + port);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "fixed") {
      toast("Applied " + msg.count + " fixes!");
      msg.indices.forEach(i => {
        const row = tbody.querySelector('[data-index="' + i + '"]');
        if (row) { row.style.opacity = "0.4"; row.querySelector(".row-check").checked = false; row.querySelector(".row-check").disabled = true; }
      });
      updateCount();
    }
  };
} catch {}

render();
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
