// ShipCheck interactive demo — runs the REAL scoring engine (engine.js is a
// byte-copy of src/engine.js; see scripts/sync-demo.mjs) on sample data.
import { computeReadiness, generateReleaseNotes, summarizeReadiness } from "./engine.js";

const STATUSES = ["To Do", "In Progress", "Done"];
const OWNERS = { "AUR-1": "Ayu", "AUR-2": "Ben", "AUR-3": "Citra", "AUR-4": "Dewi", "AUR-5": "Eka", "AUR-6": "Farhan", "AUR-7": "Gita", "AUR-8": "Hadi", "NEB-1": "Ayu", "NEB-2": "Ben", "NEB-3": "Citra", "NEB-4": "Dewi" };

const SCENARIOS = {
  "at-risk": {
    label: "Aurora 2.4 — at risk (58)",
    version: { name: "2.4", projectKey: "AUR", releaseDate: "2026-12-20" },
    issues: [
      { key: "AUR-1", summary: "Single sign-on via Atlassian account", status: "Done", type: "Story", priority: "High", assignee: { displayName: "Ayu" }, labels: [] },
      { key: "AUR-2", summary: "Fix login crash on expired sessions", status: "Done", type: "Bug", priority: "High", assignee: { displayName: "Ben" }, labels: [] },
      { key: "AUR-3", summary: "Database migration to Postgres 16", status: "In Progress", type: "Task", priority: "Highest", assignee: { displayName: "Citra" }, labels: ["blocker"] },
      { key: "AUR-4", summary: "Dark mode for the dashboard", status: "To Do", type: "Story", priority: "Medium", assignee: { displayName: "Dewi" }, labels: [] },
      { key: "AUR-5", summary: "Export audit log as CSV", status: "In Progress", type: "Story", priority: "Medium", assignee: { displayName: "Eka" }, labels: [] },
      { key: "AUR-6", summary: "Rate-limit the public API", status: "Done", type: "Task", priority: "Medium", assignee: { displayName: "Farhan" }, labels: [] },
    ],
    pullRequests: [
      { issueKey: "AUR-1", title: "SSO via Atlassian account", state: "MERGED", approved: true, checks: "PASS" },
      { issueKey: "AUR-2", title: "Fix login crash", state: "MERGED", approved: true, checks: "PASS" },
      { issueKey: "AUR-3", title: "Postgres 16 migration", state: "OPEN", approved: false, checks: "FAIL" },
      { issueKey: "AUR-5", title: "CSV audit export", state: "OPEN", approved: true, checks: "PASS" },
      { issueKey: "AUR-6", title: "API rate limiting", state: "MERGED", approved: true, checks: "PASS" },
    ],
    docs: { releaseNotesPage: false, runbookLinked: true },
  },
  "ready": {
    label: "Aurora 2.4 — ready to ship (100)",
    version: { name: "2.4", projectKey: "AUR", releaseDate: "2026-12-20" },
    issues: [
      { key: "AUR-1", summary: "Single sign-on via Atlassian account", status: "Done", type: "Story", priority: "High", assignee: { displayName: "Ayu" }, labels: [] },
      { key: "AUR-2", summary: "Fix login crash on expired sessions", status: "Done", type: "Bug", priority: "High", assignee: { displayName: "Ben" }, labels: [] },
      { key: "AUR-3", summary: "Database migration to Postgres 16", status: "Done", type: "Task", priority: "Highest", assignee: { displayName: "Citra" }, labels: [] },
      { key: "AUR-4", summary: "Dark mode for the dashboard", status: "Done", type: "Story", priority: "Medium", assignee: { displayName: "Dewi" }, labels: [] },
      { key: "AUR-5", summary: "Export audit log as CSV", status: "Done", type: "Story", priority: "Medium", assignee: { displayName: "Eka" }, labels: [] },
      { key: "AUR-6", summary: "Rate-limit the public API", status: "Done", type: "Task", priority: "Medium", assignee: { displayName: "Farhan" }, labels: [] },
      { key: "AUR-7", summary: "Fix timezone display in reports", status: "Done", type: "Bug", priority: "Low", assignee: { displayName: "Gita" }, labels: [] },
      { key: "AUR-8", summary: "Accessibility pass on settings", status: "Done", type: "Task", priority: "Medium", assignee: { displayName: "Hadi" }, labels: [] },
    ],
    pullRequests: ["AUR-1", "AUR-2", "AUR-3", "AUR-4", "AUR-5", "AUR-6", "AUR-7", "AUR-8"].map((k) => ({
      issueKey: k, title: `PR for ${k}`, state: "MERGED", approved: true, checks: "PASS",
    })),
    docs: { releaseNotesPage: true, runbookLinked: true },
  },
  "first-release": {
    label: "Nebula 1.0 — first release, on hold",
    version: { name: "1.0", projectKey: "NEB", releaseDate: "2027-01-15" },
    issues: [
      { key: "NEB-1", summary: "Onboarding wizard", status: "In Progress", type: "Story", priority: "High", assignee: { displayName: "Ayu" }, labels: [] },
      { key: "NEB-2", summary: "Billing integration", status: "To Do", type: "Story", priority: "Highest", assignee: { displayName: "Ben" }, labels: ["blocker"] },
      { key: "NEB-3", summary: "Data loss on retry after timeout", status: "To Do", type: "Bug", priority: "High", assignee: { displayName: "Citra" }, labels: [] },
      { key: "NEB-4", summary: "Landing page", status: "Done", type: "Task", priority: "Low", assignee: { displayName: "Dewi" }, labels: [] },
    ],
    pullRequests: [
      { issueKey: "NEB-1", title: "Onboarding wizard", state: "OPEN", approved: false, checks: null },
      { issueKey: "NEB-4", title: "Landing page", state: "MERGED", approved: true, checks: "PASS" },
    ],
    docs: { releaseNotesPage: false, runbookLinked: false },
  },
};

