import { ApiVersion, LogSeverity } from '@shopify/shopify-api';
import { shopifyApp } from '@shopify/shopify-app-express';
import { DrizzleSessionStorageMySQL } from '@shopify/shopify-app-session-storage-drizzle';
import { db } from './db/client.js';
import { sessions } from './db/schema.js';
import { onShopAuthenticated } from './services/shops.js';

export const API_VERSION = ApiVersion.July26;

/**
 * Embedded auth uses token exchange + Shopify-managed installation:
 * scopes come from shopify.app.toml, App Bridge sends a session token with
 * every fetch, and the library swaps it for an offline access token that we
 * persist in MySQL via Drizzle. No OAuth redirect dance inside the iframe.
 */
export const shopify = shopifyApp({
  api: {
    apiVersion: API_VERSION,
    logger: { level: process.env.NODE_ENV === 'production' ? LogSeverity.Warning : LogSeverity.Info },
  },
  auth: { path: '/api/auth', callbackPath: '/api/auth/callback' },
  webhooks: { path: '/api/webhooks' },
  sessionStorage: new DrizzleSessionStorageMySQL(db, sessions),
  future: { tokenExchange: true, expiringOfflineAccessTokens: true },
  hooks: {
    afterAuth: async ({ session }) => {
      await onShopAuthenticated(session);
    },
  },
});
