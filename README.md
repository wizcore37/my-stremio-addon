# My Server – Stremio Addon

Streams your movies & TV shows from `https://a.111477.xyz` directly in Stremio.

---

## 🚀 Deploy on Render.com (Free, No Credit Card)

### Step 1 – Get a free TMDB API key (for posters & metadata)
1. Go to https://www.themoviedb.org/signup and create a free account
2. Go to https://www.themoviedb.org/settings/api
3. Click **"Create"** → choose **"Developer"** → fill the form (any app name/description is fine)
4. Copy your **API Key (v3 auth)** — you'll need it in Step 3

---

### Step 2 – Put this code on GitHub
1. Go to https://github.com and create a free account (if you don't have one)
2. Click **"New repository"** → name it `my-stremio-addon` → click **Create**
3. Click **"uploading an existing file"**
4. Upload these 3 files: `index.js`, `package.json`, `render.yaml`
5. Click **"Commit changes"**

---

### Step 3 – Deploy on Render
1. Go to https://render.com and sign up with your GitHub account
2. Click **"New +"** → **"Web Service"**
3. Connect your `my-stremio-addon` GitHub repo
4. Render will auto-detect the settings from `render.yaml`
5. Scroll down to **Environment Variables** and add:
   - Key: `TMDB_API_KEY`  
   - Value: *(paste your key from Step 1)*
6. Click **"Create Web Service"**
7. Wait ~2 minutes for it to build
8. You'll get a URL like: `https://my-stremio-addon.onrender.com`

---

### Step 4 – Install in Stremio
1. Open Stremio on any device
2. Go to **Addons** (puzzle piece icon)
3. Click **"Community Addons"** → paste this URL in the search box:
   ```
   https://my-stremio-addon.onrender.com/manifest.json
   ```
   *(replace with your actual Render URL)*
4. Click **Install**
5. Done! 🎉 You'll see **"My Server – Movies"** and **"My Server – TV Shows"** in your catalogs

---

## 📺 Your server structure expected
```
https://a.111477.xyz/movies/
  └── Movie Name/
        └── movie.mkv

https://a.111477.xyz/tvs/
  └── Show Name/
        └── Season 1/
              └── Show.S01E01.mkv
```

---

## ⚠️ Notes
- **Free Render tier** spins down after 15 min of inactivity — first load may take ~30 seconds to wake up
- To avoid spin-down, upgrade to Render's $7/mo plan or use Railway.app instead
- TMDB API key is optional but **strongly recommended** for posters and descriptions
