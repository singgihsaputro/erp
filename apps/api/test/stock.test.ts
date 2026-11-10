import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, StockHistory, StockRow } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';
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
});

const open = (body: unknown) => app.request('/api/stock/opening', json('POST', body));
const line = (qty_milli: number, unit_cost: number) => ({ product_id: pid, qty_milli, unit_cost });

describe('stock ledger API', () => {
  it('needs sign-in, and opening stock needs a stock role', async () => {
    expect((await createApp(db).request('/api/stock')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock')).status).toBe(200);
    const r = await cashier.request('/api/stock/opening', json('POST', { warehouse_id: wh, lines: [line(1000, 100)] }));
    expect(r.status).toBe(403);
  });

  it('posts opening balances to the ledger and shows on-hand per warehouse', async () => {
    const r = await open({ warehouse_id: wh, lines: [line(1500, 12000)] });
    expect(r.status).toBe(201);
    const list = (await (await app.request('/api/stock')).json()) as Page<StockRow>;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ sku: 'P1', qty_milli: 1500, avg_cost: 12000, value: 18000, warehouse_code: 'TOKO' });
    const filtered = (await (await app.request(`/api/stock?warehouse_id=${wh + 99}`)).json()) as Page<StockRow>;
    expect(filtered.total).toBe(0);
    expect(((await (await app.request('/api/stock?q=gula')).json()) as Page<StockRow>).total).toBe(1);
  });

  it('refuses a second opening balance for the same product and warehouse', async () => {
    expect((await open({ warehouse_id: wh, lines: [line(1000, 100)] })).status).toBe(201);
    expect((await open({ warehouse_id: wh, lines: [line(2000, 100)] })).status).toBe(409);
    const n = db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('validates input', async () => {
    expect((await open({ warehouse_id: wh, lines: [] })).status).toBe(400);
    expect((await open({ warehouse_id: wh, lines: [line(0, 100)] })).status).toBe(400);
    expect((await open({ warehouse_id: wh, lines: [line(1.5, 100)] })).status).toBe(400);
    expect((await open({ warehouse_id: wh, lines: [line(1000, 10.5)] })).status).toBe(400);
    expect((await open({ warehouse_id: wh, lines: [line(1000, 100), line(1000, 100)] })).status).toBe(400);
    expect((await open({ warehouse_id: 999, lines: [line(1000, 100)] })).status).toBe(404);
    expect((await open({ warehouse_id: wh, lines: [{ ...line(1000, 100), product_id: 999 }] })).status).toBe(404);
    expect((await app.request('/api/stock/opening', { method: 'POST', body: 'x', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await app.request('/api/stock/products/999/moves')).status).toBe(404);
  });

  it('keeps a moving-average cost across warehouses and shows it in the history', async () => {
    const gdg = Number(db.prepare("INSERT INTO warehouses (code, name) VALUES ('G2', 'Gudang 2')").run().lastInsertRowid);
    await open({ warehouse_id: wh, lines: [line(10_000, 1000)] }); // 10 kg @ 1.000
    await open({ warehouse_id: gdg, lines: [line(30_000, 2000)] }); // +30 kg @ 2.000 → 1.750
    expect((db.prepare('SELECT cost FROM products WHERE id = ?').get(pid) as { cost: number }).cost).toBe(1750);
    const h = (await (await app.request(`/api/stock/products/${pid}/moves`)).json()) as StockHistory;
    expect(h.moves.map((m) => [m.balance_milli, m.avg_cost_after])).toEqual([[10_000, 1000], [40_000, 1750]]);
    const one = (await (await app.request(`/api/stock/products/${pid}/moves?warehouse_id=${gdg}`)).json()) as StockHistory;
    expect(one.moves).toHaveLength(1);
    expect(one.moves[0]).toMatchObject({ balance_milli: 30_000, avg_cost_after: 1750 });
  });

  it('the seeded demo has stock with a restock at a new average cost', async () => {
    const d = openDb(':memory:');
    seedDemo(d);
    const a = await signIn(createApp(d));
    const list = (await (await a.request('/api/stock')).json()) as Page<StockRow>;
    expect(list.total).toBeGreaterThan(10);
    const beras = list.items.find((r) => r.sku === 'BRS-PRM-5' && r.warehouse_code === 'GDG-BEL')!;
    const h = (await (await a.request(`/api/stock/products/${beras.product_id}/moves`)).json()) as StockHistory;
    expect(h.moves.length).toBe(3);
    expect(h.moves.at(-1)!.avg_cost_after).toBe(h.product.cost);
    expect(h.product.cost).toBeGreaterThan(68000);
  });
});
