// Meilisearch search service
// Handles all Meilisearch communication for product search
// Gracefully degrades if Meilisearch is unavailable

import { Meilisearch } from 'meilisearch';
import { createClient } from '@supabase/supabase-js';

const MEILI_HOST = process.env.MEILI_HOST || '';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || '';
const MEILI_INDEX = process.env.MEILI_INDEX || 'products';

let client = null;
let index = null;
let enabled = false;

// Lazy-init Meilisearch client
function getClient() {
  if (!MEILI_HOST || !MEILI_MASTER_KEY) {
    return null;
  }
  if (!client) {
    try {
      client = new Meilisearch({
        host: MEILI_HOST,
        apiKey: MEILI_MASTER_KEY,
      });
      index = client.index(MEILI_INDEX);
      enabled = true;
    } catch (err) {
      console.error('[MeiliSearch] Failed to initialize client:', err.message);
      client = null;
      index = null;
      enabled = false;
    }
  }
  return client;
}

// Ensure index exists with proper settings
async function ensureIndex() {
  if (!getClient()) return false;
  try {
    // Create index if it doesn't exist
    const indexes = await client.getIndexes();
    const exists = indexes.results?.some(i => i.uid === MEILI_INDEX);
    if (!exists) {
      await client.createIndex(MEILI_INDEX, { primaryKey: 'id' });
    }
    // Configure searchable attributes
    await index.updateSearchableAttributes([
      'name',
      'description',
      'category',
      'brand',
    ]);
    // Configure filterable attributes
    await index.updateFilterableAttributes([
      'category',
      'brand',
      'price',
      'rating',
      'createdAt',
    ]);
    // Configure sortable attributes
    await index.updateSortableAttributes([
      'price',
      'createdAt',
      'rating',
    ]);
    return true;
  } catch (err) {
    console.error('[MeiliSearch] ensureIndex error:', err.message);
    return false;
  }
}

// Build a document from a product row (listings table)
function buildDocument(product) {
  if (!product) return null;
  return {
    id: String(product.id),
    name: product.title || product.name || '',
    description: product.description || '',
    category: product.category || '',
    brand: product.brand || '',
    price: parseFloat(product.price) || 0,
    stock: parseInt(product.stock_quantity ?? product.quantity ?? 0) || 0,
    images: Array.isArray(product.images) ? product.images : [],
    rating: parseFloat(product.avg_rating ?? product.rating ?? 0) || 0,
    createdAt: product.created_at || new Date().toISOString(),
  };
}

// Map a category_id to category name using CATEGORY_TO_ID reverse lookup
function mapCategory(product, idToCategory) {
  if (product.category) return product.category;
  if (product.category_id != null && idToCategory) {
    return idToCategory[product.category_id] || 'Others';
  }
  return 'Others';
}

// Index a product (create or update)
export async function indexProduct(product, idToCategory = {}) {
  if (!getClient()) return false;
  try {
    await ensureIndex();
    const doc = buildDocument({
      ...product,
      category: mapCategory(product, idToCategory),
    });
    await index.addDocuments([doc]);
    return true;
  } catch (err) {
    console.error('[MeiliSearch] indexProduct error:', err.message);
    return false;
  }
}

// Remove a product from the index
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

// Search products via Meilisearch
export async function searchProducts({
  q = '',
  category = '',
  brand = '',
  min_price,
  max_price,
  sort = '',
  page = 1,
  limit = 20,
} = {}) {
  if (!getClient()) return null;

  try {
    await ensureIndex();

    // Build filter string
    const filters = [];
    if (category) {
      filters.push(`category = "${category}"`);
    }
    if (brand) {
      filters.push(`brand = "${brand}"`);
    }
    if (min_price !== undefined && min_price !== '') {
      filters.push(`price >= ${parseFloat(min_price)}`);
    }
    if (max_price !== undefined && max_price !== '') {
      filters.push(`price <= ${parseFloat(max_price)}`);
    }

    // Build sort string
    let sortOption = [];
    switch (sort) {
      case 'price_asc':
        sortOption = ['price:asc'];
        break;
      case 'price_desc':
        sortOption = ['price:desc'];
        break;
      case 'rating_desc':
        sortOption = ['rating:desc'];
        break;
      case 'newest':
      default:
        sortOption = ['createdAt:desc'];
        break;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const result = await index.search(q || '', {
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      filter: filters.length > 0 ? filters.join(' AND ') : undefined,
      sort: sortOption.length > 0 ? sortOption : undefined,
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

// Check if Meilisearch is available
export function isAvailable() {
  getClient();
  return enabled && client !== null;
}

// Get total indexed document count
export async function getDocumentCount() {
  if (!getClient()) return 0;
  try {
    const stats = await index.getStats();
    return stats.numberOfDocuments || 0;
  } catch (err) {
    console.error('[MeiliSearch] getDocumentCount error:', err.message);
    return 0;
  }
}
