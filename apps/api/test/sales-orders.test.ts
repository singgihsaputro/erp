import { beforeEach, describe, expect, it } from 'vitest';
import type { Availability, Page, QuotationDetail, SalesOrderDetail, SalesOrderSummary } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let p2: number;
let cust: number;
let wh: number;
let wh2: number;

const stock = (product: number, warehouse: number, qty: number) =>
  db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, ?, 10000, 'opening')").run(product, warehouse, qty);

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 10000, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 60000, 80000)").run().lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (name) VALUES ('Toko Maju')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  wh2 = Number(db.prepare("INSERT INTO warehouses (code, name) VALUES ('GDG2', 'Gudang Dua')").run().lastInsertRowid);
  stock(p1, wh, 100_000);
  stock(p2, wh, 10_000);
});

const lines = (q1 = 10_500, q2 = 2_000) => [{ product_id: p1, qty_milli: q1, unit_price: 20_000 }, { product_id: p2, qty_milli: q2, unit_price: 80_000 }];
const quote = async (extra: object = {}) =>
  (await (await app.request('/api/quotations', json('POST', { customer_id: cust, warehouse_id: wh, lines: lines(), ...extra }))).json()) as QuotationDetail;
const order = (extra: object = {}, client: Client = app) => client.request('/api/sales-orders', json('POST', { customer_id: cust, warehouse_id: wh, lines: lines(), ...extra }));
const act = (path: string, client: Client = app) => client.request(path, json('POST'));
const avail = async (warehouse = wh) => (await (await app.request(`/api/sales-orders/availability?warehouse_id=${warehouse}`)).json()) as Availability[];

async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

