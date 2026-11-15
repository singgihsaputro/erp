import { beforeEach, describe, expect, it } from 'vitest';
import type { BatchList, BatchPick, BatchRow } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { jakartaToday } from '../src/batches.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let susu: number;
let toko: number;

const inDays = (n: number) => new Date(Date.parse(`${jakartaToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const receive = (batch_no: string, expiry_date: string | null, qty_milli: number, extra: object = {}) =>
  app.request('/api/stock/batches', json('POST', { product_id: susu, warehouse_id: toko, batch_no, expiry_date, qty_milli, unit_cost: 16000, ...extra }));
const list = async (query = '') => (await (await app.request(`/api/stock/batches${query}`)).json()) as BatchList;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  susu = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('S1', 'Susu UHT 1 L', 'pcs', 0, 19500)").run().lastInsertRowid);
  toko = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
});

describe('batches API', () => {
  it('needs sign-in, and receiving needs a stock role', async () => {
    expect((await createApp(db).request('/api/stock/batches')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock/batches')).status).toBe(200);
    expect((await cashier.request('/api/stock/batches', json('POST', {}))).status).toBe(403);
  });

  it('receives a batch into the ledger and adds to it on a second receipt', async () => {
    const r = await receive('B1', inDays(40), 10_000);
    expect(r.status).toBe(201);
    expect((await r.json()) as BatchRow).toMatchObject({ batch_no: 'B1', qty_milli: 10_000, status: 'ok', days_left: 40, warehouse_name: 'Toko Utama' });
    await receive('B1', inDays(40), 5_000);
    expect((await list()).items[0].qty_milli).toBe(15_000);
    const stock = db.prepare('SELECT SUM(qty_milli) AS q FROM stock_moves WHERE product_id = ?').get(susu) as { q: number };
    expect(stock.q).toBe(15_000);
    expect(db.prepare('SELECT cost FROM products WHERE id = ?').get(susu)).toEqual({ cost: 16000 });
  });

  it('validates input and refuses a different expiry for an existing batch', async () => {
    expect((await receive('', null, 1000)).status).toBe(400);
    expect((await receive('B1', '31-12-2026', 1000)).status).toBe(400);
    expect((await receive('B1', '2026-02-31', 1000)).status).toBe(400);
    expect((await receive('B1', null, 0)).status).toBe(400);
    expect((await receive('B1', null, 1000, { product_id: 9999 })).status).toBe(404);
    expect((await receive('B1', null, 1000, { warehouse_id: 9999 })).status).toBe(404);
    await receive('B1', inDays(10), 1000);
    expect((await receive('B1', inDays(11), 1000)).status).toBe(409);
  });

  it('lists soonest expiry first and classifies expired, soon and ok', async () => {
    await receive('LATE', inDays(100), 1000);
    await receive('NONE', null, 1000);
    await receive('SOON', inDays(10), 1000);
    await receive('OLD', inDays(-3), 1000);
    const all = await list();
    expect(all.items.map((i) => i.batch_no)).toEqual(['OLD', 'SOON', 'LATE', 'NONE']);
    expect(all.items.map((i) => i.status)).toEqual(['expired', 'soon', 'ok', 'none']);
    expect(all).toMatchObject({ expired_count: 1, soon_count: 1, total: 4 });
    expect((await list('?filter=soon')).items.map((i) => i.batch_no)).toEqual(['SOON']);
    expect((await list('?filter=soon&days=200')).items.map((i) => i.batch_no)).toEqual(['SOON', 'LATE']);
    expect((await list('?filter=expired')).items.map((i) => i.batch_no)).toEqual(['OLD']);
    expect((await list('?q=late')).total).toBe(1);
    expect((await app.request('/api/stock/batches?filter=bogus')).status).toBe(400);
  });

  it('suggests first-expired-first-out and skips expired batches', async () => {
    await receive('LATE', inDays(100), 8_000);
    await receive('SOON', inDays(10), 5_000);
    await receive('OLD', inDays(-3), 4_000);
    const pick = async (qty: number) => (await (await app.request(`/api/stock/batches/pick?product_id=${susu}&warehouse_id=${toko}&qty_milli=${qty}`)).json()) as BatchPick;
    const p = await pick(7_000);
    expect(p.allocations.map((a) => [a.batch_no, a.qty_milli])).toEqual([['SOON', 5_000], ['LATE', 2_000]]);
    expect(p).toMatchObject({ shortfall_milli: 0, expired_milli: 4_000 });
    expect(await pick(20_000)).toMatchObject({ shortfall_milli: 7_000 });
    expect((await app.request('/api/stock/batches/pick?product_id=1')).status).toBe(400);
  });

  it('hides a batch once its stock is gone', async () => {
    await receive('B1', inDays(5), 3_000);
    const batch = db.prepare('SELECT id FROM stock_batches').get() as { id: number };
    db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type, batch_id) VALUES (?, ?, -3000, 16000, 'stock_adjustment', ?)").run(susu, toko, batch.id);
    expect((await list()).total).toBe(0);
  });
});