let state = structuredClone(SCENARIOS["at-risk"]);
let currentScenario = "at-risk";
let readiness = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function recompute() {
  readiness = computeReadiness(state);
  renderAll();
}

function renderGauge() {
  const arc = $("gauge-arc");
  const len = 251.3; // semicircle r=80
  const frac = readiness.score / 100;
  arc.style.strokeDasharray = String(len);
  arc.style.strokeDashoffset = String(len * (1 - frac));
  const color = readiness.verdict === "SHIP" ? "#22c55e" : readiness.verdict === "CAUTION" ? "#f59e0b" : "#ef4444";
  arc.style.stroke = color;
  $("gauge-score").textContent = readiness.score;
  const v = $("verdict");
  v.textContent =
    readiness.verdict === "SHIP" ? "SHIP — ready to release"
    : readiness.verdict === "CAUTION" ? "CAUTION — handle the items below first"
    : "HOLD — do not ship yet";
  v.className = "verdict " + readiness.verdict.toLowerCase();
  $("summary").textContent = summarizeReadiness(readiness);

  const b = readiness.breakdown;
  const rows = [
    ["Completion", b.completion],
    ["Blockers", b.blockers],
    ["Code review", b.review],
    ["Quality gates", b.quality],
    ["Docs", b.docs],
  ];
  $("breakdown").innerHTML = rows.map(([label, x]) => `
    <div class="row">
      <strong>${label}</strong>
      <div class="bar"><div class="fill" style="width:${Math.round((x.score / x.max) * 100)}%"></div></div>
      <span>${x.score}/${x.max}</span>
      <span class="detail">${esc(x.detail)}</span>
    </div>`).join("");
}