describe('quotations and sales orders API', () => {
  it('needs sign-in and a sales role', async () => {
    const warehouse = await as('warehouse');
    for (const path of ['/api/quotations', '/api/sales-orders']) {
      expect((await createApp(db).request(path)).status).toBe(401);
      expect((await warehouse.request(path)).status).toBe(403);
    }
    expect((await order({}, warehouse)).status).toBe(403);
    const cashier = await as('cashier');
    expect((await cashier.request('/api/quotations')).status).toBe(200);
    expect((await order({}, cashier)).status).toBe(201);
  });

  it('creates a quotation with DPP, PPN, total, a QT number and a 14-day validity', async () => {
    const q = await quote({ quote_date: '2026-11-10' });
    expect(q.number).toMatch(/^QT\/\d{4}\/\d{2}\/0001$/);
    expect(q.status).toBe('draft');
    expect(q.valid_until).toBe('2026-11-24');
    expect(q.dpp).toBe(210_000 + 160_000);
    expect(q.ppn).toBe(40_700);
    expect(q.total).toBe(410_700);
    expect(q.lines[0].amount).toBe(210_000);
    const list = (await (await app.request('/api/quotations?status=draft')).json()) as Page<{ id: number }>;
    expect(list.total).toBe(1);
    expect((await app.request('/api/quotations?status=sent')).status).toBe(200);
  });

  it('validates input', async () => {
    const bad = (extra: object) => app.request('/api/quotations', json('POST', { customer_id: cust, warehouse_id: wh, lines: lines(), ...extra }));
    expect((await bad({ lines: [] })).status).toBe(400);
    expect((await bad({ lines: [{ product_id: p1, qty_milli: 0, unit_price: 1 }] })).status).toBe(400);
    expect((await bad({ lines: [{ product_id: p1, qty_milli: 1.5, unit_price: 1 }] })).status).toBe(400);
    expect((await bad({ lines: [{ product_id: p1, qty_milli: 1, unit_price: 1.5 }] })).status).toBe(400);
    expect((await bad({ quote_date: '2026-11-10', valid_until: '2026-11-01' })).status).toBe(400);
    expect((await bad({ lines: [lines()[0], lines()[0]] })).status).toBe(400);
    expect((await bad({ customer_id: 9999 })).status).toBe(404);
    expect((await bad({ warehouse_id: 9999 })).status).toBe(404);
    expect((await app.request('/api/quotations/9999')).status).toBe(404);
    expect((await app.request('/api/sales-orders/availability')).status).toBe(400);
    db.prepare("UPDATE customers SET archived_at = '2026-01-01' WHERE id = ?").run(cust);
    expect((await bad({})).status).toBe(409);
  });

  it('edits only drafts and follows the status flow', async () => {
    const q = await quote();
    const put = (id: number) => app.request(`/api/quotations/${id}`, json('PUT', { customer_id: cust, warehouse_id: wh, note: 'Revisi', lines: lines(1000, 1000) }));
    expect(((await (await put(q.id)).json()) as QuotationDetail).lines[0].qty_milli).toBe(1000);
    expect((await act(`/api/quotations/${q.id}/reject`)).status).toBe(409); // not sent yet
    expect((await act(`/api/quotations/${q.id}/send`)).status).toBe(200);
    expect((await act(`/api/quotations/${q.id}/send`)).status).toBe(409);
    expect((await put(q.id)).status).toBe(409);
    expect(((await (await act(`/api/quotations/${q.id}/reject`)).json()) as QuotationDetail).status).toBe('rejected');
    expect((await act(`/api/quotations/${q.id}/convert`)).status).toBe(409);
    expect((await act(`/api/quotations/${q.id}/cancel`)).status).toBe(409);
  });

  it('converts a quotation into an order that reserves stock, once', async () => {
    const q = await quote();
    await act(`/api/quotations/${q.id}/send`);
    const res = await act(`/api/quotations/${q.id}/convert`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { quotation: QuotationDetail; sales_order_id: number };
    expect(body.quotation.status).toBe('converted');
    expect(body.quotation.sales_order_number).toMatch(/^SO\//);
    const so = (await (await app.request(`/api/sales-orders/${body.sales_order_id}`)).json()) as SalesOrderDetail;
    expect(so.status).toBe('open');
    expect(so.quotation_number).toBe(q.number);
    expect(so.total).toBe(q.total);
    expect(so.lines[0].reserved_milli).toBe(10_500);
    const a = await avail();
    expect(a.find((x) => x.product_id === p1)).toMatchObject({ on_hand_milli: 100_000, reserved_milli: 10_500, available_milli: 89_500 });
    expect((await act(`/api/quotations/${q.id}/convert`)).status).toBe(409);
    // Reserving moves no stock: the ledger is untouched.
    expect((db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get() as { n: number }).n).toBe(2);
  });

  it('refuses to reserve more than is available, counting other open orders', async () => {
    expect((await order({ lines: lines(100_001, 1000) })).status).toBe(409);
    expect((await order({ lines: lines(60_000, 1000) })).status).toBe(201);
    const res = await order({ lines: lines(60_000, 1000) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/only 40 of Gula Pasir/);
    expect((await order({ lines: lines(40_000, 1000), warehouse_id: wh2 })).status).toBe(409); // nothing in the other warehouse
    expect((await order({ lines: lines(40_000, 9_000) })).status).toBe(201);
    expect((await avail()).find((x) => x.product_id === p1)?.available_milli).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM sales_orders').get() as { n: number }).n).toBe(2);
  });

  it('a failed conversion leaves the quotation unchanged', async () => {
    const q = await quote({ lines: lines(90_000, 1000) });
    expect((await order({ lines: lines(50_000, 1000) })).status).toBe(201);
    expect((await act(`/api/quotations/${q.id}/convert`)).status).toBe(409);
    const after = (await (await app.request(`/api/quotations/${q.id}`)).json()) as QuotationDetail;
    expect(after.status).toBe('draft');
    expect(after.sales_order_id).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM sales_orders').get() as { n: number }).n).toBe(1);
  });

  it('refuses to convert an expired quotation and flags it', async () => {
    const q = await quote({ quote_date: '2026-01-01', valid_until: '2026-01-15' });
    expect(q.expired).toBe(true);
    const res = await act(`/api/quotations/${q.id}/convert`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
  });

  it('cancelling an order releases its reservation, and only once', async () => {
    const so = (await (await order({ lines: lines(90_000, 1000) })).json()) as SalesOrderDetail;
    expect((await order({ lines: lines(20_000, 1000) })).status).toBe(409);
    const cancelled = (await (await act(`/api/sales-orders/${so.id}/cancel`)).json()) as SalesOrderDetail;
    expect(cancelled.status).toBe('cancelled');
    expect((await act(`/api/sales-orders/${so.id}/cancel`)).status).toBe(409);
    expect((await order({ lines: lines(20_000, 1000) })).status).toBe(201);
    const list = (await (await app.request('/api/sales-orders?status=cancelled')).json()) as Page<SalesOrderSummary>;
    expect(list.total).toBe(1);
  });
});
