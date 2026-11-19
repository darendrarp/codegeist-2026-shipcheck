// Jira REST access for ShipCheck (Forge backend, as the user).
// Pull-request data comes from Jira's dev-status API, which surfaces linked
// Bitbucket PRs on an issue — no Bitbucket scopes needed.

import api, { route } from "@forge/api";

const ISSUE_FIELDS = "summary,status,issuetype,priority,assignee,reporter,labels,fixVersions,updated";

function toIssue(j) {
  const f = j.fields || {};
  return {
    id: j.id,
    key: j.key,
    summary: f.summary || "",
    status: f.status?.name || "",
    type: f.issuetype?.name || "",
    priority: f.priority?.name || "",
    assignee: f.assignee
      ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName }
      : null,
    reporter: f.reporter
      ? { accountId: f.reporter.accountId, displayName: f.reporter.displayName }
      : null,
    labels: f.labels || [],
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    updated: f.updated || null,
  };
}

/** All issues in a fix version, paginated. */
export async function searchIssuesByVersion(projectKey, versionName) {
  const jql = `project = ${projectKey} AND fixVersion = "${versionName.replace(/"/g, '\\"')}" ORDER BY status ASC, priority DESC`;
  const issues = [];
  let nextPageToken = null;
  for (let page = 0; page < 10; page++) {
    const body = { jql, fields: ISSUE_FIELDS.split(","), maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await api
      .asUser()
      .requestJira(route`/rest/api/3/search/jql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    if (!res.ok) throw new Error(`Jira search failed (${res.status})`);
    const json = await res.json();
    for (const j of json.issues || []) issues.push(toIssue(j));
    nextPageToken = json.nextPageToken;
    if (!nextPageToken) break;
  }
  return issues;
}

/** One issue by key (also proves the user can see it + gives the numeric id). */
export async function getIssue(key) {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not read ${key} (${res.status})`);
  return toIssue(await res.json());
}

/** Versions of a project, unreleased first. */
export async function listVersions(projectKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/project/${projectKey}/versions`);
  if (!res.ok) throw new Error(`Could not list versions (${res.status})`);
  const versions = await res.json();
  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    released: !!v.released,
    archived: !!v.archived,
    releaseDate: v.releaseDate || null,
  }));
}

/**
 * Linked Bitbucket PRs for a set of issues, via the dev-status API.
 * Returns [{ issueKey, title, state, approved, checks, author }].
 * Failures degrade to [] with a note — readiness still scores without PRs.
 */
export async function getPullRequests(issues) {
  if (issues.length === 0) return { pullRequests: [], notes: [] };
  const params = issues.map((i) => `issueId=${encodeURIComponent(i.id)}`).join("&");
  const res = await api
    .asUser()
    .requestJira(
      route`/rest/dev-status/1.0/issue/detail?${params}&applicationType=bitbucket&dataType=pullrequest`,
    );
  if (!res.ok) {
    return {
      pullRequests: [],
      notes: [`Pull-request data could not be read (${res.status}) — review score is estimated without it.`],
    };
  }
  const json = await res.json();
  const pullRequests = [];
  for (const detail of json.detail || []) {
    for (const pr of detail.pullRequests || []) {
      pullRequests.push({
        issueKey: detail.issueKey || detail.issue?.key,
        title: pr.name || pr.title || "",
        state: String(pr.status || "OPEN").toUpperCase(),
        approved: (pr.reviewers || []).some((r) => r.approved),
        checks: pr.builds?.some((b) => b.state === "FAILED")
          ? "FAIL"
          : pr.builds?.length
            ? "PASS"
            : null,
        author: pr.author?.name ? { displayName: pr.author.name } : null,
        url: pr.url || null,
      });
    }
  }
  return { pullRequests, notes: [] };
}

/** Post a comment on an issue (ADF body). Used when a verdict flips. */
export async function postComment(issueKey, text) {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      }),
    });
  return res.ok;
}

/** Resolve a name/email to one active Jira user. */
export async function findPerson(text) {
  const res = await api.asUser().requestJira(route`/rest/api/3/user/search?query=${text}&maxResults=5`);
  if (!res.ok) return { error: `user search failed (${res.status})` };
  const users = (await res.json()).filter((u) => u.accountType === "atlassian" && u.active);
  if (users.length === 0) return { error: `no active person matches "${text}"` };
  if (users.length > 1) {
    return {
      error: `"${text}" matches ${users.length} people: ${users.map((u) => u.displayName).join(", ")}. Ask which one.`,
    };
  }
  return { accountId: users[0].accountId, name: users[0].displayName };
}
