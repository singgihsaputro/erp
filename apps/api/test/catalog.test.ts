import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';
import { json, signIn, type Client } from './helpers.js';

let app: Client;
let db: ReturnType<typeof openDb>;
const product = { sku: 'TST-1', barcode: '', name: 'Produk Uji', base_unit: 'pcs', cost: 1000, price: 1500 };

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
});

const post = async (path: string, body: unknown) => app.request(path, json('POST', body));

describe('categories API', () => {
  it('requires sign-in', async () => {
    const anon = createApp(db);
    expect((await anon.request('/api/categories')).status).toBe(401);
    expect((await anon.request('/api/units')).status).toBe(401);
  });

  it('creates, lists, renames and deletes a category', async () => {
    const res = await post('/api/categories', { name: 'Minuman' });
    expect(res.status).toBe(201);
    const cat = await res.json();
    expect(cat).toMatchObject({ name: 'Minuman', product_count: 0 });
    const renamed = await app.request(`/api/categories/${cat.id}`, json('PUT', { name: 'Minuman Dingin' }));
    expect((await renamed.json()).name).toBe('Minuman Dingin');
    expect((await (await app.request('/api/categories')).json()).length).toBe(1);
    expect((await app.request(`/api/categories/${cat.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/categories/${cat.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('validates input and rejects duplicates case-insensitively', async () => {
    expect((await post('/api/categories', { name: '  ' })).status).toBe(400);
    expect((await post('/api/categories', {})).status).toBe(400);
    await post('/api/categories', { name: 'Minuman' });
    expect((await post('/api/categories', { name: 'minuman' })).status).toBe(409);
    expect((await app.request('/api/categories/999', json('PUT', { name: 'X' }))).status).toBe(404);
  });

  it('refuses to delete a category that still has products', async () => {
    const cat = await (await post('/api/categories', { name: 'Minuman' })).json();
    const p = await (await post('/api/products', { ...product, category_id: cat.id })).json();
    expect(p).toMatchObject({ category_id: cat.id, category_name: 'Minuman' });
    expect((await app.request(`/api/categories/${cat.id}`, { method: 'DELETE' })).status).toBe(409);
    const list = await (await app.request('/api/categories')).json();
    expect(list[0].product_count).toBe(1);
  });

  it('filters products by category and rejects an unknown category', async () => {
    const cat = await (await post('/api/categories', { name: 'Minuman' })).json();
    await post('/api/products', { ...product, category_id: cat.id });
    await post('/api/products', { ...product, sku: 'TST-2' });
    const filtered = await (await app.request(`/api/products?category_id=${cat.id}`)).json();
    expect(filtered.total).toBe(1);
    expect((await post('/api/products', { ...product, sku: 'TST-3', category_id: 999 })).status).toBe(400);
  });
});

describe('units API', () => {
  it('ships with the common units and manages custom ones', async () => {
    const units = await (await app.request('/api/units')).json();
    expect(units.map((u: { code: string }) => u.code)).toEqual(expect.arrayContaining(['pcs', 'kg', 'dus', 'karung']));
    const res = await post('/api/units', { code: 'ikat', name: 'Ikat' });
    expect(res.status).toBe(201);
    const u = await res.json();
    const upd = await app.request(`/api/units/${u.id}`, json('PUT', { name: 'Ikat sayur' }));
    expect(await upd.json()).toMatchObject({ code: 'ikat', name: 'Ikat sayur' });
    expect((await app.request(`/api/units/${u.id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('validates codes and rejects duplicates', async () => {
    expect((await post('/api/units', { code: '', name: 'X' })).status).toBe(400);
    expect((await post('/api/units', { code: 'a b', name: 'X' })).status).toBe(400);
    expect((await post('/api/units', { code: 'KG', name: 'Kilo' })).status).toBe(409);
  });

  it('rejects a product whose base unit does not exist', async () => {
    expect((await post('/api/products', { ...product, base_unit: 'zzz' })).status).toBe(400);
  });

  it('refuses to delete a unit that products use', async () => {
    await post('/api/products', product);
    const pcs = (await (await app.request('/api/units')).json()).find((u: { code: string }) => u.code === 'pcs');
    expect((await app.request(`/api/units/${pcs.id}`, { method: 'DELETE' })).status).toBe(409);
  });
});

describe('unit conversions', () => {
  const setup = async () => (await (await post('/api/products', product)).json()).id as number;
  const put = (id: number, units: unknown) => app.request(`/api/products/${id}/units`, json('PUT', { units }));

  it('stores 1 box = 12 pcs and replaces the set on each save', async () => {
    const id = await setup();
    const res = await put(id, [{ unit: 'box', factor_milli: 12000 }, { unit: 'dus', factor_milli: 40000 }]);
    expect(res.status).toBe(200);
    expect((await res.json()).units).toEqual([
      { unit: 'box', factor_milli: 12000 },
      { unit: 'dus', factor_milli: 40000 },
    ]);
    await put(id, [{ unit: 'box', factor_milli: 10000 }]);
    const got = await (await app.request(`/api/products/${id}/units`)).json();
    expect(got).toEqual({ base_unit: 'pcs', units: [{ unit: 'box', factor_milli: 10000 }] });
  });

  it('rejects bad conversions', async () => {
    const id = await setup();
    expect((await put(id, [{ unit: 'box', factor_milli: 0 }])).status).toBe(400);
    expect((await put(id, [{ unit: 'box', factor_milli: 1.5 }])).status).toBe(400);
    expect((await put(id, [{ unit: 'pcs', factor_milli: 1000 }])).status).toBe(400); // the base unit itself
    expect((await put(id, [{ unit: 'nope', factor_milli: 1000 }])).status).toBe(400);
    expect((await put(id, [{ unit: 'box', factor_milli: 1000 }, { unit: 'BOX', factor_milli: 2000 }])).status).toBe(400);
    expect((await put(999, [])).status).toBe(404);
  });

  it('keeps the base unit fixed while conversions exist, and blocks deleting a unit they use', async () => {
    const id = await setup();
    await put(id, [{ unit: 'box', factor_milli: 12000 }]);
    const change = await app.request(`/api/products/${id}`, json('PUT', { ...product, base_unit: 'kg' }));
    expect(change.status).toBe(409);
    const box = (await (await app.request('/api/units')).json()).find((u: { code: string }) => u.code === 'box');
    expect((await app.request(`/api/units/${box.id}`, { method: 'DELETE' })).status).toBe(409);
    await put(id, []);
    expect((await app.request(`/api/products/${id}`, json('PUT', { ...product, base_unit: 'kg' }))).status).toBe(200);
  });

  it('seeds categories and conversions', async () => {
    seedDemo(db);
    const cats = await (await app.request('/api/categories')).json();
    expect(cats.length).toBeGreaterThanOrEqual(5);
    const mie = (await (await app.request('/api/products?q=MIE-GRG-85')).json()).items[0];
    const got = await (await app.request(`/api/products/${mie.id}/units`)).json();
    expect(got.units).toContainEqual({ unit: 'dus', factor_milli: 40000 });
  });
});
