import { beforeEach, describe, expect, it } from 'vitest';
import type { AgingReport, GrDetail, Page, PoDetail, SiDetail, SpDetail, SpOpenInvoice, SpSummary } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let sup: number;
let inv1: SiDetail;
let inv2: SiDetail;

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function invoiceFor(product: number, po: PoDetail, no: string, date: string, due: string, qty: number, cost: number) {
  const gr = (await (await app.request('/api/goods-receipts', json('POST', { order_id: po.id, receipt_date: date, lines: [{ product_id: product, qty_milli: qty * 1000 }] }))).json()) as GrDetail;
  const r = await app.request('/api/supplier-invoices', json('POST', { receipt_id: gr.id, supplier_invoice_no: no, invoice_date: date, due_date: due, lines: [{ product_id: product, qty_milli: qty * 1000, unit_cost: cost }] }));
  return (await r.json()) as SiDetail;
}

const pay = (body: object, client: Client = app) =>
  client.request('/api/supplier-payments', json('POST', { supplier_id: sup, payment_date: day(0), method: 'transfer', ...body }));

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  const p = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  const p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 0, 80000)").run().lastInsertRowid);
  sup = Number(db.prepare("INSERT INTO suppliers (name, payment_terms) VALUES ('PT Pemasok', 'net_14')").run().lastInsertRowid);
  const wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  const mk = async (product: number, cost: number) => {
    const po = (await (await app.request('/api/purchase-orders', json('POST', { supplier_id: sup, warehouse_id: wh, order_date: day(-60), lines: [{ product_id: product, qty_milli: 10_000, unit_cost: cost }] }))).json()) as PoDetail;
    await app.request(`/api/purchase-orders/${po.id}/submit`, json('POST'));
    await app.request(`/api/purchase-orders/${po.id}/approve`, json('POST'));
    return po;
  };
  // inv1: 10 x 10.000 = 100.000 + 11.000 PPN = 111.000, due 45 days ago; inv2: 10 x 20.000 = 222.000, not yet due
  inv1 = await invoiceFor(p, await mk(p, 10_000), 'A-1', day(-59), day(-45), 10, 10_000);
  inv2 = await invoiceFor(p2, await mk(p2, 20_000), 'A-2', day(-5), day(10), 10, 20_000);
});

describe('supplier payments API', () => {
  it('needs sign-in and an owner, admin or super admin', async () => {
    expect((await createApp(db).request('/api/supplier-payments')).status).toBe(401);
    db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run('gudang', 'Gudang', 'warehouse', hashPassword('rahasia-1234'));
    const wh = await signIn(createApp(db), 'gudang', 'rahasia-1234');
    expect((await wh.request('/api/supplier-payments')).status).toBe(403);
    expect((await wh.request('/api/supplier-payments/aging')).status).toBe(403);
    expect((await pay({ allocations: [{ invoice_id: inv1.id, amount: 1000 }] }, wh)).status).toBe(403);
  });

  it('pays several invoices at once, partly and in full, and updates what is outstanding', async () => {
    const r = await pay({ reference: 'TRF-1', allocations: [{ invoice_id: inv1.id, amount: inv1.total }, { invoice_id: inv2.id, amount: 100_000 }] });
    expect(r.status).toBe(201);
    const p = (await r.json()) as SpDetail;
    expect(p.number).toMatch(/^PAY\/\d{4}\/\d{2}\/0001$/);
    expect(p.total).toBe(inv1.total + 100_000);
    expect(p.allocations).toHaveLength(2);
    const a = (await (await app.request(`/api/supplier-invoices/${inv1.id}`)).json()) as SiDetail;
    expect(a.status).toBe('paid');
    expect(a.outstanding).toBe(0);
    const b = (await (await app.request(`/api/supplier-invoices/${inv2.id}`)).json()) as SiDetail;
    expect(b.amount_paid).toBe(100_000);
    expect(b.outstanding).toBe(inv2.total - 100_000);
    const list = (await (await app.request('/api/supplier-payments')).json()) as Page<SpSummary>;
    expect(list.total).toBe(1);
    expect(list.items[0].invoice_count).toBe(2);
    expect(((await (await app.request(`/api/supplier-payments/${p.id}`)).json()) as SpDetail).reference).toBe('TRF-1');
  });

  it('cannot pay more than is outstanding, and a failed payment changes nothing', async () => {
    const r = await pay({ allocations: [{ invoice_id: inv2.id, amount: 1000 }, { invoice_id: inv1.id, amount: inv1.total + 1 }] });
    expect(r.status).toBe(409);
    const b = (await (await app.request(`/api/supplier-invoices/${inv2.id}`)).json()) as SiDetail;
    expect(b.amount_paid).toBe(0);
    expect(((await (await app.request('/api/supplier-payments')).json()) as Page<SpSummary>).total).toBe(0);
    // a settled invoice cannot be paid again
    await pay({ allocations: [{ invoice_id: inv1.id, amount: inv1.total }] });
    expect((await pay({ allocations: [{ invoice_id: inv1.id, amount: 1 }] })).status).toBe(409);
  });

  it('validates input and rejects invoices of another supplier', async () => {
    expect((await pay({ allocations: [] })).status).toBe(400);
    expect((await pay({ allocations: [{ invoice_id: inv1.id, amount: 0 }] })).status).toBe(400);
    expect((await pay({ allocations: [{ invoice_id: inv1.id, amount: 1.5 }] })).status).toBe(400);
    expect((await pay({ method: 'bitcoin', allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await pay({ allocations: [{ invoice_id: inv1.id, amount: 100 }, { invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await pay({ payment_date: day(-100), allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await pay({ allocations: [{ invoice_id: 9999, amount: 100 }] })).status).toBe(404);
    expect((await pay({ supplier_id: 9999, allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(404);
    const other = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('CV Lain')").run().lastInsertRowid);
    expect((await pay({ supplier_id: other, allocations: [{ invoice_id: inv1.id, amount: 100 }] })).status).toBe(400);
    expect((await app.request('/api/supplier-payments/9999')).status).toBe(404);
  });

  it('lists the open invoices of a supplier, oldest due first', async () => {
    await pay({ allocations: [{ invoice_id: inv1.id, amount: inv1.total }] });
    const open = (await (await app.request(`/api/supplier-payments/open-invoices?supplier_id=${sup}`)).json()) as SpOpenInvoice[];
    expect(open.map((o) => o.id)).toEqual([inv2.id]);
    expect(open[0].days_overdue).toBe(0);
    expect((await app.request('/api/supplier-payments/open-invoices')).status).toBe(400);
  });

  it('ages what is owed into buckets by days overdue', async () => {
    let aging = (await (await app.request('/api/supplier-payments/aging')).json()) as AgingReport;
    expect(aging.rows).toHaveLength(1);
    expect(aging.rows[0].buckets.d31_60).toBe(inv1.total);
    expect(aging.rows[0].buckets.current).toBe(inv2.total);
    expect(aging.totals.total).toBe(inv1.total + inv2.total);
    await pay({ allocations: [{ invoice_id: inv1.id, amount: 11_000 }] });
    aging = (await (await app.request('/api/supplier-payments/aging')).json()) as AgingReport;
    expect(aging.totals.d31_60).toBe(inv1.total - 11_000);
    await pay({ allocations: [{ invoice_id: inv1.id, amount: inv1.total - 11_000 }, { invoice_id: inv2.id, amount: inv2.total }] });
    aging = (await (await app.request('/api/supplier-payments/aging')).json()) as AgingReport;
    expect(aging.rows).toHaveLength(0);
    expect(aging.totals.total).toBe(0);
  });
});
