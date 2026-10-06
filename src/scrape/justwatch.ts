/** Public daily streaming charts for Spain, used when FlixPatrol is unavailable. */
import type { Entry, ListKey } from "../types.ts";

const PACKAGES: Record<string, string> = {
  netflix: "nfx",
  disney: "dnp",
  prime: "prv",
  apple: "atp",
  hbo: "mxx",
  movistar: "mp9",
  skyshowtime: "sst",
};
export type Ranking = { entries: Entry[]; updatedAt: string };
export async function fetchJustWatch(key: string, list: ListKey): Promise<Ranking> {
  // Daily charts do not expose a separate kids chart. Never relabel the adult chart as kids.
  if (list.startsWith("kids-") || (key !== "global" && !PACKAGES[key])) return { entries: [], updatedAt: "" };
  const objectType = list === "series" ? "SHOW" : "MOVIE";
  const packages = key === "global" ? "" : `, packages: [${JSON.stringify(PACKAGES[key])}]`;
  const query = `query {
    streamingCharts(country: ES, first: 10,
      filter: {category: DAILY_POPULARITY_SAME_CONTENT_TYPE, objectType: ${objectType}${packages}}) {
      edges { streamingChartInfo { rank updatedAt }
        node { id objectType content(country: ES, language: es) { title fullPath originalReleaseYear } }
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
