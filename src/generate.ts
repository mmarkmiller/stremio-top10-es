#!/usr/bin/env bun
/**
 * generate.ts — orchestrateur + CLI du générateur « Top 10 ES 🇪🇸 » (multi-pays, configurable).
 *
 * Pipeline quotidien :
 *   1. DONNÉES — pour chaque pays × source × liste : scrape FlixPatrol (via r.jina.ai) → parse → résout
 *      sur TMDB (fiche FR + IMDb) → écrit `data/<pays>/<source>/<liste>.json`. Filet de sécurité par liste
 *      (un échec garde le fichier de la veille, versionné).
 *   2. AFFICHES — régénère TOUTES les affiches custom depuis l'arbre `data/` (découplé du scrape : une liste
 *      conservée de la veille garde une affiche cohérente). Posters NON versionnés (cf. workflow CI).
 *   3. CARTE — écrit `availability.json` (combos réellement produits, lu par le Worker et la page de config).
 *
 * Commandes :
 *   (défaut) build [--dry] [--only=<source>] [--country=<pays>]   pipeline complet
 *   scrape <slug> [pays]                                          dump du Markdown brut (debug parsing)
 *   verify                                                        valide l'arbre produit
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAvailability, writeAvailability } from "./build/availability.ts";
import { dataFileExists, scanDataFiles, writeDataFile } from "./build/data.ts";
import {
  BUILD_STAMP,
  COUNTRIES,
  DEFAULT_COUNTRY,
  HEALTH_MIN,
  LIST_KEYS,
  POSTERS_DIR,
  PUBLIC_DIR,
  SOURCES,
  listMedia,
  posterKey,
} from "./config.ts";
import { buildPoster } from "./poster/compose.ts";
import { makeLogo } from "./poster/magick.ts";
import { DEFAULT_VARIANT, VARIANTS } from "./poster/variants.ts";
import { fetchTop10 } from "./scrape/flixpatrol.ts";
import { fetchJustWatch } from "./scrape/justwatch.ts";
import { parseList } from "./scrape/parse.ts";
import { loadCache, saveCache } from "./tmdb/cache.ts";
import { resolveTitle } from "./tmdb/resolve.ts";
import type { DataEntry, Entry, ListKey, Source } from "./types.ts";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const cmd = positional[0] ?? "build";
const dry = args.includes("--dry");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const onlyCountry = args.find((a) => a.startsWith("--country="))?.slice("--country=".length);
const variantName = args.find((a) => a.startsWith("--variant="))?.slice("--variant=".length) ?? DEFAULT_VARIANT;
const variant = VARIANTS[variantName] ?? VARIANTS[DEFAULT_VARIANT]!;

/** Listes qu'une source peut produire (section présente, ou films dérivés de l'« Overall »). */
function sourceLists(source: Source): ListKey[] {
  return LIST_KEYS.filter((l) => source.sections[l] || (l === "movie" && source.sections.overall));
}

/** Résout une liste d'entrées FlixPatrol en entrées de données enrichies (fiche FR + IMDb + affiche source). */
async function resolveEntries(entries: Entry[], list: ListKey, cache: ReturnType<typeof loadCache>) {
  const out: DataEntry[] = [];
  for (const entry of entries) {
    const title = await resolveTitle(entry, listMedia(list), cache);
    if (!title.tmdbId) continue;
    out.push({
      rank: entry.rank,
      id: title.imdbId ?? (title.tmdbId ? `tmdb:${title.tmdbId}` : `top10:${entry.fpSlug}`),
      name: title.titleEs,
      tmdbPosterUrl: title.posterUrl,
      rating: title.rating,
      year: title.year,
      days: entry.days,
      trend: entry.trend,
    });
  }
  return out;
}

