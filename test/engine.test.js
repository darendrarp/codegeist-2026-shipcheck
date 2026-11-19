// Tests for the ShipCheck readiness engine (pure logic, no Forge runtime).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeReadiness,
  generateReleaseNotes,
  isBlocker,
  rankContributors,
  reviewFraction,
  summarizeReadiness,
  verdictFor,
} from "../src/engine.js";

const issue = (overrides = {}) => ({
  key: "AUR-1",
  summary: "Do the thing",
  status: "Done",
  type: "Story",
  priority: "Medium",
  assignee: { displayName: "Ayu" },
  labels: [],
  ...overrides,
});

const pr = (overrides = {}) => ({
  issueKey: "AUR-1",
  state: "MERGED",
  approved: true,
  checks: "PASS",
  ...overrides,
});

const perfectRelease = () => ({
  version: { name: "2.4", projectKey: "AUR" },
  issues: [
    issue({ key: "AUR-1", type: "Story" }),
    issue({ key: "AUR-2", type: "Bug", summary: "Fix login crash" }),
    issue({ key: "AUR-3", type: "Task", summary: "Update docs" }),
  ],
  pullRequests: [pr({ issueKey: "AUR-1" }), pr({ issueKey: "AUR-2" }), pr({ issueKey: "AUR-3" })],
  docs: { releaseNotesPage: true, runbookLinked: true },
});

describe("verdictFor", () => {
  it("maps score bands to verdicts", () => {
    assert.equal(verdictFor(100), "SHIP");
    assert.equal(verdictFor(85), "SHIP");
    assert.equal(verdictFor(84), "CAUTION");
    assert.equal(verdictFor(60), "CAUTION");
    assert.equal(verdictFor(59), "HOLD");
    assert.equal(verdictFor(0), "HOLD");
  });

  it("caps SHIP at CAUTION when a blocker is open", () => {
    assert.equal(verdictFor(95, { openBlockers: 1 }), "CAUTION");
    assert.equal(verdictFor(95, { openBlockers: 0 }), "SHIP");
  });
});

describe("isBlocker", () => {
  it("flags Highest priority and blocker labels, not done items", () => {
    assert.equal(isBlocker(issue({ status: "In Progress", priority: "Highest" })), true);
    assert.equal(isBlocker(issue({ status: "To Do", labels: ["blocker"] })), true);
    assert.equal(isBlocker(issue({ status: "To Do", priority: "High" })), false);
    assert.equal(isBlocker(issue({ status: "Done", priority: "Highest" })), false);
  });
});

describe("reviewFraction", () => {
  it("scores PR states", () => {
    assert.equal(reviewFraction(issue(), pr({ state: "MERGED" })), 1);
    assert.equal(reviewFraction(issue(), pr({ state: "OPEN", approved: true })), 0.85);
    assert.equal(reviewFraction(issue(), pr({ state: "OPEN", approved: false })), 0.4);
    assert.equal(reviewFraction(issue(), pr({ state: "DECLINED" })), 0.1);
    assert.equal(reviewFraction(issue(), null), 0);
  });
});

