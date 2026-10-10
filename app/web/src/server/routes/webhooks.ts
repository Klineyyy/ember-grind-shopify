/**
 * App-specific webhooks (declared in shopify.app.toml). The raw body is
 * HMAC-verified by the Shopify library before any handler runs.
 */
import express, { Router } from 'express';
import { applyInventoryWebhook, applyOrderWebhook } from '../services/sync.js';
import { findShopByDomain, markUninstalled, purgeShop } from '../services/shops.js';
import { logActivity } from '../services/activity.js';
import { shopify } from '../shopify.js';

export const webhooks = Router();

webhooks.post('/', express.text({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const check = await shopify.api.webhooks.validate({ rawBody: req.body, rawRequest: req, rawResponse: res });
  if (!check.valid) {
    res.status(401).send('Invalid webhook');
    return;
  }
  const topic = check.topic.toLowerCase().replace(/_/g, '/'); // ORDERS_CREATE → orders/create
  const domain = check.domain;
  const payload = JSON.parse(req.body || '{}');

  // Acknowledge fast; Shopify retries anything slower than 5s.
  res.status(200).send('ok');

  try {
    const shop = await findShopByDomain(domain);
    switch (topic) {
      case 'app/uninstalled':
        await markUninstalled(domain);
        break;
      case 'orders/create':
        if (shop) await applyOrderWebhook(shop.id, payload);
        break;
      case 'inventory/levels/update':
      case 'inventory_levels/update':
        if (shop) await applyInventoryWebhook(shop.id, payload);
        break;
      case 'shop/redact':
        await purgeShop(domain);
        break;
      case 'customers/data/request':
      case 'customers/data_request':
      case 'customers/redact':
        // Restock Radar stores no customer personal data — nothing to export or erase.
        if (shop) {
          await logActivity({ shopId: shop.id, actor: 'webhook', entityType: 'settings', action: 'gdpr', summary: `Handled ${topic} (no customer data stored)` });
        }
        break;
    }
  } catch (err) {
    console.error(`Webhook ${topic} for ${domain} failed`, err);
  }
});
