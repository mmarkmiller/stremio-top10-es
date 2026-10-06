/** Public daily streaming charts by country, used when FlixPatrol is unavailable. */
import type { Entry, ListKey } from "../types.ts";

const SPAIN_PACKAGES: Record<string, string> = {
  netflix: "nfx",
  disney: "dnp",
  prime: "prv",
  apple: "atp",
  hbo: "mxx",
  movistar: "mp9",
  skyshowtime: "sst",
};
const REGIONS: Record<string, { code: string; packages: Record<string, string> }> = {
  spain: { code: "ES", packages: SPAIN_PACKAGES },
  "united-states": { code: "US", packages: { netflix: "nfx", disney: "dnp", prime: "amp", apple: "atp", hbo: "mxx" } },
};
export type Ranking = { entries: Entry[]; updatedAt: string };
export async function fetchJustWatch(key: string, list: ListKey, country = "spain"): Promise<Ranking> {
  const region = REGIONS[country];
  // Daily charts do not expose a separate kids chart. Never relabel the adult chart as kids.
  if (!region || list.startsWith("kids-") || (key !== "global" && !region.packages[key]))
    return { entries: [], updatedAt: "" };
  const objectType = list === "series" ? "SHOW" : "MOVIE";
  const packages = key === "global" ? "" : `, packages: [${JSON.stringify(region.packages[key])}]`;
  const query = `query {
    streamingCharts(country: ${region.code}, first: 10,
      filter: {category: DAILY_POPULARITY_SAME_CONTENT_TYPE, objectType: ${objectType}${packages}}) {
      edges { streamingChartInfo { rank updatedAt }
        node { id objectType content(country: ${region.code}, language: es) { title fullPath originalReleaseYear } }
      }
    }
  }`;
  const response = await fetch("https://apis.justwatch.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "stremio-top10-es/2.0" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`JustWatch HTTP ${response.status}`);
  const json = (await response.json()) as any;
  if (json.errors?.length) throw new Error(`JustWatch: ${json.errors[0].message}`);
  const edges = json.data?.streamingCharts?.edges;
  if (!Array.isArray(edges)) throw new Error("JustWatch: respuesta sin ranking");
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const node = edge.node;
    const content = node?.content;
    if (!node?.id || seen.has(node.id) || node.objectType !== objectType || !content?.title) continue;
    seen.add(node.id);
    entries.push({
      rank: entries.length + 1,
      title: content.title,
      fpSlug: `jw-${node.id}`,
      year: Number.isInteger(content.originalReleaseYear) ? content.originalReleaseYear : null,
      days: null,
      trend: { dir: "same", delta: null },
    });
  }
  return { entries, updatedAt: edges[0]?.streamingChartInfo?.updatedAt ?? "" };
}
