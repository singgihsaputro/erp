import { beforeEach, describe, expect, it } from 'vitest';
import type { Availability, DeliveryDetail, Page, DeliverySummary, SalesOrderDetail } from '@erp/shared';
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

const onHand = (product: number) => (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(product, wh) as { q: number }).q;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p1 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'kg', 10000, 20000)").run().lastInsertRowid);
  p2 = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P2', 'Beras 5 kg', 'pcs', 60000, 80000)").run().lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (name, address) VALUES ('Toko Maju', 'Jl. Melati 3')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  for (const [p, q] of [[p1, 100_000], [p2, 10_000]]) {
    db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, ?, 10000, 'opening')").run(p, wh, q);
  }
});

const makeOrder = async (q1 = 10_000, q2 = 4_000) =>
  (await (await app.request('/api/sales-orders', json('POST', {
    customer_id: cust, warehouse_id: wh,
    lines: [{ product_id: p1, qty_milli: q1, unit_price: 20_000 }, { product_id: p2, qty_milli: q2, unit_price: 80_000 }],
  }))).json()) as SalesOrderDetail;
const deliver = (order: number, lines: { product_id: number; qty_milli: number }[], extra: object = {}, client: Client = app) =>
  client.request('/api/deliveries', json('POST', { order_id: order, lines, ...extra }));
const getOrder = async (id: number) => (await (await app.request(`/api/sales-orders/${id}`)).json()) as SalesOrderDetail;
async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

describe('deliveries (Surat Jalan) API', () => {
  it('needs sign-in and a sales role', async () => {
    expect((await createApp(db).request('/api/deliveries')).status).toBe(401);
    const warehouse = await as('warehouse');
    expect((await warehouse.request('/api/deliveries')).status).toBe(403);
    expect((await deliver(1, [{ product_id: p1, qty_milli: 1000 }], {}, warehouse)).status).toBe(403);
  });

  it('delivers part of an order, posts stock out and shrinks the reservation', async () => {
    const o = await makeOrder();
    const res = await deliver(o.id, [{ product_id: p1, qty_milli: 6_000 }], { driver: 'Pak Slamet', vehicle: 'B 1234 XY' });
    expect(res.status).toBe(201);
    const d = (await res.json()) as DeliveryDetail;
    expect(d.number).toMatch(/^SJ\/\d{4}\/\d{2}\/0001$/);
    expect(d.lines).toEqual([expect.objectContaining({ product_id: p1, qty_milli: 6_000, ordered_milli: 10_000 })]);
    expect(d.driver).toBe('Pak Slamet');
    expect(onHand(p1)).toBe(94_000);
    const move = db.prepare("SELECT qty_milli, source_id FROM stock_moves WHERE source_type = 'delivery'").get() as { qty_milli: number; source_id: number };
    expect(move).toEqual({ qty_milli: -6_000, source_id: d.id });
    const after = await getOrder(o.id);
    expect(after.delivery_status).toBe('partial');
    expect(after.lines.find((l) => l.product_id === p1)?.delivered_milli).toBe(6_000);
    const av = (await (await app.request(`/api/sales-orders/availability?warehouse_id=${wh}`)).json()) as Availability[];
    const a = av.find((x) => x.product_id === p1)!;
    expect(a.reserved_milli).toBe(4_000);
    expect(a.available_milli).toBe(90_000);
  });

  it('completes an order over several deliveries and numbers them in sequence', async () => {
    const o = await makeOrder();
    await deliver(o.id, [{ product_id: p1, qty_milli: 10_000 }]);
    const second = (await (await deliver(o.id, [{ product_id: p2, qty_milli: 4_000 }])).json()) as DeliveryDetail;
    expect(second.number).toMatch(/0002$/);
    expect((await getOrder(o.id)).delivery_status).toBe('complete');
    const list = (await (await app.request(`/api/deliveries?order_id=${o.id}`)).json()) as Page<DeliverySummary>;
    expect(list.total).toBe(2);
    expect((await app.request(`/api/deliveries/${second.id}`)).status).toBe(200);
  });

  it('refuses to deliver more than is still to deliver', async () => {
    const o = await makeOrder();
    await deliver(o.id, [{ product_id: p1, qty_milli: 7_000 }]);
    const res = await deliver(o.id, [{ product_id: p1, qty_milli: 3_001 }]);
    expect(res.status).toBe(409);
    expect(onHand(p1)).toBe(93_000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get()).toEqual({ n: 1 });
  });

  it('refuses when the warehouse does not hold the stock, changing nothing', async () => {
    const o = await makeOrder();
    db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, -98000, 10000, 'adjustment')").run(p1, wh);
    const res = await deliver(o.id, [{ product_id: p2, qty_milli: 1_000 }, { product_id: p1, qty_milli: 5_000 }]);
    expect(res.status).toBe(409);
    expect(onHand(p2)).toBe(10_000);
  });

  it('validates input', async () => {
    const o = await makeOrder();
    expect((await deliver(o.id, [])).status).toBe(400);
    expect((await deliver(o.id, [{ product_id: p1, qty_milli: 0 }])).status).toBe(400);
    expect((await deliver(o.id, [{ product_id: p1, qty_milli: 1_000 }, { product_id: p1, qty_milli: 1_000 }])).status).toBe(400);
    expect((await deliver(o.id, [{ product_id: p1, qty_milli: 1_000 }], { delivery_date: '2000-01-01' })).status).toBe(400);
    expect((await deliver(o.id, [{ product_id: 9999, qty_milli: 1_000 }])).status).toBe(404);
    expect((await deliver(9999, [{ product_id: p1, qty_milli: 1_000 }])).status).toBe(404);
    expect((await app.request('/api/deliveries/9999')).status).toBe(404);
  });

  it('only delivers open orders, and a delivered order cannot be cancelled', async () => {
    const o = await makeOrder();
    const cancelled = await makeOrder(1_000, 1_000);
    await app.request(`/api/sales-orders/${cancelled.id}/cancel`, json('POST'));
    expect((await deliver(cancelled.id, [{ product_id: p1, qty_milli: 1_000 }])).status).toBe(409);
    await deliver(o.id, [{ product_id: p1, qty_milli: 10_000 }, { product_id: p2, qty_milli: 4_000 }]);
    expect((await app.request(`/api/sales-orders/${o.id}/cancel`, json('POST'))).status).toBe(409);
  });

  it('cancelling a partly delivered order releases only the remainder', async () => {
    const o = await makeOrder();
    await deliver(o.id, [{ product_id: p1, qty_milli: 6_000 }]);
    expect((await app.request(`/api/sales-orders/${o.id}/cancel`, json('POST'))).status).toBe(200);
    const av = (await (await app.request(`/api/sales-orders/availability?warehouse_id=${wh}`)).json()) as Availability[];
    expect(av.find((x) => x.product_id === p1)?.reserved_milli).toBe(0);
  });
});
