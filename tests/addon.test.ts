import { beforeAll, afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COUNTRIES, DEFAULT_COUNTRY, PLATFORMS } from "../src/config.ts";
import { parseList } from "../src/scrape/parse.ts";
import { isValidTop10 } from "../src/scrape/flixpatrol.ts";
import { searchTitle, getDetails } from "../src/tmdb/client.ts";
import { resolveTitle } from "../src/tmdb/resolve.ts";

// Match Wrangler's HTML text-module import in the unit-test runtime.
Bun.plugin({name: "html-as-text", setup(build) {
 build.onLoad({filter: /\.html$/}, args => ({exports: {default: readFileSync(args.path, "utf8")}, loader: "object"}));
}});
let worker: typeof import("../worker/index.ts").default;
beforeAll(async () => { worker = (await import("../worker/index.ts")).default; });
const originalFetch = globalThis.fetch;
const originalToken = process.env.TMDB_READ_TOKEN;
const originalKey = process.env.TMDB_API_KEY;
afterEach(() => {
 globalThis.fetch = originalFetch;
 if (originalToken === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = originalToken;
 if (originalKey === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = originalKey;
});
const pages = "https://marc.example/top10-es";
const availability = {date:"2026-10-06", countries:COUNTRIES, sources:[{key:"netflix",name:"🔴 Netflix"}], combos:{spain:{netflix:["movie","series","kids-movie"]}}};
const encode = (cfg: unknown) => Buffer.from(JSON.stringify(cfg), "utf8").toString("base64url");
const cfg = {v:1,sel:[{k:"netflix",c:"spain",m:true,s:true,label:"Selección de Marc 🇪🇸"}],kids:true};
function mockData() {
 globalThis.fetch = (async (target: any) => {
 const url=String(target);
 if(url.endsWith("availability.json")) return Response.json(availability);
 if(url.endsWith("/data/spain/netflix/movie.json")) return Response.json({date:"202610061600",entries:[{id:"tt1234567",name:"Película española",rank:1}]});
 return new Response("missing",{status:404});
 }) as typeof fetch;
}
const request = (path: string, method="GET") => worker.fetch(new Request("https://top10-es.example"+path,{method}),{PAGES_BASE:pages});
test("España es la única región generada y la predeterminada",()=>{
 expect(DEFAULT_COUNTRY).toBe("spain"); expect(COUNTRIES).toEqual([{slug:"spain",name:"España",flag:"🇪🇸"}]);
});
test("el configurador y el manifest tienen identidad española propia",async()=>{
 const html=await (await request("/configure")).text();
 expect(html).toContain('lang="es"'); expect(html).toContain('hasEs ? "spain"');
 const response=await request("/manifest.json"); const body=await response.json();
 expect(body.id).toBe("es.marc.top10"); expect(body.behaviorHints.configurationRequired).toBe(true);
 expect(response.headers.get("access-control-allow-origin")).toBe("*");
});
test("manifest personalizado conserva acentos y emoji, con filas infantiles",async()=>{
 mockData();const response=await request('/'+encode(cfg)+'/manifest.json');const body=await response.json();
 expect(body.catalogs).toHaveLength(3);expect(body.catalogs[0].name).toBe("Selección de Marc 🇪🇸 en España");
 expect(body.catalogs[2].name).toContain("Infantil");expect(body.id).toBe("es.marc.top10.custom");
});
test("catálogo compatible conserva IMDb y carátulas numeradas",async()=>{
 mockData();const body=await (await request('/'+encode(cfg)+'/catalog/movie/netflix.json')).json();
 expect(body.metas[0]).toEqual({id:"tt1234567",type:"movie",name:"Película española",poster:pages+"/posters/spain-netflix-movie-1.jpg?v=202610061600",posterShape:"poster"});
});
test("no sirve países, tipos ni filas que la configuración no seleccionó",async()=>{
 mockData();const disabled={v:1,sel:[{k:"netflix",c:"spain",m:false,s:true}]};
 for(const suffix of ['/catalog/movie/netflix.json','/catalog/series/netflix-kids.json','/catalog/series/netflix_france.json','/catalog/other/netflix.json']){
 const body=await (await request('/'+encode(disabled)+suffix)).json();expect(body.metas).toEqual([]);
 }
});
test("rechaza configuración malformada o rutas manipuladas",async()=>{
 for(const config of [{v:1,sel:[{k:"../netflix",c:"spain"}]},{v:1,sel:[{k:"netflix",cs:"spain"}]},{v:2,sel:[]}]){
 expect((await request('/'+encode(config)+'/manifest.json')).status).toBe(400);
 }
 expect((await request('/bad/manifest.json')).status).toBe(400);
 expect((await request('/missing')).status).toBe(404);
 expect((await request('/',"OPTIONS")).status).toBe(204);
});
test("rechaza páginas de verificación de bots y separa películas/series",()=>{
 expect(isValidTop10("Title: Just a moment... Performing security verification")).toBe(false);
 const md='TOP 10 on Netflix in Spain\n### TOP 10 Movies\n1.–[Película](https://flixpatrol.com/title/pelicula-2025/)3 d\n### TOP 10 TV Shows\n1.n/a[Serie](https://flixpatrol.com/title/serie/)';
 expect(isValidTop10(md)).toBe(true);
 expect(parseList(md,PLATFORMS[0]!,"movie")[0]).toMatchObject({title:"Película",rank:1,year:2025});
 expect(parseList(md,PLATFORMS[0]!,"series")[0]?.title).toBe("Serie");
});
test("TMDB solicita es-ES y resuelve nombres españoles con IMDb",async()=>{
 process.env.TMDB_READ_TOKEN="test-only-token";
 const urls:URL[]=[];
 globalThis.fetch=(async(target:any,init:any)=>{
 const u=new URL(String(target));urls.push(u);
 expect(init.headers.Authorization).toBe("Bearer test-only-token");
 if(u.pathname.includes('/search/')) return Response.json({results:[{id:12,title:"El título",original_title:"The Title",release_date:"2025-01-01",popularity:1}]});
 if(u.pathname.endsWith('/external_ids')) return Response.json({imdb_id:"tt1234567"});
 return Response.json({title:"El título",poster_path:"/poster.jpg",release_date:"2025-01-01",vote_average:8});
 }) as typeof fetch;
 await searchTitle("movie","The Title",2025);await getDetails("movie",12);
 const title=await resolveTitle({title:"The Title",fpSlug:"the-title-2025",year:2025,rank:1,days:1,trend:{dir:"same",delta:0}},"movie",new Map());
 expect(title.titleEs).toBe("El título");expect(title.imdbId).toBe("tt1234567");
 for(const u of urls.filter(u=>!u.pathname.endsWith('external_ids'))) expect(u.searchParams.get('language')).toBe('es-ES');
});