describe("computeReadiness", () => {
  it("scores a perfect release 100 SHIP", () => {
    const r = computeReadiness(perfectRelease());
    assert.equal(r.score, 100);
    assert.equal(r.verdict, "SHIP");
    assert.equal(r.blockers.length, 0);
    assert.equal(r.breakdown.completion.score, 35);
    assert.equal(r.breakdown.review.score, 20);
    assert.equal(r.breakdown.docs.score, 10);
  });

  it("scores an empty release 0 HOLD with a note", () => {
    const r = computeReadiness({ version: { name: "9.9" }, issues: [], pullRequests: [], docs: {} });
    assert.equal(r.score, 0);
    assert.equal(r.verdict, "HOLD");
    assert.ok(r.notes.length > 0);
  });

  it("penalises open blockers and caps the verdict at CAUTION", () => {
    const input = perfectRelease();
    input.issues.push(
      issue({ key: "AUR-9", status: "In Progress", priority: "Highest", summary: "DB migration stuck" }),
    );
    const r = computeReadiness(input);
    assert.equal(r.counts.blockers, 1);
    assert.equal(r.breakdown.blockers.score, 16); // 25 - 9
    assert.equal(r.verdict, "CAUTION"); // would otherwise be high
    assert.ok(r.blockers.some((b) => b.key === "AUR-9" && b.severity === "high"));
    assert.ok(r.risks.some((x) => x.title.includes("blocker")));
  });

  it("penalises failing CI checks", () => {
    const input = perfectRelease();
    input.pullRequests[0] = pr({ issueKey: "AUR-1", checks: "FAIL" });
    const r = computeReadiness(input);
    assert.equal(r.breakdown.quality.score, 6); // 10 - 4
    assert.equal(r.counts.failingChecks, 1);
    assert.ok(r.blockers.some((b) => b.kind === "failing-check"));
  });

  it("scores review from PR states, not just counts", () => {
    const input = perfectRelease();
    input.pullRequests = [
      pr({ issueKey: "AUR-1", state: "OPEN", approved: false, checks: null }),
      pr({ issueKey: "AUR-2", state: "OPEN", approved: true, checks: null }),
      // AUR-3: no PR at all
    ];
    const r = computeReadiness(input);
    // (0.4 + 0.85 + 0) / 3 * 20 = 8.33 -> 8
    assert.equal(r.breakdown.review.score, 8);
    assert.ok(r.risks.some((x) => x.title.includes("awaiting review")));
  });

  it("handles missing CI data without crashing and says so", () => {
    const input = perfectRelease();
    input.pullRequests = input.pullRequests.map((p) => ({ ...p, checks: null }));
    const r = computeReadiness(input);
    assert.equal(r.breakdown.quality.score, 10);
    assert.ok(r.notes.some((n) => n.includes("No CI check data")));
  });

  it("scores docs from release notes + runbook", () => {
    const input = perfectRelease();
    input.docs = { releaseNotesPage: false, runbookLinked: false };
    assert.equal(computeReadiness(input).breakdown.docs.score, 0);
    input.docs = { releaseNotesPage: true, runbookLinked: false };
    assert.equal(computeReadiness(input).breakdown.docs.score, 6);
  });

  it("counts open critical bugs separately from blockers", () => {
    const input = perfectRelease();
    input.issues.push(
      issue({ key: "AUR-7", type: "Bug", status: "To Do", priority: "High", summary: "Data loss on retry" }),
    );
    const r = computeReadiness(input);
    assert.equal(r.counts.openCriticalBugs, 1);
    assert.equal(r.breakdown.blockers.score, 21); // 25 - 4
  });

  it("produces ordered, actionable next steps", () => {
    const input = perfectRelease();
    input.issues.push(
      issue({ key: "AUR-9", status: "In Progress", priority: "Highest", summary: "DB migration stuck" }),
    );
    input.docs = { releaseNotesPage: false, runbookLinked: false };
    const r = computeReadiness(input);
    assert.ok(r.actions[0].includes("AUR-9"), "blocker action comes first");
    assert.ok(r.actions.some((a) => a.includes("release notes")));
  });

  it("tolerates missing/partial input", () => {
    const r = computeReadiness({});
    assert.equal(r.score, 0);
    assert.equal(r.verdict, "HOLD");
    const r2 = computeReadiness({ issues: [{ key: "X-1" }] });
    assert.equal(r2.counts.total, 1);
    assert.equal(r2.counts.done, 0);
  });
});

describe("summarizeReadiness", () => {
  it("leads with the verdict", () => {
    const ship = summarizeReadiness(computeReadiness(perfectRelease()));
    assert.match(ship, /READY TO SHIP/);
    assert.match(ship, /100\/100/);
    const hold = summarizeReadiness(computeReadiness({ version: { name: "1.0" }, issues: [] }));
    assert.match(hold, /HOLD/);
  });
});

describe("generateReleaseNotes", () => {
  it("groups done work by type and lists known issues", () => {
    const input = perfectRelease();
    input.issues.push(
      issue({ key: "AUR-5", type: "Story", status: "In Progress", summary: "Dark mode (slips)" }),
    );
    const r = computeReadiness(input);
    const notes = generateReleaseNotes(r, input.issues, { siteUrl: "https://example.atlassian.net" });
    assert.equal(notes.title, "Release Notes 2.4");
    assert.match(notes.markdown, /## Features/);
    assert.match(notes.markdown, /## Bug fixes/);
    assert.match(notes.markdown, /AUR-1/);
    assert.match(notes.markdown, /## Known issues/);
    assert.match(notes.markdown, /AUR-5/);
    assert.match(notes.markdown, /https:\/\/example\.atlassian\.net\/browse\/AUR-1/);
    assert.match(notes.storageFormat, /<h2>Features<\/h2>/);
    assert.match(notes.storageFormat, /<li>/);
  });

  it("handles a release with nothing done yet", () => {
    const r = computeReadiness({ version: { name: "0.1" }, issues: [issue({ status: "To Do" })] });
    const notes = generateReleaseNotes(r, [issue({ status: "To Do" })]);
    assert.match(notes.markdown, /No completed work items/);
  });
});

describe("rankContributors", () => {
  it("ranks by engagement (assigned counts most), ties by name", () => {
    const ranked = rankContributors([
      { name: "Zoe", comments: 5 },
      { name: "Ayu", assigned: 2 },
      { name: "Ben", comments: 1, assigned: 1 },
    ]);
    // Ayu 6, Zoe 10, Ben 5 -> Zoe, Ayu, Ben
    assert.deepEqual(
      ranked.map((p) => p.name),
      ["Zoe", "Ayu", "Ben"],
    );
    assert.equal(ranked[0].engagement, 10);
  });
});
