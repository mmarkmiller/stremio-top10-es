/**
 * compose.ts — fabrique l'affiche custom d'un titre : télécharge l'affiche TMDB puis incruste le rang.
 *
 * Écrit `public/posters/<key>.jpg`. Si l'affiche TMDB manque (titre non résolu), on génère quand même
 * une vignette « chiffre seul sur fond noir » pour ne jamais laisser de case vide.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POSTERS_DIR } from "../config.ts";
import { compose } from "./magick.ts";
import type { Variant } from "./variants.ts";

export async function buildPoster(opts: {
  posterUrl: string | null;
  rank: number;
  key: string;
  variant: Variant;
}): Promise<void> {
  mkdirSync(POSTERS_DIR, { recursive: true });
  let posterPath: string | null = null;
  if (opts.posterUrl) {
    const res = await fetch(opts.posterUrl, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      posterPath = join(tmpdir(), `tmdb-${opts.key}.jpg`);
      writeFileSync(posterPath, Buffer.from(await res.arrayBuffer()));
    }
  }
  compose(posterPath, opts.rank, opts.variant, join(POSTERS_DIR, `${opts.key}.jpg`));
}
