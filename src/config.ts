/**
 * config.ts — constantes du générateur « Top 10 ES 🇪🇸 » (pays, sources, listes, chemins, réglages).
 *
 * Les chemins sont résolus par rapport à la RACINE du dépôt (calculée depuis ce fichier),
 * pour que le générateur écrive au bon endroit quel que soit le répertoire courant.
 */
import { dirname, join } from "node:path";
import type { Audience, Country, ListKey, MediaType, Source, TmdbType } from "./types.ts";

// ─────────── Chemins ───────────
/** Racine du dépôt : ce fichier vit dans `src/`, donc on remonte d'un cran. */
export const ROOT = dirname(import.meta.dir);
export const PUBLIC_DIR = join(ROOT, "public");
export const CACHE_DIR = join(ROOT, "cache");
export const DATA_DIR = join(PUBLIC_DIR, "data");
export const POSTERS_DIR = join(PUBLIC_DIR, "posters");

/** Chemin du fichier de données d'une (pays, source, liste). */
export function dataFilePath(country: string, key: string, list: ListKey): string {
  return join(DATA_DIR, country, key, `${list}.json`);
}

/** Clé d'affiche stable `<pays>-<source>-<liste>-<rang>` (l'URL ne change pas, le contenu oui). */
export function posterKey(country: string, key: string, list: ListKey, rank: number): string {
  return `${country}-${key}-${list}-${rank}`;
}

// ─────────── Publication ───────────
/** Déploiement de référence — dernier repli quand on tourne hors CI et sans override. */
export const PAGES_BASE = "https://mmarkmiller.github.io/stremio-top10-es";

/**
 * Base de l'URL publique servie (sert à fabriquer les URLs d'affiches), par ordre de priorité :
 *   1. `ADDON_BASE_URL` — override explicite (dev local, tunnel, domaine perso) ;
 *   2. en CI GitHub Actions : dérivée de `GITHUB_REPOSITORY` → l'URL GitHub Pages du dépôt.
 *      Un FORK fonctionne ainsi SANS configuration : ses affiches pointent vers SON propre Pages ;
 *   3. à défaut : le déploiement de référence ci-dessus.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.ADDON_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const repo = process.env.GITHUB_REPOSITORY?.trim(); // format "owner/name"
  const [owner, name] = repo?.split("/") ?? [];
  if (owner && name) {
    const host = `${owner.toLowerCase()}.github.io`;
    // Dépôt nommé « owner.github.io » → Pages à la racine ; sinon Pages de projet « /name ».
    return name.toLowerCase() === host ? `https://${host}` : `https://${host}/${name}`;
  }
  return PAGES_BASE;
}

/** Base réellement servie (voir `resolveBaseUrl`). */
export const BASE_URL = resolveBaseUrl();
/** Préfixe des affiches TMDB (w780 = bon compromis qualité/poids). */
export const TMDB_IMG = "https://image.tmdb.org/t/p/w780";
/** Date du run AAAAMMJJ (UTC) — version du manifest + paramètre anti-cache des affiches. */
export const BUILD_DATE = ((d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
})();
/** Date AAAA-MM-JJ (UTC) — affichée dans `availability.json`. */
export const BUILD_DAY = `${BUILD_DATE.slice(0, 4)}-${BUILD_DATE.slice(4, 6)}-${BUILD_DATE.slice(6, 8)}`;
/**
 * Tampon de build AAAAMMJJHHMM (UTC) — stocké dans les fichiers `data/` et utilisé comme `?v=` des affiches.
 * Inclut l'heure : un re-build le MÊME jour change le tampon → casse le cache CDN/app (les corrections de
 * la journée se propagent, sans attendre le changement de date).
 */
export const BUILD_STAMP = `${BUILD_DATE}${((d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
})()}`;

// ─────────── Réglages ───────────
/** Seuil de santé : en dessous de N entrées résolues, on garde la veille (filet de sécurité). */
export const HEALTH_MIN = 8;
/** Forme d'affiche (figée après validation visuelle TV). */
export const POSTER_SHAPE = "poster" as const;

/** Les quatre listes possibles, dans l'ordre de génération. */
export const LIST_KEYS: ListKey[] = ["movie", "series", "kids-movie", "kids-series"];

/** Média Stremio d'une liste (`kids-movie` reste un film). */
export function listMedia(list: ListKey): MediaType {
  return list.endsWith("series") ? "series" : "movie";
}
/** Type TMDB d'une liste. */
export function listTmdbType(list: ListKey): TmdbType {
  return listMedia(list) === "series" ? "tv" : "movie";
}
/** Public d'une liste. */
export function listAudience(list: ListKey): Audience {
  return list.startsWith("kids") ? "kids" : "main";
}

// ─────────── Países del ranking ───────────
export const COUNTRIES: Country[] = [
  { slug: "spain", name: "España", flag: "🇪🇸" },
  { slug: "united-states", name: "Estados Unidos", flag: "🇺🇸" },
];
/** Pays par défaut (config simple sans personnalisation + rétro-compat). */
export const DEFAULT_COUNTRY = "spain";

// ─────────── Sources (plateformes + agrégat « toutes plateformes ») ───────────
const STD_SECTIONS = {
  movie: "TOP 10 Movies",
  series: "TOP 10 TV Shows",
  "kids-movie": "TOP 10 Kids Movies",
  "kids-series": "TOP 10 Kids TV Shows",
} as const;

/** Plataformas; se muestran solo cuando tienen rankings españoles. */
export const PLATFORMS: Source[] = [
  { key: "netflix", slug: "netflix", name: "🔴 Netflix", sections: { ...STD_SECTIONS } },
  { key: "disney", slug: "disney", name: "🏰 Disney+", sections: { ...STD_SECTIONS } },
  { key: "prime", slug: "amazon-prime", name: "📦 Prime Video", sections: { ...STD_SECTIONS } },
  { key: "apple", slug: "apple-tv", name: "🍎 Apple TV+", sections: { ...STD_SECTIONS } },
  { key: "hbo", slug: "hbo-max", name: "🎭 HBO Max", sections: { ...STD_SECTIONS } },
  { key: "skyshowtime", slug: "skyshowtime", name: "🗻 SkyShowtime", sections: { ...STD_SECTIONS } },
  { key: "movistar", slug: "movistar-plus", name: "📡 Movistar Plus+", sections: { ...STD_SECTIONS } },
];

/** Agrégat « toutes plateformes confondues » (FlixPatrol slug `streaming`). */
export const GLOBAL: Source = {
  key: "global",
  slug: "streaming",
  name: "🌍 Todas las plataformas",
  sections: { movie: "TOP 10 Movies", series: "TOP 10 TV Shows" },
};

/** Toutes les sources générées (plateformes + global). */
export const SOURCES: Source[] = [...PLATFORMS, GLOBAL];
