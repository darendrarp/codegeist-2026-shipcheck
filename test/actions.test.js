// Tests for the Rovo actions with fake Forge clients (no Atlassian site needed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftReleaseNotes,
  findReleaseOwners,
  getReleaseReadiness,
  listReleaseBlockers,
  resolveRelease,
} from "../src/actions.js";

const issue = (overrides = {}) => ({
  id: "10001",
  key: "AUR-1",
  summary: "Do the thing",
  status: "Done",
  type: "Story",
  priority: "Medium",
  assignee: { accountId: "u-ayu", displayName: "Ayu" },
  labels: [],
  ...overrides,
});

function fakeClients(overrides = {}) {
  const issues = overrides.issues || [
    issue({ id: "10001", key: "AUR-1" }),
    issue({ id: "10002", key: "AUR-2", type: "Bug", summary: "Fix login crash" }),
    issue({
      id: "10003",
      key: "AUR-3",
      status: "In Progress",
      priority: "Highest",
      summary: "DB migration stuck",
      assignee: { accountId: "u-ben", displayName: "Ben" },
    }),
  ];
  const pullRequests = overrides.pullRequests || [
    { issueKey: "AUR-1", state: "MERGED", approved: true, checks: "PASS" },
    { issueKey: "AUR-2", state: "MERGED", approved: true, checks: "PASS" },
    { issueKey: "AUR-3", state: "OPEN", approved: false, checks: "FAIL" },
  ];
  return {
    createdPages: [],
    jira: {
      listVersions: async () => [
        { name: "2.4", released: false, archived: false, releaseDate: "2026-12-20" },
        { name: "2.3", released: true, archived: false },
      ],
      searchIssuesByVersion: async () => issues,
      getPullRequests: async () => ({ pullRequests, notes: [] }),
      getIssue: async (key) => issues.find((i) => i.key === key) || null,
    },
    confluence: {
      findReleaseNotesPage: async () => ({ exists: false }),
      createReleaseNotesPage: async function (spaceKey, title, storageFormat) {
        const page = { id: "999", title, url: `/wiki/spaces/${spaceKey}/pages/999` };
        this.createdPages?.push?.({ spaceKey, title, storageFormat });
        return { ok: true, page };
      },
    },
    twg: {
      engagedPeopleForIssue: async (cloudId, issueId) => {
        if (issueId === "10003") {
          return {
            people: [
              { name: "Citra", accountId: "u-citra", comments: 5, lastAt: "2026-11-19" },
              { name: "Ben", accountId: "u-ben", comments: 2, lastAt: "2026-11-18" },
            ],
            notes: [],
          };
        }
        return { people: [], notes: [] };
      },
      teamsOf: async (accountId) =>
        accountId === "u-citra" ? { teams: [{ name: "Platform" }] } : { teams: [] },
    },
  };
}

describe("resolveRelease", () => {
  it("uses explicit project + version", async () => {
    const c = fakeClients();
    const r = await resolveRelease({ projectKey: "aur", version: "2.4" }, {}, c.jira);
    assert.deepEqual(r, { projectKey: "AUR", version: "2.4", releaseDate: "2026-12-20" });
  });

  it("defaults to the next unreleased version", async () => {
    const c = fakeClients();
    const r = await resolveRelease({ projectKey: "AUR" }, {}, c.jira);
    assert.equal(r.version, "2.4");
  });

  it("asks for a project when none is given", async () => {
    const c = fakeClients();
    const r = await resolveRelease({}, {}, c.jira);
    assert.match(r.error, /Which project/);
  });
});

describe("getReleaseReadiness", () => {
  it("returns score, verdict and breakdown for a real-ish release", async () => {
    const c = fakeClients();
    const r = await getReleaseReadiness({ projectKey: "AUR", version: "2.4" }, {}, c);
    // completion 2/3*35=23, blockers 25-9=16, review (1+1+0.4)/3*20=16,
    // quality 10-4=6, docs 0 -> 61 CAUTION
    assert.equal(r.score, 61);
    assert.equal(r.verdict, "CAUTION");
    assert.equal(r.counts.blockers, 1);
    assert.equal(r.counts.failingChecks, 1);
    assert.match(r.summary, /CAUTION/);
    assert.ok(r.actions.length > 0);
  });

  it("surfaces a PR-source failure as a note, not a crash", async () => {
    const c = fakeClients();
    c.jira.getPullRequests = async () => ({
      pullRequests: [],
      notes: ["Pull-request data could not be read (500) — review score is estimated without it."],
    });
    const r = await getReleaseReadiness({ projectKey: "AUR", version: "2.4" }, {}, c);
    assert.ok(r.notes.some((n) => n.includes("could not be read")));
    assert.equal(typeof r.score, "number");
  });
});

describe("listReleaseBlockers", () => {
  it("names the blocker, the failing check and the next steps", async () => {
    const c = fakeClients();
    const r = await listReleaseBlockers({ projectKey: "AUR", version: "2.4" }, {}, c);
    assert.equal(r.blockers.length, 2); // AUR-3 blocker + AUR-3 failing check
    assert.ok(r.blockers.some((b) => b.key === "AUR-3" && b.kind === "blocker"));
    assert.ok(r.blockers.some((b) => b.kind === "failing-check"));
    assert.ok(r.actions[0].includes("AUR-3"));
  });
});

describe("findReleaseOwners", () => {
  it("ranks assignees + Teamwork Graph commenters by engagement", async () => {
    const c = fakeClients();
    const r = await findReleaseOwners({ projectKey: "AUR", version: "2.4" }, { cloudId: "cloud-1" }, c);
    assert.ok(r.owners.length >= 2);
    // Citra: 5 comments * 2 + 1 role = 11. Ben: assigned 3 + 2 comments * 2 + 2 roles = 9.
    assert.equal(r.owners[0].name, "Citra");
    assert.equal(r.owners[1].name, "Ben");
    assert.deepEqual(r.owners[0].teams, ["Platform"]);
    assert.match(r.summary, /Citra/);
  });

  it("still works when the Teamwork Graph is unreadable", async () => {
    const c = fakeClients();
    c.twg.engagedPeopleForIssue = async () => ({
      people: [],
      notes: ["Teamwork Graph comments could not be read: http-500"],
    });
    const r = await findReleaseOwners({ projectKey: "AUR", version: "2.4" }, { cloudId: "cloud-1" }, c);
    assert.ok(r.owners.some((o) => o.name === "Ben"), "assignee fallback still present");
    assert.ok(r.notes.some((n) => n.includes("could not be read")));
  });
});

describe("draftReleaseNotes", () => {
  it("asks for a space key instead of guessing", async () => {
    const c = fakeClients();
    const r = await draftReleaseNotes({ projectKey: "AUR", version: "2.4" }, {}, c);
    assert.match(r.error, /Which Confluence space/);
  });

  it("creates the page and returns the markdown", async () => {
    const c = fakeClients();
    const r = await draftReleaseNotes(
      { projectKey: "AUR", version: "2.4", spaceKey: "team" },
      {},
      c,
    );
    assert.match(r.summary, /created in Confluence/);
    assert.equal(r.page.title, "Release Notes 2.4");
    assert.match(r.markdown, /## Features/);
    assert.match(r.markdown, /AUR-1/);
  });
});
