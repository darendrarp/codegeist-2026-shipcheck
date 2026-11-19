// ShipCheck Rovo actions + shared release-loading logic.
//
// Every function takes injectable clients so the whole flow is unit-testable
// with fakes (see test/actions.test.js). In production, src/index.js passes
// the real Forge clients from jira.js / confluence.js / twg.js.
//
// Clients shape:
//   jira:        { searchIssuesByVersion, getPullRequests, listVersions, getIssue }
//   confluence:  { findReleaseNotesPage, createReleaseNotesPage }
//   twg:         { engagedPeopleForIssue, teamsOf }

import {
  computeReadiness,
  generateReleaseNotes,
  rankContributors,
  summarizeReadiness,
} from "./engine.js";

const log = (event, data) => console.log(JSON.stringify({ shipcheck: event, ...data }));

/** Resolve project + version from payload, Rovo context, or defaults. */
export async function resolveRelease(payload, context, jira) {
  const projectKey =
    String(payload?.projectKey || context?.jira?.projectKey || "").trim().toUpperCase() || null;
  let version = String(payload?.version || "").trim() || null;
  if (!projectKey) return { error: "Which project? Give me a project key such as AUR." };

  let releaseDate = null;
  if (!version) {
    const versions = await jira.listVersions(projectKey);
    const next = versions.filter((v) => !v.released && !v.archived)[0] || versions[0];
    if (!next) return { error: `Project ${projectKey} has no versions yet.` };
    version = next.name;
    releaseDate = next.releaseDate;
  } else {
    try {
      const versions = await jira.listVersions(projectKey);
      releaseDate = versions.find((v) => v.name === version)?.releaseDate || null;
    } catch {
      // Non-fatal: version name alone is enough to score.
    }
  }
  return { projectKey, version, releaseDate };
}

/** Load everything the engine needs for one release. Never throws on a
 *  single-source failure — each failure becomes a note, and scoring goes on. */
export async function loadReleaseData(projectKey, version, releaseDate, clients) {
  const notes = [];
  const issues = await clients.jira.searchIssuesByVersion(projectKey, version);
  const { pullRequests, notes: prNotes } = await clients.jira.getPullRequests(issues);
  notes.push(...prNotes);

  let docs = { releaseNotesPage: false, runbookLinked: false };
  try {
    const found = await clients.confluence.findReleaseNotesPage(null, version);
    docs.releaseNotesPage = !!found.exists;
    if (found.error) notes.push(found.error);
  } catch (e) {
    notes.push(`Confluence could not be read: ${String(e?.message || e).slice(0, 120)}`);
  }

  const readiness = computeReadiness({
    version: { name: version, projectKey, releaseDate },
    issues,
    pullRequests,
    docs,
  });
  readiness.notes.push(...notes);
  return { readiness, issues, pullRequests, docs };
}

// --- Action 1: get-release-readiness ---------------------------------------
export async function getReleaseReadiness(payload, context, clients) {
  const t0 = Date.now();
  const rel = await resolveRelease(payload, context, clients.jira);
  if (rel.error) return { error: rel.error };
  const { readiness } = await loadReleaseData(rel.projectKey, rel.version, rel.releaseDate, clients);
  log("get-release-readiness", { ms: Date.now() - t0, score: readiness.score, verdict: readiness.verdict });
  return {
    summary: summarizeReadiness(readiness),
    score: readiness.score,
    verdict: readiness.verdict,
    breakdown: readiness.breakdown,
    counts: readiness.counts,
    risks: readiness.risks,
    actions: readiness.actions,
    notes: readiness.notes,
  };
}

// --- Action 2: list-release-blockers ---------------------------------------
export async function listReleaseBlockers(payload, context, clients) {
  const rel = await resolveRelease(payload, context, clients.jira);
  if (rel.error) return { error: rel.error };
  const { readiness } = await loadReleaseData(rel.projectKey, rel.version, rel.releaseDate, clients);
  return {
    summary:
      readiness.blockers.length === 0
        ? `${rel.version} has no blockers. ${summarizeReadiness(readiness)}`
        : `${rel.version} has ${readiness.blockers.length} blocker(s), score ${readiness.score}/100 (${readiness.verdict}).`,
    score: readiness.score,
    verdict: readiness.verdict,
    blockers: readiness.blockers,
    actions: readiness.actions,
    notes: readiness.notes,
  };
}

