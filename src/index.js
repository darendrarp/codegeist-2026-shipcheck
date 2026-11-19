// ShipCheck Forge entry point: UI resolver, Rovo actions, triggers.
//
// Wiring (see manifest.yml):
//   resolver                -> jira:projectPage + jira:issuePanel (UI Kit)
//   getReleaseReadinessAction / listReleaseBlockersAction /
//   findReleaseOwnersAction / draftReleaseNotesAction
//                           -> `action` modules (Rovo agent + rovo:mcp tools)
//   rescore                 -> scheduledTrigger, hourly
//   onIssueEvent            -> trigger avi:jira:updated:issue

import Resolver from "@forge/resolver";
import { kvs } from "@forge/kvs";
import * as jiraClient from "./jira.js";
import * as confluenceClient from "./confluence.js";
import * as twgClient from "./twg.js";
import {
  getReleaseReadiness,
  listReleaseBlockers,
  findReleaseOwners,
  draftReleaseNotes,
  resolveRelease,
  loadReleaseData,
} from "./actions.js";

const clients = { jira: jiraClient, confluence: confluenceClient, twg: twgClient };

const WATCH_KEY = "shipcheck:watched";
const SNAPSHOT_PREFIX = "shipcheck:snapshot:";
const RESCORE_MIN_GAP_MS = 5 * 60 * 1000;

async function watchedReleases() {
  return (await kvs.get(WATCH_KEY)) || [];
}

async function setWatched(releases) {
  await kvs.set(WATCH_KEY, releases);
}

// ---------------------------------------------------------------------------
// UI resolver
// ---------------------------------------------------------------------------
const resolver = new Resolver();

resolver.define("getVersions", async ({ payload }) => {
  return jiraClient.listVersions(payload.projectKey);
});

resolver.define("getReadiness", async ({ payload }) => {
  const rel = await resolveRelease(payload, {}, jiraClient);
  if (rel.error) return { error: rel.error };
  const { readiness } = await loadReleaseData(rel.projectKey, rel.version, rel.releaseDate, clients);
  return readiness;
});

resolver.define("getIssueReadiness", async ({ payload, context }) => {
  const issueKey = payload.issueKey || context?.extension?.issue?.key;
  if (!issueKey) return { error: "No work item in context." };
  const issue = await jiraClient.getIssue(issueKey);
  if (!issue) return { error: `${issueKey} does not exist or you cannot see it.` };
  if (issue.fixVersions.length === 0) {
    return { issue, readiness: null, note: "This work item is not in any release." };
  }
  const projectKey = issueKey.split("-")[0];
  const { readiness } = await loadReleaseData(projectKey, issue.fixVersions[0], null, clients);
  return { issue, readiness };
});

resolver.define("getHistory", async ({ payload }) => {
  const key = `${SNAPSHOT_PREFIX}${payload.projectKey}:${payload.version}`;
  return (await kvs.get(key)) || [];
});

resolver.define("watchRelease", async ({ payload }) => {
  const watched = await watchedReleases();
  const entry = { projectKey: payload.projectKey, version: payload.version };
  if (!watched.some((w) => w.projectKey === entry.projectKey && w.version === entry.version)) {
    watched.push(entry);
    await setWatched(watched);
  }
  return { watched };
});

resolver.define("draftNotes", async ({ payload }) => {
  return draftReleaseNotes(payload, {}, clients);
});

export const handler = resolver.getDefinitions();

// ---------------------------------------------------------------------------
// Rovo actions (one function per action, as in the Forge Rovo docs)
// ---------------------------------------------------------------------------
export async function getReleaseReadinessAction(payload, context) {
  return getReleaseReadiness(payload, context, clients);
}
export async function listReleaseBlockersAction(payload, context) {
  return listReleaseBlockers(payload, context, clients);
}
export async function findReleaseOwnersAction(payload, context) {
  return findReleaseOwners(payload, context, clients);
}
export async function draftReleaseNotesAction(payload, context) {
  return draftReleaseNotes(payload, context, clients);
}

// ---------------------------------------------------------------------------
// Background re-scoring
// ---------------------------------------------------------------------------
async function scoreAndStore(projectKey, version, { notify = true } = {}) {
  const { readiness, issues } = await loadReleaseData(projectKey, version, null, clients);
  const key = `${SNAPSHOT_PREFIX}${projectKey}:${version}`;
  const history = (await kvs.get(key)) || [];
  const prev = history[history.length - 1];
  history.push({
    at: readiness.generatedAt,
    score: readiness.score,
    verdict: readiness.verdict,
    counts: readiness.counts,
  });
  await kvs.set(key, history.slice(-48)); // keep ~2 days of hourly snapshots

  // Verdict flip? Tell the team on the first blocker (or first issue).
  if (notify && prev && prev.verdict !== readiness.verdict) {
    const target = readiness.blockers[0]?.key || issues[0]?.key;
    const direction =
      readiness.verdict === "HOLD"
        ? "dropped to HOLD — do not ship"
        : readiness.verdict === "SHIP"
          ? "is now SHIP — ready to release"
          : `moved to ${readiness.verdict}`;
    if (target) {
      await jiraClient.postComment(
        target,
        `ShipCheck: release ${version} ${direction} (score ${readiness.score}/100, was ${prev.score}/100 ${prev.verdict}).`,
      );
    }
  }
  return readiness;
}

// Hourly: re-score every watched release.
export async function rescore() {
  const watched = await watchedReleases();
  const results = [];
  for (const w of watched) {
    try {
      const r = await scoreAndStore(w.projectKey, w.version);
      results.push({ ...w, score: r.score, verdict: r.verdict });
    } catch (e) {
      results.push({ ...w, error: String(e?.message || e).slice(0, 160) });
    }
  }
  console.log(JSON.stringify({ shipcheck: "hourly-rescore", watched: watched.length, results }));
  return results;
}

// On issue update: re-score the issue's watched releases (debounced 5 min).
export async function onIssueEvent(event) {
  const issue = event?.issue;
  if (!issue?.key) return;
  const projectKey = String(issue.key).split("-")[0];
  const watched = (await watchedReleases()).filter((w) => w.projectKey === projectKey);
  if (watched.length === 0) return;

  const full = await jiraClient.getIssue(issue.key).catch(() => null);
  const versions = new Set(full?.fixVersions || []);
  for (const w of watched) {
    if (!versions.has(w.version)) continue;
    const key = `${SNAPSHOT_PREFIX}${w.projectKey}:${w.version}`;
    const history = (await kvs.get(key)) || [];
    const last = history[history.length - 1];
    if (last && Date.now() - new Date(last.at).getTime() < RESCORE_MIN_GAP_MS) continue;
    try {
      await scoreAndStore(w.projectKey, w.version);
    } catch (e) {
      console.log(JSON.stringify({ shipcheck: "event-rescore-failed", ...w, error: String(e?.message || e) }));
    }
  }
}
