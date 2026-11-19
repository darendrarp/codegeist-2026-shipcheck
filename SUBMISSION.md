# SUBMISSION.md — Devpost draft (Codegeist 2026)

Copy-paste draft for https://codegeist2026.devpost.com/ — fill the
`[BRACKETED]` fields after the Forge install + video exist.

---

## Title

**ShipCheck — Release Readiness Agent**

## Tagline

"Is this release ready to ship?" — answered with evidence, not vibes: a
deterministic 0–100 score from Jira, Bitbucket and Confluence, with the
blockers, their owners, and the release notes.

## Category

**Apps for Software Teams**

## Bonus prizes entered

- Best Agents — Rovo/Assignable agents (primary)
- Best app with Atlassian MCP
- Best apps with Teamwork Graph integration

## Description

Release day is a scavenger hunt. The release manager opens Jira to count open
issues, Bitbucket to chase unreviewed PRs, Confluence to check whether anyone
wrote the notes, and Slack to find who owns the blocker — then ships on a gut
feeling assembled from four tabs.

ShipCheck turns that into one number, with receipts. It scores a Jira release
0–100 across five explainable components — completion (35), blockers (25),
code review (20), quality gates (10), docs (10) — and returns a SHIP / CAUTION
/ HOLD verdict. A release with an open blocker can never be SHIP, by design.

**What it does:**

- **Jira dashboard** (project page) + **issue panel** — the score, its
  breakdown, the blocker table, and the single most important next step.
- **Rovo agent "ShipCheck"** — ask in chat: "Is release 2.4 ready to ship?",
  "What is blocking release 2.4?", "Who owns the blockers?", "Draft release
  notes for 2.4". Four actions back the agent; three are read-only.
- **Teamwork Graph owners** — blockers are matched to the people who can
  actually unblock them: assignees from Jira plus the people actively
  discussing each blocker (recent commenters + their teams, read from the
  Teamwork Graph via curated GraphQL), ranked by engagement.
- **MCP server** — the same four actions exposed as tools for Rovo Studio
  custom agents and external MCP clients.
- **Release notes** — one ask drafts the notes from done work items and
  creates the Confluence page.
- **Background watch** — hourly re-scoring of watched releases; a Jira comment
  the moment a verdict flips, plus re-scoring on issue updates.

**No Forge LLM, no paid API.** Scoring is deterministic and fully explainable:
every point lost maps to a named blocker, risk or missing artefact. Rovo only
narrates the result. The scoring engine is pure JavaScript with zero
dependencies — the same file runs in Forge, in the 38-test suite, and in the
live interactive demo.

## How it meets the technology requirement

ShipCheck is a Forge app (manifest + modules, Node 22 runtime) integrating
five Atlassian surfaces: **Jira** (project page, issue panel, REST search,
dev-status PR data, comments, triggers), **Confluence** (release-notes pages),
**Bitbucket** (linked PR state + CI checks via Jira dev-status),
**Teamwork Graph** (curated GraphQL via `requestTeamworkGraph`, as-user,
25-row paging, retry with backoff), and **Rovo** (`rovo:agent` + four
`action` modules + `rovo:mcp` server). No Forge LLM calls anywhere.

## Links

- **Repository (public, MIT):** https://github.com/darendrarp/codegeist-2026-shipcheck
- **Live interactive demo (no account needed):** https://codegeist-2026-shipcheck.vercel.app
- **Installation link (judges):** [PASTE AFTER FORGE DISTRIBUTION SETUP]
- **Demo video (<5 min, YouTube public):** [PASTE AFTER RECORDING]

## Try it (judges)

1. **No account:** open the live demo, pick a scenario, click an issue status
   or approve a PR — the score, blockers and release notes update live.
2. **With an Atlassian site:** install via the installation link above, seed
   demo data per `INSTALL.md` §4, then open the project → **ShipCheck —
   Release Readiness**, or ask the ShipCheck agent in Rovo chat.
3. **Tests:** `npm install && npm test` — 38 tests, all passing.

## Bonus-prize specifics

- **Best Agents:** the app declares a `rovo:agent` module ("ShipCheck") with
  a resource-file prompt, four conversation starters, and four reusable
  `action` modules other agents can invoke as tools.
- **Best app with Atlassian MCP:** the app declares a `rovo:mcp` module
  ("ShipCheck MCP") exposing all four actions as tools; external clients can
  connect at `https://mcp.atlassian.com/forge/<appId>` once enabled in
  Administration → Connected apps.
- **Best apps with Teamwork Graph integration:** the app consumes the Teamwork
  Graph API (Preview) through curated GraphQL queries — recent commenters and
  teams for release blockers — with per-object scopes, paging and honest
  incomplete-data reporting. See `src/twg.js`.
