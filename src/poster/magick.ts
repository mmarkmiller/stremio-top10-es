/**
 * magick.ts — compose une affiche custom (gros chiffre de rang « façon Netflix » + affiche TMDB) via ImageMagick.
 *
 * Format poster 2:3 (compatible avec la grille Stremio/Nuvio) : l'affiche TMDB occupe tout le cadre, et le
 * numéro de rang est incrusté en bas-gauche, gros, gris très foncé + fin contour clair, avec une ombre portée
 * douce pour rester lisible quelle que soit l'affiche. Un léger dégradé sombre en bas renforce le contraste.
 *
 * ⚠️ Le chiffre est généré dans un FICHIER séparé (pas en `label:` dans la commande de composition) : sinon
 * le `-size` défini pour le dégradé persiste et « gonfle » le `label:` suivant (chiffre géant). Leçon retenue.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Variant } from "./variants.ts";

const BIN = spawnSync("magick", ["-version"], { encoding: "utf8" }).status === 0 ? "magick" : "convert";

function run(args: string[], context: string): void {
  const r = spawnSync(BIN, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ImageMagick (${context}) : ${(r.stderr || r.error?.message || "").slice(0, 300)}`);
  }
}

/** Génère le logo carré de l'addon (« 10 » blanc sur fond sombre) dans `out`. */
export function makeLogo(font: string, out: string): void {
  run(
    [
      "-size",
      "512x512",
      "canvas:#0b0b0b",
      "-font",
      font,
      "-pointsize",
      "300",
      "-fill",
      "#ffffff",
      "-stroke",
      "#9a9a9a",
      "-strokewidth",
      "4",
      "-gravity",
      "center",
      "-annotate",
      "+0+0",
      "10",
      out,
    ],
    "logo",
  );
}

/** Génère le chiffre (remplissage foncé + contour clair + ombre portée) dans un PNG temporaire, hauteur `h`. */
function renderNumber(rank: number, v: Variant, h: number): string {
  const out = join(tmpdir(), `top10-num-${v.name}-${rank}-${h}.png`);
  run(
    [
      "-background",
      "none",
      "-fill",
      v.numberFill,
      "-stroke",
      v.numberStroke,
      "-strokewidth",
      String(v.strokeWidth),
      "-font",
      v.font,
      "-pointsize",
      String(Math.round(h * 1.4)),
      `label:${rank}`,
      "-trim",
      "+repage",
      "-resize",
      `x${h}`,
      "(",
      "+clone",
      "-background",
      "black",
      "-shadow",
      "55x5+0+3",
      ")",
      "+swap",
      "-background",
      "none",
      "-layers",
      "merge",
      "+repage",
      out,
    ],
    `chiffre ${rank}`,
  );
  return out;
}

/** Compose l'affiche custom et l'écrit dans `out`. */
export function compose(posterPath: string | null, rank: number, v: Variant, out: string): void {
  const { width: W, height: H } = v;
  const margin = Math.round(W * 0.035);
  const numPath = renderNumber(rank, v, Math.round(H * v.numberHeightRatio)); // hauteur du chiffre = ratio réglable

  const args: string[] = ["-size", `${W}x${H}`, `canvas:${v.bg}`];
  if (posterPath) {
    args.push(
      "(",
      posterPath,
      "-resize",
      `${W}x${H}^`,
      "-gravity",
      "center",
      "-extent",
      `${W}x${H}`,
      ")",
      "-composite",
    );
  }
  // Léger dégradé sombre en bas (le `-size` ne pollue plus rien : le chiffre est un fichier, pas un label).
  args.push(
    "(",
    "-size",
    `${W}x${Math.round(H * 0.2)}`,
    "gradient:none-black",
    ")",
    "-gravity",
    "South",
    "-compose",
    "over",
    "-composite",
  );
  // Le chiffre (fichier → taille native conservée), ancré en bas-gauche.
  args.push(numPath, "-gravity", "SouthWest", "-geometry", `+${margin}+${margin}`, "-composite");
  args.push("-quality", "88", out);

  run(args, `compose ${rank}`);
}
