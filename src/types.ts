/**
 * types.ts — types partagés du générateur « Top 10 ES 🇪🇸 ».
 *
 * Flux : FlixPatrol (Markdown via r.jina.ai) → `Entry` → résolution TMDB → `DataEntry` (stocké dans
 * `data/`, source de vérité commune au catalogue ET à la régénération d'affiche). Le Worker Cloudflare
 * lit ensuite ces fichiers `data/` et assemble les réponses Stremio (`MetaPreview`) selon la config.
 */

/** Type de média côté Stremio (catalogue/manifest). */
export type MediaType = "movie" | "series";

/** Type de média côté TMDB (endpoints). */
export type TmdbType = "movie" | "tv";

/** Public visé d'une liste : grand public ou jeunesse. */
export type Audience = "main" | "kids";

/**
 * Clé de liste = audience + média, encodée en chaîne (sert de nom de fichier et de segment d'URL).
 * Quatre valeurs : grand public (`movie`/`series`) et jeunesse (`kids-movie`/`kids-series`).
 */
export type ListKey = "movie" | "series" | "kids-movie" | "kids-series";

/** Tendance d'un titre dans le Top 10 (fournie par FlixPatrol). */
export type Trend = {
  dir: "up" | "down" | "same" | "new";
  delta: number | null; // nombre de places gagnées/perdues (null si inconnu)
};

/** Un pays dont on peut tirer un classement (slug FlixPatrol + libellé FR + drapeau). */
export type Country = {
  slug: string; // slug FlixPatrol (ex. "france", "united-states")
  name: string; // libellé français (ex. "États-Unis")
  flag: string; // emoji drapeau (ex. "🇫🇷")
};

/**
 * Une source = une plateforme (Netflix…) ou l'agrégat « toutes plateformes » (slug FlixPatrol `streaming`).
 * `key` est l'identifiant court utilisé dans les chemins, noms d'affiches et ids de catalogue.
 */
export type Source = {
  key: string; // identifiant court (netflix, disney, …, global) — chemins/affiches/catalogue
  slug: string; // slug FlixPatrol (netflix, amazon-prime, hbo-max, …, streaming)
  name: string; // nom affiché avec emoji (ex. "🔴 Netflix")
  /** En-têtes de section du Markdown FlixPatrol par liste. `movie` peut être dérivé d'`overall` (Canal+). */
  sections: Partial<Record<ListKey, string>> & { overall?: string };
};

/** Une entrée brute du Top 10 FlixPatrol (avant résolution TMDB). */
export type Entry = {
  rank: number; // 1..10
  title: string; // titre tel qu'affiché par FlixPatrol (souvent en anglais)
  fpSlug: string; // slug FlixPatrol (clé de cache stable + indice d'année)
  year: number | null; // année extraite du slug si présente
  days: number | null; // nombre de jours consécutifs dans le Top 10
  trend: Trend;
};

/** Un titre résolu sur TMDB (fiche FR + identifiants). */
export type Title = {
  posterTitleOverlay?: boolean;
  artworkVersion?: number;
  description?: string;
  genres?: string[];
  background?: string;
  logo?: string;
  runtime?: string;
  director?: string[];
  cast?: string[];

  tmdbId: number; // 0 si non résolu
  tmdbType: TmdbType;
  imdbId: string | null; // tt… (id du meta si présent)
  titleEs: string; // titre français (champ name)
  year: number | null;
  posterUrl: string | null; // affiche TMDB d'origine (source de l'affiche custom)
  rating: number | null; // note TMDB (vote_average), 0 → null
};

/**
 * Entrée enrichie stockée dans `data/<country>/<key>/<list>.json`. SOURCE DE VÉRITÉ : sert à la fois à
 * construire le catalogue (côté Worker) et à régénérer l'affiche custom (côté robot, via `tmdbPosterUrl`).
 */
export type DataEntry = {
  posterTitleOverlay?: boolean;
  artworkVersion?: number;
  description?: string;
  genres?: string[];
  background?: string;
  logo?: string;
  runtime?: string;
  director?: string[];
  cast?: string[];

  rank: number;
  id: string; // id du meta Stremio : tt… (IMDb) ou tmdb:<id> en repli
  name: string; // titre français
  tmdbPosterUrl: string | null; // affiche TMDB source (pour régénérer l'affiche ; ignoré par le Worker)
  rating: number | null;
  year: number | null;
  days: number | null;
  trend: Trend;
};

/** Contenu d'un fichier `data/<country>/<key>/<list>.json` (contrat robot ↔ Worker). */
export type DataFile = {
  country: string; // slug du pays
  key: string; // clé de la source (netflix, …, global)
  list: ListKey;
  date: string; // AAAA-MM-JJ de la dernière mise à jour réussie (cache-buster des affiches)
  entries: DataEntry[];
  rankingSource?: "flixpatrol" | "justwatch";
  rankingUpdatedAt?: string;
};

/**
 * `availability.json` : ce que le générateur a réellement produit (combos pays × source × liste valides).
 * La page de configuration s'en sert pour ne proposer que des choix qui existent.
 */
export type Availability = {
  date: string;
  rankings?: Array<{ country: string; key: string; list: ListKey; source: string; updatedAt: string }>;
  countries: Country[];
  sources: Array<{ key: string; name: string }>;
  /** combos[country][sourceKey] = listes disponibles (ex. ["movie","series","kids-movie"]). */
  combos: Record<string, Record<string, ListKey[]>>;
};

/** Objet « meta preview » d'un catalogue Stremio (une carte de la grille) — construit par le Worker. */
export type MetaPreview = {
  id: string; // tt… ou tmdb:<id>
  type: MediaType;
  name: string;
  poster: string; // URL de l'affiche custom (GitHub Pages)
  posterShape?: "poster" | "square" | "landscape";
};
