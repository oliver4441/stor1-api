// CJdropshipping REST API client
// Docs: https://developers.cjdropshipping.com
// Needs CJ_API_TOKEN env var to function

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api';

async function api(path, opts = {}) {
  const token = process.env.CJ_API_TOKEN;
  if (!token) throw Object.assign(new Error('CJ_API_TOKEN not configured'), { code: 'CJ_NOT_CONFIGURED' });
  const url = `${CJ_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token, ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`CJ API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`CJ API error ${body.code}: ${body.message || body.msg}`);
  return body.data;
}

// Search CJ product catalog
export async function searchProducts({ keyword, page = 1, pageSize = 20, categoryId } = {}) {
  return api('/product/list', {
    method: 'POST',
    body: JSON.stringify({ keyword, page, pageSize, categoryId }),
  });
}

// Get product detail (variants, images, shipping info)
export async function getProductDetail(pid) {
  return api('/product/detail', {
    method: 'POST',
    body: JSON.stringify({ pid }),
  });
}

// Get shipping methods for a product to a country
export async function getShippingMethods(pid, country = 'KE', quantity = 1) {
  return api('/product/shipping', {
    method: 'POST',
    body: JSON.stringify({ pid, country, quantity }),
  });
}

// Submit order to CJ for fulfillment
export async function createOrder(orderData) {
  return api('/order/create', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });
}

// Get order tracking info
export async function getOrderStatus(cjOrderNo) {
  return api('/order/getTrackNumber', {
    method: 'POST',
    body: JSON.stringify({ orderNumber: cjOrderNo }),
  });
}
