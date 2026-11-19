# VIDEO_SCRIPT.md — Demo video script (< 5 minutes)

**Format:** screen recording + voiceover, no face needed. Record at 1080p.
Upload to YouTube as **public**. Total target: **~4:30**.

If the Forge install is done, record Part B in real Jira/Rovo; otherwise
record Part B against the demo site's "Ask ShipCheck" chat and say so on
camera ("the same agent, live in Rovo — see the repo for install steps").
Never fake a live Jira screen.

---

## 0:00–0:30 — The problem (voiceover + Jira tabs on screen)

> "Every release, the same scavenger hunt: Jira to count open issues,
> Bitbucket to chase unreviewed PRs, Confluence to check the notes, Slack to
> find who owns the blocker — and then we ship on a gut feeling.
> ShipCheck turns that into one number, with receipts."

[Show: 3–4 browser tabs, then the ShipCheck demo/dashboard.]

## 0:30–1:30 — The score (demo site or Jira dashboard)

> "Aurora 2.4 scores 61 out of 100 — CAUTION. The breakdown shows why:
> completion is fine, but there's an open blocker, a PR failing checks, and
> no release notes yet. Every point lost maps to something named."

[Show: gauge + breakdown bars. Click the blocker row.]

> "And the score is deterministic — no LLM, no vibes. Fix the blocker and
> the score moves. Watch."

[Click AUR-3 status to Done; approve + merge its PR. Score climbs live.]

## 1:30–2:30 — The Rovo agent

> "The same engine answers in Rovo chat."

[Show Rovo chat — or the demo's Ask ShipCheck panel:]
- "Is release 2.4 ready to ship?" → verdict + evidence + next step.
- "What is blocking release 2.4?" → named blockers with owners.
- "Who owns the blockers?" → "Citra and Ben — Citra's been discussing the
  migration all week. That's the Teamwork Graph, not just the assignee field."

## 2:30–3:30 — Release notes + owners + MCP

> "One ask drafts the release notes in Confluence — grouped by type, with
> known issues listed honestly."

[Show the notes preview / created Confluence page.]

> "And the same four actions are MCP tools — any Rovo Studio agent or
> external MCP client can call them."

[Show the rovo:mcp manifest snippet + Rovo Studio tools list, briefly.]

## 3:30–4:15 — The watch + the code

> "ShipCheck also watches releases hourly and posts a comment the moment a
> verdict flips — so nobody has to keep refreshing."

[Show: watched release + a verdict-flip comment, or the scheduledTrigger
code + test run.]

> "Thirty-eight tests, all passing. Zero paid APIs, zero Forge LLM calls.
> The scoring engine is one pure file — the demo you're watching runs the
> exact same code as the Forge app."

[Show: `npm test` output — 38 pass.]

## 4:15–4:30 — Close

> "ShipCheck — know before you ship. Links in the description."

[End card: repo + demo links.]

---

## Recording checklist

- [ ] 1080p, system audio off, mic clear, no background noise
- [ ] Cursor visible; zoom browser to 110–125% for readability
- [ ] Demo data seeded (INSTALL.md §4) so nothing is empty on screen
- [ ] Keep it under 5:00 — judges aren't required to watch past 5 minutes
- [ ] Title: "ShipCheck — Release Readiness Agent | Atlassian Codegeist 2026"
- [ ] Description: repo + demo + install links
