import { beforeEach, describe, expect, it } from 'vitest';
import type { GrDetail, Page, PoDetail, SiDetail, SiPayableSummary, SiPrefill, SiReceiptOption, SiSummary } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let p2: number;
let sup: number;
let receipt: number;

const create = (body: object, client: Client = app) =>
  client.request('/api/supplier-invoices', json('POST', { receipt_id: receipt, supplier_invoice_no: 'F-001', invoice_date: '2026-11-06', ...body }));
let lines: { product_id: number; qty_milli: number; unit_cost: number }[];

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 0, 80000)").run().lastInsertRowid);
  sup = Number(db.prepare("INSERT INTO suppliers (name, payment_terms, npwp) VALUES ('PT Pemasok', 'net_14', '01.234.567.8-901.000')").run().lastInsertRowid);
  const wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  const po = (
    (await (await app.request('/api/purchase-orders', json('POST', {
      supplier_id: sup, warehouse_id: wh, order_date: '2026-11-01',
      lines: [{ product_id: p1, qty_milli: 10_000, unit_cost: 12_000 }, { product_id: p2, qty_milli: 2_000, unit_cost: 65_000 }],
    }))).json()) as PoDetail
  ).id;
  await app.request(`/api/purchase-orders/${po}/submit`, json('POST'));
  await app.request(`/api/purchase-orders/${po}/approve`, json('POST'));
  const gr = await app.request('/api/goods-receipts', json('POST', { order_id: po, receipt_date: '2026-11-05', lines: [{ product_id: p1, qty_milli: 4_000 }, { product_id: p2, qty_milli: 2_000 }] }));
  receipt = ((await gr.json()) as GrDetail).id;
  lines = [{ product_id: p1, qty_milli: 4_000, unit_cost: 12_000 }, { product_id: p2, qty_milli: 2_000, unit_cost: 65_000 }];
});

