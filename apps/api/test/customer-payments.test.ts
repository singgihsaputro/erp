import { beforeEach, describe, expect, it } from 'vitest';
import type { CpDetail, CpOpenInvoice, CpSummary, CreditStatus, Page, ReceivablesReport, SalesInvoiceDetail, SalesInvoiceSummary, SalesOrderDetail } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let cust: number;
let other: number;
let wh: number;
let inv1: SalesInvoiceDetail; // 10 x 20.000 = 200.000 + 22.000 = 222.000, 45 days overdue
let inv2: SalesInvoiceDetail; // 5 x 20.000 = 100.000 + 11.000 = 111.000, not yet due

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function sell(customer: number, qty: number, invoiceDate: string): Promise<SalesInvoiceDetail> {
  const o = (await (await app.request('/api/sales-orders', json('POST', { customer_id: customer, warehouse_id: wh, order_date: invoiceDate, lines: [{ product_id: p1, qty_milli: qty * 1000, unit_price: 20_000 }] }))).json()) as SalesOrderDetail;
  await app.request('/api/deliveries', json('POST', { order_id: o.id, delivery_date: invoiceDate, lines: [{ product_id: p1, qty_milli: qty * 1000 }] }));
  const lines = [{ product_id: p1, qty_milli: qty * 1000 }];
  return (await (await app.request('/api/sales-invoices', json('POST', { order_id: o.id, invoice_date: invoiceDate, lines }))).json()) as SalesInvoiceDetail;
}

const receive = (body: object, client: Client = app) =>
  client.request('/api/customer-payments', json('POST', { customer_id: cust, payment_date: day(0), method: 'transfer', ...body }));

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 10000, 20000)").run().lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (name, payment_terms, credit_limit) VALUES ('Toko Maju', 'net_14', 0)").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO customers (name, payment_terms) VALUES ('Toko Lain', 'net_14')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, 1000000, 10000, 'opening')").run(p1, wh);
  inv1 = await sell(cust, 10, day(-59));
  inv2 = await sell(cust, 5, day(-5));
});

describe('customer payments API', () => {
  it('needs sign-in and a sales role', async () => {
    expect((await createApp(db).request('/api/customer-payments')).status).toBe(401);
    db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run('gudang', 'Gudang', 'warehouse', hashPassword('rahasia-1234'));
    const wc = await signIn(createApp(db), 'gudang', 'rahasia-1234');
    expect((await wc.request('/api/customer-payments')).status).toBe(403);
    expect((await wc.request('/api/customer-payments/aging')).status).toBe(403);
    expect((await receive({ allocations: [{ invoice_id: inv1.id, amount: 1000 }] }, wc)).status).toBe(403);
  });

  it('receives a payment across invoices and reduces what is outstanding', async () => {
    const res = await receive({ reference: 'TRF-1', allocations: [{ invoice_id: inv1.id, amount: 222_000 }, { invoice_id: inv2.id, amount: 11_000 }] });
    expect(res.status).toBe(201);
    const p = (await res.json()) as CpDetail;
    expect(p.number).toMatch(/^RCV\/\d{4}\/\d{2}\/0001$/);
    expect(p.total).toBe(233_000);
    expect(p.allocations).toHaveLength(2);
    const list = (await (await app.request('/api/customer-payments')).json()) as Page<CpSummary>;
    expect(list.total).toBe(1);
    const open = (await (await app.request(`/api/customer-payments/open-invoices?customer_id=${cust}`)).json()) as CpOpenInvoice[];
    expect(open).toHaveLength(1);
    expect(open[0].outstanding).toBe(100_000);
    const invs = (await (await app.request('/api/sales-invoices')).json()) as Page<SalesInvoiceSummary>;
    expect(invs.items.find((i) => i.id === inv1.id)?.outstanding).toBe(0);
    expect(invs.items.find((i) => i.id === inv2.id)?.amount_paid).toBe(11_000);
  });

  it('rejects bad input, wrong customer, early dates and duplicates', async () => {
    expect((await receive({ allocations: [] })).status).toBe(400);
    expect((await receive({ allocations: [{ invoice_id: inv1.id, amount: 0 }] })).status).toBe(400);
    expect((await receive({ allocations: [{ invoice_id: inv1.id, amount: 10.5 }] })).status).toBe(400);
    expect((await receive({ method: 'bitcoin', allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await receive({ allocations: [{ invoice_id: inv1.id, amount: 100 }, { invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await receive({ customer_id: other, allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await receive({ payment_date: day(-100), allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await receive({ allocations: [{ invoice_id: 9999, amount: 100 }] })).status).toBe(404);
    expect((await receive({ customer_id: 9999, allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(404);
    expect((await app.request('/api/customer-payments/9999')).status).toBe(404);
  });

  it('cannot receive more than is outstanding, and changes nothing when it refuses', async () => {
    const res = await receive({ allocations: [{ invoice_id: inv2.id, amount: 1000 }, { invoice_id: inv1.id, amount: 222_001 }] });
    expect(res.status).toBe(409);
    expect(((await (await app.request('/api/customer-payments')).json()) as Page<CpSummary>).total).toBe(0);
    expect(db.prepare('SELECT amount_paid FROM sales_invoices WHERE id = ?').get(inv2.id)).toEqual({ amount_paid: 0 });
    await receive({ allocations: [{ invoice_id: inv2.id, amount: 111_000 }] });
    expect((await receive({ allocations: [{ invoice_id: inv2.id, amount: 1 }] })).status).toBe(409);
  });

  it('ages receivables into buckets', async () => {
    await receive({ allocations: [{ invoice_id: inv1.id, amount: 22_000 }] });
    const r = (await (await app.request('/api/customer-payments/aging')).json()) as ReceivablesReport;
    expect(r.rows).toHaveLength(1);
    // inv1: invoiced 59 days ago, net 14 => 45 days overdue, 200.000 left; inv2 not yet due
    expect(r.rows[0].buckets.d31_60).toBe(200_000);
    expect(r.rows[0].buckets.current).toBe(111_000);
    expect(r.totals.total).toBe(311_000);
  });

  it('blocks a new order that would pass the credit limit', async () => {
    db.prepare('UPDATE customers SET credit_limit = ? WHERE id = ?').run(400_000, cust);
    const s = (await (await app.request(`/api/customer-payments/credit/${cust}`)).json()) as CreditStatus;
    expect(s.receivables).toBe(333_000);
    expect(s.available).toBe(67_000);
    const order = (qty: number) => app.request('/api/sales-orders', json('POST', { customer_id: cust, warehouse_id: wh, lines: [{ product_id: p1, qty_milli: qty * 1000, unit_price: 20_000 }] }));
    const refused = await order(4); // 80.000 + 8.800 PPN = 88.800 > 67.000
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Credit limit exceeded/);
    expect((await order(3)).status).toBe(201); // 66.600 fits
    // that open order now counts, so one more cannot fit
    expect((await order(1)).status).toBe(409);
    // paying invoices frees credit
    await receive({ allocations: [{ invoice_id: inv1.id, amount: 222_000 }] });
    expect((await order(1)).status).toBe(201);
  });

  it('does not enforce a limit when none is set', async () => {
    const res = await app.request('/api/sales-orders', json('POST', { customer_id: cust, warehouse_id: wh, lines: [{ product_id: p1, qty_milli: 500_000, unit_price: 20_000 }] }));
    expect(res.status).toBe(201);
  });
});
