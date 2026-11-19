// Confluence access for ShipCheck (Forge backend, as the user).

import api, { route } from "@forge/api";

/** Does a release-notes page already exist for this version? */
export async function findReleaseNotesPage(spaceKey, versionName) {
  const cql = `title ~ "Release Notes ${versionName}" and type = page` +
    (spaceKey ? ` and space = ${spaceKey}` : "");
  const res = await api
    .asUser()
    .requestConfluence(route`/rest/api/content/search?cql=${cql}&limit=5`);
  if (!res.ok) return { exists: false, error: `confluence search failed (${res.status})` };
  const json = await res.json();
  const page = (json.results || [])[0];
  return page
    ? { exists: true, page: { id: page.id, title: page.title, url: page._links?.webui } }
    : { exists: false };
}

/** Create the release-notes page (storage format XHTML body). */
export async function createReleaseNotesPage(spaceKey, title, storageFormat) {
  const res = await api
    .asUser()
    .requestConfluence(route`/rest/api/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "page",
        title,
        space: { key: spaceKey },
        body: { storage: { value: storageFormat, representation: "storage" } },
      }),
    });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `page create failed (${res.status}): ${text.slice(0, 200)}` };
  }
  const page = await res.json();
  return { ok: true, page: { id: page.id, title: page.title, url: page._links?.webui } };
}
