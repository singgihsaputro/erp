import { beforeEach, describe, expect, it } from 'vitest';
import type { GrDetail, Page, PoDetail, PrDetail, PrReceiptOption, PrSummary, SiDetail } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let wh: number;
let sup: number;
let receipt: number;

const stock = () => (db.prepare('SELECT COALESCE(SUM(qty_milli),0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(p1, wh) as { q: number }).q;
const ret = (body: object, client: Client = app) =>
  client.request('/api/purchase-returns', json('POST', { receipt_id: receipt, return_date: '2026-11-10', reason: 'Rusak', ...body }));
const invoice = async () => {
  const r = await app.request('/api/supplier-invoices', json('POST', {
    receipt_id: receipt, supplier_invoice_no: 'F-1', invoice_date: '2026-11-05',
    lines: [{ product_id: p1, qty_milli: 10_000, unit_cost: 12_000 }],
  }));
  return (await r.json()) as SiDetail;
};

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  sup = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('PT Pemasok')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  const po = ((await (await app.request('/api/purchase-orders', json('POST', {
    supplier_id: sup, warehouse_id: wh, order_date: '2026-11-01', lines: [{ product_id: p1, qty_milli: 10_000, unit_cost: 12_000 }],
  }))).json()) as PoDetail).id;
  await app.request(`/api/purchase-orders/${po}/submit`, json('POST'));
  await app.request(`/api/purchase-orders/${po}/approve`, json('POST'));
  const r = await app.request('/api/goods-receipts', json('POST', { order_id: po, receipt_date: '2026-11-04', lines: [{ product_id: p1, qty_milli: 10_000 }] }));
  receipt = ((await r.json()) as GrDetail).id;
});

describe('purchase returns API', () => {
  it('needs sign-in and a purchasing role', async () => {
    expect((await createApp(db).request('/api/purchase-returns')).status).toBe(401);
    db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run('kasir', 'Kasir', 'cashier', hashPassword('rahasia-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'rahasia-1234');
    expect((await cashier.request('/api/purchase-returns')).status).toBe(403);
    expect((await ret({ lines: [{ product_id: p1, qty_milli: 1000 }] }, cashier)).status).toBe(403);
  });

  it('sends goods back: stock goes out and the return is numbered', async () => {
    const r = await ret({ lines: [{ product_id: p1, qty_milli: 3000 }] });
    expect(r.status).toBe(201);
    const d = (await r.json()) as PrDetail;
    expect(d.number).toMatch(/^PR\/\d{4}\/\d{2}\/0001$/);
    expect(d).toMatchObject({ dpp: 36_000, ppn: 3_960, total: 39_960, credit_applied: 0, refund_due: 39_960, invoice_number: null });
    expect(stock()).toBe(7000);
    const mv = db.prepare("SELECT qty_milli, source_type FROM stock_moves WHERE source_type = 'purchase_return'").get();
    expect(mv).toMatchObject({ qty_milli: -3000 });
    const list = (await (await app.request('/api/purchase-returns')).json()) as Page<PrSummary>;
    expect(list.total).toBe(1);
    expect((await app.request(`/api/purchase-returns/${d.id}`)).status).toBe(200);
    expect((await app.request('/api/purchase-returns/999')).status).toBe(404);
  });

  it('credits the supplier invoice so less is owed', async () => {
    const inv = await invoice();
    expect(inv.outstanding).toBe(133_200);
    const d = (await (await ret({ lines: [{ product_id: p1, qty_milli: 2000 }] })).json()) as PrDetail;
    expect(d).toMatchObject({ total: 26_640, credit_applied: 26_640, refund_due: 0, invoice_number: inv.number });
    const after = (await (await app.request(`/api/supplier-invoices/${inv.id}`)).json()) as SiDetail;
    expect(after).toMatchObject({ amount_credited: 26_640, outstanding: 106_560 });
    const aging = (await (await app.request('/api/supplier-payments/aging')).json()) as { totals: { total: number } };
    expect(aging.totals.total).toBe(106_560);
    // a payment can no longer exceed the reduced balance
    const pay = await app.request('/api/supplier-payments', json('POST', {
      supplier_id: sup, payment_date: '2026-11-12', method: 'cash', allocations: [{ invoice_id: inv.id, amount: 133_200 }],
    }));
    expect(pay.status).toBe(409);
  });

  it('caps the credit at what is still owed when the invoice was already paid', async () => {
    const inv = await invoice();
    await app.request('/api/supplier-payments', json('POST', {
      supplier_id: sup, payment_date: '2026-11-12', method: 'cash', allocations: [{ invoice_id: inv.id, amount: 133_200 }],
    }));
    const d = (await (await ret({ return_date: '2026-11-13', lines: [{ product_id: p1, qty_milli: 1000 }] })).json()) as PrDetail;
    expect(d).toMatchObject({ total: 13_320, credit_applied: 0, refund_due: 13_320 });
  });

  it('cannot return more than was received, in total', async () => {
    expect((await ret({ lines: [{ product_id: p1, qty_milli: 6000 }] })).status).toBe(201);
    const over = await ret({ lines: [{ product_id: p1, qty_milli: 5000 }] });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toContain('can still be returned');
    expect(stock()).toBe(4000);
    const opts = (await (await app.request('/api/purchase-returns/receipts')).json()) as PrReceiptOption[];
    expect(opts[0]!.lines[0]).toMatchObject({ received_milli: 10_000, returned_milli: 6000, returnable_milli: 4000 });
  });

  it('cannot return goods that have already left the warehouse', async () => {
    db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, -8000, 12000, 'sale')").run(p1, wh);
    const r = await ret({ lines: [{ product_id: p1, qty_milli: 3000 }] });
    expect(r.status).toBe(409);
    expect(stock()).toBe(2000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchase_returns').get()).toEqual({ n: 0 });
  });

  it('validates the input', async () => {
    expect((await ret({ lines: [] })).status).toBe(400);
    expect((await ret({ reason: ' ', lines: [{ product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await ret({ lines: [{ product_id: p1, qty_milli: 0 }] })).status).toBe(400);
    expect((await ret({ lines: [{ product_id: p1, qty_milli: 1.5 }] })).status).toBe(400);
    expect((await ret({ lines: [{ product_id: p1, qty_milli: 1000 }, { product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await ret({ return_date: '2026-11-01', lines: [{ product_id: p1, qty_milli: 1000 }] })).status).toBe(400);
    expect((await ret({ receipt_id: 999, lines: [{ product_id: p1, qty_milli: 1000 }] })).status).toBe(404);
    expect((await ret({ lines: [{ product_id: 999, qty_milli: 1000 }] })).status).toBe(404);
    expect(stock()).toBe(10_000);
  });
});
