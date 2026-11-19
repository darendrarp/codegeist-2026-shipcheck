// ShipCheck readiness engine — pure, deterministic, zero dependencies.
//
// No Forge imports here on purpose: the same file runs in the Forge backend,
// in `node --test`, and in the standalone demo (demo/engine.js is a copy —
// see scripts/sync-demo.mjs). The score is fully explainable: every point
// lost maps to a named blocker, risk or missing artefact. No LLM is involved
// in scoring; Rovo only narrates the result.

export const WEIGHTS = Object.freeze({
  completion: 35,
  blockers: 25,
  review: 20,
  quality: 10,
  docs: 10,
});

export const DONE_STATUSES = new Set([
  "done",
  "closed",
  "resolved",
  "released",
  "complete",
  "completed",
]);

const CODE_TYPES = new Set(["story", "task", "bug", "sub-task", "subtask"]);

const isDone = (issue) => DONE_STATUSES.has(String(issue?.status || "").trim().toLowerCase());
const isCodeWork = (issue) => CODE_TYPES.has(String(issue?.type || "").trim().toLowerCase());
const isBug = (issue) => String(issue?.type || "").trim().toLowerCase() === "bug";

export function isBlocker(issue) {
  if (isDone(issue)) return false;
  const priority = String(issue?.priority || "").trim().toLowerCase();
  const labels = (issue?.labels || []).map((l) => String(l).toLowerCase());
  return priority === "highest" || labels.includes("blocker") || labels.includes("blocking");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Score for one issue's review state, 0..1. */
export function reviewFraction(issue, pr) {
  if (!pr) return 0;
  const state = String(pr.state || "").toUpperCase();
  if (state === "MERGED") return 1;
  if (state === "DECLINED") return 0.1;
  // OPEN (or anything else): approved PRs are nearly done, unreviewed ones are not.
  return pr.approved ? 0.85 : 0.4;
}

export function verdictFor(score, { openBlockers = 0 } = {}) {
  let verdict = score >= 85 ? "SHIP" : score >= 60 ? "CAUTION" : "HOLD";
  // Hard rule, stated in the UI: a release with an open blocker can never be SHIP.
  if (verdict === "SHIP" && openBlockers > 0) verdict = "CAUTION";
  return verdict;
}

/**
 * Compute release readiness.
 *
 * @param {object} input
 * @param {object} input.version { name, releaseDate?, projectKey? }
 * @param {Array}  input.issues [{ key, summary, status, type, priority, assignee?, labels? }]
 * @param {Array}  input.pullRequests [{ issueKey, state, approved, checks }]
 * @param {object} input.docs { releaseNotesPage: boolean, runbookLinked: boolean }
 * @returns {object} { version, score, verdict, breakdown, counts, blockers, risks, actions, notes }
 */
export function computeReadiness(input = {}) {
  const version = input.version || {};
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const pullRequests = Array.isArray(input.pullRequests) ? input.pullRequests : [];
  const docs = input.docs || {};
  const notes = [];

  const prByIssue = new Map();
  for (const pr of pullRequests) {
    if (pr?.issueKey) prByIssue.set(String(pr.issueKey).toUpperCase(), pr);
  }

  const done = issues.filter(isDone);
  const open = issues.filter((i) => !isDone(i));
  const blockers = open.filter(isBlocker);
  const openCriticalBugs = open.filter(
    (i) => isBug(i) && !isBlocker(i) && String(i.priority || "").toLowerCase() === "high",
  );
  const codeIssues = issues.filter(isCodeWork);
  const failingChecks = pullRequests.filter(
    (pr) => String(pr.checks || "").toUpperCase() === "FAIL",
  );
  const prsWithChecks = pullRequests.filter((pr) => pr.checks != null);

  // --- 1. Completion (35) ---
  let completion = 0;
  let completionDetail;
  if (issues.length === 0) {
    completionDetail = "No work items in this release.";
    notes.push("No Jira work items found for this fix version.");
  } else {
    completion = Math.round((done.length / issues.length) * WEIGHTS.completion);
    completionDetail = `${done.length}/${issues.length} work items done.`;
  }

  // --- 2. Blockers (25) ---
  const blockerDeduction = blockers.length * 9 + openCriticalBugs.length * 4;
  const blockersScore = clamp(WEIGHTS.blockers - blockerDeduction, 0, WEIGHTS.blockers);
  const blockersDetail =
    blockers.length === 0 && openCriticalBugs.length === 0
      ? "No open blockers or critical bugs."
      : `${blockers.length} open blocker(s), ${openCriticalBugs.length} open critical bug(s).`;

  // --- 3. Code review (20) ---
  let review = WEIGHTS.review;
  let reviewDetail;
  if (codeIssues.length === 0) {
    reviewDetail = "No code work in this release.";
    notes.push("No code work items (story/task/bug) — review score is full by default.");
  } else {
    const total = codeIssues.reduce(
      (sum, issue) => sum + reviewFraction(issue, prByIssue.get(String(issue.key).toUpperCase())),
      0,
    );
    review = Math.round((total / codeIssues.length) * WEIGHTS.review);
    const merged = codeIssues.filter(
      (i) => String(prByIssue.get(String(i.key).toUpperCase())?.state || "").toUpperCase() === "MERGED",
    ).length;
    const noPr = codeIssues.filter((i) => !prByIssue.has(String(i.key).toUpperCase())).length;
    reviewDetail = `${merged}/${codeIssues.length} code items merged${noPr ? `, ${noPr} without a linked PR` : ""}.`;
  }

  // --- 4. Quality gates (10) ---
  let quality = WEIGHTS.quality;
  let qualityDetail;
  if (prsWithChecks.length === 0) {
    qualityDetail = "No CI check data on linked PRs.";
    notes.push("No CI check data — quality score assumes a clean bill of health; connect CI to Bitbucket for a real signal.");
  } else {
    quality = clamp(WEIGHTS.quality - failingChecks.length * 4, 0, WEIGHTS.quality);
    qualityDetail =
      failingChecks.length === 0
        ? `All ${prsWithChecks.length} PR(s) with CI data are passing.`
        : `${failingChecks.length} PR(s) failing checks.`;
  }

  // --- 5. Docs (10) ---
  const docsScore = (docs.releaseNotesPage ? 6 : 0) + (docs.runbookLinked ? 4 : 0);
  const docsDetail = [
    docs.releaseNotesPage ? "release notes drafted" : "no release notes page",
    docs.runbookLinked ? "runbook linked" : "no runbook linked",
  ].join("; ");

  const score =
    issues.length === 0
      ? 0
      : clamp(completion + blockersScore + review + quality + docsScore, 0, 100);
  const verdict = verdictFor(score, { openBlockers: blockers.length });

  // --- Blockers list (the "what" for the dashboard + agent) ---
  const blockerRows = [
    ...blockers.map((i) => ({
      key: i.key,
      summary: i.summary || "",
      kind: "blocker",
      severity: "high",
      status: i.status,
      owner: i.assignee?.displayName || null,
      action: `Resolve ${i.key} (${i.summary || "no summary"}) — it blocks the release.`,
    })),
    ...openCriticalBugs.map((i) => ({
      key: i.key,
      summary: i.summary || "",
      kind: "critical-bug",
      severity: "high",
      status: i.status,
      owner: i.assignee?.displayName || null,
      action: `Fix or explicitly defer ${i.key} — open critical bug in the release.`,
    })),
    ...failingChecks.map((pr) => ({
      key: pr.issueKey,
      summary: pr.title || "Pull request failing checks",
      kind: "failing-check",
      severity: "medium",
      status: `PR ${String(pr.state || "OPEN").toLowerCase()}`,
      owner: pr.author?.displayName || null,
      action: `Fix the failing checks on the PR for ${pr.issueKey}.`,
    })),
  ];

  // --- Risks (the "why it matters") ---
  const risks = [];
  if (blockers.length > 0) {
    risks.push({
      severity: "high",
      title: `${blockers.length} open blocker${blockers.length > 1 ? "s" : ""}`,
      detail: blockers.map((b) => b.key).join(", "),
      owner: blockers[0]?.assignee?.displayName || null,
    });
  }
  const unreviewed = codeIssues.filter((i) => {
    const pr = prByIssue.get(String(i.key).toUpperCase());
    return pr && String(pr.state || "").toUpperCase() === "OPEN" && !pr.approved;
  });
  if (unreviewed.length > 0) {
    risks.push({
      severity: "medium",
      title: `${unreviewed.length} PR${unreviewed.length > 1 ? "s" : ""} awaiting review`,
      detail: unreviewed.map((i) => i.key).join(", "),
      owner: null,
    });
  }
  const noPrDone = done.filter((i) => isCodeWork(i) && !prByIssue.has(String(i.key).toUpperCase()));
  if (noPrDone.length > 0) {
    risks.push({
      severity: "medium",
      title: `${noPrDone.length} done item${noPrDone.length > 1 ? "s" : ""} with no linked PR`,
      detail: noPrDone.map((i) => i.key).join(", "),
      owner: null,
    });
  }
  if (failingChecks.length > 0) {
    risks.push({
      severity: "high",
      title: `${failingChecks.length} PR${failingChecks.length > 1 ? "s" : ""} failing CI checks`,
      detail: failingChecks.map((p) => p.issueKey).join(", "),
      owner: null,
    });
  }
  if (!docs.releaseNotesPage) {
    risks.push({
      severity: "low",
      title: "Release notes not drafted",
      detail: "No Confluence release-notes page found for this version.",
      owner: null,
    });
  }
  if (issues.length > 0 && open.length / issues.length > 0.5) {
    risks.push({
      severity: "medium",
      title: `More than half the release is still open (${open.length}/${issues.length})`,
      detail: "Completion is below 50%.",
      owner: null,
    });
  }

  // --- Recommended actions, highest impact first ---
  const actions = [];
  for (const b of blockerRows.filter((r) => r.severity === "high")) actions.push(b.action);
  if (unreviewed.length > 0) {
    actions.push(`Get reviews on ${unreviewed.map((i) => i.key).join(", ")}.`);
  }
  for (const b of blockerRows.filter((r) => r.severity === "medium")) actions.push(b.action);
  if (noPrDone.length > 0) {
    actions.push(`Link PRs to done items: ${noPrDone.map((i) => i.key).join(", ")}.`);
  }
  if (!docs.releaseNotesPage) actions.push("Draft the release notes in Confluence (ShipCheck can do it).");
  if (verdict === "SHIP") actions.push("Ship it — then mark the version released in Jira.");
  if (actions.length === 0) actions.push("Nothing blocking — keep the release moving.");

  return {
    version: {
      name: version.name || null,
      projectKey: version.projectKey || null,
      releaseDate: version.releaseDate || null,
    },
    score,
    verdict,
    breakdown: {
      completion: { score: completion, max: WEIGHTS.completion, detail: completionDetail },
      blockers: { score: blockersScore, max: WEIGHTS.blockers, detail: blockersDetail },
      review: { score: review, max: WEIGHTS.review, detail: reviewDetail },
      quality: { score: quality, max: WEIGHTS.quality, detail: qualityDetail },
      docs: { score: docsScore, max: WEIGHTS.docs, detail: docsDetail },
    },
    counts: {
      total: issues.length,
      done: done.length,
      open: open.length,
      blockers: blockers.length,
      openCriticalBugs: openCriticalBugs.length,
      pullRequests: pullRequests.length,
      failingChecks: failingChecks.length,
    },
    blockers: blockerRows,
    risks,
    actions,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

/** One-paragraph summary for Rovo chat answers and MCP tool output. */
export function summarizeReadiness(r) {
  const name = r.version?.name ? `Release ${r.version.name}` : "This release";
  const head =
    r.verdict === "SHIP"
      ? `${name} is READY TO SHIP (score ${r.score}/100).`
      : r.verdict === "CAUTION"
        ? `${name} scores ${r.score}/100 — CAUTION, ship only after the items below are handled.`
        : `${name} scores ${r.score}/100 — HOLD, do not ship yet.`;
  const parts = [head, `${r.counts.done}/${r.counts.total} work items done.`];
  if (r.counts.blockers > 0) parts.push(`${r.counts.blockers} open blocker(s).`);
  if (r.counts.failingChecks > 0) parts.push(`${r.counts.failingChecks} PR(s) failing checks.`);
  if (r.actions.length > 0) parts.push(`Next: ${r.actions[0]}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Release notes
// ---------------------------------------------------------------------------

const SECTION_ORDER = [
  ["story", "Features"],
  ["task", "Tasks & improvements"],
  ["bug", "Bug fixes"],
];

function sectionOf(issue) {
  const t = String(issue?.type || "").toLowerCase();
  const found = SECTION_ORDER.find(([type]) => type === t);
  return found ? found[1] : "Other";
}

/**
 * Build release notes from a readiness result + its issues.
 * Returns { title, markdown, storageFormat } — markdown for chat/preview,
 * Confluence storage format (XHTML) for page creation.
 */
export function generateReleaseNotes(readiness, issues = [], { siteUrl = "" } = {}) {
  const versionName = readiness?.version?.name || "Unreleased";
  const title = `Release Notes ${versionName}`;
  const done = issues.filter(isDone);
  const openNonBlockers = issues.filter((i) => !isDone(i) && !isBlocker(i));

  const link = (issue) =>
    siteUrl ? `[${issue.key}](${siteUrl.replace(/\/$/, "")}/browse/${issue.key})` : issue.key;

  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `ShipCheck readiness: **${readiness.score}/100 (${readiness.verdict})** — ` +
      `${readiness.counts.done}/${readiness.counts.total} work items done.`,
  );
  lines.push("");

  const groups = new Map();
  for (const issue of done) {
    const section = sectionOf(issue);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(issue);
  }
  const orderedSections = [...SECTION_ORDER.map(([, s]) => s), "Other"];
  for (const section of orderedSections) {
    const items = groups.get(section);
    if (!items || items.length === 0) continue;
    lines.push(`## ${section}`);
    for (const issue of items) {
      lines.push(`- ${link(issue)} ${issue.summary || ""}`.trimEnd());
    }
    lines.push("");
  }

  if (openNonBlockers.length > 0) {
    lines.push("## Known issues (not in this release)");
    for (const issue of openNonBlockers) {
      lines.push(`- ${link(issue)} ${issue.summary || ""} (${issue.status})`.trimEnd());
    }
    lines.push("");
  }

  if (done.length === 0) {
    lines.push("_No completed work items in this release yet._");
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated by ShipCheck — Release Readiness Agent._");

  const markdown = lines.join("\n");

  // Confluence storage format: minimal valid XHTML the REST API accepts.
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xhtml = [];
  xhtml.push(`<h1>${esc(title)}</h1>`);
  xhtml.push(
    `<p>ShipCheck readiness: <strong>${readiness.score}/100 (${readiness.verdict})</strong> — ` +
      `${readiness.counts.done}/${readiness.counts.total} work items done.</p>`,
  );
  for (const section of orderedSections) {
    const items = groups.get(section);
    if (!items || items.length === 0) continue;
    xhtml.push(`<h2>${esc(section)}</h2><ul>`);
    for (const issue of items) {
      const href = siteUrl ? `${siteUrl.replace(/\/$/, "")}/browse/${issue.key}` : null;
      xhtml.push(
        href
          ? `<li><a href="${esc(href)}">${esc(issue.key)}</a> ${esc(issue.summary || "")}</li>`
          : `<li>${esc(issue.key)} ${esc(issue.summary || "")}</li>`,
      );
    }
    xhtml.push("</ul>");
  }
  if (openNonBlockers.length > 0) {
    xhtml.push("<h2>Known issues (not in this release)</h2><ul>");
    for (const issue of openNonBlockers) {
      xhtml.push(`<li>${esc(issue.key)} ${esc(issue.summary || "")} (${esc(issue.status)})</li>`);
    }
    xhtml.push("</ul>");
  }
  xhtml.push("<p><em>Generated by ShipCheck — Release Readiness Agent.</em></p>");

  return { title, markdown, storageFormat: xhtml.join("") };
}

// ---------------------------------------------------------------------------
// Owners (Teamwork Graph + Jira)
// ---------------------------------------------------------------------------

/**
 * Rank people by how engaged they are with release work.
 * Input: [{ accountId, name, teams?, comments?, assigned?, roles? }]
 * Score: comments*2 + assigned*3 + explicit roles. Ties break by name.
 */
export function rankContributors(people = []) {
  const scored = people.map((p) => {
    const comments = Number(p.comments || 0);
    const assigned = Number(p.assigned || 0);
    const roles = Array.isArray(p.roles) ? p.roles : [];
    return {
      accountId: p.accountId || null,
      name: p.name || "Unknown",
      teams: Array.isArray(p.teams) ? p.teams : [],
      comments,
      assigned,
      roles,
      engagement: comments * 2 + assigned * 3 + roles.length,
    };
  });
  scored.sort((a, b) => b.engagement - a.engagement || a.name.localeCompare(b.name));
  return scored;
}
