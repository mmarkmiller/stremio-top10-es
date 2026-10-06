/**
 * cache.ts — cache persistant des correspondances « slug FlixPatrol → fiche TMDB ».
 *
 * Clé = `fpSlug` (stable, contrairement au titre qui change de casse/langue). But : éviter de
 * réinterroger TMDB chaque jour pour les mêmes titres (vitesse, stabilité, moins d'appels API).
 * Le fichier `cache/tmdb-map-es-ES.json` est versionné (committé par la CI) → diffs Git propres (clés triées).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "../config.ts";
import type { Title } from "../types.ts";

/** Entrée de cache = une fiche `Title` + la date de mise en cache. */
export type CacheEntry = Title & { ts: string };

const FILE = join(CACHE_DIR, "tmdb-map-es-ES.json");

export function loadCache(): Map<string, CacheEntry> {
  if (!existsSync(FILE)) return new Map();
  try {
    const obj = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, CacheEntry>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map(); // cache corrompu → on repart à neuf (sans casser le run)
  }
}

export function saveCache(cache: Map<string, CacheEntry>): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const obj: Record<string, CacheEntry> = {};
  for (const key of [...cache.keys()].sort()) obj[key] = cache.get(key)!;
  writeFileSync(FILE, `${JSON.stringify(obj, null, 2)}\n`);
}