describe('supplier invoices API', () => {
  it('needs sign-in and an owner, admin or super admin', async () => {
    expect((await createApp(db).request('/api/supplier-invoices')).status).toBe(401);
    db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run('gudang', 'Gudang', 'warehouse', hashPassword('rahasia-1234'));
    const wh = await signIn(createApp(db), 'gudang', 'rahasia-1234');
    expect((await wh.request('/api/supplier-invoices')).status).toBe(403);
    expect((await create({ lines }, wh)).status).toBe(403);
  });

  it('records an invoice with DPP, PPN, total, due date from the payment terms and a clean match', async () => {
    const r = await create({ lines, stated_total: 214_160 });
    expect(r.status).toBe(201);
    const si = (await r.json()) as SiDetail;
    expect(si.number).toMatch(/^BILL\/\d{4}\/\d{2}\/0001$/);
    expect(si.dpp).toBe(48_000 + 130_000);
    expect(si.ppn).toBe(19_580);
    expect(si.total).toBe(197_580 + 0);
    expect(si.due_date).toBe('2026-11-20');
    expect(si.outstanding).toBe(si.total);
    expect(si.status === 'overdue' || si.status === 'open').toBe(true);
    // stated total 214_160 differs from 197_580, nothing else does
    expect(si.warnings.map((w) => w.kind)).toEqual(['total']);
    const list = (await (await app.request('/api/supplier-invoices')).json()) as Page<SiSummary>;
    expect(list.total).toBe(1);
    expect(list.items[0].warning_count).toBe(1);
  });

  it('warns about quantity, price and goods not invoiced, without blocking', async () => {
    const si = (await (await create({ lines: [{ product_id: p1, qty_milli: 5_000, unit_cost: 13_000 }] })).json()) as SiDetail;
    const kinds = si.warnings.map((w) => w.kind).sort();
    expect(kinds).toEqual(['not_invoiced', 'price', 'qty']);
    expect(si.warnings.find((w) => w.kind === 'qty')!.message).toContain('invoiced 5 but 4 received');
  });

  it('lists receipts still to invoice and the accounts payable summary', async () => {
    expect(((await (await app.request('/api/supplier-invoices/receipts')).json()) as SiReceiptOption[]).map((x) => x.id)).toEqual([receipt]);
    await create({ lines, due_date: '2026-11-10' });
    expect(((await (await app.request('/api/supplier-invoices/receipts')).json()) as SiReceiptOption[]).length).toBe(0);
    const p = (await (await app.request('/api/supplier-invoices/payable')).json()) as SiPayableSummary;
    expect(p).toMatchObject({ open_count: 1, outstanding: 197_580, overdue_count: 1, overdue_outstanding: 197_580 });
    const overdue = (await (await app.request('/api/supplier-invoices?status=overdue')).json()) as Page<SiSummary>;
    expect(overdue.total).toBe(1);
    expect(((await (await app.request('/api/supplier-invoices?status=paid')).json()) as Page<SiSummary>).total).toBe(0);
  });

  it('refuses a second invoice for the same receipt or the same supplier number (409)', async () => {
    expect((await create({ lines })).status).toBe(201);
    const again = await create({ lines, supplier_invoice_no: 'F-002' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('already invoiced');
    const wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
    const po2 = ((await (await app.request('/api/purchase-orders', json('POST', { supplier_id: sup, warehouse_id: wh, order_date: '2026-11-02', lines: [{ product_id: p1, qty_milli: 1_000, unit_cost: 12_000 }] }))).json()) as PoDetail).id;
    await app.request(`/api/purchase-orders/${po2}/submit`, json('POST'));
    await app.request(`/api/purchase-orders/${po2}/approve`, json('POST'));
    const gr2 = ((await (await app.request('/api/goods-receipts', json('POST', { order_id: po2, receipt_date: '2026-11-05', lines: [{ product_id: p1, qty_milli: 1_000 }] }))).json()) as GrDetail).id;
    const dup = await create({ receipt_id: gr2, supplier_invoice_no: 'f-001', lines: [{ product_id: p1, qty_milli: 1_000, unit_cost: 12_000 }] });
    expect(dup.status).toBe(409);
  });

  it('validates input', async () => {
    expect((await create({ lines: [] })).status).toBe(400);
    expect((await create({ lines, supplier_invoice_no: '  ' })).status).toBe(400);
    expect((await create({ lines, invoice_date: '06-11-2026' })).status).toBe(400);
    expect((await create({ lines, due_date: '2026-11-01' })).status).toBe(400);
    expect((await create({ lines: [{ product_id: p1, qty_milli: 1.5, unit_cost: 1 }] })).status).toBe(400);
    expect((await create({ lines: [lines[0], lines[0]] })).status).toBe(400);
    expect((await create({ lines, invoice_date: '2026-11-04' })).status).toBe(400);
    expect((await create({ lines, receipt_id: 9999 })).status).toBe(404);
    const other = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P3', 'Lain', 'pcs', 0, 1)").run().lastInsertRowid);
    expect((await create({ lines: [{ product_id: other, qty_milli: 1000, unit_cost: 1 }] })).status).toBe(400);
    expect((await app.request('/api/supplier-invoices/9999')).status).toBe(404);
  });

  it('creates an invoice from a confirmed inbox PDF only, once', async () => {
    const ins = (status: string, data: object) =>
      Number(db.prepare(
        `INSERT INTO invoice_extractions (file_name, file_size, file_sha256, file_data, page_count, raw_text, status, extracted_json, found_json, data_json, uploaded_by)
         VALUES (?, 1, ?, x'00', 1, '', ?, '{}', '{}', ?, 1)`,
      ).run(`${status}.pdf`, `sha-${status}`, status, JSON.stringify(data)).lastInsertRowid);
    const data = {
      supplier_name: 'pt pemasok', supplier_npwp: null, invoice_number: 'PMS-77', invoice_date: '2026-11-06', due_date: null,
      lines: [
        { description: 'Gula', product_id: p1, qty_milli: 4000, unit: 'kg', unit_price: 12000, amount: 48000 },
        { description: 'Tidak dikenal', product_id: null, qty_milli: 1000, unit: 'pcs', unit_price: 5000, amount: 5000 },
      ],
      subtotal: 48000, discount: 0, ppn_rate: 11, ppn: 5280, total: 53280,
    };
    const review = ins('review', data);
    const confirmed = ins('confirmed', data);
    expect((await app.request(`/api/supplier-invoices/prefill/${review}`)).status).toBe(409);
    expect((await app.request('/api/supplier-invoices/prefill/9999')).status).toBe(404);
    expect((await create({ lines, extraction_id: review })).status).toBe(409);
    expect(((await (await app.request('/api/supplier-invoices/extractions')).json()) as { id: number }[]).map((x) => x.id)).toEqual([confirmed]);

    const pre = (await (await app.request(`/api/supplier-invoices/prefill/${confirmed}`)).json()) as SiPrefill;
    expect(pre).toMatchObject({ supplier_id: sup, receipt_id: receipt, supplier_invoice_no: 'PMS-77', skipped_lines: 1, stated_total: 53280 });
    expect(pre.lines).toEqual([{ product_id: p1, qty_milli: 4000, unit_cost: 12000 }]);

    const r = await create({ lines: pre.lines, supplier_invoice_no: pre.supplier_invoice_no, stated_total: pre.stated_total, extraction_id: confirmed });
    expect(r.status).toBe(201);
    expect(((await r.json()) as SiDetail).extraction_id).toBe(confirmed);
    expect((await app.request(`/api/supplier-invoices/prefill/${confirmed}`)).status).toBe(409);
    expect(((await (await app.request('/api/supplier-invoices/extractions')).json()) as unknown[]).length).toBe(0);
  });
});
