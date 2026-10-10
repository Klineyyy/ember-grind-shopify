/**
 * Dev-only: populates the Ember & Grind dev store so the theme and the app
 * have realistic data — metafield definitions, coffees + gear with stock,
 * branded packshot images, smart collections, the SAMPLER15 discount and
 * the main menu.
 *
 * Idempotent: existing products / collections / discount are skipped, so it
 * is safe to run more than once. Each step reports its own result.
 */
import type { Session } from '@shopify/shopify-api';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { shopify } from '../shopify.js';
import { COFFEES, GEAR, GRINDS, VARIANT_MIX, variantCost, variantPrice, variantSku } from './catalog.js';

type Client = InstanceType<typeof shopify.api.clients.Graphql>;
type UserError = { field?: string[] | null; message: string; code?: string | null };

export interface SeedLog {
  step: string;
  ok: boolean;
  detail: string;
}

const METAFIELDS = [
  { key: 'roast_level', name: 'Roast level (1–5)', type: 'number_integer' },
  { key: 'origin', name: 'Origin', type: 'single_line_text_field' },
  { key: 'process', name: 'Process', type: 'single_line_text_field' },
  { key: 'altitude', name: 'Altitude', type: 'single_line_text_field' },
  { key: 'tasting_notes', name: 'Tasting notes', type: 'list.single_line_text_field' },
  { key: 'brew_methods', name: 'Best brew methods', type: 'list.single_line_text_field' },
  { key: 'flavor_profile', name: 'Flavour profile (0–10)', type: 'json' },
  { key: 'decaf', name: 'Decaf', type: 'boolean' },
];

async function gql<T>(client: Client, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await client.request<T>(query, { variables });
  if (!res.data) throw new Error('Empty GraphQL response');
  return res.data;
}

const errorsText = (errors: UserError[]) => errors.map((e) => e.message).join('; ');

