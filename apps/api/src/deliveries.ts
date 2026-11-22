import { Hono } from 'hono';
import { deliveryInputSchema, deliveryListQuerySchema, type DeliveryDetail, type DeliveryInput, type DeliveryLine, type DeliverySummary, type Page } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';
import { DELIVERED, SALES_ROLES } from './sales-orders.js';

const SUMMARY = `SELECT d.id, d.number, d.order_id, o.number AS order_number, c.name AS customer_name, w.name AS warehouse_name,
    d.delivery_date, d.driver, d.vehicle, d.note, u.name AS delivered_by_name, d.created_at,
    (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id) AS line_count
  FROM deliveries d JOIN sales_orders o ON o.id = d.order_id JOIN customers c ON c.id = o.customer_id
  JOIN warehouses w ON w.id = d.warehouse_id JOIN users u ON u.id = d.delivered_by`;

/**
 * Posts a Surat Jalan against an open sales order: each line takes stock out of the order's
 * warehouse and reduces the order's reservation. A line may not exceed what is still to deliver
 * (409) nor what is in stock (409). Also used by the demo seed.
 */
export function createDelivery(db: Db, input: DeliveryInput, userId: number): number {
  const data = deliveryInputSchema.parse(input);
  const o = db.prepare('SELECT number, status, warehouse_id, order_date FROM sales_orders WHERE id = ?').get(data.order_id) as
    | { number: string; status: string; warehouse_id: number; order_date: string }
    | undefined;
  if (!o) throw new HttpError(404, 'Sales order not found');
  if (o.status !== 'open') throw new HttpError(409, `Sales order ${o.number} is ${o.status}; only an open order can be delivered`);
  const date = data.delivery_date ?? jakartaToday();
  if (date < o.order_date) throw new HttpError(400, 'Delivery date cannot be before the order date');
  const open = db.prepare(
    `SELECT l.qty_milli - ${DELIVERED} AS open_milli, p.name FROM sales_order_lines l JOIN products p ON p.id = l.product_id
     WHERE l.order_id = ? AND l.product_id = ?`,
  );
  const onHand = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?');
  const seen = new Set<number>();
  for (const [i, l] of data.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const row = open.get(data.order_id, l.product_id) as { open_milli: number; name: string } | undefined;
    if (!row) throw new HttpError(404, `Line ${i + 1}: product is not on ${o.number}`);
    if (l.qty_milli > row.open_milli) throw new HttpError(409, `Line ${i + 1}: only ${row.open_milli / 1000} of ${row.name} still to deliver on ${o.number}, cannot deliver ${l.qty_milli / 1000}`);
    const have = (onHand.get(l.product_id, o.warehouse_id) as { q: number }).q;
    if (l.qty_milli > have) throw new HttpError(409, `Line ${i + 1}: only ${have / 1000} of ${row.name} in stock in the warehouse, cannot deliver ${l.qty_milli / 1000}`);
  }
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'delivery');
    const id = Number(
      db.prepare('INSERT INTO deliveries (number, order_id, warehouse_id, delivery_date, driver, vehicle, note, delivered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(number, data.order_id, o.warehouse_id, date, data.driver, data.vehicle, data.note, userId).lastInsertRowid,
    );
    for (const l of data.lines) {
      db.prepare('INSERT INTO delivery_lines (delivery_id, product_id, qty_milli) VALUES (?, ?, ?)').run(id, l.product_id, l.qty_milli);
      postStockMove(db, {
        productId: l.product_id, warehouseId: o.warehouse_id, qtyMilli: -l.qty_milli, unitCost: 0,
        sourceType: 'delivery', sourceId: id, note: `${number} · ${o.number}`,
      });
    }
    return id;
  })();
}

export function deliveryRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  app.get('/', (c) => {
    const q = parse(deliveryListQuerySchema, c.req.query());
    const clause = q.order_id ? 'WHERE d.order_id = ?' : '';
    const args = q.order_id ? [q.order_id] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM deliveries d ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY d.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as DeliverySummary[];
    const body: Page<DeliverySummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): DeliveryDetail => {
    const head = db.prepare(`${SUMMARY} WHERE d.id = ?`).get(id) as DeliverySummary | undefined;
    if (!head) throw new HttpError(404, 'Delivery not found');
    const cust = db
      .prepare('SELECT c.address, c.npwp FROM customers c JOIN sales_orders o ON o.customer_id = c.id WHERE o.id = ?')
      .get(head.order_id) as { address: string; npwp: string };
    const lines = db
      .prepare(
        `SELECT dl.product_id, p.sku, p.name, p.base_unit, dl.qty_milli,
           (SELECT l.qty_milli FROM sales_order_lines l WHERE l.order_id = d.order_id AND l.product_id = dl.product_id) AS ordered_milli
         FROM delivery_lines dl JOIN deliveries d ON d.id = dl.delivery_id JOIN products p ON p.id = dl.product_id
         WHERE dl.delivery_id = ? ORDER BY dl.id`,
      )
      .all(id) as DeliveryLine[];
    return { ...head, customer_address: cust.address, customer_npwp: cust.npwp, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(deliveryInputSchema, await readJson(c));
    return c.json(detail(createDelivery(db, input, c.get('user').id)), 201);
  });

  return app;
}
