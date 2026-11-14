import { beforeEach, describe, expect, it } from 'vitest';
import type { CountDetail, CountSummary, Page } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p1: number;
let p2: number;
let wh: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 0, 70000)").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  await app.request('/api/stock/opening', json('POST', { warehouse_id: wh, lines: [{ product_id: p1, qty_milli: 10_000, unit_cost: 12000 }, { product_id: p2, qty_milli: 4_000, unit_cost: 60000 }] }));
});

const start = async (body: object = { warehouse_id: wh }) => app.request('/api/stock/counts', json('POST', body));
const enter = (id: number, counts: unknown) => app.request(`/api/stock/counts/${id}/counts`, json('PUT', { counts }));
const onHand = (pid: number) => (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(pid, wh) as { q: number }).q;

describe('stock opname API', () => {
  it('needs sign-in, and writing needs a stock role', async () => {
    expect((await createApp(db).request('/api/stock/counts')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock/counts')).status).toBe(200);
    expect((await cashier.request('/api/stock/counts', json('POST', { warehouse_id: wh }))).status).toBe(403);
    const id = ((await (await start()).json()) as CountDetail).id;
    expect((await cashier.request(`/api/stock/counts/${id}/post`, { method: 'POST' })).status).toBe(403);
  });

  it('snapshots the books into a numbered count sheet', async () => {
    const r = await start({ warehouse_id: wh, note: 'Opname akhir bulan' });
    expect(r.status).toBe(201);
    const c = (await r.json()) as CountDetail;
    expect(c.number).toMatch(/^OPN\/\d{4}\/\d{2}\/0001$/);
    expect(c).toMatchObject({ status: 'draft', line_count: 2, counted_count: 0, variance_count: 0, warehouse_name: 'Toko Utama' });
    expect(c.lines.map((l) => l.sku)).toEqual(['P2', 'P1']); // by product name
    expect(c.lines.find((l) => l.sku === 'P1')).toMatchObject({ system_qty_milli: 10_000, counted_qty_milli: null, variance_milli: null });
  });

  it('shows variances while counting and posts them as one adjustment', async () => {
    const c = (await (await start()).json()) as CountDetail;
    const res = await enter(c.id, [{ product_id: p1, counted_qty_milli: 8_500 }, { product_id: p2, counted_qty_milli: 5_000 }]);
    expect(res.status).toBe(200);
    const mid = (await res.json()) as CountDetail;
    expect(mid).toMatchObject({ counted_count: 2, variance_count: 2, variance_value: -18000 + 60000 });
    expect(mid.lines.find((l) => l.sku === 'P1')).toMatchObject({ variance_milli: -1500, variance_value: -18000 });
    expect(onHand(p1)).toBe(10_000); // nothing moves before posting

    const posted = await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' });
    expect(posted.status).toBe(200);
    const done = (await posted.json()) as CountDetail;
    expect(done.status).toBe('posted');
    expect(done.adjustment_id).not.toBeNull();
    expect(onHand(p1)).toBe(8_500);
    expect(onHand(p2)).toBe(5_000);
    expect((db.prepare('SELECT COUNT(*) AS n FROM stock_adjustments').get() as { n: number }).n).toBe(1);
    const adj = db.prepare('SELECT reason, note FROM stock_adjustments').get() as { reason: string; note: string };
    expect(adj).toMatchObject({ reason: 'correction', note: `Stock opname ${c.number}` });
  });

  it('leaves uncounted lines alone and posts nothing when counts match', async () => {
    const c = (await (await start()).json()) as CountDetail;
    await enter(c.id, [{ product_id: p1, counted_qty_milli: 10_000 }]);
    const done = (await (await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' })).json()) as CountDetail;
    expect(done).toMatchObject({ status: 'posted', adjustment_id: null, variance_count: 0 });
    expect(onHand(p2)).toBe(4_000);
    expect((db.prepare('SELECT COUNT(*) AS n FROM stock_adjustments').get() as { n: number }).n).toBe(0);
  });

  it('cannot post before anything is counted, and a posted count is frozen', async () => {
    const c = (await (await start()).json()) as CountDetail;
    expect((await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' })).status).toBe(409);
    await enter(c.id, [{ product_id: p1, counted_qty_milli: 9_000 }]);
    expect((await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' })).status).toBe(200);
    expect((await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' })).status).toBe(409);
    expect((await enter(c.id, [{ product_id: p1, counted_qty_milli: 1 }])).status).toBe(409);
    expect((await app.request(`/api/stock/counts/${c.id}/cancel`, { method: 'POST' })).status).toBe(409);
    expect(onHand(p1)).toBe(9_000);
  });

  it('cancelling a count adjusts nothing and frees the warehouse for a new one', async () => {
    const c = (await (await start()).json()) as CountDetail;
    expect((await start()).status).toBe(409); // one open count per warehouse
    await enter(c.id, [{ product_id: p1, counted_qty_milli: 0 }]);
    const cancelled = (await (await app.request(`/api/stock/counts/${c.id}/cancel`, { method: 'POST' })).json()) as CountDetail;
    expect(cancelled.status).toBe('cancelled');
    expect(onHand(p1)).toBe(10_000);
    expect((await start()).status).toBe(201);
  });

  it('refuses to remove stock that moved away since the count started', async () => {
    const c = (await (await start()).json()) as CountDetail;
    await app.request('/api/stock/adjustments', json('POST', { warehouse_id: wh, reason: 'lost', lines: [{ product_id: p1, qty_milli: -9_500 }] }));
    await enter(c.id, [{ product_id: p1, counted_qty_milli: 8_000 }]);
    const r = await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' });
    expect(r.status).toBe(409);
    expect(((await (await app.request(`/api/stock/counts/${c.id}`)).json()) as CountDetail).status).toBe('draft');
    expect(onHand(p1)).toBe(500);
  });

  it('validates input', async () => {
    expect((await start({})).status).toBe(400);
    expect((await start({ warehouse_id: 9999 })).status).toBe(404);
    const empty = Number(db.prepare("INSERT INTO warehouses (code, name) VALUES ('GDG', 'Gudang Kosong')").run().lastInsertRowid);
    expect((await start({ warehouse_id: empty })).status).toBe(409); // nothing to count
    const c = (await (await start()).json()) as CountDetail;
    expect((await enter(c.id, [{ product_id: p1, counted_qty_milli: -1 }])).status).toBe(400);
    expect((await enter(c.id, [{ product_id: p1, counted_qty_milli: 1.5 }])).status).toBe(400);
    expect((await enter(c.id, [])).status).toBe(400);
    expect((await enter(c.id, [{ product_id: 9999, counted_qty_milli: 1 }])).status).toBe(404);
    expect((await enter(c.id, [{ product_id: p1, counted_qty_milli: 1 }, { product_id: p1, counted_qty_milli: 2 }])).status).toBe(400);
    expect((await app.request('/api/stock/counts/9999')).status).toBe(404);
    expect((await app.request('/api/stock/counts/abc')).status).toBe(400);
  });

  it('lists counts by status', async () => {
    const c = (await (await start()).json()) as CountDetail;
    await enter(c.id, [{ product_id: p1, counted_qty_milli: 9_000 }]);
    await app.request(`/api/stock/counts/${c.id}/post`, { method: 'POST' });
    await start();
    const all = (await (await app.request('/api/stock/counts')).json()) as Page<CountSummary>;
    expect(all.total).toBe(2);
    expect(all.items[0].status).toBe('draft');
    const posted = (await (await app.request('/api/stock/counts?status=posted')).json()) as Page<CountSummary>;
    expect(posted.items.map((i) => i.id)).toEqual([c.id]);
    expect((await app.request('/api/stock/counts?status=nope')).status).toBe(400);
  });
});
