import { beforeEach, describe, expect, it } from 'vitest';
import type { AdjustmentDetail, AdjustmentSummary, Page, StockRow } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let pid: number;
let wh: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  pid = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  await app.request('/api/stock/opening', json('POST', { warehouse_id: wh, lines: [{ product_id: pid, qty_milli: 10_000, unit_cost: 12000 }] }));
});

const post = (body: unknown) => app.request('/api/stock/adjustments', json('POST', body));
const onHand = async () => ((await (await app.request('/api/stock')).json()) as Page<StockRow>).items[0]?.qty_milli;
const adj = (reason: string, qty_milli: number, extra: object = {}) => ({ warehouse_id: wh, reason, lines: [{ product_id: pid, qty_milli, ...extra }] });

describe('stock adjustments API', () => {
  it('needs sign-in, and posting needs a stock role', async () => {
    expect((await createApp(db).request('/api/stock/adjustments')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock/adjustments')).status).toBe(200);
    expect((await cashier.request('/api/stock/adjustments', json('POST', adj('lost', -1000)))).status).toBe(403);
  });

  it('removes damaged stock at the average cost and numbers the document', async () => {
    const r = await post({ ...adj('damaged', -2500), note: 'Karung sobek' });
    expect(r.status).toBe(201);
    const head = (await r.json()) as AdjustmentSummary;
    expect(head.number).toMatch(/\/0001$/);
    expect(head).toMatchObject({ reason: 'damaged', line_count: 1, value: -30000, warehouse_name: 'Toko Utama' });
    expect(await onHand()).toBe(7500);
    const detail = (await (await app.request(`/api/stock/adjustments/${head.id}`)).json()) as AdjustmentDetail;
    expect(detail.lines[0]).toMatchObject({ sku: 'P1', qty_milli: -2500, unit_cost: 12000 });
    const move = db.prepare("SELECT * FROM stock_moves WHERE source_type = 'stock_adjustment'").get() as { source_id: number; qty_milli: number };
    expect(move).toMatchObject({ source_id: head.id, qty_milli: -2500 });
    const second = (await (await post(adj('lost', -1000))).json()) as AdjustmentSummary;
    expect(second.number).toMatch(/\/0002$/);
  });

  it('a correction can add stock at a given cost and re-averages', async () => {
    expect((await post(adj('correction', 10_000, { unit_cost: 14000 }))).status).toBe(201);
    expect(await onHand()).toBe(20_000);
    const row = ((await (await app.request('/api/stock')).json()) as Page<StockRow>).items[0];
    expect(row.avg_cost).toBe(13000);
  });

  it('cannot remove more than is on hand in the warehouse', async () => {
    expect((await post(adj('lost', -10_001))).status).toBe(409);
    expect(await onHand()).toBe(10_000);
    expect((await post(adj('lost', -10_000))).status).toBe(201);
    expect(await onHand()).toBeUndefined();
    expect(((await (await app.request('/api/stock/adjustments')).json()) as Page<AdjustmentSummary>).total).toBe(1);
  });

  it('is atomic: a bad second line posts nothing', async () => {
    const r = await post({ warehouse_id: wh, reason: 'lost', lines: [{ product_id: pid, qty_milli: -1000 }, { product_id: 999, qty_milli: -1000 }] });
    expect(r.status).toBe(404);
    expect(await onHand()).toBe(10_000);
  });

  it('validates input', async () => {
    expect((await post(adj('damaged', 1000))).status).toBe(400); // only removal for damaged
    expect((await post(adj('correction', 0))).status).toBe(400);
    expect((await post(adj('correction', 1.5))).status).toBe(400);
    expect((await post(adj('stolen', -1000))).status).toBe(400);
    expect((await post({ warehouse_id: wh, reason: 'lost', lines: [] })).status).toBe(400);
    expect((await post({ warehouse_id: wh, reason: 'lost', lines: [{ product_id: pid, qty_milli: -1000 }, { product_id: pid, qty_milli: -1000 }] })).status).toBe(400);
    expect((await post({ ...adj('lost', -1000), warehouse_id: 999 })).status).toBe(404);
    expect((await app.request('/api/stock/adjustments/999')).status).toBe(404);
    expect((await app.request('/api/stock/adjustments/abc')).status).toBe(400);
  });

  it('lists newest first and filters by warehouse', async () => {
    await post(adj('lost', -1000));
    await post(adj('expired', -1000));
    const list = (await (await app.request(`/api/stock/adjustments?warehouse_id=${wh}`)).json()) as Page<AdjustmentSummary>;
    expect(list.items.map((a) => a.reason)).toEqual(['expired', 'lost']);
    expect(((await (await app.request(`/api/stock/adjustments?warehouse_id=${wh + 99}`)).json()) as Page<AdjustmentSummary>).total).toBe(0);
  });
});
