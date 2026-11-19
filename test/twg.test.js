// Tests for the Teamwork Graph client (transport injected — no Forge runtime).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTwgClient, Q, workItemAri, userAri, PAGE_SIZE } from "../src/twg.js";

const okResponse = (data, status = 200) => ({
  status,
  json: async () => ({ data }),
});

describe("ARI helpers", () => {
  it("builds user and work-item ARIs", () => {
    assert.equal(userAri("abc"), "ari:cloud:identity::user/abc");
    assert.equal(workItemAri("cloud-1", "10001"), "ari:cloud:jira:cloud-1:issue/10001");
  });
});

describe("twg()", () => {
  it("names the operation shipcheck_<op> and returns data", async () => {
    let seen;
    const client = createTwgClient(async (text, variables, operationName) => {
      seen = { text, variables, operationName };
      return okResponse({ atlassianUserInTeams: { edges: [], pageInfo: {} } });
    });
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(seen.operationName, "shipcheck_userTeams");
    assert.match(seen.text, /query shipcheck_userTeams/);
    assert.equal(seen.variables.first, undefined); // twg() does not add paging
  });

  it("treats HTTP 200 with GraphQL errors as failure (DataFetchingException)", async () => {
    const client = createTwgClient(async () => ({
      status: 200,
      json: async () => ({
        errors: [{ message: "DataFetchingException: bad operation name", extensions: { classification: "DataFetchingException" } }],
      }),
    }));
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /DataFetchingException/);
  });

  it("retries transient errors with backoff, then succeeds", async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      if (calls < 3) {
        return { status: 429, json: async () => ({ errors: [{ message: "RATE_LIMITED" }] }) };
      }
      return okResponse({ ok: true });
    });
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(calls, 3);
  });

  it("gives up after retries on persistent transient errors", async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      return { status: 503, json: async () => ({ errors: [{ message: "unavailable" }] }) };
    });
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, false);
    assert.equal(calls, 4); // 1 + 3 retries
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      return { status: 400, json: async () => ({ errors: [{ message: "bad query" }] }) };
    });
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, false);
    assert.equal(calls, 1);
  });

  it("never throws on transport failure", async () => {
    const client = createTwgClient(async () => {
      throw new Error("socket closed");
    });
    const r = await client.twg("userTeams", Q.userTeams, { userId: "u1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /socket closed/);
  });
});

describe("twgAll()", () => {
  it("pages 25 rows at a time until hasNextPage is false", async () => {
    const seenFirst = [];
    const client = createTwgClient(async (text, variables) => {
      seenFirst.push(variables.first);
      const page = variables.after ? 2 : 1;
      return okResponse({
        atlassianUserInTeams: {
          edges: [{ node: { id: `t${page}`, displayName: `Team ${page}` } }],
          pageInfo: { hasNextPage: page === 1, endCursor: page === 1 ? "cursor-1" : null },
        },
      });
    });
    const r = await client.twgAll("userTeams", Q.userTeams, { userId: "u1" }, "atlassianUserInTeams");
    assert.equal(r.ok, true);
    assert.equal(r.complete, true);
    assert.equal(r.nodes.length, 2);
    assert.deepEqual(seenFirst, [PAGE_SIZE, PAGE_SIZE]);
    assert.equal(PAGE_SIZE, 25);
  });

  it("keeps partial nodes and flags incomplete when a page fails", async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      if (calls === 1) {
        return okResponse({
          atlassianUserInTeams: {
            edges: [{ node: { id: "t1", displayName: "Team 1" } }],
            pageInfo: { hasNextPage: true, endCursor: "c1" },
          },
        });
      }
      return { status: 500, json: async () => ({ errors: [{ message: "boom" }] }) };
    });
    const r = await client.twgAll("userTeams", Q.userTeams, { userId: "u1" }, "atlassianUserInTeams");
    assert.equal(r.ok, true, "partial results still usable");
    assert.equal(r.complete, false);
    assert.equal(r.nodes.length, 1);
  });

  it("stops after maxPages and flags incomplete", async () => {
    const client = createTwgClient(async () => {
      return okResponse({
        atlassianUserInTeams: {
          edges: [{ node: { id: "t", displayName: "T" } }],
          pageInfo: { hasNextPage: true, endCursor: "c" },
        },
      });
    });
    const r = await client.twgAll("userTeams", Q.userTeams, { userId: "u1" }, "atlassianUserInTeams", 2);
    assert.equal(r.complete, false);
    assert.equal(r.error, "stopped-after-max-pages");
    assert.equal(r.nodes.length, 2);
  });
});
