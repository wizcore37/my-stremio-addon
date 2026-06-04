const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://a.111477.xyz";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PORT = process.env.PORT || 7000;

// Cache to avoid hammering the server
const cache = { movies: null, tvs: null, lastFetch: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: "org.custom.myhttpserver",
  version: "1.0.0",
  name: "My Server",
  description: "Streams movies & TV shows from your personal HTTP server",
  logo: "https://dl.strem.io/addon-logo.png",
  resources: ["catalog", "stream", "meta"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "myserver-movies", name: "My Server – Movies" },
    { type: "series", id: "myserver-tvs", name: "My Server – TV Shows" },
  ],
  idPrefixes: ["myserver:"],
};

const builder = new addonBuilder(manifest);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch directory listing and return hrefs */
async function fetchIndex(url) {
  const res = await axios.get(url, { timeout: 10000 });
  const $ = cheerio.load(res.data);
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.startsWith("?") && href !== "../" && href !== "/") {
      links.push(href);
    }
  });
  return links;
}

/** Decode %xx and strip trailing slash */
function decodeName(href) {
  return decodeURIComponent(href.replace(/\/$/, ""));
}

/** Check if href looks like a video file */
function isVideo(href) {
  return /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm)$/i.test(href);
}

/** Search TMDB for a title, return basic meta */
async function tmdbSearch(title, type) {
  if (!TMDB_API_KEY) return null;
  try {
    const searchType = type === "movie" ? "movie" : "tv";
    const res = await axios.get(
      `https://api.themoviedb.org/3/search/${searchType}`,
      {
        params: { api_key: TMDB_API_KEY, query: title, page: 1 },
        timeout: 5000,
      }
    );
    const result = res.data.results?.[0];
    if (!result) return null;
    return {
      tmdbId: result.id,
      poster: result.poster_path
        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
        : null,
      background: result.backdrop_path
        ? `https://image.tmdb.org/t/p/original${result.backdrop_path}`
        : null,
      description: result.overview || "",
      year:
        (result.release_date || result.first_air_date || "").split("-")[0] ||
        "",
      name: result.title || result.name || title,
    };
  } catch {
    return null;
  }
}

/** Build the movies list from /movies/ */
async function getMovies() {
  const now = Date.now();
  if (cache.movies && now - cache.lastFetch < CACHE_TTL) return cache.movies;

  const folders = await fetchIndex(`${BASE_URL}/movies/`);
  const movies = [];

  for (const folder of folders) {
    if (!folder.endsWith("/")) continue; // skip non-folders
    const name = decodeName(folder);
    const id = `myserver:movie:${encodeURIComponent(name)}`;

    // Find video file inside
    const files = await fetchIndex(`${BASE_URL}/movies/${folder}`).catch(() => []);
    const videoFile = files.find(isVideo);
    const streamUrl = videoFile
      ? `${BASE_URL}/movies/${folder}${videoFile}`
      : null;

    const tmdb = await tmdbSearch(name, "movie");

    movies.push({
      id,
      type: "movie",
      name: tmdb?.name || name,
      poster: tmdb?.poster || null,
      background: tmdb?.background || null,
      description: tmdb?.description || "",
      year: tmdb?.year || "",
      streamUrl,
    });
  }

  cache.movies = movies;
  cache.lastFetch = now;
  return movies;
}

