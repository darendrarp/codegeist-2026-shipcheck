// ShipCheck UI (Forge UI Kit, @forge/react).
// One resource serves both modules; the component branches on the extension
// type from product context: jira:projectPage -> Dashboard,
// jira:issuePanel -> IssuePanel. Falls back to the dashboard.

import React, { useEffect, useState } from "react";
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Link,
  List,
  ListItem,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Text,
  useProductContext,
} from "@forge/react";
import { invoke } from "@forge/bridge";

const VERDICT_STYLE = {
  SHIP: { label: "SHIP — ready to release", tone: "success" },
  CAUTION: { label: "CAUTION — handle the items below first", tone: "warning" },
  HOLD: { label: "HOLD — do not ship yet", tone: "error" },
};

function ScoreBar({ label, score, max, detail }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const filled = Math.round(pct / 10);
  return (
    <Box>
      <Text>
        <Strong>{label}</Strong> — {score}/{max} ({pct}%)
      </Text>
      <Text>{"█".repeat(filled) + "░".repeat(10 - filled)} {detail}</Text>
    </Box>
  );
}

function ReadinessView({ readiness }) {
  const verdict = VERDICT_STYLE[readiness.verdict] || VERDICT_STYLE.HOLD;
  const b = readiness.breakdown;
  return (
    <Stack space="space.200">
      <SectionMessage title={`${readiness.score}/100 — ${verdict.label}`} appearance={verdict.tone}>
        <Text>
          {readiness.counts.done}/{readiness.counts.total} work items done ·{" "}
          {readiness.counts.blockers} open blocker(s) ·{" "}
          {readiness.counts.failingChecks} PR(s) failing checks
        </Text>
      </SectionMessage>

      <Heading as="h3">Score breakdown</Heading>
      <ScoreBar label="Completion" {...b.completion} />
      <ScoreBar label="Blockers" {...b.blockers} />
      <ScoreBar label="Code review" {...b.review} />
      <ScoreBar label="Quality gates" {...b.quality} />
      <ScoreBar label="Docs" {...b.docs} />

      {readiness.blockers.length > 0 && (
        <>
          <Heading as="h3">Blockers</Heading>
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH>Type</TH>
                <TH>Owner</TH>
                <TH>Next step</TH>
              </TR>
            </THead>
            <TBody>
              {readiness.blockers.map((row) => (
                <TR key={`${row.kind}-${row.key}`}>
                  <TD>
                    <Strong>{row.key}</Strong>
                    <Text>{row.summary}</Text>
                  </TD>
                  <TD>{row.kind}</TD>
                  <TD>{row.owner || "Unassigned"}</TD>
                  <TD>{row.action}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      <Heading as="h3">Recommended next steps</Heading>
      <List>
        {readiness.actions.map((a, i) => (
          <ListItem key={i}>
            <Text>{a}</Text>
          </ListItem>
        ))}
      </List>

      {readiness.notes.length > 0 && (
        <SectionMessage title="Notes — some data may be incomplete" appearance="information">
          {readiness.notes.map((n, i) => (
            <Text key={i}>• {n}</Text>
          ))}
        </SectionMessage>
      )}
    </Stack>
  );
}

function Dashboard() {
  const context = useProductContext();
  const projectKey = context?.extension?.project?.key || "";
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState("");
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [watching, setWatching] = useState(false);
  const [notesMsg, setNotesMsg] = useState("");

  useEffect(() => {
    if (!projectKey) return;
    invoke("getVersions", { projectKey })
      .then((vs) => {
        setVersions(vs);
        const next = vs.find((v) => !v.released && !v.archived) || vs[0];
        if (next) setVersion(next.name);
        else setLoading(false);
      })
      .catch((e) => {
        setError(`Could not list versions: ${e.message}`);
        setLoading(false);
      });
  }, [projectKey]);

  const refresh = (v) => {
    setLoading(true);
    setError("");
    invoke("getReadiness", { projectKey, version: v || version })
      .then((r) => {
        if (r.error) setError(r.error);
        else setReadiness(r);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (version) refresh(version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const watch = () => {
    invoke("watchRelease", { projectKey, version }).then(() => setWatching(true));
  };

  const draftNotes = () => {
    setNotesMsg("Ask ShipCheck in Rovo chat: “Draft release notes for " + version + "” — or pick a space below.");
    invoke("draftNotes", { projectKey, version, spaceKey: "" }).then((r) => {
      setNotesMsg(r.error || r.summary);
    });
  };

  if (!projectKey) {
    return <Text>Open ShipCheck from a Jira project to see its releases.</Text>;
  }

  return (
    <Stack space="space.300">
      <Heading as="h2">ShipCheck — Release Readiness · {projectKey}</Heading>

      <Inline space="space.200" alignBlock="center">
        <Text>
          <Strong>Release:</Strong>
        </Text>
        {versions
          .filter((v) => !v.archived)
          .map((v) => (
            <Button
              key={v.id}
              appearance={v.name === version ? "primary" : "default"}
              onClick={() => setVersion(v.name)}
            >
              {v.name}
              {v.released ? " (released)" : ""}
            </Button>
          ))}
        <Button onClick={() => refresh()} isDisabled={loading}>
          Refresh
        </Button>
        <Button onClick={watch} isDisabled={watching || !version}>
          {watching ? "Watching (hourly)" : "Watch this release"}
        </Button>
        <Button onClick={draftNotes} isDisabled={!version}>
          Draft release notes
        </Button>
      </Inline>

      {notesMsg && (
        <SectionMessage title="Release notes" appearance="information">
          <Text>{notesMsg}</Text>
        </SectionMessage>
      )}

      {loading && <Spinner size="medium" label="Scoring release…" />}
      {error && (
        <SectionMessage title="Could not score this release" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {!loading && !error && readiness && <ReadinessView readiness={readiness} />}
      {!loading && !error && !readiness && versions.length === 0 && (
        <Text>No versions in this project yet — create a fix version in Jira first.</Text>
      )}

      <Text>
        Scored deterministically from Jira work items, linked Bitbucket PRs and Confluence docs.{" "}
        <Link href="https://github.com/darendrarp/codegeist-2026-shipcheck">
          How scoring works
        </Link>
      </Text>
    </Stack>
  );
}

function IssuePanel() {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key || "";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!issueKey) return;
    invoke("getIssueReadiness", { issueKey })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setData({ error: e.message });
        setLoading(false);
      });
  }, [issueKey]);

  if (loading) return <Spinner size="medium" label="Loading…" />;
  if (!data || data.error) {
    return <Text>{data?.error || "Could not load release context."}</Text>;
  }
  if (!data.readiness) {
    return <Text>{data.note}</Text>;
  }
  const r = data.readiness;
  const verdict = VERDICT_STYLE[r.verdict] || VERDICT_STYLE.HOLD;
  return (
    <Stack space="space.200">
      <Text>
        Release <Strong>{r.version.name}</Strong>: {r.score}/100 — {verdict.label}
      </Text>
      <Text>
        {r.counts.done}/{r.counts.total} done · {r.counts.blockers} blocker(s)
      </Text>
      <Text>
        <Strong>Next:</Strong> {r.actions[0]}
      </Text>
    </Stack>
  );
}

const App = () => {
  const context = useProductContext();
  const type = context?.extension?.type;
  if (type === "jira:issuePanel") return <IssuePanel />;
  return <Dashboard />;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