export async function seedStore(session: Session): Promise<SeedLog[]> {
  const client = new shopify.api.clients.Graphql({ session });
  const log: SeedLog[] = [];
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      log.push({ step: name, ok: true, detail: await fn() });
    } catch (err) {
      log.push({ step: name, ok: false, detail: (err as Error).message });
    }
  };

  /* 1. Metafield definitions (so merchants can edit coffee data in the admin) */
  await step('Metafield definitions', async () => {
    let created = 0;
    for (const def of METAFIELDS) {
      const data = await gql<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(
        client,
        `#graphql
        mutation Def($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) { userErrors { field message code } }
        }`,
        {
          definition: {
            namespace: 'coffee',
            key: def.key,
            name: def.name,
            type: def.type,
            ownerType: 'PRODUCT',
            access: { storefront: 'PUBLIC_READ' },
          },
        }
      );
      const errs = data.metafieldDefinitionCreate.userErrors.filter((e) => e.code !== 'TAKEN');
      if (errs.length) throw new Error(`${def.key}: ${errorsText(errs)}`);
      if (!data.metafieldDefinitionCreate.userErrors.length) created++;
    }
    return `${created} created, ${METAFIELDS.length - created} already existed`;
  });

  /* 2. Location + Online Store publication */
  const { locations, publications } = await gql<{
    locations: { nodes: { id: string }[] };
    publications: { nodes: { id: string; name: string }[] };
  }>(
    client,
    `#graphql
    query { locations(first: 1, query: "active:true") { nodes { id } } publications(first: 20) { nodes { id name } } }`
  );
  const locationId = locations.nodes[0]?.id;
  const onlineStore = publications.nodes.find((p) => p.name === 'Online Store')?.id;
  if (!locationId) return [...log, { step: 'Location', ok: false, detail: 'No active location on this store' }];

  const publish = async (id: string) => {
    if (!onlineStore) return;
    await gql(
      client,
      `#graphql
      mutation Pub($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { message } }
      }`,
      { id, input: [{ publicationId: onlineStore }] }
    );
  };

  const exists = async (handle: string) => {
    const data = await gql<{ products: { nodes: { id: string }[] } }>(
      client,
      `#graphql
      query Find($q: String!) { products(first: 1, query: $q) { nodes { id } } }`,
      { q: `handle:${handle}` }
    );
    return data.products.nodes[0]?.id ?? null;
  };

  const PRODUCT_SET = `#graphql
    mutation Seed($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id }
        userErrors { field message code }
      }
    }`;

  /* 3. Coffees */
  await step('Coffee products', async () => {
    let created = 0;
    for (const coffee of COFFEES) {
      if (await exists(coffee.handle)) continue;
      const variants = VARIANT_MIX.map((mix) => {
        const price = variantPrice(coffee, mix.size);
        return {
          optionValues: [
            { optionName: 'Size', name: mix.size },
            { optionName: 'Grind', name: mix.grind },
          ],
          price: price.toFixed(2),
          sku: variantSku(coffee, mix.size, mix.grind),
          inventoryItem: { tracked: true, cost: variantCost(price).toFixed(2) },
          inventoryQuantities: [
            { locationId, name: 'available', quantity: Math.max(0, Math.round(coffee.demand * mix.share * coffee.coverDays)) },
          ],
        };
      });
      const data = await gql<{ productSet: { product: { id: string } | null; userErrors: UserError[] } }>(client, PRODUCT_SET, {
        input: {
          title: coffee.title,
          handle: coffee.handle,
          descriptionHtml: `<p>${coffee.description}</p>`,
          productType: 'Coffee',
          vendor: 'Ember & Grind',
          tags: [`roast:${coffee.roast}`, `origin:${coffee.origin}`, ...(coffee.decaf ? ['decaf'] : [])],
          status: 'ACTIVE',
          productOptions: [
            { name: 'Size', values: [{ name: '250g' }, { name: '1kg' }] },
            { name: 'Grind', values: GRINDS.map((name) => ({ name })) },
          ],
          variants,
          metafields: [
            { namespace: 'coffee', key: 'roast_level', type: 'number_integer', value: String(coffee.roast) },
            { namespace: 'coffee', key: 'origin', type: 'single_line_text_field', value: coffee.origin },
            { namespace: 'coffee', key: 'process', type: 'single_line_text_field', value: coffee.process },
            { namespace: 'coffee', key: 'altitude', type: 'single_line_text_field', value: coffee.altitude },
            { namespace: 'coffee', key: 'tasting_notes', type: 'list.single_line_text_field', value: JSON.stringify(coffee.notes) },
            { namespace: 'coffee', key: 'brew_methods', type: 'list.single_line_text_field', value: JSON.stringify(coffee.methods) },
            { namespace: 'coffee', key: 'flavor_profile', type: 'json', value: JSON.stringify(coffee.profile) },
            { namespace: 'coffee', key: 'decaf', type: 'boolean', value: String(Boolean(coffee.decaf)) },
          ],
        },
      });
      if (data.productSet.userErrors.length) throw new Error(`${coffee.title}: ${errorsText(data.productSet.userErrors)}`);
      await publish(data.productSet.product!.id);
      created++;
    }
    return `${created} created, ${COFFEES.length - created} already existed`;
  });

  /* 4. Brewing gear */
  await step('Brewing gear', async () => {
    let created = 0;
    for (const gear of GEAR) {
      if (await exists(gear.handle)) continue;
      const data = await gql<{ productSet: { product: { id: string } | null; userErrors: UserError[] } }>(client, PRODUCT_SET, {
        input: {
          title: gear.title,
          handle: gear.handle,
          descriptionHtml: `<p>${gear.description}</p>`,
          productType: 'Brewing Gear',
          vendor: 'Ember & Grind',
          tags: gear.tags,
          status: 'ACTIVE',
          productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
          variants: [
            {
              optionValues: [{ optionName: 'Title', name: 'Default Title' }],
              price: gear.price.toFixed(2),
              sku: `EG-GEAR-${gear.handle.toUpperCase().slice(0, 18)}`,
              inventoryItem: { tracked: true, cost: gear.cost.toFixed(2) },
              inventoryQuantities: [{ locationId, name: 'available', quantity: Math.round(gear.demand * gear.coverDays) }],
            },
          ],
        },
      });
      if (data.productSet.userErrors.length) throw new Error(`${gear.title}: ${errorsText(data.productSet.userErrors)}`);
      await publish(data.productSet.product!.id);
      created++;
    }
    return `${created} created, ${GEAR.length - created} already existed`;
  });

  /* 4b. Branded packshots (rendered by scripts/render-packshots.ts) */
  await step('Product images', async () => {
    const items = [
      ...COFFEES.map((c) => ({ handle: c.handle, alt: `${c.title} — Ember & Grind coffee bag` })),
      ...GEAR.map((g) => ({ handle: g.handle, alt: g.title })),
    ];
    let uploaded = 0;
    for (const item of items) {
      const found = await gql<{ products: { nodes: { id: string; media: { nodes: { id: string }[] } }[] } }>(
        client,
        `#graphql
        query Media($q: String!) { products(first: 1, query: $q) { nodes { id media(first: 1) { nodes { id } } } } }`,
        { q: `handle:${item.handle}` }
      );
      const product = found.products.nodes[0];
      if (!product || product.media.nodes.length) continue; // missing, or already has an image

      const file = await readFile(path.join(import.meta.dirname, 'images', `${item.handle}.jpg`));
      const staged = await gql<{
        stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: UserError[] };
      }>(
        client,
        `#graphql
        mutation Stage($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
        { input: [{ resource: 'IMAGE', filename: `${item.handle}.jpg`, mimeType: 'image/jpeg', httpMethod: 'POST', fileSize: String(file.length) }] }
      );
      if (staged.stagedUploadsCreate.userErrors.length) throw new Error(errorsText(staged.stagedUploadsCreate.userErrors));
      const target = staged.stagedUploadsCreate.stagedTargets[0];

      // Upload the bytes straight to Shopify's storage, then attach the staged file to the product.
      const form = new FormData();
      target.parameters.forEach((p) => form.append(p.name, p.value));
      form.append('file', new Blob([file], { type: 'image/jpeg' }), `${item.handle}.jpg`);
      const upload = await fetch(target.url, { method: 'POST', body: form });
      if (!upload.ok) throw new Error(`Upload failed for ${item.handle}: ${upload.status}`);

      const attached = await gql<{ productUpdate: { userErrors: UserError[] } }>(
        client,
        `#graphql
        mutation Attach($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) { userErrors { field message } }
        }`,
        { product: { id: product.id }, media: [{ originalSource: target.resourceUrl, alt: item.alt, mediaContentType: 'IMAGE' }] }
      );
      if (attached.productUpdate.userErrors.length) throw new Error(`${item.handle}: ${errorsText(attached.productUpdate.userErrors)}`);
      uploaded++;
    }
    return `${uploaded} uploaded, ${items.length - uploaded} already had images`;
  });

  /* 5. Smart collections */
  const collectionIds: Record<string, string> = {};
  await step('Collections', async () => {
    const wanted = [
      { handle: 'coffee', title: 'Coffee', type: 'Coffee', description: 'Single origins and blends, roasted every Tuesday.' },
      { handle: 'brewing-gear', title: 'Brewing Gear', type: 'Brewing Gear', description: 'Everything you need to brew it right at home.' },
    ];
    const results: string[] = [];
    for (const c of wanted) {
      const found = await gql<{ collectionByIdentifier: { id: string } | null }>(
        client,
        `#graphql
        query C($handle: String!) { collectionByIdentifier(identifier: { handle: $handle }) { id } }`,
        { handle: c.handle }
      );
      if (found.collectionByIdentifier) {
        collectionIds[c.handle] = found.collectionByIdentifier.id;
        results.push(`${c.title} exists`);
        continue;
      }
      const data = await gql<{ collectionCreate: { collection: { id: string } | null; userErrors: UserError[] } }>(
        client,
        `#graphql
        mutation Col($input: CollectionInput!) {
          collectionCreate(input: $input) { collection { id } userErrors { field message } }
        }`,
        {
          input: {
            title: c.title,
            handle: c.handle,
            descriptionHtml: `<p>${c.description}</p>`,
            ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TYPE', relation: 'EQUALS', condition: c.type }] },
          },
        }
      );
      if (data.collectionCreate.userErrors.length) throw new Error(errorsText(data.collectionCreate.userErrors));
      collectionIds[c.handle] = data.collectionCreate.collection!.id;
      await publish(collectionIds[c.handle]);
      results.push(`${c.title} created`);
    }
    return results.join(', ');
  });

  /* 6. Sampler discount used by the theme's Brew Profile quiz */
  await step('SAMPLER15 discount', async () => {
    const found = await gql<{ codeDiscountNodeByCode: { id: string } | null }>(
      client,
      `#graphql
      query { codeDiscountNodeByCode(code: "SAMPLER15") { id } }`
    );
    if (found.codeDiscountNodeByCode) return 'already exists';
    const data = await gql<{ discountCodeBasicCreate: { userErrors: UserError[] } }>(
      client,
      `#graphql
      mutation Disc($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) { userErrors { field message } }
      }`,
      {
        input: {
          title: 'Brew Profile sampler — 15% off 3+ bags',
          code: 'SAMPLER15',
          startsAt: new Date().toISOString(),
          context: { all: 'ALL' },
          customerGets: { value: { percentage: 0.15 }, items: { all: true } },
          minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: '3' } },
        },
      }
    );
    if (data.discountCodeBasicCreate.userErrors.length) throw new Error(errorsText(data.discountCodeBasicCreate.userErrors));
    return 'created (15% off when buying 3+ items)';
  });

  /* 7. Main menu */
  await step('Main menu', async () => {
    const menus = await gql<{ menus: { nodes: { id: string; handle: string; title: string }[] } }>(
      client,
      `#graphql
      query { menus(first: 10) { nodes { id handle title } } }`
    );
    const main = menus.menus.nodes.find((m) => m.handle === 'main-menu');
    if (!main) return 'no main-menu found, skipped';
    const items = [
      { title: 'Shop coffee', type: 'COLLECTION', resourceId: collectionIds.coffee, url: '/collections/coffee', items: [] },
      { title: 'Brewing gear', type: 'COLLECTION', resourceId: collectionIds['brewing-gear'], url: '/collections/brewing-gear', items: [] },
      { title: 'Find my coffee', type: 'HTTP', url: '/#brew-quiz', items: [] },
    ].filter((i) => i.type === 'HTTP' || i.resourceId);
    const data = await gql<{ menuUpdate: { userErrors: UserError[] } }>(
      client,
      `#graphql
      mutation Menu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
        menuUpdate(id: $id, title: $title, items: $items) { userErrors { field message } }
      }`,
      { id: main.id, title: main.title, items }
    );
    if (data.menuUpdate.userErrors.length) throw new Error(errorsText(data.menuUpdate.userErrors));
    return `${items.length} links set`;
  });

  if (!onlineStore) log.push({ step: 'Publishing', ok: false, detail: 'Online Store publication not found; publish products manually' });
  return log;
}
