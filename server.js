require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Load all bios from bios/ into memory at startup
function loadBios() {
  const bios = {};
  const biosDir = path.join(__dirname, 'bios');
  if (!fs.existsSync(biosDir)) return bios;

  fs.readdirSync(biosDir).forEach(file => {
    if (!file.endsWith('.md')) return;
    const slug = file.slice(0, -3);
    const content = fs.readFileSync(path.join(biosDir, file), 'utf8');
    bios[slug] = marked(content);
  });

  return bios;
}

// Cache catalog in memory, refresh every hour
let catalogCache = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 60 * 1000;

async function fetchCatalog() {
  const now = Date.now();

  if (catalogCache && (now - lastFetch) < CACHE_TTL) {
    return catalogCache;
  }

  console.log('Fetching fresh catalog from B2...');

  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.B2_KEY_ID}:${process.env.B2_APP_KEY}`
      ).toString('base64')
    }
  });

  const auth = await authResponse.json();

  const filesResponse = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: {
      'Authorization': auth.authorizationToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketId: process.env.B2_BUCKET_ID,
      maxFileCount: 10000
    })
  });

  const data = await filesResponse.json();

  const bios = loadBios();
  const catalog = {};

  data.files.forEach(file => {
    if (!file.fileName.endsWith('.mp3')) return;

    const parts = file.fileName.split('/');
    if (parts.length < 3) return;

    const artist = parts[0];
    const album = parts[1];
    const track = parts.slice(2).join('/');
    const slug = slugify(artist);

    if (!catalog[slug]) {
      catalog[slug] = { name: artist, bio: bios[slug] || null, albums: {} };
    }

    if (!catalog[slug].albums[album]) catalog[slug].albums[album] = [];

    const encodedFileName = file.fileName.split('/').map(encodeURIComponent).join('/').replace(/%20/g, '+');

    catalog[slug].albums[album].push({
      track,
      url: `${auth.downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${encodedFileName}`,
      size: file.contentLength
    });
  });

  catalogCache = catalog;
  lastFetch = now;

  console.log(`Loaded ${Object.keys(catalog).length} artists`);

  return catalog;
}

// Landing page — artist list
app.get('/', async (req, res) => {
  try {
    const catalog = await fetchCatalog();
    const artists = Object.entries(catalog).sort(([, a], [, b]) => a.name.localeCompare(b.name));

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Denver Music Archive (1997-2005)</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f9f9f9;
    }
    h1 {
      border-bottom: 3px solid #333;
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .intro {
      background: #fff;
      padding: 20px;
      margin-bottom: 30px;
      border-left: 4px solid #333;
    }
    .artist-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      margin-bottom: 50px;
    }
    .artist-card {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-decoration: none;
      color: #333;
      display: block;
      transition: box-shadow 0.2s;
    }
    .artist-card:hover { box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
    .artist-card h2 { margin: 0 0 8px 0; font-size: 18px; }
    .artist-card .meta { color: #888; font-size: 13px; }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #ddd;
      text-align: center;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>🎸 Denver Music Archive</h1>

  <div class="intro">
    <p><strong>Preserving underground Denver music from 1997-2005.</strong></p>
    <p>Recordings you can't find anywhere else. A love letter to the Denver music scene of that era.</p>
    <p>Have recordings from this time period? Email: <strong>nick@nickcox.me</strong></p>
    <p>Uploaded by community and artists; removed upon request.</p>
  </div>

  <div class="artist-list">
    ${artists.map(([slug, artist]) => {
      const albumCount = Object.keys(artist.albums).length;
      return `
      <a class="artist-card" href="/artist/${encodeURIComponent(slug)}">
        <h2>${escapeHtml(artist.name)}</h2>
        <div class="meta">${albumCount} album${albumCount !== 1 ? 's' : ''}</div>
      </a>`;
    }).join('')}
  </div>

  <div class="footer">
    <p>Denver Music Archive · 1997-2005</p>
    <p>Built with love for the scene</p>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error loading catalog');
  }
});

// Artist page
app.get('/artist/:slug', async (req, res) => {
  try {
    const catalog = await fetchCatalog();
    const artist = catalog[req.params.slug];

    if (!artist) return res.status(404).send('Artist not found');

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(artist.name)} · Denver Music Archive</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f9f9f9;
    }
    .back {
      display: inline-block;
      margin-bottom: 20px;
      color: #555;
      text-decoration: none;
      font-size: 14px;
    }
    .back:hover { color: #333; }
    h1 {
      border-bottom: 3px solid #333;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .bio {
      background: #fff;
      padding: 20px;
      margin-bottom: 30px;
      border-left: 4px solid #333;
      line-height: 1.6;
    }
    .bio p:first-child { margin-top: 0; }
    .bio p:last-child { margin-bottom: 0; }
    .album {
      background: #fff;
      margin-bottom: 30px;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .album h2 {
      margin: 0 0 15px 0;
      color: #333;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
    }
    .track {
      margin: 12px 0;
      padding: 12px;
      background: #f5f5f5;
      border-radius: 4px;
    }
    .track-name {
      margin-bottom: 8px;
      font-weight: 500;
      color: #333;
    }
    audio {
      width: 100%;
      height: 32px;
    }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #ddd;
      text-align: center;
      color: #666;
    }
    a {
      color: rgb(234,54,36);
    }
  </style>
</head>
<body>
  <a class="back" href="/">← All Artists</a>
  <h1>${escapeHtml(artist.name)}</h1>

  ${artist.bio ? `<div class="bio">${artist.bio}</div>` : ''}

  ${Object.entries(artist.albums).map(([album, tracks]) => `
    <div class="album">
      <h2>${escapeHtml(album)}</h2>
      ${tracks.map(track => `
        <div class="track">
          <div class="track-name">${escapeHtml(track.track)}</div>
          <audio controls preload="none">
            <source src="${escapeHtml(track.url)}" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
        </div>
      `).join('')}
    </div>
  `).join('')}

  <div class="footer">
    <p>Denver Music Archive · 1997-2005</p>
    <p>Built with love for the scene</p>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error loading artist');
  }
});

// API endpoint
app.get('/api/catalog', async (req, res) => {
  try {
    const catalog = await fetchCatalog();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
