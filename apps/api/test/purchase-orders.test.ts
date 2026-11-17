import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, PoDetail, PoSummary } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let p2: number;
let sup: number;
let wh: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 0, 80000)").run().lastInsertRowid);
  sup = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('PT Pemasok')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
});

const body = (extra: object = {}) => ({
  supplier_id: sup, warehouse_id: wh, order_date: '2026-11-10', expected_date: '2026-11-15',
  lines: [{ product_id: p1, qty_milli: 10_500, unit_cost: 12_000 }, { product_id: p2, qty_milli: 2_000, unit_cost: 65_000 }], ...extra,
});
const create = async (extra: object = {}) => (await (await app.request('/api/purchase-orders', json('POST', body(extra)))).json()) as PoDetail;
const act = (id: number, what: string, client: Client = app) => client.request(`/api/purchase-orders/${id}/${what}`, json('POST'));

async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

describe('purchase orders API', () => {
  it('needs sign-in and a purchasing role; approving needs an approver', async () => {
    expect((await createApp(db).request('/api/purchase-orders')).status).toBe(401);
    const cashier = await as('cashier');
    expect((await cashier.request('/api/purchase-orders')).status).toBe(403);
    expect((await cashier.request('/api/purchase-orders', json('POST', body()))).status).toBe(403);
    const po = await create();
    await act(po.id, 'submit');
    const warehouse = await as('warehouse');
    expect((await warehouse.request('/api/purchase-orders')).status).toBe(200);
    expect((await act(po.id, 'approve', warehouse)).status).toBe(403);
    expect((await act(po.id, 'reject', warehouse)).status).toBe(403);
    expect((await act(po.id, 'approve')).status).toBe(200);
  });

  it('creates a draft with DPP, PPN and total worked out from the lines', async () => {
    const r = await app.request('/api/purchase-orders', json('POST', body({ note: 'Restok' })));
    expect(r.status).toBe(201);
    const po = (await r.json()) as PoDetail;
    expect(po).toMatchObject({ status: 'draft', supplier_name: 'PT Pemasok', line_count: 2, ppn_rate_bp: 1100, note: 'Restok' });
    expect(po.number).toMatch(/^PO\/\d{4}\/\d{2}\/0001$/);
    expect(po.lines.map((l) => l.amount)).toEqual([126_000, 130_000]);
    expect(po).toMatchObject({ dpp: 256_000, ppn: 28_160, total: 284_160 });
    expect((await create()).number).toMatch(/\/0002$/);
  });

  it('rejects invalid input with 400, and unknown or archived references', async () => {
    const bad = async (extra: object) => (await app.request('/api/purchase-orders', json('POST', body(extra)))).status;
    expect(await bad({ lines: [] })).toBe(400);
    expect(await bad({ lines: [{ product_id: p1, qty_milli: 0, unit_cost: 1 }] })).toBe(400);
    expect(await bad({ lines: [{ product_id: p1, qty_milli: 1000, unit_cost: 1.5 }] })).toBe(400);
    expect(await bad({ lines: [{ product_id: p1, qty_milli: 1000, unit_cost: 1 }, { product_id: p1, qty_milli: 1000, unit_cost: 1 }] })).toBe(400);
    expect(await bad({ order_date: '10-11-2026' })).toBe(400);
    expect(await bad({ expected_date: '2026-11-01' })).toBe(400);
    expect(await bad({ supplier_id: 999 })).toBe(404);
    expect(await bad({ warehouse_id: 999 })).toBe(404);
    expect(await bad({ lines: [{ product_id: 999, qty_milli: 1000, unit_cost: 1 }] })).toBe(404);
    db.prepare("UPDATE suppliers SET archived_at = '2026-11-01' WHERE id = ?").run(sup);
    expect(await bad({})).toBe(409);
    expect((await app.request('/api/purchase-orders/abc')).status).toBe(400);
    expect((await app.request('/api/purchase-orders/999')).status).toBe(404);
  });

  it('walks draft → submitted → approved and freezes the order', async () => {
    const po = await create();
    expect((await act(po.id, 'approve')).status).toBe(409); // not submitted yet
    const sub = (await (await act(po.id, 'submit')).json()) as PoDetail;
    expect(sub.status).toBe('submitted');
    expect((await act(po.id, 'submit')).status).toBe(409);
    const ok = (await (await act(po.id, 'approve')).json()) as PoDetail;
    expect(ok).toMatchObject({ status: 'approved', approved_by_name: 'Admin' });
    expect(ok.approved_at).toBeTruthy();
    expect((await app.request(`/api/purchase-orders/${po.id}`, json('PUT', body()))).status).toBe(409);
    expect((await act(po.id, 'reject')).status).toBe(409);
    expect((await act(po.id, 'approve')).status).toBe(409);
  });

  it('edits a draft, replacing its lines, and a rejected order returns to draft', async () => {
    const po = await create();
    const r = await app.request(`/api/purchase-orders/${po.id}`, json('PUT', body({ lines: [{ product_id: p2, qty_milli: 1000, unit_cost: 70_000 }], note: 'Revisi' })));
    expect(r.status).toBe(200);
    const edited = (await r.json()) as PoDetail;
    expect(edited).toMatchObject({ line_count: 1, dpp: 70_000, note: 'Revisi', number: po.number });
    await act(po.id, 'submit');
    expect((await app.request(`/api/purchase-orders/${po.id}`, json('PUT', body()))).status).toBe(409);
    expect(((await (await act(po.id, 'reject')).json()) as PoDetail).status).toBe('draft');
    expect((await app.request(`/api/purchase-orders/${po.id}`, json('PUT', body()))).status).toBe(200);
  });

  it('cancels a draft, submitted or approved order once, and never changes it again', async () => {
    const a = await create();
    expect(((await (await act(a.id, 'cancel')).json()) as PoDetail).status).toBe('cancelled');
    expect((await act(a.id, 'cancel')).status).toBe(409);
    expect((await act(a.id, 'submit')).status).toBe(409);
    expect((await app.request(`/api/purchase-orders/${a.id}`, json('PUT', body()))).status).toBe(409);
    const b = await create();
    await act(b.id, 'submit');
    await act(b.id, 'approve');
    expect((await act(b.id, 'cancel')).status).toBe(200);
    expect((await act(999, 'cancel')).status).toBe(404);
  });

  it('lists newest first, filtered by status, and paginates', async () => {
    const a = await create();
    await create();
    await act(a.id, 'submit');
    const all = (await (await app.request('/api/purchase-orders')).json()) as Page<PoSummary>;
    expect(all.total).toBe(2);
    expect(all.items[0].id).toBeGreaterThan(all.items[1].id);
    const sub = (await (await app.request('/api/purchase-orders?status=submitted')).json()) as Page<PoSummary>;
    expect(sub.items.map((i) => i.id)).toEqual([a.id]);
    const p2page = (await (await app.request('/api/purchase-orders?page=2&page_size=1')).json()) as Page<PoSummary>;
    expect(p2page.items).toHaveLength(1);
    expect((await app.request('/api/purchase-orders?status=bogus')).status).toBe(400);
  });

  it('does not touch the stock ledger', async () => {
    const po = await create();
    await act(po.id, 'submit');
    await act(po.id, 'approve');
    expect((db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get() as { n: number }).n).toBe(0);
  });
});
