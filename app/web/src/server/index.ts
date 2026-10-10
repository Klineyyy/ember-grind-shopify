import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes/api.js';
import { webhooks } from './routes/webhooks.js';
import { shopify } from './shopify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CLIENT_ROOT = path.join(ROOT, 'src/client');
const DIST = path.join(ROOT, 'dist/client');
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || process.env.BACKEND_PORT || process.env.FRONTEND_PORT || 3000);

const app = express();
const server = createServer(app);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Webhooks need the raw body for HMAC verification, so they mount before any JSON parser.
app.use('/api/webhooks', webhooks);

// Everything else under /api requires a valid App Bridge session token.
app.use('/api', shopify.validateAuthenticatedSession(), express.json({ limit: '1mb' }), api);

/** App Bridge + Polaris must load from Shopify's CDN, first thing in <head>. */
function injectShopifyHead(html: string) {
  const head = [
    `<meta name="shopify-api-key" content="${process.env.SHOPIFY_API_KEY ?? ''}" />`,
    '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>',
    '<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>',
  ].join('\n    ');
  return html.replace('<head>', `<head>\n    ${head}`);
}

if (isProd) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
  const template = injectShopifyHead(await readFile(path.join(DIST, 'index.html'), 'utf8'));
  app.get('/{*path}', shopify.ensureInstalledOnShop(), (_req, res) => {
    res.type('html').send(template);
  });
} else {
  // Dev: Vite runs inside Express (one process, one tunnel). HMR rides the same HTTP server.
  const { createServer: createVite } = await import('vite');
  const host = process.env.HOST ? new URL(process.env.HOST) : null;
  const vite = await createVite({
    root: CLIENT_ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: { server, ...(host ? { protocol: 'wss', clientPort: 443, host: host.hostname } : {}) },
      allowedHosts: true,
    },
  });
  app.use(vite.middlewares);
  app.get('/{*path}', shopify.ensureInstalledOnShop(), async (req, res, next) => {
    try {
      const raw = await readFile(path.join(CLIENT_ROOT, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.type('html').send(injectShopifyHead(html));
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Restock Radar listening on :${PORT} (${isProd ? 'production' : 'development'})`);
});
