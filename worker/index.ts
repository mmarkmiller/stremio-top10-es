/**
 * index.ts — Worker Cloudflare qui sert l'addon Stremio « Top 10 ES 🇪🇸 » configurable.
 *
 * Architecture hybride : les DONNÉES (listes + affiches) sont pré-générées et servies en statique par
 * GitHub Pages ; ce Worker ne fait que la LOGIQUE légère — décoder la config de l'URL, choisir les bons
 * fichiers statiques et assembler les réponses Stremio. Aucune image n'est composée ici.
 *
 * Routes (sous le domaine du Worker) :
 *   GET /                                    → page de configuration (HTML)
 *   GET /configure                           → idem (accepte `#<config>` pour pré-remplir)
 *   GET /availability.json                   → proxy des données statiques (même origine pour la page)
 *   GET /manifest.json                       → manifest « à configurer » (sans config)
 *   GET /<config>/manifest.json              → manifest selon la config (catalogues activés)
 *   GET /<config>/catalog/<type>/<id>.json   → contenu d'un catalogue
 *
 * <config> = base64url(JSON.stringify(Config)). Config = { v, sel: [{k,c,m,s,label?,cmode?,ctext?}], kids?, ts? }.
 */
import CONFIGURE_HTML from "./configure.html";

export interface Env {
  /** Base des données statiques (GitHub Pages). Injectée par wrangler.toml ([vars]). */
  PAGES_BASE?: string;
}

/**
 * Une sélection : source `k` (netflix…/global), pays, films `m`, séries `s`.
 * Pays : `cs` (tableau, multi-pays) si présent, sinon `c` (un seul pays — format historique, compat).
 * Personnalisation du nom du catalogue (facultative) : `label` (partie libre), `cmode` (affichage du
 * pays : « full » en toutes lettres / « flag » drapeau / « custom » texte libre), `ctext` (texte custom).
 * IDs de catalogue : `k` quand un seul pays (compat) ; `k_<pays>` quand plusieurs (évite les collisions).
 */
type Sel = {
  k: string;
  c?: string;
  cs?: string[];
  m?: boolean;
  s?: boolean;
  label?: string;
  cmode?: "full" | "flag" | "custom";
  ctext?: string;
};

/** Pays d'une sélection, normalisés : `cs` (multi) sinon `[c]` (mono), sinon `[]`. */
function selCountries(sel: Sel): string[] {
  return sel.cs?.length ? sel.cs : sel.c ? [sel.c] : [];
}
/** Config encodée dans l'URL. `ts` = Nuvio ajoute lui-même le type « - Film/- Série » (défaut true). */
type Config = { v: number; sel: Sel[]; kids?: boolean; ts?: boolean };

type ListKey = "movie" | "series" | "kids-movie" | "kids-series";

const DEFAULT_PAGES = "http://localhost:8088";
const ADDON_NAME = "Top 10 ES 🇪🇸 🔟";
/** Forme « en toutes lettres » du pays (préposition correcte) — pour le mode d'affichage « full ». */
const COUNTRY_LOC: Record<string, string> = {
  spain: "en España",
  france: "en Francia",
  belgium: "en Bélgica",
  switzerland: "en Suiza",
  canada: "en Canadá",
  "united-states": "en Estados Unidos",
  "united-kingdom": "en Reino Unido",
};
const ADDON_DESC =
  "Top 10 de España por plataforma: películas y series, metadatos en español y carátulas con números grandes.";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    const url = new URL(req.url);
    const pages = (env.PAGES_BASE || DEFAULT_PAGES).replace(/\/+$/, "");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      // Routes sans préfixe de config.
      if (parts.length === 0 || (parts.length === 1 && parts[0] === "configure")) return html(CONFIGURE_HTML);
      if (parts.length === 1 && parts[0] === "availability.json") return await proxyJson(`${pages}/availability.json`);
      if (parts.length === 1 && parts[0] === "manifest.json") return json(stubManifest(url.origin, pages));

      // Routes avec préfixe de config : /<config>/…
      const cfgSeg = parts[0] ?? "";
      const rest = parts.slice(1);
      if (rest.length === 1 && rest[0] === "manifest.json") {
        return json(await buildManifest(cfgSeg, pages, url.origin));
      }
      if (rest[0] === "catalog" && rest.length >= 3) {
        const type = rest[1] ?? "";
        // L'id peut être suivi d'un segment « extra » et finit par .json — on ne garde que l'id.
        const id = (rest[2] ?? "").replace(/\.json$/, "");
        return json(await buildCatalog(cfgSeg, pages, type, id));
      }
      return notFound();
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 400,
        headers: jsonHeaders(),
      });
    }
  },
};

