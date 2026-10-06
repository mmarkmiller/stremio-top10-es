/**
 * availability.ts — écrit `public/availability.json` : la carte des combinaisons réellement produites
 * (pays × source × listes). La page de configuration et le Worker s'en servent pour ne proposer/servir
 * que ce qui existe vraiment (une plateforme absente dans un pays n'apparaît pas).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_DAY, COUNTRIES, LIST_KEYS, PUBLIC_DIR, SOURCES } from "../config.ts";
import type { Availability, DataFile, ListKey } from "../types.ts";

/** Construit l'objet availability à partir des fichiers de données réellement présents. */
export function buildAvailability(files: DataFile[]): Availability {
  const combos: Record<string, Record<string, ListKey[]>> = {};
  for (const f of files) {
    let byCountry = combos[f.country];
    if (!byCountry) {
      byCountry = {};
      combos[f.country] = byCountry;
    }
    let lists = byCountry[f.key];
    if (!lists) {
      lists = [];
      byCountry[f.key] = lists;
    }
    if (!lists.includes(f.list)) lists.push(f.list);
  }
  // Tri des listes dans l'ordre canonique (movie, series, kids-movie, kids-series) pour un JSON stable.
  for (const byCountry of Object.values(combos)) {
    for (const key of Object.keys(byCountry)) {
      byCountry[key] = LIST_KEYS.filter((l) => byCountry[key]?.includes(l));
    }
  }
  return {
    date: BUILD_DAY,
    rankings: files.map((f) => ({
      country: f.country,
      key: f.key,
      list: f.list,
      source: f.rankingSource ?? "flixpatrol",
      updatedAt: f.rankingUpdatedAt || f.date,
    })),
    countries: COUNTRIES.filter((c) => combos[c.slug]),
    sources: SOURCES.filter((s) => Object.values(combos).some((byCountry) => byCountry[s.key])).map((s) => ({
      key: s.key,
      name: s.name,
    })),
    combos,
  };
}

/** Écrit `public/availability.json`. */
export function writeAvailability(availability: Availability): void {
  writeFileSync(join(PUBLIC_DIR, "availability.json"), `${JSON.stringify(availability, null, 2)}\n`);
}
