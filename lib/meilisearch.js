// Meilisearch search service
// Handles all Meilisearch communication for product search
// Gracefully degrades if Meilisearch is unavailable

import { Meilisearch } from 'meilisearch';

const MEILI_HOST = process.env.MEILI_HOST || '';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || '';
const MEILI_INDEX = process.env.MEILI_INDEX || 'products';

const CATEGORY_ID_TO_NAME = {
  1: 'Electronics', 2: 'Furniture', 3: 'Clothing', 4: 'Books',
  5: 'Vehicles', 6: 'Home & Garden', 7: 'Sports', 8: 'Toys & Games',
  9: 'Health & Beauty', 10: 'Services', 11: 'Others',
  12: 'Food', 13: 'Drinks', 14: 'Snacks', 15: 'Bakery',
};

let client = null;
let index = null;
let enabled = false;

function getClient() {
  if (!MEILI_HOST || !MEILI_MASTER_KEY) return null;
  if (!client) {
    try {
      client = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY });
      index = client.index(MEILI_INDEX);
      enabled = true;
    } catch (err) {
      console.error('[MeiliSearch] init failed:', err.message);
    }
  }
  return client;
}

async function ensureIndex() {
  if (!getClient()) return false;
  try {
    const indexes = await client.getIndexes();
    if (!indexes.results?.some(i => i.uid === MEILI_INDEX)) {
      await client.createIndex(MEILI_INDEX, { primaryKey: 'id' });
    }
    await index.updateSearchableAttributes(['name', 'description', 'category', 'brand']);
    await index.updateFilterableAttributes(['category', 'brand', 'price', 'rating', 'createdAt']);
    await index.updateSortableAttributes(['price', 'createdAt', 'rating']);
    return true;
  } catch (err) {
    console.error('[MeiliSearch] ensureIndex error:', err.message);
    return false;
  }
}

function resolveCategory(product) {
  if (product.category) return product.category;
  const catId = parseInt(product.category_id);
  if (!isNaN(catId) && CATEGORY_ID_TO_NAME[catId]) return CATEGORY_ID_TO_NAME[catId];
  return 'Others';
}

function buildDocument(product) {
  if (!product) return null;
  return {
    id: String(product.id),
    name: product.title || product.name || '',
    description: product.description || '',
    category: resolveCategory(product),
    brand: product.brand || '',
    price: parseFloat(product.price) || 0,
    stock: parseInt(product.stock_quantity ?? product.quantity ?? 0) || 0,
    images: Array.isArray(product.images) ? product.images : [],
    rating: parseFloat(product.avg_rating ?? product.rating ?? 0) || 0,
    createdAt: product.created_at || new Date().toISOString(),
  };
}

export async function indexProduct(product) {
  if (!getClient()) return false;
  try {
    await ensureIndex();
    await index.addDocuments([buildDocument(product)]);
    return true;
  } catch (err) {
    console.error('[MeiliSearch] indexProduct error:', err.message);
    return false;
  }
}

export async function removeProduct(id) {
  if (!getClient()) return false;
  try {
    await index.deleteDocument(String(id));
    return true;
  } catch (err) {
    console.error('[MeiliSearch] removeProduct error:', err.message);
    return false;
  }
}

export async function searchProducts({
  q = '', category = '', brand = '', min_price, max_price,
  sort = '', page = 1, limit = 20,
} = {}) {
  if (!getClient()) return null;
  try {
    await ensureIndex();
    const filters = [];
    if (category) filters.push(`category = "${category}"`);
    if (brand) filters.push(`brand = "${brand}"`);
    const minP = parseFloat(min_price);
    const maxP = parseFloat(max_price);
    if (!isNaN(minP)) filters.push(`price >= ${minP}`);
    if (!isNaN(maxP)) filters.push(`price <= ${maxP}`);

    const sortMap = { price_asc: ['price:asc'], price_desc: ['price:desc'], rating_desc: ['rating:desc'] };
    const sortOption = sortMap[sort] || ['createdAt:desc'];

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const result = await index.search(q || '', {
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      filter: filters.length > 0 ? filters.join(' AND ') : undefined,
      sort: sortOption,
    });

    return {
      listings: result.hits || [],
      total: result.estimatedTotalHits || result.nbHits || 0,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil((result.estimatedTotalHits || result.nbHits || 0) / limitNum),
    };
  } catch (err) {
    console.error('[MeiliSearch] searchProducts error:', err.message);
    return null;
  }
}

export function isAvailable() {
  getClient();
  return enabled && client !== null;
}

export async function getDocumentCount() {
  if (!getClient()) return 0;
  try {
    const stats = await index.getStats();
    return stats.numberOfDocuments || 0;
  } catch { return 0; }
}
