// Teamwork Graph (TWG) client for Forge backend functions.
//
// The TWG API (Preview since 15 Oct 2026) is GraphQL with *curated* queries —
// typed root fields, no raw Cypher for apps. Hard-won rules (verified against
// Atlassian docs and the Codegeist 2026 TWG tutorial by Mihai / LeanZero):
//   - Every operation needs a name shaped `[company]_[operation]` (company >= 3
//     chars, operation >= 4). Without it the API answers HTTP 200 with a
//     DataFetchingException, not a 4xx — so res.ok alone is NOT success.
//   - Curated connections return at most 25 rows per page. Page with `after`.
//   - A rate-limited call can come back with zero rows. Treat "empty + errors"
//     as "could not read", never as "nothing there".
//   - @forge/api exposes requestTeamworkGraph on asUser() only, so results are
//     permission-filtered for the person chatting.
//   - One scope per object type touched (see manifest.yml).
//
// The transport is injectable (createTwgClient) so the paging/retry/error
// logic is unit-testable without a Forge runtime; the default client binds
// the real @forge/api call.

import api from "@forge/api";

export const PAGE_SIZE = 25;
const OP_PREFIX = "shipcheck_";
const TRANSIENT = /RATE_LIMIT|THROTTL|429|502|503|504/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;
export const workItemAri = (cloudId, issueId) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;

export const Q = {
  assignedWork: `query OP($userId: ID!, $first: Int, $after: String) {
    atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first, after: $after) {
      edges { node { ... on JiraWorkItem { key summary webUrl status { name } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,

  workItemComments: `query OP($id: ID!, $since: String!, $first: Int, $after: String) {
    jiraWorkItemComments(id: $id, since: $since, first: $first, after: $after) {
      edges { node { ... on JiraWorkItemComment { createdAt author { name ... on AtlassianUser { accountId } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,

  userTeams: `query OP($userId: ID!, $first: Int, $after: String) {
    atlassianUserInTeams(userId: $userId, first: $first, after: $after) {
      edges { node { ... on AtlassianTeam { id displayName } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
};

/**
 * Build a TWG client around a transport function.
 * transport(queryText, variables, operationName) -> { status, json() }
 * The real transport is api.asUser().requestTeamworkGraph.
 */
export function createTwgClient(transport) {
  // One GraphQL call, up to 3 retries on transient errors.
  // Answers { ok, data, error, ms } and never throws.
  async function twg(opName, query, variables) {
    const operationName = `${OP_PREFIX}${opName}`;
    const text = query.replace("query OP", `query ${operationName}`);
    const t0 = Date.now();

    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let json = null;
      try {
        const res = await transport(text, variables, operationName);
        status = res.status;
        json = await res.json().catch(() => null);
      } catch (e) {
        json = { errors: [{ message: String(e?.message || e) }] };
      }

      const errors = Array.isArray(json?.errors) ? json.errors : [];
      const firstError = errors[0]
        ? `${errors[0].extensions?.classification || errors[0].extensions?.errorType || "error"}: ${String(errors[0].message).slice(0, 160)}`
        : status >= 400
          ? `http-${status}`
          : null;

      if (!firstError && json?.data) return { ok: true, data: json.data, ms: Date.now() - t0 };
      if (attempt < 3 && TRANSIENT.test(`${firstError} ${status}`)) {
        await sleep(Math.min(1200, 200 * 2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      return { ok: false, error: firstError || "no-data", data: json?.data || null, ms: Date.now() - t0 };
    }
  }

  // Reads a curated connection page by page.
  // Answers { ok, nodes, complete, error }. complete=false means we stopped
  // early (maxPages) or a page failed — callers must say "may be incomplete".
  async function twgAll(opName, query, variables, field, maxPages = 4) {
    const nodes = [];
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const r = await twg(opName, query, { ...variables, first: PAGE_SIZE, after });
      if (!r.ok) return { ok: nodes.length > 0, nodes, complete: false, error: r.error };
      const conn = r.data?.[field];
      if (!conn || !Array.isArray(conn.edges)) {
        return { ok: false, nodes, complete: false, error: "no-connection" };
      }
      for (const e of conn.edges) if (e?.node) nodes.push(e.node);
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) {
        return { ok: true, nodes, complete: true };
      }
      after = conn.pageInfo.endCursor;
    }
    return { ok: true, nodes, complete: false, error: "stopped-after-max-pages" };
  }

  return { twg, twgAll };
}

// Default client bound to the real Forge transport.
const defaultClient = createTwgClient((text, variables, operationName) =>
  api.asUser().requestTeamworkGraph(text, variables, operationName),
);
export const { twg, twgAll } = defaultClient;

/**
 * Who is actively engaged with one work item? Recent commenters from the
 * Teamwork Graph (last 90 days), with comment counts. The assignee/reporter
 * come from Jira REST — this adds the people *talking* about the item, which
 * is usually who can actually unblock it.
 * Returns { people: [{ name, accountId, comments, lastAt }], notes: [] }.
 */
export async function engagedPeopleForIssue(cloudId, issueId, client = defaultClient) {
  const notes = [];
  if (!cloudId || !issueId) {
    return { people: [], notes: ["Teamwork Graph lookup skipped: missing cloud/issue id."] };
  }
  const r = await client.twgAll(
    "workItemComments",
    Q.workItemComments,
    { id: workItemAri(cloudId, issueId), since: "P90D" },
    "jiraWorkItemComments",
  );
  if (!r.ok) {
    notes.push(`Teamwork Graph comments could not be read: ${r.error}`);
    return { people: [], notes };
  }
  if (!r.complete) notes.push("Comment list may be incomplete (paging stopped early).");

  const byAuthor = new Map();
  for (const c of r.nodes) {
    const name = c.author?.name || "unknown";
    const row = byAuthor.get(name) || {
      name,
      accountId: c.author?.accountId || null,
      comments: 0,
      lastAt: null,
    };
    row.comments += 1;
    if (!row.lastAt || c.createdAt > row.lastAt) row.lastAt = c.createdAt;
    byAuthor.set(name, row);
  }
  return { people: [...byAuthor.values()], notes };
}

/** Teams a person belongs to (for the "who should I ask" answer). */
export async function teamsOf(accountId, client = defaultClient) {
  const r = await client.twgAll(
    "userTeams",
    Q.userTeams,
    { userId: userAri(accountId) },
    "atlassianUserInTeams",
  );
  if (!r.ok) return { teams: [], error: r.error };
  return { teams: r.nodes.map((t) => ({ id: t.id, name: t.displayName })), error: null };
}
