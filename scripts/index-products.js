// One-time Meilisearch indexing script for Omix Store products
// Reads all active products from the database and indexes them into Meilisearch
// Idempotent — safe to run multiple times; skips already-indexed products
//
// Usage: node scripts/index-products.js
//
// Requires env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, MEILI_HOST, MEILI_MASTER_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { Meilisearch } from 'meilisearch';

const MEILI_HOST = process.env.MEILI_HOST || '';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || '';
const MEILI_INDEX = process.env.MEILI_INDEX || 'products';

const ID_TO_CATEGORY = {
  1: 'Electronics', 2: 'Furniture', 3: 'Clothing', 4: 'Books',
  5: 'Vehicles', 6: 'Home & Garden', 7: 'Sports', 8: 'Toys & Games',
  9: 'Health & Beauty', 10: 'Services', 11: 'Others',
  12: 'Food', 13: 'Drinks', 14: 'Snacks', 15: 'Bakery',
};

function buildDoc(p) {
  return {
    id: String(p.id),
    name: p.title || p.name || '',
    description: p.description || '',
    category: ID_TO_CATEGORY[p.category_id] || p.category || 'Others',
    brand: p.brand || '',
    price: parseFloat(p.price) || 0,
    stock: parseInt(p.stock_quantity ?? p.quantity ?? 0) || 0,
    images: Array.isArray(p.images) ? p.images : [],
    rating: parseFloat(p.avg_rating ?? p.rating ?? 0) || 0,
    createdAt: p.created_at || new Date().toISOString(),
  };
}

// Fields that determine whether a re-index is needed
const COMPARE_KEYS = ['name', 'description', 'category', 'brand', 'price', 'stock', 'rating'];

function compareChanged(dbDoc, meiliDoc) {
  for (const key of COMPARE_KEYS) {
    if (String(dbDoc[key] ?? '') !== String(meiliDoc[key] ?? '')) return true;
  }
  return false;
}

async function main() {
  console.log('=== Omix Store - Product Indexer ===\n');

  if (!MEILI_HOST || !MEILI_MASTER_KEY) {
    console.error('ERROR: MEILI_HOST and MEILI_MASTER_KEY env vars must be set');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars must be set');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const meili = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY });

  // ── Ensure index ──
  console.log('Ensuring index...');
  const indexes = await meili.getIndexes();
  if (!indexes.results?.some(i => i.uid === MEILI_INDEX)) {
    await meili.createIndex(MEILI_INDEX, { primaryKey: 'id' });
    console.log('  Created:', MEILI_INDEX);
  } else {
    console.log('  Exists:', MEILI_INDEX);
  }
  const idx = meili.index(MEILI_INDEX);
  await idx.updateSearchableAttributes(['name', 'description', 'category', 'brand']);
  await idx.updateFilterableAttributes(['category', 'brand', 'price', 'rating', 'createdAt']);
  await idx.updateSortableAttributes(['price', 'createdAt', 'rating']);
  console.log('  Settings configured.\n');

  // ── Fetch existing Meilisearch docs (all content fields) ──
  const existingDocs = new Map();
  try {
    let offset = 0;
    while (true) {
      const result = await idx.getDocuments({ offset, limit: 1000, fields: ['id', ...COMPARE_KEYS] });
      const docs = result.results || [];
      if (docs.length === 0) break;
      for (const d of docs) existingDocs.set(String(d.id), d);
      offset += docs.length;
    }
    console.log(`Existing indexed docs: ${existingDocs.size}`);
  } catch (err) {
    console.log('Fetching existing docs failed (fresh index?):', err.message);
  }

  // ── Fetch all active products from DB ──
  console.log('\nFetching active products from DB...');
  const { data: products, error } = await supabase
    .from('listings')
    .select('*', { count: 'exact' })
    .eq('status', 'active');

  if (error) { console.error('ERROR:', error.message); process.exit(1); }

  const totalFound = products?.length || 0;
  console.log(`Products found in DB: ${totalFound}`);
  if (!totalFound) { console.log('No products. Done.'); return; }

  // ── Diff: skip unchanged, index new/changed ──
  const toIndex = [];
  let skipped = 0;
  let updated = 0;

  for (const product of products) {
    const doc = buildDoc(product);
    const existing = existingDocs.get(doc.id);
    if (existing) {
      if (compareChanged(doc, existing)) {
        toIndex.push(doc);
        updated++;
      } else {
        skipped++;
      }
    } else {
      toIndex.push(doc);
    }
  }

  console.log(`  New:         ${toIndex.length - updated}`);
  console.log(`  Updated:     ${updated}`);
  console.log(`  Skipped:     ${skipped}\n`);

  // ── Index ──
  let indexed = 0;
  let failures = 0;

  if (toIndex.length > 0) {
    const BATCH = 100;
    console.log(`Indexing ${toIndex.length} products...`);
    for (let i = 0; i < toIndex.length; i += BATCH) {
      const batch = toIndex.slice(i, i + BATCH);
      try {
        await idx.addDocuments(batch);
        indexed += batch.length;
        const pct = Math.min(100, Math.round((indexed / toIndex.length) * 100));
        process.stdout.write(`\r  ${indexed}/${toIndex.length} (${pct}%)`);
      } catch (err) {
        failures += batch.length;
        console.error(`\n  Batch ${Math.floor(i / BATCH) + 1} failed:`, err.message);
      }
    }
    console.log();
  }

  // ── Report ──
  console.log('\n=== Indexing Report ===');
  console.log(`  Products found in DB:    ${totalFound}`);
  console.log(`  Successfully indexed:    ${indexed}`);
  console.log(`  Skipped (unchanged):     ${skipped}`);
  console.log(`  Failures:                ${failures}`);

  try {
    const stats = await idx.getStats();
    console.log(`  Meilisearch doc count:   ${stats.numberOfDocuments}`);
  } catch { /* skip */ }

  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
