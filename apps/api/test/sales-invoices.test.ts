import { beforeEach, describe, expect, it } from 'vitest';
import type { InvoiceableOrder, Page, SalesInvoiceDetail, SalesInvoiceSummary, SalesOrderDetail } from '@erp/shared';
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

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 10000, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 60000, 80000)").run().lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (name, address, npwp, payment_terms) VALUES ('Toko Maju', 'Jl. Melati 3', '01.234.567.8-901.000', 'net_14')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  for (const p of [p1, p2]) db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, 100000, 10000, 'opening')").run(p, wh);
});

const makeOrder = async () =>
  (await (await app.request('/api/sales-orders', json('POST', {
    customer_id: cust, warehouse_id: wh,
    lines: [{ product_id: p1, qty_milli: 10_000, unit_price: 20_000 }, { product_id: p2, qty_milli: 4_000, unit_price: 80_000 }],
  }))).json()) as SalesOrderDetail;
const deliver = (order: number, lines: { product_id: number; qty_milli: number }[]) => app.request('/api/deliveries', json('POST', { order_id: order, lines }));
const invoice = (order: number, lines: { product_id: number; qty_milli: number }[], extra: object = {}, client: Client = app) =>
  client.request('/api/sales-invoices', json('POST', { order_id: order, lines, ...extra }));
async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

describe('sales invoices API', () => {
  it('needs sign-in and a sales role', async () => {
    expect((await createApp(db).request('/api/sales-invoices')).status).toBe(401);
    const warehouse = await as('warehouse');
    expect((await warehouse.request('/api/sales-invoices')).status).toBe(403);
    expect((await invoice(1, [{ product_id: p1, qty_milli: 1000 }], {}, warehouse)).status).toBe(403);
  });

  it('invoices delivered goods with DPP, PPN, total and a due date from the payment terms', async () => {
    const o = await makeOrder();
    await deliver(o.id, [{ product_id: p1, qty_milli: 6_000 }, { product_id: p2, qty_milli: 4_000 }]);
    const res = await invoice(o.id, [{ product_id: p1, qty_milli: 6_000 }, { product_id: p2, qty_milli: 4_000 }], { invoice_date: '2030-01-10' });
    expect(res.status).toBe(201);
    const i = (await res.json()) as SalesInvoiceDetail;
    expect(i.number).toMatch(/^INV\/\d{4}\/\d{2}\/0001$/);
    expect(i.dpp).toBe(6 * 20_000 + 4 * 80_000);
    expect(i.ppn).toBe(Math.round(i.dpp * 0.11));
    expect(i.total).toBe(i.dpp + i.ppn);
    expect(i.due_date).toBe('2030-01-24');
    expect(i.customer_npwp).toBe('01.234.567.8-901.000');
    expect(i.lines).toHaveLength(2);
    const list = (await (await app.request('/api/sales-invoices')).json()) as Page<SalesInvoiceSummary>;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ number: i.number, total: i.total, customer_name: 'Toko Maju' });
    expect((await app.request(`/api/sales-invoices/${i.id}`)).status).toBe(200);
  });

  it('refuses to invoice goods that were not delivered, or invoice them twice', async () => {
    const o = await makeOrder();
    const none = await invoice(o.id, [{ product_id: p1, qty_milli: 1_000 }]);
    expect(none.status).toBe(409);
    await deliver(o.id, [{ product_id: p1, qty_milli: 6_000 }]);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 7_000 }])).status).toBe(409);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 4_000 }])).status).toBe(201);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 3_000 }])).status).toBe(409);
    const open = (await (await app.request(`/api/sales-invoices/invoiceable/${o.id}`)).json()) as InvoiceableOrder;
    expect(open.lines.find((l) => l.product_id === p1)).toMatchObject({ delivered_milli: 6_000, invoiced_milli: 4_000, invoiceable_milli: 2_000 });
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 2_000 }])).status).toBe(201);
    const numbers = (db.prepare('SELECT number FROM sales_invoices ORDER BY id').all() as { number: string }[]).map((r) => r.number);
    expect(numbers[1]).toMatch(/0002$/);
  });

  it('validates input and finds nothing for unknown ids', async () => {
    const o = await makeOrder();
    await deliver(o.id, [{ product_id: p1, qty_milli: 6_000 }]);
    expect((await invoice(o.id, [])).status).toBe(400);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 0 }])).status).toBe(400);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 1_000 }], { invoice_date: '2000-01-01' })).status).toBe(400);
    expect((await invoice(o.id, [{ product_id: p1, qty_milli: 1_000 }, { product_id: p1, qty_milli: 1_000 }])).status).toBe(400);
    expect((await invoice(o.id, [{ product_id: p2, qty_milli: 1_000 }])).status).toBe(409);
    expect((await invoice(999, [{ product_id: p1, qty_milli: 1_000 }])).status).toBe(404);
    expect((await app.request('/api/sales-invoices/999')).status).toBe(404);
    expect((await app.request('/api/sales-invoices/x')).status).toBe(400);
  });
});
