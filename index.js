const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://a.111477.xyz";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PORT = process.env.PORT || 7000;

const CACHE_TTL = 30 * 60 * 1000;
const cache = {};

// â”€â”€ Folder definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FOLDERS = [
  { path: "movies",       type: "movie",  catalogId: "myserver-movies",       name: "My Server â€“ Movies"       },
  { path: "tvs",          type: "series", catalogId: "myserver-tvs",          name: "My Server â€“ TV Shows"     },
  { path: "asian%20drama",type: "series", catalogId: "myserver-asiandrama",   name: "My Server â€“ Asian Drama"  },
  { path: "k%20drama",    type: "series", catalogId: "myserver-kdrama",       name: "My Server â€“ K-Drama"      },
  { path: "misc",         type: "movie",  catalogId: "myserver-misc",         name: "My Server â€“ Misc"         },
];

// â”€â”€ Manifest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const manifest = {
  id: "org.custom.myhttpserver",
  version: "1.1.0",
  name: "My Server",
  description: "Streams movies & TV shows from your personal HTTP server",
  logo: "https://dl.strem.io/addon-logo.png",
  resources: ["catalog", "stream", "meta"],
  types: ["movie", "series"],
  catalogs: FOLDERS.map(f => ({ type: f.type, id: f.catalogId, name: f.name })),
  idPrefixes: ["myserver:"],
};

const builder = new addonBuilder(manifest);

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchIndex(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });
    const $ = cheerio.load(res.data);
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("?") && !href.startsWith("/") && href !== "../") {
        links.push(href);
      }
    });
    return links;
  } catch (e) {
    console.error(`Failed to fetch ${url}:`, e.message);
    return [];
  }
}

function decodeName(href) {
  return decodeURIComponent(href.replace(/\/$/, ""));
}

function isVideo(href) {
  return /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm)$/i.test(href);
}

async function tmdbSearch(title, type) {
  if (!TMDB_API_KEY) return null;
  try {
    const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
    const searchType = type === "movie" ? "movie" : "tv";
    const res = await axios.get(`https://api.themoviedb.org/3/search/${searchType}`, {
      params: { api_key: TMDB_API_KEY, query: cleanTitle, page: 1 },
      timeout: 5000,
    });
    const result = res.data.results?.[0];
    if (!result) return null;
    return {
      poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      background: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
      description: result.overview || "",
      year: (result.release_date || result.first_air_date || "").split("-")[0] || "",
      name: result.title || result.name || title,
    };
  } catch {
    return null;
  }
}

// â”€â”€ Build catalog for a folder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function buildCatalog(folder) {
  const now = Date.now();
  if (cache[folder.catalogId] && now - cache[folder.catalogId].time < CACHE_TTL) {
    return cache[folder.catalogId].data;
  }

  const url = `${BASE_URL}/${folder.path}/`;
  console.log(`Fetching index: ${url}`);
  const entries = await fetchIndex(url);
  console.log(`Found ${entries.length} entries in ${folder.path}`);

  const items = [];

  for (const entry of entries) {
    if (!entry.endsWith("/")) continue;
    const name = decodeName(entry);
    const id = `myserver:${folder.type}:${folder.path}:${encodeURIComponent(name)}`;
    const tmdb = await tmdbSearch(name, folder.type);

    if (folder.type === "movie") {
      const files = await fetchIndex(`${url}${entry}`);
      const videoFile = files.find(isVideo);
      items.push({
        id, type: "movie",
        name: tmdb?.name || name,
        poster: tmdb?.poster || null,
        background: tmdb?.background || null,
        description: tmdb?.description || "",
        year: tmdb?.year || "",
        streamUrl: videoFile ? `${url}${entry}${videoFile}` : null,
      });
    } else {
      // Series â€” scan seasons
      const seasonFolders = await fetchIndex(`${url}${entry}`);
      const videos = [];
      for (const sf of seasonFolders) {
        if (!sf.endsWith("/")) continue;
        const seasonName = decodeName(sf);
        const seasonNum = parseInt(seasonName.match(/\d+/)?.[0] || "1", 10);
        const epFiles = await fetchIndex(`${url}${entry}${sf}`);
        for (const file of epFiles) {
          if (!isVideo(file)) continue;
          const fileName = decodeName(file);
          const epMatch = fileName.match(/[Ss](\d{1,2})[Ee](\d{1,2})/) || fileName.match(/(\d{1,2})x(\d{1,2})/);
          videos.push({
            season: epMatch ? parseInt(epMatch[1], 10) : seasonNum,
            episode: epMatch ? parseInt(epMatch[2], 10) : videos.length + 1,
            title: fileName.replace(/\.[^.]+$/, ""),
            url: `${url}${entry}${sf}${file}`,
          });
        }
      }
      items.push({
        id, type: "series",
        name: tmdb?.name || name,
        poster: tmdb?.poster || null,
        background: tmdb?.background || null,
        description: tmdb?.description || "",
        year: tmdb?.year || "",
        videos,
      });
    }
  }

  cache[folder.catalogId] = { data: items, time: now };
  return items;
}

