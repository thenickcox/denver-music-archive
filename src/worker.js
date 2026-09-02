import { marked } from 'marked';
import rogerRoll from '../bios/roger-roll.md';
import askMeAboutDragons from '../bios/ask-me-about-dragons.md';

// NOTE: when you add bios/{slug}.md, add an import above and an entry below.
// Wrangler bundles these as text modules (see wrangler.toml [[rules]]).
const BIOS = {
  'roger-roll': marked(rogerRoll),
  'ask-me-about-dragons': marked(askMeAboutDragons),
};

// Cache catalog in memory, refresh every hour (per worker isolate)
let catalogCache = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 60 * 1000;

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

async function fetchCatalog(env) {
  const now = Date.now();

  if (catalogCache && (now - lastFetch) < CACHE_TTL) {
    return catalogCache;
  }

  console.log('Fetching fresh catalog from B2...');

  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': 'Basic ' + btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`)
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
      bucketId: env.B2_BUCKET_ID,
      maxFileCount: 10000
    })
  });

  const data = await filesResponse.json();

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
      catalog[slug] = { name: artist, bio: BIOS[slug] || null, albums: {} };
    }

    if (!catalog[slug].albums[album]) catalog[slug].albums[album] = [];

    const encodedFileName = file.fileName.split('/').map(encodeURIComponent).join('/').replace(/%20/g, '+');

    catalog[slug].albums[album].push({
      track,
      url: `${auth.downloadUrl}/file/${env.B2_BUCKET_NAME}/${encodedFileName}`,
      size: file.contentLength
    });
  });

  catalogCache = catalog;
  lastFetch = now;

  console.log(`Loaded ${Object.keys(catalog).length} artists`);

  return catalog;
}

function renderIndex(catalog) {
  const artists = Object.entries(catalog).sort(([, a], [, b]) => a.name.localeCompare(b.name));

  return `
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
  `;
}

function renderArtist(artist) {
  return `
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
  `;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/') {
        const catalog = await fetchCatalog(env);
        return html(renderIndex(catalog));
      }

      const artistMatch = path.match(/^\/artist\/([^/]+)$/);
      if (artistMatch) {
        const catalog = await fetchCatalog(env);
        const artist = catalog[decodeURIComponent(artistMatch[1])];
        if (!artist) return html('Artist not found', 404);
        return html(renderArtist(artist));
      }

      if (path === '/api/catalog') {
        const catalog = await fetchCatalog(env);
        return Response.json(catalog);
      }

      return html('Not found', 404);
    } catch (error) {
      console.error('Error:', error);
      return html('Error loading catalog', 500);
    }
  }
};
