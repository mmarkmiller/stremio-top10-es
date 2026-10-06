/**
 * resolve.ts — résout une entrée FlixPatrol (titre souvent EN) en fiche TMDB française.
 *
 * Stratégie de recherche : es-ES avec année → es-ES sans année → en-US avec année → en-US sans année.
 * Désambiguïsation par score (année exacte, titre exact normalisé, popularité). En dernier recours,
 * on renvoie un `Title` minimal (sans TMDB) pour ne jamais casser une rangée.
 */
import { TMDB_IMG } from "../config.ts";
import type { Entry, MediaType, Title, TmdbType } from "../types.ts";
import type { CacheEntry } from "./cache.ts";
import { externalIds, getDetails, searchTitle } from "./client.ts";

/** Résout une entrée en `Title` (fiche FR + imdbId + affiche + note), via le cache si possible. */
export async function resolveTitle(entry: Entry, type: MediaType, cache: Map<string, CacheEntry>): Promise<Title> {
  const tmdbType: TmdbType = type === "series" ? "tv" : "movie";

  const cached = cache.get(entry.fpSlug);
  if (cached && cached.tmdbType === tmdbType && cached.tmdbId && cached.artworkVersion === 1) {
    const { ts: _ts, ...title } = cached;
    return title;
  }

  let results = await searchTitle(tmdbType, entry.title, entry.year, "es-ES");
  if (!results.length) results = await searchTitle(tmdbType, entry.title, null, "es-ES");
  if (!results.length) results = await searchTitle(tmdbType, entry.title, entry.year, "en-US");
  if (!results.length) results = await searchTitle(tmdbType, entry.title, null, "en-US");

  if (!results.length) {
    console.error(`  ⚠️ TMDB introuvable : « ${entry.title} » (${tmdbType}, ${entry.year ?? "?"})`);
    return { tmdbId: 0, tmdbType, imdbId: null, titleEs: entry.title, year: entry.year, posterUrl: null, rating: null };
  }

  const best = pickBest(results, entry, tmdbType);
  const [details, imdbId] = await Promise.all([getDetails(tmdbType, best.id, "es-ES"), externalIds(tmdbType, best.id)]);

  const titleEs = (tmdbType === "tv" ? details.name : details.title) || entry.title;
  const images = details.images ?? {};
  // Les images sans langue sont les variantes sans texte enregistrées par TMDB.
  const byVotes = (a: any, b: any) =>
    (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.vote_average ?? 0) - (a.vote_average ?? 0);
  const cleanPosters = (images.posters ?? []).filter((i: any) => i.iso_639_1 === null).sort(byVotes);
  const posterPath = cleanPosters[0]?.file_path ?? details.poster_path;
  const posterUrl = posterPath ? TMDB_IMG + posterPath : null;
  const logos = (images.logos ?? []).filter((i: any) => i.file_path?.endsWith(".png"));
  const logo = ["es", "en", null].flatMap((lang) => logos.filter((i: any) => i.iso_639_1 === lang).sort(byVotes))[0];
  const backdrop =
    (images.backdrops ?? []).filter((i: any) => i.iso_639_1 === null).sort(byVotes)[0]?.file_path ??
    details.backdrop_path;
  const date = tmdbType === "tv" ? details.first_air_date : details.release_date;
  const rating = typeof details.vote_average === "number" && details.vote_average > 0 ? details.vote_average : null;

  const title: Title = {
    artworkVersion: 1,
    description: details.overview || undefined,
    genres: details.genres?.map((g: any) => g.name),
    background: backdrop ? `https://image.tmdb.org/t/p/w1280${backdrop}` : undefined,
    logo: logo ? `https://image.tmdb.org/t/p/w500${logo.file_path}` : undefined,
    runtime: details.runtime ? `${details.runtime} min` : undefined,
    director: details.credits?.crew?.filter((c: any) => c.job === "Director").map((c: any) => c.name),
    cast: details.credits?.cast?.slice(0, 8).map((c: any) => c.name),
    tmdbId: best.id,
    tmdbType,
    imdbId,
    titleEs,
    year: parseYear(date) ?? entry.year,
    posterUrl,
    rating,
  };
  cache.set(entry.fpSlug, { ...title, ts: new Date().toISOString().slice(0, 10) });
  return title;
}

/** Choisit le meilleur candidat TMDB par score (année exacte > titre exact > popularité). */
function pickBest(results: any[], entry: Entry, type: TmdbType): any {
  const target = normalize(entry.title);
  let best = results[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const r of results) {
    const rTitle = type === "tv" ? r.name : r.title;
    const rOrig = type === "tv" ? r.original_name : r.original_title;
    const rYear = parseYear(type === "tv" ? r.first_air_date : r.release_date);
    let score = 0;
    if (entry.year && rYear === entry.year) score += 4;
    if (normalize(rTitle ?? "") === target || normalize(rOrig ?? "") === target) score += 3;
    score += Math.min(2, (r.popularity ?? 0) / 50);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** Normalise un titre pour comparaison : minuscules, sans accents ni ponctuation. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // retire les accents (après NFD, « café » → « cafe »)
    .replace(/[^a-z0-9]/g, "");
}

function parseYear(date: string | undefined | null): number | null {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isInteger(y) && y >= 1900 ? y : null;
}
