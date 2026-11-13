import { beforeEach, describe, expect, it } from 'vitest';
import type { ReorderList, ReorderRow } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let gula: number;
let beras: number;
let toko: number;
let gudang: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  gula = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  beras = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras Pulen', 'kg', 0, 14000)").run().lastInsertRowid);
  toko = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  gudang = Number(db.prepare("INSERT INTO warehouses (code, name) VALUES ('GDG', 'Gudang')").run().lastInsertRowid);
  await app.request('/api/stock/opening', json('POST', { warehouse_id: toko, lines: [{ product_id: gula, qty_milli: 10_000, unit_cost: 12000 }, { product_id: beras, qty_milli: 50_000, unit_cost: 11000 }] }));
});

const put = (product_id: number, warehouse_id: number, min_qty_milli: number) =>
  app.request('/api/stock/reorder-points', json('PUT', { product_id, warehouse_id, min_qty_milli }));
const list = async (query = '') => (await (await app.request(`/api/stock/reorder-points${query}`)).json()) as ReorderList;

describe('reorder points API', () => {
  it('needs sign-in, and changes need a stock role', async () => {
    expect((await createApp(db).request('/api/stock/reorder-points')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock/reorder-points')).status).toBe(200);
    expect((await cashier.request('/api/stock/reorder-points', json('PUT', {}))).status).toBe(403);
    expect((await cashier.request('/api/stock/reorder-points/1', json('DELETE'))).status).toBe(403);
  });

  it('sets a minimum, shows on-hand and shortfall, and replaces it on a second put', async () => {
    const r = await put(gula, toko, 15_000);
    expect(r.status).toBe(201);
    expect((await r.json()) as ReorderRow).toMatchObject({ min_qty_milli: 15_000, on_hand_milli: 10_000, shortfall_milli: 5_000, below: true, warehouse_name: 'Toko Utama' });
    const again = await put(gula, toko, 8_000);
    expect(again.status).toBe(200);
    expect(((await again.json()) as ReorderRow)).toMatchObject({ min_qty_milli: 8_000, shortfall_milli: 0, below: false });
    expect((await list()).total).toBe(1);
  });

  it('lists only what is below the minimum, and counts it', async () => {
    await put(gula, toko, 15_000);
    await put(beras, toko, 20_000);
    await put(beras, gudang, 5_000); // nothing on hand there at all
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.below_count).toBe(2);
    const below = await list('?below=1');
    expect(below.items.map((i) => `${i.name}@${i.warehouse_name}`)).toEqual(['Beras Pulen@Gudang', 'Gula Pasir 1 kg@Toko Utama']);
    expect(below.items[0]).toMatchObject({ on_hand_milli: 0, shortfall_milli: 5_000 });
    expect((await list(`?warehouse_id=${gudang}`)).total).toBe(1);
    expect((await list('?q=gula')).total).toBe(1);
  });

  it('follows the ledger: a sale-sized adjustment pushes a product below its minimum', async () => {
    await put(beras, toko, 40_000);
    expect((await list('?below=1')).total).toBe(0);
    await app.request('/api/stock/adjustments', json('POST', { warehouse_id: toko, reason: 'lost', lines: [{ product_id: beras, qty_milli: -15_000 }] }));
    const below = await list('?below=1');
    expect(below.items[0]).toMatchObject({ on_hand_milli: 35_000, shortfall_milli: 5_000 });
  });

  it('rejects bad input and unknown or archived records', async () => {
    expect((await put(gula, toko, 0)).status).toBe(400);
    expect((await put(gula, toko, 1.5)).status).toBe(400);
    expect((await app.request('/api/stock/reorder-points', json('PUT', { product_id: gula }))).status).toBe(400);
    expect((await put(9999, toko, 1000)).status).toBe(404);
    expect((await put(gula, 9999, 1000)).status).toBe(404);
    db.prepare("UPDATE products SET archived_at = '2026-01-01' WHERE id = ?").run(gula);
    expect((await put(gula, toko, 1000)).status).toBe(409);
    expect((await app.request('/api/stock/reorder-points?below=maybe')).status).toBe(400);
  });

  it('removes a reorder point', async () => {
    const id = ((await (await put(gula, toko, 15_000)).json()) as ReorderRow).id;
    expect((await app.request(`/api/stock/reorder-points/${id}`, json('DELETE'))).status).toBe(200);
    expect((await list()).total).toBe(0);
    expect((await app.request(`/api/stock/reorder-points/${id}`, json('DELETE'))).status).toBe(404);
  });
});
