import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, SalesInvoiceDetail, SalesOrderDetail, SrDetail, SrInvoiceOption, SrSummary } from '@erp/shared';
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
let inv: SalesInvoiceDetail;

const onHand = (product: number) => (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(product, wh) as { q: number }).q;
const ret = (lines: { product_id: number; qty_milli: number }[], extra: object = {}, client: Client = app, invoice = inv.id) =>
  client.request('/api/sales-returns', json('POST', { invoice_id: invoice, reason: 'Rusak', lines, ...extra }));
const getInvoice = async () => (await (await app.request(`/api/sales-invoices/${inv.id}`)).json()) as SalesInvoiceDetail;
async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 10000, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 60000, 80000)").run().lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (name, address, npwp) VALUES ('Toko Maju', 'Jl. Melati 3', '01.234.567.8-901.000')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  for (const p of [p1, p2]) db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, 100000, 10000, 'opening')").run(p, wh);
  const order = (await (await app.request('/api/sales-orders', json('POST', {
    customer_id: cust, warehouse_id: wh,
    lines: [{ product_id: p1, qty_milli: 10_000, unit_price: 20_000 }, { product_id: p2, qty_milli: 4_000, unit_price: 80_000 }],
  }))).json()) as SalesOrderDetail;
  const lines = [{ product_id: p1, qty_milli: 10_000 }, { product_id: p2, qty_milli: 4_000 }];
  await app.request('/api/deliveries', json('POST', { order_id: order.id, lines }));
  inv = (await (await app.request('/api/sales-invoices', json('POST', { order_id: order.id, lines }))).json()) as SalesInvoiceDetail;
});

describe('sales returns API', () => {
  it('needs sign-in and a sales role', async () => {
    expect((await createApp(db).request('/api/sales-returns')).status).toBe(401);
    const warehouse = await as('warehouse');
    expect((await warehouse.request('/api/sales-returns')).status).toBe(403);
    expect((await ret([{ product_id: p1, qty_milli: 1000 }], {}, warehouse)).status).toBe(403);
  });

  it('takes goods back into stock and credits the unpaid invoice', async () => {
    const before = onHand(p1);
    const res = await ret([{ product_id: p1, qty_milli: 3_000 }]);
    expect(res.status).toBe(201);
    const r = (await res.json()) as SrDetail;
    expect(r.number).toMatch(/^SR\/\d{4}\/\d{2}\/0001$/);
    expect(r.credit_note_number).toMatch(/^CN\/\d{4}\/\d{2}\/0001$/);
    expect([r.dpp, r.ppn, r.total]).toEqual([60_000, 6_600, 66_600]);
    expect(r.credit_applied).toBe(66_600);
    expect(r.refund_due).toBe(0);
    expect(r.customer_npwp).toBe('01.234.567.8-901.000');
    expect(onHand(p1)).toBe(before + 3_000);
    const after = await getInvoice();
    expect(after.amount_credited).toBe(66_600);
    expect(after.outstanding).toBe(inv.total - 66_600);
    // unit cost unchanged: the average cost does not move on a return
    expect((db.prepare('SELECT cost FROM products WHERE id = ?').get(p1) as { cost: number }).cost).toBe(10_000);
  });

  it('refunds the part that was already paid instead of crediting it', async () => {
    await app.request('/api/customer-payments', json('POST', {
      customer_id: cust, payment_date: inv.invoice_date, method: 'cash', allocations: [{ invoice_id: inv.id, amount: inv.total }],
    }));
    const r = (await (await ret([{ product_id: p2, qty_milli: 1_000 }])).json()) as SrDetail;
    expect(r.total).toBe(88_800);
    expect(r.credit_applied).toBe(0);
    expect(r.refund_due).toBe(88_800);
    expect((await getInvoice()).amount_credited).toBe(0);
  });

  it('caps the credit at what is outstanding', async () => {
    await app.request('/api/customer-payments', json('POST', {
      customer_id: cust, payment_date: inv.invoice_date, method: 'transfer', allocations: [{ invoice_id: inv.id, amount: inv.total - 10_000 }],
    }));
    const r = (await (await ret([{ product_id: p1, qty_milli: 1_000 }])).json()) as SrDetail;
    expect(r.total).toBe(22_200);
    expect(r.credit_applied).toBe(10_000);
    expect(r.refund_due).toBe(12_200);
    expect((await getInvoice()).outstanding).toBe(0);
  });

  it('cannot return more than was invoiced and not yet returned', async () => {
    expect((await ret([{ product_id: p1, qty_milli: 10_001 }])).status).toBe(409);
    expect((await ret([{ product_id: p1, qty_milli: 7_000 }])).status).toBe(201);
    const over = await ret([{ product_id: p1, qty_milli: 3_001 }]);
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toContain('3');
    expect((await ret([{ product_id: p1, qty_milli: 3_000 }])).status).toBe(201);
    expect(onHand(p1)).toBe(100_000);
    const options = (await (await app.request('/api/sales-returns/invoices')).json()) as SrInvoiceOption[];
    expect(options[0]!.lines.find((l) => l.product_id === p1)!.returnable_milli).toBe(0);
    expect(options[0]!.lines.find((l) => l.product_id === p2)!.returnable_milli).toBe(4_000);
  });

  it('rejects invalid input and unknown documents', async () => {
    expect((await ret([])).status).toBe(400);
    expect((await ret([{ product_id: p1, qty_milli: 0 }])).status).toBe(400);
    expect((await ret([{ product_id: p1, qty_milli: 1_500.5 }])).status).toBe(400);
    expect((await ret([{ product_id: p1, qty_milli: 1000 }], { reason: ' ' })).status).toBe(400);
    expect((await ret([{ product_id: p1, qty_milli: 1000 }], { return_date: '2000-01-01' })).status).toBe(400);
    expect((await ret([{ product_id: p1, qty_milli: 1000 }, { product_id: p1, qty_milli: 1000 }])).status).toBe(400);
    expect((await ret([{ product_id: 9999, qty_milli: 1000 }])).status).toBe(404);
    expect((await ret([{ product_id: p1, qty_milli: 1000 }], {}, app, 9999)).status).toBe(404);
    expect(onHand(p1)).toBe(90_000);
  });

  it('lists, filters and shows returns; the customer receivable falls', async () => {
    const r = (await (await ret([{ product_id: p1, qty_milli: 2_000 }])).json()) as SrDetail;
    const list = (await (await app.request(`/api/sales-returns?customer_id=${cust}`)).json()) as Page<SrSummary>;
    expect(list.total).toBe(1);
    expect(list.items[0]!.invoice_number).toBe(inv.number);
    expect(((await (await app.request('/api/sales-returns?invoice_id=9999')).json()) as Page<SrSummary>).total).toBe(0);
    expect((await app.request(`/api/sales-returns/${r.id}`)).status).toBe(200);
    expect((await app.request('/api/sales-returns/9999')).status).toBe(404);
    const credit = (await (await app.request(`/api/customer-payments/credit/${cust}`)).json()) as { receivables: number };
    expect(credit.receivables).toBe(inv.total - r.total);
  });

  it('a credited invoice cannot be overpaid', async () => {
    await ret([{ product_id: p2, qty_milli: 4_000 }]);
    const pay = await app.request('/api/customer-payments', json('POST', {
      customer_id: cust, payment_date: inv.invoice_date, method: 'cash', allocations: [{ invoice_id: inv.id, amount: inv.total }],
    }));
    expect(pay.status).toBe(409);
  });
});
