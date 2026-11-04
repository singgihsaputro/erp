import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';

let app: ReturnType<typeof createApp>;
let testDb: ReturnType<typeof openDb>;

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const valid = { sku: 'TST-1', barcode: '123', name: 'Produk Uji', base_unit: 'pcs', cost: 1000, price: 1500 };
const list = async (qs = '') => (await app.request(`/api/products${qs}`)).json();

beforeEach(() => {
  testDb = openDb(':memory:');
  app = createApp(testDb);
});

describe('products API', () => {
  it('creates, reads, updates a product', async () => {
    const created = await app.request('/api/products', json('POST', valid));
    expect(created.status).toBe(201);
    const p = await created.json();
    expect(p).toMatchObject({ sku: 'TST-1', price: 1500, archived_at: null });
    expect((await app.request(`/api/products/${p.id}`)).status).toBe(200);
    const upd = await app.request(`/api/products/${p.id}`, json('PUT', { ...valid, name: 'Baru', price: 2000 }));
    expect(upd.status).toBe(200);
    expect(await upd.json()).toMatchObject({ name: 'Baru', price: 2000 });
  });

  it('treats an empty barcode as none, allowing several', async () => {
    expect((await app.request('/api/products', json('POST', { ...valid, barcode: '' }))).status).toBe(201);
    expect((await app.request('/api/products', json('POST', { ...valid, sku: 'TST-2', barcode: '' }))).status).toBe(201);
  });

  it('rejects invalid input with 400', async () => {
    for (const bad of [
      { ...valid, sku: '' },
      { ...valid, name: '   ' },
      { ...valid, price: 10.5 },
      { ...valid, cost: -1 },
      { ...valid, price: '100' },
    ]) {
      expect((await app.request('/api/products', json('POST', bad))).status).toBe(400);
    }
    expect((await app.request('/api/products', { method: 'POST', body: 'x' })).status).toBe(400);
    expect((await app.request('/api/products/abc')).status).toBe(400);
    expect((await app.request('/api/products?page=0')).status).toBe(400);
  });

  it('returns 404 for a missing product', async () => {
    expect((await app.request('/api/products/999')).status).toBe(404);
    expect((await app.request('/api/products/999', json('PUT', valid))).status).toBe(404);
    expect((await app.request('/api/products/999/archive', json('POST'))).status).toBe(404);
  });

  it('returns 409 on a duplicate SKU or barcode, also on update', async () => {
    await app.request('/api/products', json('POST', valid));
    expect((await app.request('/api/products', json('POST', valid))).status).toBe(409);
    expect((await app.request('/api/products', json('POST', { ...valid, sku: 'TST-2' }))).status).toBe(409);
    const other = await (await app.request('/api/products', json('POST', { ...valid, sku: 'TST-3', barcode: '999' }))).json();
    expect((await app.request(`/api/products/${other.id}`, json('PUT', { ...valid, sku: 'TST-3' }))).status).toBe(409);
    expect((await app.request(`/api/products/${other.id}`, json('PUT', { ...valid, sku: 'TST-3', barcode: '999' }))).status).toBe(200);
  });

  it('archives and restores; archived products leave the default list; repeats are 409', async () => {
    const p = await (await app.request('/api/products', json('POST', valid))).json();
    const arch = await app.request(`/api/products/${p.id}/archive`, json('POST'));
    expect(arch.status).toBe(200);
    expect((await arch.json()).archived_at).not.toBeNull();
    expect((await app.request(`/api/products/${p.id}/archive`, json('POST'))).status).toBe(409);
    expect((await list()).total).toBe(0);
    expect((await list('?status=archived')).total).toBe(1);
    expect((await list('?status=all')).total).toBe(1);
    expect((await app.request(`/api/products/${p.id}/restore`, json('POST'))).status).toBe(200);
    expect((await app.request(`/api/products/${p.id}/restore`, json('POST'))).status).toBe(409);
    expect((await list()).total).toBe(1);
  });

  it('searches by name, SKU and barcode, escaping wildcards, and paginates', async () => {
    seedDemo(testDb);
    expect((await list('?q=beras')).items.map((x: { sku: string }) => x.sku)).toContain('BRS-PRM-5');
    expect((await list('?q=MYK-GRG')).total).toBe(1);
    expect((await list('?q=8990000000042')).items[0].sku).toBe('GLA-PSR-1');
    expect((await list('?q=%25')).total).toBe(0);
    expect((await list('?q=zzzz')).total).toBe(0);
    // the seeded discontinued item only shows under the archived filter
    expect((await list('?status=archived')).items[0].sku).toBe('KRP-UDG-250');
    const all = await list('?page_size=10');
    expect(all.items).toHaveLength(10);
    expect(all.total).toBeGreaterThan(10);
    const p2 = await list('?page_size=10&page=2');
    expect(p2.items[0].id).not.toBe(all.items[0].id);
    // seeding twice does not duplicate
    const before = (await list('?status=all')).total;
    seedDemo(testDb);
    expect((await list('?status=all')).total).toBe(before);
  });
});
