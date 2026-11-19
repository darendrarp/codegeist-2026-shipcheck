# NEEDS_USER.md — what still needs a human

ShipCheck is **submission-ready as code** (38/38 tests pass, demo live, docs
complete). The items below need the user's Atlassian account, browser, or
voice — they cannot be done from this VM.

## 1. Atlassian account + site (required for the real install)
- [ ] Atlassian account + a Jira Cloud site. A **Standard or Premium trial**
      is needed for the Rovo agent (Rovo is paid-only; the trial includes it).
      The dashboard alone works on a free site.
- [ ] **Org-admin rights** on that site (Teamwork Graph scopes need org-admin
      approval at install time).
- [ ] Run on your own machine (or give the agent the go-ahead in a session
      with browser access):
      `npx forge login` → `npx forge register` → `npx forge deploy -e production` → `npx forge install`
- [ ] Seed demo data per INSTALL.md §4 (~5 min in the Jira UI).
- [ ] Create the **installation link** for judges (developer console →
      Distribution → Sharing, NOT "within organization") and paste it into
      the Devpost form.

## 2. Verify on a live site (recommended before submitting)
- [ ] Dashboard renders for a seeded release; score matches the demo logic.
- [ ] Rovo agent answers the four conversation starters.
- [ ] MCP tools visible in Rovo Studio.
- [ ] Release-notes page created in Confluence.
- [ ] `forge lint` clean after `forge register` (see §5 — lint status).

## 3. Demo video < 5 min (required by Devpost)
- [ ] Record the screen following VIDEO_SCRIPT.md (demo site + Forge install
      if available; demo site alone is enough for a valid video).
- [ ] Upload to YouTube as **public**, paste the link into the Devpost form.

## 4. Devpost submission (by the user)
- [ ] Create/confirm the Devpost account, open the Codegeist 2026 project,
      fill in SUBMISSION.md, add: repo link, demo link, installation link,
      video link, category **Apps for Software Teams**, bonus prizes
      (see §6 for the one-bonus rule).
- [ ] Submit before **23 Dec 2026 03:00 WIB** (22 Dec 15:00 EST).

## 5. Known limits / honest status (do not overclaim)
- **Validation done in this VM:** 38/38 unit tests pass; the full Forge
  **client-side lint passes with 0 errors, 0 warnings** (Forge CLI 15.1.0's
  bundled `@forge/lint`, run locally — manifest schema, handlers,
  permissions, Teamwork Graph, storage, timeouts). During that lint we fixed
  three real issues: a missing `storage:app` scope, the deprecated
  `@forge/api` storage export (migrated to `@forge/kvs`), and the UI Kit
  resource wiring (`render: native` + JSX entry file).
- **Still blocked on login (needs the user):** the `forge lint` *command*
  itself, `forge deploy` and `forge install` all require an Atlassian login
  (CLI 15.1.0 enforces auth before every command), and there is no Atlassian
  account/token in this VM. Server-side lint also runs at deploy time. The
  first real `forge deploy -e production` is the remaining moment of truth —
  budget 30 min for small fixes if deploy complains. (Also: the CLI's `keytar`
  native module doesn't build in this VM, so prefer env-var login:
  `FORGE_EMAIL` + `FORGE_API_TOKEN`.)
- **No live Atlassian testing yet.** All 38 tests use fake Forge clients or
  pure logic. The Jira/Confluence/TWG calls follow documented REST/GraphQL
  shapes, but live-site verification (§2) is still open.
- **Screenshots:** demo screenshots exist (`docs/screenshots/`, taken from the
  live Vercel demo 19 Nov 2026). Screenshots from a live Jira install do not
  exist yet — take 2–3 during §2 for the Devpost gallery.
- **Marketplace bonus NOT pursued.** A Marketplace-submitted app cannot be
  shared via installation link (Atlassian requires a separate copy app),
  and listing takes review time. The submission targets the other three
  bonuses instead (see §6).

## 6. Bonus-prize strategy (rules)
- One submission can win **at most one grand prize + one bonus prize**.
  ShipCheck qualifies for three bonuses (Agents, MCP, Teamwork Graph) —
  list all three on the form, but expect at most one. **Best Agents** is the
  strongest story (the Rovo agent is the product's front door); Teamwork
  Graph is the second-strongest (owners feature).
- The "Best Marketplace published app" bonus is intentionally skipped (§5).

## 7. Optional polish (only if time remains before 23 Dec)
- [ ] `graph:connector` module to write release-readiness entities back into
      the Teamwork Graph (stronger TWG story; needs care with the connector
      schema — verify against current docs first).
- [ ] Jira Automation action provider (`automation:actionProvider`) reusing
      the same actions for scheduled "release health" rules.
- [ ] Screenshots of the live Jira dashboard in README + Devpost gallery.
