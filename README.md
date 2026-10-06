# Top 10 ES 🇪🇸 — Marc

Versión personal de [stremio-top10-fr de Apertaa](https://github.com/Apertaa/stremio-top10-fr), bajo su licencia PolyForm Noncommercial incluida en LICENSE.

Rankings diarios de **España y Estados Unidos** por plataforma, títulos y pósteres TMDB en **es-ES**, identificadores IMDb y carátulas 600 × 900 con números grandes. Addon de catálogos compatible con Stremio y Nuvio. La reproducción y las fichas detalladas siguen a cargo de los otros addons instalados.

## Arquitectura

GitHub Actions actualiza a las 16:00 UTC → GitHub Pages publica rankings y carátulas → Cloudflare Worker sirve el configurador, manifest y catálogos personalizados.

Las plataformas solo aparecen si la fuente publica rankings españoles válidos. Se incluyen Netflix, Disney+, Prime Video, Apple TV, HBO Max, SkyShowtime y Movistar Plus+. No se reutilizan rankings de Francia. El caché TMDB español usa `cache/tmdb-map-es-ES.json`.

## Desarrollo

```sh
bun install
bun test
bun run typecheck
bunx tsc --noEmit -p worker/tsconfig.json
bun run src/generate.ts --country=spain
bun run verify
```

La generación requiere ImageMagick y **uno** de los secretos `TMDB_READ_TOKEN` (recomendado) o `TMDB_API_KEY`. Guárdalo en `.env` local o como secreto de GitHub Actions. Nunca en el código ni en archivos públicos.

## Publicación

1. Publicar esta adaptación en un repositorio de GitHub y habilitar Pages con origen GitHub Actions.
2. Añadir el secreto TMDB al repositorio.
3. Ejecutar el workflow `daily`; comprobar generación y publicación.
4. Poner la URL real de Pages en `worker/wrangler.toml` (`PAGES_BASE`).
5. Desde `worker/`, iniciar sesión con `bunx wrangler login` y publicar con `bunx wrangler deploy`.
6. Abrir la URL HTTPS del Worker, seleccionar plataformas y copiar el manifest personalizado en Nuvio/Stremio.

`PAGES_BASE` está preparado para `https://mmarkmiller.github.io/stremio-top10-es`; debe coincidir con el repositorio publicado. `ADDON_BASE_URL` permite fijar la base de las carátulas; en GitHub Actions se deduce del repositorio.

## Estado de validación

Las 11 pruebas automáticas cubren región española, identidad del manifest, UTF-8, filas infantiles, catálogos con IMDb, URLs de pósteres, peticiones TMDB es-ES, selección del ranking diario por plataforma y errores de las fuentes.

FlixPatrol es la fuente preferida. Si su lector devuelve una verificación de bots o falla, se consultan los rankings diarios de JustWatch para cada país, filtrados por plataforma y tipo de contenido. Estos miden interés de los usuarios de JustWatch, y pueden diferir del ranking interno de cada servicio. El configurador muestra la fuente y fecha de generación, y cada archivo JSON conserva la procedencia y fecha de actualización del ranking.

JustWatch no publica aquí una clasificación infantil separada: esas filas solo aparecen si FlixPatrol las proporciona. Las listas anteriores se conservan ante fallos o rankings incompletos.

Fuentes: [FlixPatrol](https://flixpatrol.com/top10/) y [JustWatch Streaming Charts España](https://www.justwatch.com/es/streaming-charts). Metadatos e imágenes: [TMDB](https://www.themoviedb.org/). Este producto usa la API TMDB y no está avalado ni certificado por TMDB.
