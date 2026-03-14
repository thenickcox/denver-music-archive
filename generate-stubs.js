/**
 * Connects to B2, reads the artist list from MP3 paths, and creates
 * bios/{slug}.md stubs for any artist that doesn't already have one.
 * Run once: node generate-stubs.js
 */
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function main() {
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

  // Collect unique artist names from MP3 paths
  const artists = new Map();
  data.files.forEach(file => {
    if (!file.fileName.endsWith('.mp3')) return;
    const parts = file.fileName.split('/');
    if (parts.length < 3) return;
    const name = parts[0];
    artists.set(slugify(name), name);
  });

  const biosDir = path.join(__dirname, 'bios');
  if (!fs.existsSync(biosDir)) fs.mkdirSync(biosDir);

  let created = 0;
  let skipped = 0;

  for (const [slug, name] of artists) {
    const filePath = path.join(biosDir, `${slug}.md`);
    if (fs.existsSync(filePath)) {
      console.log(`  skip  ${slug}.md (already exists)`);
      skipped++;
      continue;
    }

    fs.writeFileSync(filePath, `${name} were a Denver-based band active in the late 1990s and early 2000s.\n`);
    console.log(`  create  ${slug}.md`);
    created++;
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
