# INSTALL.md — ShipCheck install guide

Everything a judge (or the developer) needs to run ShipCheck on a real
Atlassian site. No step requires a paid Forge feature; the only paid piece is
Rovo itself, which is included in a Standard/Premium **trial**.

## 0. What you need

- An Atlassian Cloud site with **Jira** (and Confluence for release notes).
  A free Jira site works for the dashboard, but **Rovo needs a Standard or
  Premium plan** — start a trial if you don't have one; the trial includes Rovo.
- **Organization admin** rights on that site (installing an app with
  Teamwork Graph scopes needs an org admin to approve them).
- Node.js 22+ and npm.
- Forge CLI 15+ (`npm install` in this repo installs it as a devDependency).

## 1. Clone + test (no Atlassian account needed)

```bash
git clone https://github.com/darendrarp/codegeist-2026-shipcheck.git
cd codegeist-2026-shipcheck
npm install
npm test        # 38 tests, all passing
```

Try the interactive demo (no account at all):
https://codegeist-2026-shipcheck.vercel.app

## 2. Log in to Forge + register the app

```bash
npx forge login          # browser login to your Atlassian account
npx forge register       # replaces the placeholder app id in manifest.yml
npx forge lint           # validate manifest + handlers
```

## 3. Deploy + install

```bash
npx forge deploy -e production
npx forge install        # pick your Jira site; approve the scopes
```

Scopes requested (all least-privilege, see `manifest.yml`):
`read:jira-work`, `read:jira-user`, `write:jira-work` (verdict-flip comments),
`read:confluence-content.summary`, `write:confluence-content` (release notes),
plus per-object Teamwork Graph scopes (`read:graph:issue:jira`,
`read:graph:issue-status:jira`, `read:graph:issue-comment:jira`,
`read:graph:user:atlassian`, `read:graph:team:atlassian`).

## 4. Seed demo data (5 minutes, Jira UI)

1. Create a project (e.g. key `AUR`).
2. Create a version: Project settings → Versions → `2.4` (unreleased).
3. Create ~6 issues with fix version `2.4`: mix of Done / In Progress /
   To Do; make one Highest priority (a blocker); add a Bug or two.
4. Link a Bitbucket repo to the project and open a PR mentioning an issue key
   (e.g. `AUR-1`) so Jira's dev panel shows it. Optional — scoring works
   without PRs and says so.
5. (Optional) Create a Confluence space for release notes.

## 5. Try it

- **Dashboard:** open the project → left sidebar → **ShipCheck — Release
  Readiness**. Pick version `2.4`. Click **Watch this release** for hourly
  re-scoring.
- **Issue panel:** open any issue in the release → **ShipCheck** panel shows
  the release score and next step.
- **Rovo agent:** open Rovo chat → select the **ShipCheck** agent:
  - "Is release 2.4 ready to ship?"
  - "What is blocking release 2.4?"
  - "Who owns the blockers in release 2.4?"
  - "Draft release notes for 2.4" (it will ask for a Confluence space key)
- **MCP tools:** in Rovo Studio, add the **ShipCheck MCP** tools to a custom
  agent; or connect an external MCP client to
  `https://mcp.atlassian.com/forge/<appId>` after enabling the tools in
  Atlassian Administration → Apps → Connected apps → ShipCheck → Tools.

## 6. Sharing with judges (installation link)

For the Codegeist submission the judges install via a link, not from source:

1. `npx forge deploy -e production`
2. Open the app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/)
   → **Distribution** → Edit → pick **Sharing** (NOT "Sharing within
   organization" — outsiders can't install with that one).
3. Fill in the app details, choose **Jira** as the install target, save, and
   copy the installation link into the Devpost form.

## 7. Uninstall

`npx forge uninstall`, or remove the app from Jira Settings → Apps. Watched
releases and score history live in Forge storage and are removed with the app.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `forge lint` complains about the app id | Run `forge register` first — the repo ships a placeholder id. |
| Rovo agent not visible | Rovo needs Standard/Premium (trial OK). Check Rovo is enabled on the site. |
| Install asks for org admin | Expected for Teamwork Graph scopes — an org admin must approve them. |
| Agent says a source "could not be read" | The TWG API rate-limits aggressively; the app retries 3× and reports honestly. Wait a minute and ask again. |
| No PR data | Link a Bitbucket repo and reference issue keys in PR titles/branches. Without PRs, review scores 0 for code items and the UI says so. |
| `forge deploy` fails on the frontend | The UI Kit bundle builds during deploy; make sure `npm install` completed (needs `@forge/react`). |