function renderBlockers() {
  const box = $("blockers");
  if (readiness.blockers.length === 0 && readiness.risks.length === 0) {
    box.innerHTML = `<p class="empty">No blockers or risks. Ship it. 🚀</p>`;
  } else {
    box.innerHTML = readiness.blockers.length === 0
      ? `<p class="empty">No hard blockers.</p>`
      : `<table><tr><th>Item</th><th>Type</th><th>Owner</th><th>Next step</th></tr>${readiness.blockers.map((r) => `
        <tr><td><strong>${esc(r.key)}</strong><br>${esc(r.summary)}</td>
        <td><span class="sev ${r.severity}">${esc(r.severity)}</span><br>${esc(r.kind)}</td>
        <td>${esc(r.owner || "Unassigned")}</td><td>${esc(r.action)}</td></tr>`).join("")}</table>`;
    if (readiness.risks.length > 0) {
      box.innerHTML += `<p style="margin-top:10px"><strong>Risks:</strong> ${readiness.risks.map((x) => esc(x.title)).join(" · ")}</p>`;
    }
  }
  $("actions").innerHTML = readiness.actions.map((a) => `<li>${esc(a)}</li>`).join("");
  $("notes").innerHTML = readiness.notes.length === 0 ? "" :
    `<div class="notes-box"><strong>Notes — some data may be incomplete:</strong><br>${readiness.notes.map(esc).join("<br>")}</div>`;
}

function renderIssues() {
  $("issues").innerHTML = state.issues.map((issue, i) => {
    const isBlocker = (issue.priority === "Highest" || issue.labels.includes("blocker")) && issue.status !== "Done";
    return `<div class="issue">
      <span class="key">${esc(issue.key)}</span>
      <span class="summary">${esc(issue.summary)}</span>
      <span class="pill">${esc(issue.type)}</span>
      <span class="pill">${esc(issue.priority)}</span>
      ${isBlocker ? `<span class="pill blocker">BLOCKER</span>` : ""}
      <span class="pill">${esc(issue.assignee?.displayName || "Unassigned")}</span>
      <button class="status-btn ${issue.status === "Done" ? "done" : ""}" data-issue="${i}">${esc(issue.status)} ↻</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-issue]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const issue = state.issues[Number(btn.dataset.issue)];
      issue.status = STATUSES[(STATUSES.indexOf(issue.status) + 1) % STATUSES.length];
      recompute();
    });
  });
}

function renderPRs() {
  $("prs").innerHTML = state.pullRequests.map((pr, i) => `
    <div class="pr">
      <span class="key">${esc(pr.issueKey)}</span>
      <span class="summary">${esc(pr.title)}</span>
      <span class="pill">${esc(pr.state)}${pr.approved ? " · approved" : ""}</span>
      <span class="pill">${pr.checks ? `CI ${pr.checks}` : "no CI data"}</span>
      ${pr.state === "OPEN" ? `<button data-pr="${i}">${pr.approved ? "Merge" : "Approve"}</button>` : ""}
    </div>`).join("");
  document.querySelectorAll("[data-pr]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pr = state.pullRequests[Number(btn.dataset.pr)];
      if (!pr.approved) pr.approved = true;
      else { pr.state = "MERGED"; pr.checks = "PASS"; }
      recompute();
    });
  });
}

function mdToHtml(md) {
  return md.split("\n").map((line) => {
    if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
    if (line.startsWith("- ")) {
      const text = line.slice(2).replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
      return `<ul><li>${text}</li></ul>`;
    }
    if (line.trim() === "---") return "<hr>";
    if (line.trim() === "") return "";
    return `<p>${esc(line).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/_([^_]+)_/g, "<em>$1</em>")}</p>`;
  }).join("");
}

function renderNotesPreview() {
  const notes = generateReleaseNotes(readiness, state.issues);
  $("notes-preview").innerHTML = mdToHtml(notes.markdown);
}

function renderAll() {
  renderGauge();
  renderBlockers();
  renderIssues();
  renderPRs();
  renderNotesPreview();
  $("doc-notes").checked = state.docs.releaseNotesPage;
  $("doc-runbook").checked = state.docs.runbookLinked;
}

function renderScenarios() {
  $("scenario-buttons").innerHTML = Object.entries(SCENARIOS).map(([key, s]) =>
    `<button data-scenario="${key}" class="${key === currentScenario ? "active" : ""}">${esc(s.label)}</button>`).join("");
  document.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentScenario = btn.dataset.scenario;
      state = structuredClone(SCENARIOS[currentScenario]);
      document.querySelectorAll("[data-scenario]").forEach((b) => b.classList.toggle("active", b === btn));
      $("chat-log").innerHTML = "";
      greet();
      recompute();
    });
  });
}

// --- Simulated Rovo agent chat (deterministic answers from the live score) ---
const QUICK = [
  "Is this release ready to ship?",
  "What is blocking this release?",
  "Who owns the blockers?",
  "Draft the release notes",
];

function addMsg(who, html) {
  const log = $("chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg ${who}">${html}</div>`);
  log.scrollTop = log.scrollHeight;
}