// â”€â”€ Catalog handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
builder.defineCatalogHandler(async ({ type, id }) => {
  const folder = FOLDERS.find(f => f.catalogId === id && f.type === type);
  if (!folder) return { metas: [] };
  const items = await buildCatalog(folder);
  return {
    metas: items.map(m => ({
      id: m.id, type: m.type, name: m.name,
      poster: m.poster, description: m.description, year: m.year,
    }))
  };
});

// â”€â”€ Meta handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith("myserver:")) return { meta: null };
  const parts = id.split(":");
  const folderPath = parts[2];
  const folder = FOLDERS.find(f => f.path === folderPath);
  if (!folder) return { meta: null };
  const items = await buildCatalog(folder);
  const item = items.find(m => m.id === id);
  if (!item) return { meta: null };

  const meta = {
    id: item.id, type: item.type, name: item.name,
    poster: item.poster, background: item.background,
    description: item.description, year: item.year,
  };

  if (item.type === "series") {
    meta.videos = item.videos.map(v => ({
      id: `${item.id}:${v.season}:${v.episode}`,
      title: `S${String(v.season).padStart(2,"0")}E${String(v.episode).padStart(2,"0")} â€“ ${v.title}`,
      season: v.season, episode: v.episode,
      released: new Date(0).toISOString(),
      streams: [{ url: v.url, title: "My Server" }],
    }));
  }

  return { meta };
});

// â”€â”€ Stream handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
builder.defineStreamHandler(async ({ type, id }) => {
  if (!id.startsWith("myserver:")) return { streams: [] };

  if (type === "movie") {
    const parts = id.split(":");
    const folderPath = parts[2];
    const folder = FOLDERS.find(f => f.path === folderPath);
    if (!folder) return { streams: [] };
    const items = await buildCatalog(folder);
    const item = items.find(m => m.id === id);
    if (!item?.streamUrl) return { streams: [] };
    return { streams: [{ url: item.streamUrl, title: "My Server" }] };
  }

  if (type === "series") {
    const parts = id.split(":");
    const folderPath = parts[2];
    const showId = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}`;
    const season = parseInt(parts[4], 10);
    const episode = parseInt(parts[5], 10);
    const folder = FOLDERS.find(f => f.path === folderPath);
    if (!folder) return { streams: [] };
    const items = await buildCatalog(folder);
    const show = items.find(s => s.id === showId);
    if (!show) return { streams: [] };
    const vid = show.videos.find(v => v.season === season && v.episode === episode);
    if (!vid) return { streams: [] };
    return { streams: [{ url: vid.url, title: "My Server" }] };
  }

  return { streams: [] };
});

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Addon running on port ${PORT}`);
console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
