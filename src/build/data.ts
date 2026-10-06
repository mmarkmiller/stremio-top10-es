/**
 * data.ts — lecture/écriture de l'arbre `public/data/<pays>/<source>/<liste>.json`.
 *
 * Ces fichiers sont la SOURCE DE VÉRITÉ : ils alimentent le catalogue (côté Worker) ET la régénération
 * des affiches (côté robot). Ils sont versionnés (committés par la CI) → persistance du filet de sécurité
 * « garder la veille » : si un scrape échoue, on ne réécrit pas le fichier et celui de la veille subsiste.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR, LIST_KEYS, dataFilePath } from "../config.ts";
import type { DataEntry, DataFile, ListKey } from "../types.ts";

/** Écrit un fichier de données (pays, source, liste). */
export function writeDataFile(
  country: string,
  key: string,
  list: ListKey,
  date: string,
  entries: DataEntry[],
  rankingSource: "flixpatrol" | "justwatch" = "flixpatrol",
  rankingUpdatedAt = "",
): void {
  const file = dataFilePath(country, key, list);
  mkdirSync(dirname(file), { recursive: true });
  const payload: DataFile = { country, key, list, date, entries, rankingSource, rankingUpdatedAt };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Lit un fichier de données s'il existe (et est valide), sinon null. */
export function readDataFile(country: string, key: string, list: ListKey): DataFile | null {
  const file = dataFilePath(country, key, list);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DataFile;
  } catch {
    return null;
  }
}

/** Vrai si un fichier de données existe déjà (= une version de la veille à conserver). */
export function dataFileExists(country: string, key: string, list: ListKey): boolean {
  return existsSync(dataFilePath(country, key, list));
}

/** Parcourt tout l'arbre `data/` et renvoie les fichiers présents (frais ou conservés de la veille). */
export function scanDataFiles(): DataFile[] {
  if (!existsSync(DATA_DIR)) return [];
  const out: DataFile[] = [];
  for (const country of readdirSync(DATA_DIR)) {
    const countryDir = join(DATA_DIR, country);
    if (!isDir(countryDir)) continue;
    for (const key of readdirSync(countryDir)) {
      const keyDir = join(countryDir, key);
      if (!isDir(keyDir)) continue;
      for (const f of readdirSync(keyDir)) {
        if (!f.endsWith(".json")) continue;
        const list = f.slice(0, -".json".length) as ListKey;
        if (!LIST_KEYS.includes(list)) continue;
        const data = readDataFile(country, key, list);
        if (data?.entries?.length) out.push(data);
      }
    }
  }
  return out;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