// ─────────── Construction des réponses Stremio ───────────

/** Manifest « à configurer » (quand on installe l'URL nue, sans config). */
function stubManifest(origin: string, pages: string) {
  return {
    id: "es.marc.top10",
    version: "2.0.0",
    name: ADDON_NAME,
    description: ADDON_DESC,
    logo: `${pages}/posters/_logo.png`,
    resources: ["catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb:"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true, configurationURL: `${origin}/configure` },
  };
}

/** Manifest personnalisé : un catalogue par (source × type) activé et réellement disponible. */
async function buildManifest(cfgSeg: string, pages: string, origin: string) {
  const cfg = decodeConfig(cfgSeg);
  const avail = await fetchJson(`${pages}/availability.json`);
  const flag = (c: string): string => avail.countries.find((x: any) => x.slug === c)?.flag ?? "";
  const sourceName = (k: string): string => avail.sources.find((x: any) => x.key === k)?.name ?? k;
  const has = (c: string, k: string, list: ListKey): boolean => !!avail.combos?.[c]?.[k]?.includes(list);
  const ts = cfg.ts !== false; // défaut true : Nuvio ajoute lui-même « - Film » / « - Série »

  const catalogs: Array<{ type: string; id: string; name: string }> = [];
  for (const sel of cfg.sel) {
    const sn = sourceName(sel.k);
    const countries = selCountries(sel);
    const multi = countries.length > 1; // IDs suffixés par pays seulement si plusieurs (sinon compat)
    for (const c of countries) {
      const fl = flag(c);
      const id = multi ? `${sel.k}_${c}` : sel.k;
      if (sel.m && has(c, sel.k, "movie")) {
        catalogs.push({ type: "movie", id, name: catalogName(sel, sn, c, fl, false, "movie", ts) });
      }
      if (sel.s && has(c, sel.k, "series")) {
        catalogs.push({ type: "series", id, name: catalogName(sel, sn, c, fl, false, "series", ts) });
      }
      if (cfg.kids && sel.m && has(c, sel.k, "kids-movie")) {
        catalogs.push({ type: "movie", id: `${id}-kids`, name: catalogName(sel, sn, c, fl, true, "movie", ts) });
      }
      if (cfg.kids && sel.s && has(c, sel.k, "kids-series")) {
        catalogs.push({ type: "series", id: `${id}-kids`, name: catalogName(sel, sn, c, fl, true, "series", ts) });
      }
    }
  }

  const types = [...new Set(catalogs.map((c) => c.type))];
  return {
    id: "es.marc.top10.custom",
    version: `2.0.${String(avail.date || "").replace(/-/g, "")}`,
    name: ADDON_NAME,
    description: ADDON_DESC,
    logo: `${pages}/posters/_logo.png`,
    resources: ["catalog"],
    types: types.length ? types : ["movie", "series"],
    idPrefixes: ["tt", "tmdb:"],
    catalogs,
    // Pré-remplit la page de configuration avec la config actuelle (via le hash).
    behaviorHints: { configurable: true, configurationURL: `${origin}/configure#${cfgSeg}` },
  };
}

/**
 * Nom d'un catalogue, calculé PAR type (movie/series).
 *   label par défaut : si `ts` (Nuvio ajoute le type) → « <plateforme> | Top 10 de hoy » (type-agnostique) ;
 *   sinon on tisse le type → « <plateforme> | Top 10 des films/séries du jour ».
 *   `sel.label` (custom) remplace le défaut ; le token `{type}` y devient « films »/« séries ».
 *   suffixe pays selon `sel.cmode` ; « · Infantil » pour les listes enfants.
 */