/** Build the TV shows list from /tvs/ */
async function getTVShows() {
  const now = Date.now();
  if (cache.tvs && now - cache.lastFetch < CACHE_TTL) return cache.tvs;

  const showFolders = await fetchIndex(`${BASE_URL}/tvs/`);
  const shows = [];

  for (const showFolder of showFolders) {
    if (!showFolder.endsWith("/")) continue;
    const showName = decodeName(showFolder);
    const id = `myserver:series:${encodeURIComponent(showName)}`;
    const tmdb = await tmdbSearch(showName, "series");

    // Get seasons
    const seasonFolders = await fetchIndex(
      `${BASE_URL}/tvs/${showFolder}`
    ).catch(() => []);
    const videos = [];

    for (const seasonFolder of seasonFolders) {
      if (!seasonFolder.endsWith("/")) continue;
      const seasonName = decodeName(seasonFolder);
      const seasonNum = parseInt(seasonName.match(/\d+/)?.[0] || "1", 10);

      const episodeFiles = await fetchIndex(
        `${BASE_URL}/tvs/${showFolder}${seasonFolder}`
      ).catch(() => []);

      for (const file of episodeFiles) {
        if (!isVideo(file)) continue;
        const fileName = decodeName(file);
        // Try to extract episode number from filename (e.g. S02E01, 2x01, E01)
        const epMatch =
          fileName.match(/[Ss](\d{1,2})[Ee](\d{1,2})/) ||
          fileName.match(/(\d{1,2})x(\d{1,2})/);
        const epNum = epMatch ? parseInt(epMatch[2], 10) : videos.length + 1;
        const sNum = epMatch ? parseInt(epMatch[1], 10) : seasonNum;

        videos.push({
          season: sNum,
          episode: epNum,
          title: fileName.replace(/\.[^.]+$/, ""),
          url: `${BASE_URL}/tvs/${showFolder}${seasonFolder}${file}`,
        });
      }
    }

    shows.push({
      id,
      type: "series",
      name: tmdb?.name || showName,
      poster: tmdb?.poster || null,
      background: tmdb?.background || null,
      description: tmdb?.description || "",
      year: tmdb?.year || "",
      videos,
    });
  }

  cache.tvs = shows;
  cache.lastFetch = now;
  return shows;
}

// ── Catalog handler ───────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type === "movie" && id === "myserver-movies") {
    const movies = await getMovies();
    return {
      metas: movies.map((m) => ({
        id: m.id,
        type: "movie",
        name: m.name,
        poster: m.poster,
        description: m.description,
        year: m.year,
      })),
    };
  }

  if (type === "series" && id === "myserver-tvs") {
    const shows = await getTVShows();
    return {
      metas: shows.map((s) => ({
        id: s.id,
        type: "series",
        name: s.name,
        poster: s.poster,
        description: s.description,
        year: s.year,
      })),
    };
  }

  return { metas: [] };
});

// ── Meta handler ──────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith("myserver:")) return { meta: null };

  if (type === "movie") {
    const movies = await getMovies();
    const movie = movies.find((m) => m.id === id);
    if (!movie) return { meta: null };
    return {
      meta: {
        id: movie.id,
        type: "movie",
        name: movie.name,
        poster: movie.poster,
        background: movie.background,
        description: movie.description,
        year: movie.year,
      },
    };
  }

  if (type === "series") {
    const shows = await getTVShows();
    const show = shows.find((s) => s.id === id);
    if (!show) return { meta: null };
    return {
      meta: {
        id: show.id,
        type: "series",
        name: show.name,
        poster: show.poster,
        background: show.background,
        description: show.description,
        year: show.year,
        videos: show.videos.map((v) => ({
          id: `${show.id}:${v.season}:${v.episode}`,
          title: `S${String(v.season).padStart(2, "0")}E${String(v.episode).padStart(2, "0")} – ${v.title}`,
          season: v.season,
          episode: v.episode,
          released: new Date(0).toISOString(),
          streams: [{ url: v.url, title: "My Server" }],
        })),
      },
    };
  }

  return { meta: null };
});

// ── Stream handler ────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
  if (!id.startsWith("myserver:")) return { streams: [] };

  if (type === "movie") {
    const movies = await getMovies();
    const movie = movies.find((m) => m.id === id);
    if (!movie?.streamUrl) return { streams: [] };
    return {
      streams: [{ url: movie.streamUrl, title: "My Server" }],
    };
  }

  if (type === "series") {
    // id format: myserver:series:ShowName:season:episode
    const parts = id.split(":");
    const showId = `${parts[0]}:${parts[1]}:${parts[2]}`;
    const season = parseInt(parts[3], 10);
    const episode = parseInt(parts[4], 10);

    const shows = await getTVShows();
    const show = shows.find((s) => s.id === showId);
    if (!show) return { streams: [] };

    const vid = show.videos.find(
      (v) => v.season === season && v.episode === episode
    );
    if (!vid) return { streams: [] };

    return {
      streams: [{ url: vid.url, title: "My Server" }],
    };
  }

  return { streams: [] };
});

// ── Start ─────────────────────────────────────────────────────────────────────
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Stremio addon running on http://localhost:${PORT}`);
console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
