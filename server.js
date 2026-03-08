require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (CSS, etc)
app.use(express.static('public'));

// Cache catalog in memory, refresh every hour
let catalogCache = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchCatalog() {
  const now = Date.now();
  
  // Return cache if fresh
  if (catalogCache && (now - lastFetch) < CACHE_TTL) {
    return catalogCache;
  }

  console.log('Fetching fresh catalog from B2...');

  // Authorize with B2
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.B2_KEY_ID}:${process.env.B2_APP_KEY}`
      ).toString('base64')
    }
  });

  const auth = await authResponse.json();

  // List all files
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

  // Build catalog structure
  const catalog = {};
  
  data.files.forEach(file => {
    if (!file.fileName.endsWith('.mp3')) return;
    
    const parts = file.fileName.split('/');
    if (parts.length < 3) return;
    
    const artist = parts[0];
    const album = parts[1];
    const track = parts.slice(2).join('/');
    
    if (!catalog[artist]) catalog[artist] = {};
    if (!catalog[artist][album]) catalog[artist][album] = [];
    
    // Use the downloadUrl from auth response and encode spaces as +
    const encodedFileName = file.fileName.split('/').map(encodeURIComponent).join('/').replace(/%20/g, '+');
    
    catalog[artist][album].push({
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

// Main route
app.get('/', async (req, res) => {
  try {
    const catalog = await fetchCatalog();
    
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
    .artist {
      background: #fff;
      margin-bottom: 30px;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .artist h2 {
      margin: 0 0 15px 0;
      color: #333;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
    }
    .album {
      margin-bottom: 25px;
    }
    .album h3 {
      margin: 0 0 10px 0;
      color: #666;
      font-size: 18px;
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

  ${Object.entries(catalog).sort().map(([artist, albums]) => `
    <div class="artist">
      <h2>${escapeHtml(artist)}</h2>
      ${Object.entries(albums).map(([album, tracks]) => `
        <div class="album">
          <h3>${escapeHtml(album)}</h3>
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
    res.status(500).send('Error loading catalog');
  }
});

// API endpoint (for future use)
app.get('/api/catalog', async (req, res) => {
  try {
    const catalog = await fetchCatalog();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