function answer(q) {
  const v = state.version.name;
  const lower = q.toLowerCase();
  if (lower.includes("blocking") || lower.includes("blocker") && lower.includes("what")) {
    if (readiness.blockers.length === 0) return `Nothing is blocking ${v}. ${summarizeReadiness(readiness)}`;
    return `<strong>${readiness.blockers.length} blocker(s) on ${v}:</strong><br>` +
      readiness.blockers.map((b) => `• <strong>${esc(b.key)}</strong> — ${esc(b.summary)} (owner: ${esc(b.owner || "unassigned")})`).join("<br>") +
      `<br>Next: ${esc(readiness.actions[0])}`;
  }
  if (lower.includes("who") || lower.includes("owner")) {
    const owners = [...new Set(readiness.blockers.map((b) => b.owner).filter(Boolean))];
    if (owners.length === 0) return `No blockers on ${v}, so no one to chase. In the full app, I also check the Teamwork Graph for the people actively discussing each blocker — not just the assignee.`;
    return `The blockers on ${v} are owned by <strong>${owners.map(esc).join(", ")}</strong>. In the full app I rank owners from the Teamwork Graph (recent commenters + teams), not just assignees — ask me there.`;
  }
  if (lower.includes("release notes") || lower.includes("draft")) {
    const notes = generateReleaseNotes(readiness, state.issues);
    return `Here is the draft for <strong>${esc(notes.title)}</strong> — the full app creates this as a Confluence page:<br><br>` +
      mdToHtml(notes.markdown.split("\n").slice(0, 12).join("\n")) + `<p><em>See the full preview in the Release notes panel →</em></p>`;
  }
  return summarizeReadiness(readiness) + (readiness.actions.length ? ` Next step: ${readiness.actions[0]}` : "");
}

function ask(q) {
  const text = (q || "").trim();
  if (!text) return;
  addMsg("user", esc(text));
  addMsg("agent", answer(text));
  $("chat-input").value = "";
}

function greet() {
  addMsg("agent", `Hi, I'm <strong>ShipCheck</strong>. Ask me whether <strong>${esc(state.version.name)}</strong> is ready to ship — I score it from the live work items, PRs and docs on this page.`);
}

$("quick-questions").innerHTML = QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join("");
document.querySelectorAll("[data-q]").forEach((btn) => btn.addEventListener("click", () => ask(btn.dataset.q)));
$("chat-send").addEventListener("click", () => ask($("chat-input").value));
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(e.target.value); });
$("doc-notes").addEventListener("change", (e) => { state.docs.releaseNotesPage = e.target.checked; recompute(); });
$("doc-runbook").addEventListener("change", (e) => { state.docs.runbookLinked = e.target.checked; recompute(); });

renderScenarios();
greet();
recompute();
