import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';
import { json, signIn, type Client } from './helpers.js';

let app: Client;
let db: ReturnType<typeof openDb>;
const gudang = { code: 'GDG-1', name: 'Gudang Satu', address: 'Jl. Uji 1' };

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
});

const post = (path: string, body?: unknown) => app.request(path, json('POST', body));
const stockIn = (wh: number, qty: number, cost = 1000) => {
  db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Produk', 'pcs', ?, 2000) ON CONFLICT DO NOTHING").run(cost);
  const p = db.prepare("SELECT id FROM products WHERE sku = 'P1'").get() as { id: number };
  db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, ?, ?, 'test')").run(p.id, wh, qty, cost);
};

describe('warehouses API', () => {
  it('requires sign-in, and only managers may change warehouses', async () => {
    expect((await createApp(db).request('/api/warehouses')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('gudang', 'Petugas Gudang', 'warehouse', ?)").run(hashPassword('gudang-123'));
    const staff = await signIn(createApp(db), 'gudang', 'gudang-123');
    expect((await staff.request('/api/warehouses')).status).toBe(200);
    expect((await staff.request('/api/warehouses', json('POST', gudang))).status).toBe(403);
  });

  it('starts with one default warehouse', async () => {
    const list = await (await app.request('/api/warehouses')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: 'TOKO', is_default: true, product_count: 0, stock_milli: 0 });
  });

  it('creates, edits and fetches a warehouse', async () => {
    const res = await post('/api/warehouses', gudang);
    expect(res.status).toBe(201);
    const w = await res.json();
    expect(w).toMatchObject({ ...gudang, is_default: false, archived_at: null });
    const put = await app.request(`/api/warehouses/${w.id}`, json('PUT', { ...gudang, name: 'Gudang Utara' }));
    expect((await put.json()).name).toBe('Gudang Utara');
    expect((await (await app.request(`/api/warehouses/${w.id}`)).json()).name).toBe('Gudang Utara');
    expect((await app.request('/api/warehouses/999')).status).toBe(404);
  });

  it('validates input and rejects duplicate codes', async () => {
    expect((await post('/api/warehouses', { ...gudang, code: '' })).status).toBe(400);
    expect((await post('/api/warehouses', { ...gudang, code: 'a b' })).status).toBe(400);
    expect((await post('/api/warehouses', { ...gudang, name: ' ' })).status).toBe(400);
    expect((await post('/api/warehouses', { ...gudang, code: 'toko' })).status).toBe(409);
    expect((await app.request('/api/warehouses/abc')).status).toBe(400);
  });

  it('reports on-hand per warehouse from the ledger', async () => {
    const w = await (await post('/api/warehouses', gudang)).json();
    stockIn(w.id, 5000, 2000);
    stockIn(w.id, -2000, 2000);
    const got = await (await app.request(`/api/warehouses/${w.id}`)).json();
    expect(got).toMatchObject({ product_count: 1, stock_milli: 3000, stock_value: 6000, move_count: 2 });
    const stock = await (await app.request(`/api/warehouses/${w.id}/stock`)).json();
    expect(stock).toMatchObject([{ sku: 'P1', qty_milli: 3000 }]);
    // stock is per warehouse: the default one is untouched
    const other = await (await app.request('/api/warehouses')).json();
    expect(other.find((x: { code: string }) => x.code === 'TOKO').stock_milli).toBe(0);
  });

  it('keeps one default and will not archive it', async () => {
    const w = await (await post('/api/warehouses', gudang)).json();
    expect((await post(`/api/warehouses/1/archive`)).status).toBe(409);
    const made = await (await post(`/api/warehouses/${w.id}/make-default`)).json();
    expect(made.is_default).toBe(true);
    const list = await (await app.request('/api/warehouses')).json();
    expect(list.filter((x: { is_default: boolean }) => x.is_default)).toHaveLength(1);
    expect(list[0].id).toBe(w.id);
    expect((await post('/api/warehouses/1/archive')).status).toBe(200);
  });

  it('refuses to archive a warehouse that still holds stock, and can restore one', async () => {
    const w = await (await post('/api/warehouses', gudang)).json();
    stockIn(w.id, 1000);
    expect((await post(`/api/warehouses/${w.id}/archive`)).status).toBe(409);
    stockIn(w.id, -1000);
    expect((await post(`/api/warehouses/${w.id}/archive`)).status).toBe(200);
    expect((await post(`/api/warehouses/${w.id}/archive`)).status).toBe(409);
    expect((await post(`/api/warehouses/${w.id}/make-default`)).status).toBe(409);
    expect(await (await app.request('/api/warehouses')).json()).toHaveLength(1);
    expect(await (await app.request('/api/warehouses?archived=1')).json()).toHaveLength(1);
    expect((await post(`/api/warehouses/${w.id}/restore`)).status).toBe(200);
    expect((await post(`/api/warehouses/${w.id}/restore`)).status).toBe(409);
  });

  it('locks the code once the warehouse has movements', async () => {
    const w = await (await post('/api/warehouses', gudang)).json();
    stockIn(w.id, 1000);
    const res = await app.request(`/api/warehouses/${w.id}`, json('PUT', { ...gudang, code: 'BARU' }));
    expect(res.status).toBe(409);
    expect((await app.request(`/api/warehouses/${w.id}`, json('PUT', { ...gudang, name: 'Baru' }))).status).toBe(200);
  });

  it('seeds three warehouses with opening stock, idempotently', async () => {
    seedDemo(db);
    seedDemo(db);
    const list = await (await app.request('/api/warehouses')).json();
    expect(list.map((x: { code: string }) => x.code)).toEqual(['TOKO', 'GDG-BEL', 'GDG-CKR']);
    expect(list.every((x: { product_count: number }) => x.product_count > 0)).toBe(true);
  });
});
