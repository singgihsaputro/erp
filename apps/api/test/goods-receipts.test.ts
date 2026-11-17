import { beforeEach, describe, expect, it } from 'vitest';
import type { GrDetail, Page, GrSummary, PoDetail } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let p2: number;
let wh: number;
let po: number;

const stock = (p: number) => (db.prepare('SELECT COALESCE(SUM(qty_milli),0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(p, wh) as { q: number }).q;
const cost = (p: number) => (db.prepare('SELECT cost FROM products WHERE id = ?').get(p) as { cost: number }).cost;
const receive = (body: object, client: Client = app) => client.request('/api/goods-receipts', json('POST', { order_id: po, ...body }));
const order = async () => (await (await app.request(`/api/purchase-orders/${po}`)).json()) as PoDetail;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 0, 80000)").run().lastInsertRowid);
  const sup = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('PT Pemasok')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  const r = await app.request('/api/purchase-orders', json('POST', {
    supplier_id: sup, warehouse_id: wh, order_date: '2026-11-01',
    lines: [{ product_id: p1, qty_milli: 10_000, unit_cost: 12_000 }, { product_id: p2, qty_milli: 2_000, unit_cost: 65_000 }],
  }));
  po = ((await r.json()) as PoDetail).id;
  await app.request(`/api/purchase-orders/${po}/submit`, json('POST'));
  await app.request(`/api/purchase-orders/${po}/approve`, json('POST'));
});

describe('goods receipts API', () => {
  it('needs sign-in and a purchasing role', async () => {
    expect((await createApp(db).request('/api/goods-receipts')).status).toBe(401);
    db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run('kasir', 'Kasir', 'cashier', hashPassword('rahasia-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'rahasia-1234');
    expect((await cashier.request('/api/goods-receipts')).status).toBe(403);
    expect((await receive({ lines: [{ product_id: p1, qty_milli: 1000 }] }, cashier)).status).toBe(403);
  });

  it('receives part of an order into stock at the order price, then the rest', async () => {
    const r = await receive({ receipt_date: '2026-11-05', supplier_ref: 'SJ-1', lines: [{ product_id: p1, qty_milli: 4_000 }] });
    expect(r.status).toBe(201);
    const gr = (await r.json()) as GrDetail;
    expect(gr.number).toMatch(/^GR\/\d{4}\/\d{2}\/0001$/);
    expect(gr.value).toBe(48_000);
    expect(gr.warehouse_id).toBe(wh);
    expect(stock(p1)).toBe(4_000);
    expect(cost(p1)).toBe(12_000);
    let o = await order();
    expect(o.receive_status).toBe('partial');
    expect(o.lines.find((l) => l.product_id === p1)?.received_milli).toBe(4_000);

    await receive({ lines: [{ product_id: p1, qty_milli: 6_000 }, { product_id: p2, qty_milli: 2_000 }] });
    o = await order();
    expect(o.receive_status).toBe('complete');
    expect(stock(p2)).toBe(2_000);
    const list = (await (await app.request(`/api/goods-receipts?order_id=${po}`)).json()) as Page<GrSummary>;
    expect(list.total).toBe(2);
    expect((await app.request(`/api/goods-receipts/${gr.id}`)).status).toBe(200);
    expect((await app.request('/api/goods-receipts/9999')).status).toBe(404);
  });

  it('re-averages cost on top of existing stock', async () => {
    db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, 10000, 14000, 'opening')").run(p1, wh);
    db.prepare('UPDATE products SET cost = 14000 WHERE id = ?').run(p1);
    await receive({ lines: [{ product_id: p1, qty_milli: 10_000 }] });
    expect(cost(p1)).toBe(13_000);
  });

  it('refuses to receive more than is outstanding', async () => {
    await receive({ lines: [{ product_id: p1, qty_milli: 8_000 }] });
    const r = await receive({ lines: [{ product_id: p1, qty_milli: 2_001 }] });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/outstanding/);
    expect(stock(p1)).toBe(8_000);
    expect((await receive({ lines: [{ product_id: p1, qty_milli: 2_000 }] })).status).toBe(201);
  });

  it('validates input and the order state', async () => {
    expect((await receive({ lines: [] })).status).toBe(400);
    expect((await receive({ lines: [{ product_id: p1, qty_milli: 0 }] })).status).toBe(400);
    expect((await receive({ lines: [{ product_id: p1, qty_milli: 1500.5 }] })).status).toBe(400);
    expect((await receive({ receipt_date: '31-10-2026', lines: [{ product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await receive({ receipt_date: '2026-10-01', lines: [{ product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await receive({ lines: [{ product_id: p1, qty_milli: 1000 }, { product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await receive({ lines: [{ product_id: 9999, qty_milli: 1000 }] })).status).toBe(404);
    expect((await app.request('/api/goods-receipts', json('POST', { order_id: 9999, lines: [{ product_id: p1, qty_milli: 1000 }] }))).status).toBe(404);
    // a draft order cannot be received against
    const draft = (await (await app.request('/api/purchase-orders', json('POST', {
      supplier_id: 1, warehouse_id: wh, lines: [{ product_id: p1, qty_milli: 1000, unit_cost: 1 }],
    }))).json()) as PoDetail;
    const r = await app.request('/api/goods-receipts', json('POST', { order_id: draft.id, lines: [{ product_id: p1, qty_milli: 1000 }] }));
    expect(r.status).toBe(409);
  });

  it('stops an order being cancelled once goods have arrived', async () => {
    await receive({ lines: [{ product_id: p1, qty_milli: 1000 }] });
    const r = await app.request(`/api/purchase-orders/${po}/cancel`, json('POST'));
    expect(r.status).toBe(409);
  });
});