// --- Action 3: find-release-owners -----------------------------------------
// Assignees from Jira + people actively engaged with each blocker (recent
// commenters from the Teamwork Graph) + their teams, ranked by engagement.
export async function findReleaseOwners(payload, context, clients) {
  const rel = await resolveRelease(payload, context, clients.jira);
  if (rel.error) return { error: rel.error };
  const { readiness, issues } = await loadReleaseData(
    rel.projectKey,
    rel.version,
    rel.releaseDate,
    clients,
  );
  const notes = [...readiness.notes];
  const cloudId = context?.cloudId || payload?.context?.cloudId || null;

  const openIssues = issues.filter((i) => readiness.blockers.some((b) => b.key === i.key));
  const targets = openIssues.length > 0 ? openIssues.slice(0, 10) : issues.slice(0, 10);

  const people = new Map();
  const addPerson = (p) => {
    if (!p?.name && !p?.accountId) return;
    const key = p.accountId || p.name;
    const row = people.get(key) || {
      accountId: p.accountId || null,
      name: p.name || "Unknown",
      teams: [],
      comments: 0,
      assigned: 0,
      roles: [],
    };
    row.comments += Number(p.comments || 0);
    row.assigned += Number(p.assigned || 0);
    for (const r of p.roles || []) if (!row.roles.includes(r)) row.roles.push(r);
    people.set(key, row);
  };

  // Assignees first (always available from Jira).
  for (const issue of targets) {
    if (issue.assignee) {
      addPerson({
        accountId: issue.assignee.accountId,
        name: issue.assignee.displayName,
        assigned: 1,
        roles: [`assignee of ${issue.key}`],
      });
    }
  }

  // Then the Teamwork Graph: who is *talking* about each blocker.
  for (const issue of targets) {
    const { people: engaged, notes: twgNotes } = await clients.twg.engagedPeopleForIssue(
      cloudId,
      issue.id,
    );
    notes.push(...twgNotes);
    for (const p of engaged) {
      addPerson({
        accountId: p.accountId,
        name: p.name,
        comments: p.comments,
        roles: [`commented on ${issue.key}`],
      });
    }
  }

  const ranked = rankContributors([...people.values()]);

  // Teams for the top 3, best effort.
  for (const person of ranked.slice(0, 3)) {
    if (!person.accountId) continue;
    try {
      const { teams } = await clients.twg.teamsOf(person.accountId);
      person.teams = teams.map((t) => t.name);
    } catch {
      // Teams are garnish; never fail the action for them.
    }
  }

  return {
    summary:
      ranked.length === 0
        ? `No owners found for ${rel.version} — its blockers may be unassigned.`
        : `Top people who can unblock ${rel.version}: ${ranked
            .slice(0, 3)
            .map((p) => p.name)
            .join(", ")}.`,
    version: rel.version,
    owners: ranked,
    notes,
  };
}

// --- Action 4: draft-release-notes -----------------------------------------
export async function draftReleaseNotes(payload, context, clients) {
  const rel = await resolveRelease(payload, context, clients.jira);
  if (rel.error) return { error: rel.error };
  const spaceKey = String(payload?.spaceKey || "").trim().toUpperCase();
  if (!spaceKey) {
    return {
      error:
        "Which Confluence space should the release notes go in? Give me a space key (for example TEAM).",
    };
  }
  const { readiness, issues } = await loadReleaseData(
    rel.projectKey,
    rel.version,
    rel.releaseDate,
    clients,
  );
  const notesDoc = generateReleaseNotes(readiness, issues);
  const created = await clients.confluence.createReleaseNotesPage(
    spaceKey,
    notesDoc.title,
    notesDoc.storageFormat,
  );
  if (!created.ok) return { error: created.error, markdown: notesDoc.markdown };
  log("draft-release-notes", { version: rel.version, pageId: created.page.id });
  return {
    summary: `Release notes for ${rel.version} created in Confluence (space ${spaceKey}).`,
    page: created.page,
    markdown: notesDoc.markdown,
  };
}
