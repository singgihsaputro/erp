import { Hono } from 'hono';
import { grInputSchema, grListQuerySchema, type GrDetail, type GrLine, type GrSummary, type Page } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';
import { PO_WRITERS } from './purchase-orders.js';

type Input = ReturnType<typeof grInputSchema.parse>;

const SUMMARY = `SELECT r.id, r.number, r.order_id, o.number AS order_number, s.name AS supplier_name, r.warehouse_id, w.name AS warehouse_name,
    r.receipt_date, r.supplier_ref, r.note, u.name AS received_by_name, r.created_at,
    (SELECT COUNT(*) FROM goods_receipt_lines l WHERE l.receipt_id = r.id) AS line_count,
    (SELECT COALESCE(SUM(CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER)), 0) FROM goods_receipt_lines l WHERE l.receipt_id = r.id) AS value
  FROM goods_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id
  JOIN warehouses w ON w.id = r.warehouse_id JOIN users u ON u.id = r.received_by`;

/**
 * Receives goods against an approved purchase order and posts them to stock at the order's price.
 * No line may take in more than is still outstanding on the order. Also used by the demo seed.
 */
export function receiveGoods(db: Db, input: Input, userId: number): number {
  const o = db.prepare('SELECT number, status, warehouse_id, order_date FROM purchase_orders WHERE id = ?').get(input.order_id) as
    | { number: string; status: string; warehouse_id: number; order_date: string }
    | undefined;
  if (!o) throw new HttpError(404, 'Purchase order not found');
  if (o.status !== 'approved') throw new HttpError(409, `Purchase order ${o.number} is ${o.status}; goods can only be received against an approved order`);
  const wh = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(o.warehouse_id) as { archived_at: string | null };
  if (wh.archived_at) throw new HttpError(409, 'The order\'s warehouse is archived');
  const date = input.receipt_date ?? jakartaToday();
  if (date < o.order_date) throw new HttpError(400, 'Receipt date cannot be before the order date');
  const outstanding = db.prepare(
    `SELECT l.qty_milli - (SELECT COALESCE(SUM(gl.qty_milli), 0) FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.receipt_id
        WHERE g.order_id = l.order_id AND gl.product_id = l.product_id) AS open_milli, l.unit_cost, p.name
     FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ? AND l.product_id = ?`,
  );
  const seen = new Set<number>();
  const priced: { product_id: number; qty_milli: number; unit_cost: number }[] = [];
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const row = outstanding.get(input.order_id, l.product_id) as { open_milli: number; unit_cost: number; name: string } | undefined;
    if (!row) throw new HttpError(404, `Line ${i + 1}: product is not on ${o.number}`);
    if (l.qty_milli > row.open_milli) throw new HttpError(409, `Line ${i + 1}: only ${row.open_milli / 1000} of ${row.name} still outstanding on ${o.number}, cannot receive ${l.qty_milli / 1000}`);
    priced.push({ ...l, unit_cost: row.unit_cost });
  }
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'goods_receipt');
    const id = Number(
      db.prepare('INSERT INTO goods_receipts (number, order_id, warehouse_id, receipt_date, supplier_ref, note, received_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(number, input.order_id, o.warehouse_id, date, input.supplier_ref, input.note, userId).lastInsertRowid,
    );
    for (const l of priced) {
      db.prepare('INSERT INTO goods_receipt_lines (receipt_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)').run(id, l.product_id, l.qty_milli, l.unit_cost);
      postStockMove(db, {
        productId: l.product_id, warehouseId: o.warehouse_id, qtyMilli: l.qty_milli, unitCost: l.unit_cost,
        sourceType: 'goods_receipt', sourceId: id, note: `${number} · ${o.number}`,
      });
    }
    return id;
  })();
}

export function goodsReceiptRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...PO_WRITERS) as never);

  app.get('/', (c) => {
    const q = parse(grListQuerySchema, c.req.query());
    const clause = q.order_id ? 'WHERE r.order_id = ?' : '';
    const args = q.order_id ? [q.order_id] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM goods_receipts r ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as GrSummary[];
    const body: Page<GrSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): GrDetail => {
    const head = db.prepare(`${SUMMARY} WHERE r.id = ?`).get(id) as GrSummary | undefined;
    if (!head) throw new HttpError(404, 'Goods receipt not found');
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost,
           CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER) AS amount
         FROM goods_receipt_lines l JOIN products p ON p.id = l.product_id WHERE l.receipt_id = ? ORDER BY l.id`,
      )
      .all(id) as GrLine[];
    return { ...head, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(grInputSchema, await readJson(c));
    return c.json(detail(receiveGoods(db, input, c.get('user').id)), 201);
  });

  return app;
}
