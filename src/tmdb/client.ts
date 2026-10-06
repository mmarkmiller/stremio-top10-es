/**
 * client.ts — client minimal de l'API TMDB (recherche, identifiants externes, détails).
 *
 * Auth : token v4 « Read Access Token » (`TMDB_READ_TOKEN`, en Bearer) en priorité ; repli sur la
 * clé v3 (`TMDB_API_KEY`, en query `?api_key=`). Retries sur 429/5xx (respecte `Retry-After`).
 */
import type { TmdbType } from "../types.ts";

const TMDB = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function auth(): { headers: Record<string, string>; apiKey: string | null } {
  const token = process.env.TMDB_READ_TOKEN;
  const key = process.env.TMDB_API_KEY;
  if (token) return { headers: { Authorization: `Bearer ${token}` }, apiKey: null };
  if (key) return { headers: {}, apiKey: key };
  throw new Error("TMDB : ni TMDB_READ_TOKEN ni TMDB_API_KEY dans l'environnement.");
}

async function tmdb(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const { headers, apiKey } = auth();
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  }
  if (apiKey) u.searchParams.set("api_key", apiKey);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(u, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 429 || r.status >= 500) {
      const retryAfter = Number(r.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000);
      continue;
    }
    const json = await r.json();
    if (!r.ok) throw new Error(`TMDB ${path} → HTTP ${r.status} : ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }
  throw new Error(`TMDB ${path} → échec après retries (429/5xx persistants).`);
}

/** Recherche un titre (films ou séries). `year` filtre par année si fourni. */
export async function searchTitle(type: TmdbType, query: string, year: number | null, lang = "es-ES"): Promise<any[]> {
  const yearParam = type === "movie" ? { year: year ?? undefined } : { first_air_date_year: year ?? undefined };
  const j = await tmdb(`/search/${type}`, { query, language: lang, include_adult: "false", ...yearParam });
  return Array.isArray(j.results) ? j.results : [];
}

/** Identifiant IMDb (`tt…`) d'un titre TMDB, ou null. */
export async function externalIds(type: TmdbType, id: number): Promise<string | null> {
  const j = await tmdb(`/${type}/${id}/external_ids`);
  return typeof j.imdb_id === "string" && j.imdb_id ? j.imdb_id : null;
}

/** Détails d'un titre (titre localisé, affiche, note, date) dans la langue demandée. */
export async function getDetails(type: TmdbType, id: number, lang = "es-ES"): Promise<any> {
  return tmdb(`/${type}/${id}`, { language: lang });
}
