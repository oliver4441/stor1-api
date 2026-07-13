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

// ── Category ID → Name mapping ──
const ID_TO_CATEGORY = {
  1: 'Electronics',
  2: 'Furniture',
  3: 'Clothing',
  4: 'Books',
  5: 'Vehicles',
  6: 'Home & Garden',
  7: 'Sports',
  8: 'Toys & Games',
  9: 'Health & Beauty',
  10: 'Services',
  11: 'Others',
  12: 'Food',
  13: 'Drinks',
  14: 'Snacks',
  15: 'Bakery',
};

async function main() {
  console.log('=== Omix Store — Product Indexer ===\n');

  // Validate env
  if (!MEILI_HOST || !MEILI_MASTER_KEY) {
    console.error('ERROR: MEILI_HOST and MEILI_MASTER_KEY env vars must be set');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars must be set');
    process.exit(1);
  }

  // ── Init clients ──
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const meili = new Meilisearch({
    host: MEILI_HOST,
    apiKey: MEILI_MASTER_KEY,
  });

  // ── Ensure index exists with proper config ──
  console.log('Ensuring Meilisearch index exists...');
  const indexes = await meili.getIndexes();
  const exists = indexes.results?.some(i => i.uid === MEILI_INDEX);
  if (!exists) {
    await meili.createIndex(MEILI_INDEX, { primaryKey: 'id' });
    console.log('  Created index:', MEILI_INDEX);
  } else {
    console.log('  Index already exists:', MEILI_INDEX);
  }

  const idx = meili.index(MEILI_INDEX);

  // Configure search/filter/sort attributes
  await idx.updateSearchableAttributes(['name', 'description', 'category', 'brand']);
  await idx.updateFilterableAttributes(['category', 'brand', 'price', 'rating', 'createdAt']);
  await idx.updateSortableAttributes(['price', 'createdAt', 'rating']);
  console.log('  Index settings configured.\n');

  // ── Get current indexed IDs ──
  let existingDocIds = new Set();
  try {
    const allDocs = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const result = await idx.getDocuments({ offset, limit: batchSize, fields: ['id'] });
      const docs = result.results || [];
      if (docs.length === 0) break;
      allDocs.push(...docs);
      offset += batchSize;
    }
    existingDocIds = new Set(allDocs.map(d => String(d.id)));
    console.log(`Already indexed documents: ${existingDocIds.size}`);
  } catch (err) {
    console.log('Could not fetch existing documents (fresh index or error):', err.message);
  }

  // ── Fetch all active products from DB ──
  console.log('\nFetching products from database...');
  const { data: products, error, count } = await supabase
    .from('listings')
    .select('*', { count: 'exact' })
    .eq('status', 'active');

  if (error) {
    console.error('ERROR fetching products:', error.message);
    process.exit(1);
  }

  console.log(`Products found in DB: ${count || products.length}`);

  if (!products || products.length === 0) {
    console.log('No products to index. Done.');
    return;
  }

  // ── Build documents ──
  function buildDoc(p) {
    const catName = ID_TO_CATEGORY[p.category_id] || p.category || 'Others';
    return {
      id: String(p.id),
      name: p.title || p.name || '',
      description: p.description || '',
      category: catName,
      brand: p.brand || '',
      price: parseFloat(p.price) || 0,
      stock: parseInt(p.stock_quantity ?? p.quantity ?? 0) || 0,
      images: Array.isArray(p.images) ? p.images : [],
      rating: parseFloat(p.avg_rating ?? p.rating ?? 0) || 0,
      createdAt: p.created_at || new Date().toISOString(),
    };
  }

  const docs = products.map(buildDoc);

  // Separate new vs skip
  const toIndex = [];
  let skipped = 0;
  for (const doc of docs) {
    if (existingDocIds.has(doc.id)) {
      skipped++;
    } else {
      toIndex.push(doc);
    }
  }

  console.log(`\nTo index (new/updated): ${toIndex.length}`);
  console.log(`Skipped (already indexed): ${skipped}`);

  // ── Index in batches ──
  if (toIndex.length > 0) {
    const BATCH_SIZE = 100;
    let indexed = 0;
    let failures = 0;

    console.log(`\nIndexing in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
      const batch = toIndex.slice(i, i + BATCH_SIZE);
      try {
        const result = await idx.addDocuments(batch);
        indexed += batch.length;
        const pct = Math.min(100, Math.round(((i + batch.length) / toIndex.length) * 100));
        process.stdout.write(`\r  Progress: ${indexed}/${toIndex.length} (${pct}%)`);
      } catch (err) {
        failures += batch.length;
        console.error(`\n  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
      }
    }
    console.log('\n');

    // ── Report ──
    console.log('=== Indexing Report ===');
    console.log(`  Products found in DB:    ${products.length}`);
    console.log(`  Successfully indexed:    ${indexed}`);
    console.log(`  Skipped (already had):   ${skipped}`);
    console.log(`  Failures:                ${failures}`);

    if (failures > 0) {
      console.log('\nWARNING: Some products failed to index. Check errors above.');
    }
  } else {
    console.log('\nNo new products to index. All products are already indexed.');
    console.log(`=== Indexing Report ===`);
    console.log(`  Products found in DB:    ${products.length}`);
    console.log(`  Successfully indexed:    0`);
    console.log(`  Skipped (already had):   ${products.length}`);
    console.log(`  Failures:                0`);
  }

  // Final count
  try {
    const stats = await idx.getStats();
    console.log(`\nMeilisearch total documents: ${stats.numberOfDocuments}`);
  } catch { /* ignore */ }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
