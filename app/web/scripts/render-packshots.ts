/**
 * Renders the demo packshots (src/server/demo/packshots.ts) to JPEGs in
 * src/server/demo/images/. Uses headless Chromium so the brand fonts
 * (Fraunces + Inter from Google Fonts) render exactly as on the storefront.
 *
 *   npx playwright install chromium   # once
 *   npm run demo:packshots
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { allPackshots, PACKSHOT_SIZE } from '../src/server/demo/packshots.js';

const OUT = path.resolve(import.meta.dirname, '../src/server/demo/images');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: PACKSHOT_SIZE, height: PACKSHOT_SIZE } });

for (const shot of allPackshots()) {
  await page.setContent(
    `<!doctype html><html><head>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,800;1,9..144,400&family=Inter:wght@400;600&display=block" rel="stylesheet">
      <style>html,body{margin:0}svg{display:block}</style>
    </head><body>${shot.svg}</body></html>`,
    { waitUntil: 'networkidle' }
  );
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT, `${shot.handle}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: PACKSHOT_SIZE, height: PACKSHOT_SIZE } });
  console.log('✔', path.relative(process.cwd(), file));
}

await browser.close();