function catalogName(
  sel: Sel,
  srcName: string,
  country: string,
  fl: string,
  kids: boolean,
  media: "movie" | "series",
  ts: boolean,
): string {
  const plural = media === "series" ? "series" : "películas";
  const def = ts ? `${srcName} | Top 10 de hoy` : `${srcName} | Top 10 de ${plural} de hoy`;
  const label = ((sel.label || "").trim() || def).replace(/\{type\}/g, plural);
  const mode = sel.cmode || "full";
  const suffix = mode === "flag" ? fl : mode === "custom" ? (sel.ctext || "").trim() : COUNTRY_LOC[country] || "";
  const main = kids ? `${label} · Infantil` : label;
  return suffix ? `${main} ${suffix}` : main;
}

/** Contenu d'un catalogue : lit le bon fichier statique et construit les metas (affiches sur GitHub Pages). */
async function buildCatalog(cfgSeg: string, pages: string, type: string, id: string) {
  const cfg = decodeConfig(cfgSeg);
  let base = id;
  const kids = base.endsWith("-kids");
  if (kids) base = base.slice(0, -"-kids".length);
  // base = « <k> » (mono) ou « <k>_<pays> » (multi). Les clés source n'ont pas de « _ ».
  const us = base.indexOf("_");
  const k = us > 0 ? base.slice(0, us) : base;
  const country = us > 0 ? base.slice(us + 1) : null;
  const sel = cfg.sel.find((s) => s.k === k);
  if (!sel) return { metas: [] };
  const c = country ?? selCountries(sel)[0];
  if (!c || !selCountries(sel).includes(c)) return { metas: [] };
  if (type !== "movie" && type !== "series") return { metas: [] };
  if ((type === "movie" && !sel.m) || (type === "series" && !sel.s) || (kids && !cfg.kids)) {
    return { metas: [] };
  }

  const media = type === "series" ? "series" : "movie";
  const list = (kids ? `kids-${media}` : media) as ListKey;
  const data = await fetchJson(`${pages}/data/${c}/${k}/${list}.json`).catch(() => null);
  if (!data?.entries) return { metas: [] };

  const metas = data.entries.map((e: any) => ({
    id: e.id,
    type: media,
    name: e.name,
    poster: `${pages}/posters/${c}-${k}-${list}-${e.rank}.jpg?v=${data.date}`,
    posterShape: "poster",
  }));
  return { metas };
}

// ─────────── Utilitaires ───────────

/** Décode le segment de config (base64url → JSON), avec validation minimale. */
function decodeConfig(seg: string): Config {
  let b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const cfg = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as Config;
  if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.sel) || cfg.sel.length > 20) throw new Error("Configuración inválida");
  const keys = new Set<string>();
  for (const sel of cfg.sel) {
    if (!sel || !/^[a-z][a-z0-9-]*$/.test(sel.k) || keys.has(sel.k)) throw new Error("Plataforma inválida");
    keys.add(sel.k);
    if (sel.cs !== undefined && !Array.isArray(sel.cs)) throw new Error("País inválido");
    const countries = selCountries(sel);
    if (
      !countries.length ||
      countries.length > 10 ||
      countries.some((c) => typeof c !== "string" || !/^[a-z][a-z-]*$/.test(c))
    ) {
      throw new Error("País inválido");
    }
    if ([sel.label, sel.ctext].some((s) => s !== undefined && (typeof s !== "string" || s.length > 200))) {
      throw new Error("Nombre inválido");
    }
  }
  return cfg;
}

/** Récupère un JSON statique avec cache d'edge (10 min). */
async function fetchJson(target: string): Promise<any> {
  const r = await fetch(target, { cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit);
  if (!r.ok) throw new Error(`fetch ${target} → HTTP ${r.status}`);
  return r.json();
}

function cors(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*",
  };
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=600", ...cors() };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: jsonHeaders() });
}

async function proxyJson(target: string): Promise<Response> {
  const r = await fetchJson(target);
  return json(r);
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=600", ...cors() },
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
}