async function build(): Promise<void> {
  const countries = COUNTRIES.filter((c) => !onlyCountry || c.slug === onlyCountry);
  const sources = SOURCES.filter((s) => !only || s.key === only);
  if (!countries.length) throw new Error(`Aucun pays ne correspond à --country=${onlyCountry}`);
  if (!sources.length) throw new Error(`Aucune source ne correspond à --only=${only}`);

  const cache = loadCache();
  let fresh = 0;
  let kept = 0;

  // ─── 1. DONNÉES ───
  for (const country of countries) {
    for (const source of sources) {
      const lists = sourceLists(source);
      let md: string | null = null;
      try {
        md = await fetchTop10(source.slug, country.slug);
      } catch (e) {
        // Scrape échoué : on garde tous les fichiers de la veille de ce (pays, source).
        const survived = lists.filter((l) => dataFileExists(country.slug, source.key, l)).length;
        kept += survived;
        console.error(`  ⏳ ${country.slug}/${source.key} : scrape KO (${msg(e)}) → ${survived} liste(s) gardée(s)`);
        console.error("  ↪ Se comprobará la popularidad diaria de JustWatch en España.");
      }
      for (const list of lists) {
        try {
          const ranking = md === null ? await fetchJustWatch(source.key, list) : null;
          const entries = await resolveEntries(ranking?.entries ?? parseList(md!, source, list), list, cache);
          if (entries.length === 0) {
            // Section absente pour ce pays : on garde la veille si elle existe, sinon rien.
            if (dataFileExists(country.slug, source.key, list)) kept++;
            continue;
          }
          if (entries.length < HEALTH_MIN && dataFileExists(country.slug, source.key, list)) {
            kept++;
            console.error(`  ⏳ ${country.slug}/${source.key}/${list}: ranking incompleto → se conserva el anterior`);
            continue;
          }
          if (!dry)
            writeDataFile(
              country.slug,
              source.key,
              list,
              BUILD_STAMP,
              entries,
              md === null ? "justwatch" : "flixpatrol",
              ranking?.updatedAt ?? "",
            );
          fresh++;
        } catch (e) {
          if (dataFileExists(country.slug, source.key, list)) kept++;
          console.error(`  ⚠️ ${country.slug}/${source.key}/${list} : ${msg(e)} → veille gardée`);
        }
      }
    }
    console.error(`📡 ${country.name} traité.`);
  }
  if (!dry) saveCache(cache);

  // ─── 2. AFFICHES (depuis l'arbre data/, donc cohérentes même pour les listes conservées) ───
  if (!dry) {
    mkdirSync(POSTERS_DIR, { recursive: true });
    makeLogo(variant.font, join(POSTERS_DIR, "_logo.png"));
    const files = scanDataFiles();
    let posters = 0;
    let posterFail = 0;
    for (const f of files) {
      for (const e of f.entries) {
        try {
          await buildPoster({
            posterUrl: e.tmdbPosterUrl,
            rank: e.rank,
            key: posterKey(f.country, f.key, f.list, e.rank),
            variant,
          });
          posters++;
        } catch (err) {
          posterFail++;
          if (posterFail <= 5) console.error(`  🖼️ affiche KO ${f.country}/${f.key}/${f.list}#${e.rank} : ${msg(err)}`);
        }
      }
    }
    console.error(`🖼️ ${posters} affiches générées${posterFail ? `, ${posterFail} échecs` : ""}.`);

    // ─── 3. CARTE (combos disponibles, lue par le Worker et la page de config) ───
    writeAvailability(buildAvailability(files));
  }

  console.error(`\n✅ ${fresh} listes fraîches, ${kept} conservées de la veille.`);
  // Garde-fou CI : panne totale (proxy/TMDB) → sortir en erreur SANS rien écraser d'utile.
  if (!dry && fresh === 0) {
    console.error("⚠️ Aucune liste fraîche — anomalie probable (proxy/TMDB).");
    process.exit(1);
  }
}

/** Valide l'arbre produit : availability.json + tous les fichiers data qu'il référence. */
async function verify(): Promise<void> {
  const availFile = join(PUBLIC_DIR, "availability.json");
  if (!existsSync(availFile)) throw new Error("public/availability.json absent — lance d'abord `build`.");
  const avail = JSON.parse(readFileSync(availFile, "utf8"));
  let problems = 0;
  let lists = 0;
  if (!Object.keys(avail.combos ?? {}).length) throw new Error("No hay rankings para publicar.");
  for (const [country, bySource] of Object.entries(avail.combos as Record<string, Record<string, ListKey[]>>)) {
    for (const [key, ls] of Object.entries(bySource)) {
      for (const list of ls) {
        lists++;
        const file = join(PUBLIC_DIR, "data", country, key, `${list}.json`);
        if (!existsSync(file)) {
          console.error(`❌ data manquant : ${country}/${key}/${list}`);
          problems++;
          continue;
        }
        const data = JSON.parse(readFileSync(file, "utf8"));
        const bad = data.entries.filter((e: DataEntry) => !e.id || !e.name).length;
        if (!data.entries.length || bad) {
          console.error(
            `❌ ${country}/${key}/${list} : ${data.entries.length} entrées${bad ? `, ${bad} incomplètes` : ""}`,
          );
          problems++;
        }
        for (const entry of data.entries as DataEntry[]) {
          if (!/^(?:tt\d+|tmdb:\d+)$/.test(entry.id) || !Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > 10) {
            console.error(`❌ Entrada inválida: ${country}/${key}/${list}`);
            problems++;
          }
          const poster = join(POSTERS_DIR, `${posterKey(country, key, list, entry.rank)}.jpg`);
          if (!existsSync(poster)) {
            console.error(`❌ Carátula ausente: ${country}/${key}/${list}#${entry.rank}`);
            problems++;
          }
        }
      }
    }
  }
  console.error(problems ? `\n⚠️ ${problems} problème(s) sur ${lists} listes.` : `\n✅ ${lists} listes valides.`);
  if (problems) process.exit(1);
}

async function main(): Promise<void> {
  switch (cmd) {
    case "build":
      await build();
      break;
    case "verify":
      await verify();
      break;
    case "scrape": {
      const slug = positional[1];
      const country = positional[2] ?? DEFAULT_COUNTRY;
      if (!slug) throw new Error("Usage : scrape <slug> [pays]");
      console.log(await fetchTop10(slug, country));
      break;
    }
    default:
      console.error(
        "Commandes : build [--dry] [--only=<source>] [--country=<pays>]  ·  scrape <slug> [pays]  ·  verify",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("Erreur :", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
