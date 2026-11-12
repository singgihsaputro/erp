import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, StockRow, TransferDetail, TransferSummary } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let pid: number;
let toko: number;
let gudang: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  pid = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 0, 20000)").run().lastInsertRowid);
  toko = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  gudang = Number(db.prepare("INSERT INTO warehouses (code, name) VALUES ('GDG', 'Gudang')").run().lastInsertRowid);
  await app.request('/api/stock/opening', json('POST', { warehouse_id: toko, lines: [{ product_id: pid, qty_milli: 10_000, unit_cost: 12000 }] }));
});

const send = (qty: number, extra: object = {}) =>
  app.request('/api/stock/transfers', json('POST', { from_warehouse_id: toko, to_warehouse_id: gudang, lines: [{ product_id: pid, qty_milli: qty }], ...extra }));
const stock = async () => {
  const rows = ((await (await app.request('/api/stock')).json()) as Page<StockRow>).items;
  return Object.fromEntries(rows.map((r) => [r.warehouse_id, r.qty_milli]));
};

describe('stock transfers API', () => {
  it('needs sign-in, and changes need a stock role', async () => {
    expect((await createApp(db).request('/api/stock/transfers')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/stock/transfers')).status).toBe(200);
    expect((await cashier.request('/api/stock/transfers', json('POST', {}))).status).toBe(403);
    const t = (await (await send(1000)).json()) as TransferDetail;
    expect((await cashier.request(`/api/stock/transfers/${t.id}/receive`, json('POST'))).status).toBe(403);
    expect((await cashier.request(`/api/stock/transfers/${t.id}/cancel`, json('POST'))).status).toBe(403);
  });

  it('sending takes stock out of the source and holds it in transit; receiving lands it', async () => {
    const r = await send(4000, { note: 'Isi gudang' });
    expect(r.status).toBe(201);
    const t = (await r.json()) as TransferDetail;
    expect(t).toMatchObject({ status: 'in_transit', from_warehouse_name: 'Toko Utama', to_warehouse_name: 'Gudang', line_count: 1, value: 48000 });
    expect(t.number).toMatch(/\/0001$/);
    expect(await stock()).toEqual({ [toko]: 6000 });

    const got = await app.request(`/api/stock/transfers/${t.id}/receive`, json('POST'));
    expect(got.status).toBe(200);
    expect(((await got.json()) as TransferDetail)).toMatchObject({ status: 'received' });
    expect(await stock()).toEqual({ [toko]: 6000, [gudang]: 4000 });
    const cost = (db.prepare('SELECT cost FROM products WHERE id = ?').get(pid) as { cost: number }).cost;
    expect(cost).toBe(12000);
    const sources = db.prepare('SELECT source_type FROM stock_moves WHERE source_id = ? ORDER BY id').all(t.id).map((m) => (m as { source_type: string }).source_type);
    expect(sources).toEqual(['stock_transfer_out', 'stock_transfer_in']);
  });

  it('cannot send more than is on hand, or to the same warehouse', async () => {
    expect((await send(10_001)).status).toBe(409);
    expect(await stock()).toEqual({ [toko]: 10_000 });
    const same = await app.request('/api/stock/transfers', json('POST', { from_warehouse_id: toko, to_warehouse_id: toko, lines: [{ product_id: pid, qty_milli: 1000 }] }));
    expect(same.status).toBe(400);
  });

  it('validates the input', async () => {
    const bad = (body: object) => app.request('/api/stock/transfers', json('POST', body));
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: gudang, lines: [] })).status).toBe(400);
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: gudang, lines: [{ product_id: pid, qty_milli: 0 }] })).status).toBe(400);
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: gudang, lines: [{ product_id: pid, qty_milli: -5 }] })).status).toBe(400);
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: gudang, lines: [{ product_id: pid, qty_milli: 1000 }, { product_id: pid, qty_milli: 1000 }] })).status).toBe(400);
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: 999, lines: [{ product_id: pid, qty_milli: 1000 }] })).status).toBe(404);
    expect((await bad({ from_warehouse_id: toko, to_warehouse_id: gudang, lines: [{ product_id: 999, qty_milli: 1000 }] })).status).toBe(404);
    expect((await app.request('/api/stock/transfers/999')).status).toBe(404);
    expect((await app.request('/api/stock/transfers/999/receive', json('POST'))).status).toBe(404);
  });

  it('a transfer can only be settled once', async () => {
    const t = (await (await send(1000)).json()) as TransferDetail;
    expect((await app.request(`/api/stock/transfers/${t.id}/receive`, json('POST'))).status).toBe(200);
    expect((await app.request(`/api/stock/transfers/${t.id}/receive`, json('POST'))).status).toBe(409);
    expect((await app.request(`/api/stock/transfers/${t.id}/cancel`, json('POST'))).status).toBe(409);
    expect(await stock()).toEqual({ [toko]: 9000, [gudang]: 1000 });
  });

  it('cancelling returns the stock to the source', async () => {
    const t = (await (await send(3000)).json()) as TransferDetail;
    const c = await app.request(`/api/stock/transfers/${t.id}/cancel`, json('POST'));
    expect(((await c.json()) as TransferDetail).status).toBe('cancelled');
    expect(await stock()).toEqual({ [toko]: 10_000 });
    expect((await app.request(`/api/stock/transfers/${t.id}/receive`, json('POST'))).status).toBe(409);
  });

  it('lists and filters by status and warehouse', async () => {
    const a = (await (await send(1000)).json()) as TransferDetail;
    await send(1000);
    await app.request(`/api/stock/transfers/${a.id}/receive`, json('POST'));
    const list = async (q: string) => (await (await app.request(`/api/stock/transfers${q}`)).json()) as Page<TransferSummary>;
    expect((await list('')).total).toBe(2);
    expect((await list('?status=in_transit')).items.map((i) => i.id)).not.toContain(a.id);
    expect((await list(`?warehouse_id=${gudang}&status=received`)).total).toBe(1);
    expect((await app.request('/api/stock/transfers?status=bogus')).status).toBe(400);
  });
});
