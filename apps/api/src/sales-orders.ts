import { Hono } from 'hono';
import {
  quotationInputSchema,
  quotationListQuerySchema,
  salesOrderInputSchema,
  salesOrderListQuerySchema,
  type Availability,
  type Page,
  type QuotationDetail,
  type QuotationInput,
  type QuotationSummary,
  type SaleLine,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { getCompany, nextDocumentNumber } from './settings.js';

/** Who may quote customers and take orders. Warehouse staff do not sell. */
export const SALES_ROLES = ['super_admin', 'owner', 'admin', 'cashier'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const AMOUNT = 'CAST(ROUND(l.qty_milli * l.unit_price / 1000.0) AS INTEGER)';

type Line = { product_id: number; qty_milli: number; unit_price: number };

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Quantity of a product on hand in a warehouse. */
function onHand(db: Db, productId: number, warehouseId: number): number {
  return (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId) as { q: number }).q;
}
/** Quantity of a product held by open sales orders in a warehouse. */
export function reservedQty(db: Db, productId: number, warehouseId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.qty_milli), 0) AS q FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
         WHERE o.status = 'open' AND o.warehouse_id = ? AND l.product_id = ?`,
      )
      .get(warehouseId, productId) as { q: number }
  ).q;
}

function validate(db: Db, customerId: number, warehouseId: number, lines: Line[]): void {
  const c = db.prepare('SELECT archived_at FROM customers WHERE id = ?').get(customerId) as { archived_at: string | null } | undefined;
  if (!c) throw new HttpError(404, 'Customer not found');
  if (c.archived_at) throw new HttpError(409, 'Customer is archived');
  const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(warehouseId) as { archived_at: string | null } | undefined;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
  const seen = new Set<number>();
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(l.product_id) as { archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, `Line ${i + 1}: product not found`);
    if (p.archived_at) throw new HttpError(409, `Line ${i + 1}: product is archived`);
  }
}

const money = (dpp: number, bp: number) => {
  const ppn = Math.round((dpp * bp) / 10_000);
  return { ppn, total: dpp + ppn };
};

// ---------- sales orders ----------

const SO_SUMMARY = `SELECT o.id, o.number, o.status, o.customer_id, c.name AS customer_name, o.warehouse_id, w.name AS warehouse_name,
    o.order_date, o.delivery_date, o.note, u.name AS created_by_name, o.ppn_rate_bp, o.cancelled_at, o.quotation_id, q.number AS quotation_number,
    (SELECT COUNT(*) FROM sales_order_lines l WHERE l.order_id = o.id) AS line_count,
    (SELECT COALESCE(SUM(${AMOUNT}), 0) FROM sales_order_lines l WHERE l.order_id = o.id) AS dpp
  FROM sales_orders o JOIN customers c ON c.id = o.customer_id JOIN warehouses w ON w.id = o.warehouse_id
  JOIN users u ON u.id = o.created_by LEFT JOIN quotations q ON q.id = o.quotation_id`;
type SoRow = Omit<SalesOrderSummary, 'ppn' | 'total'>;
const soWithTax = (r: SoRow): SalesOrderSummary => ({ ...r, ...money(r.dpp, r.ppn_rate_bp) });

/**
 * Creates an open sales order and reserves its stock. Refuses (409) when a product's available
 * quantity (on hand minus what other open orders hold) in the warehouse is too small.
 * Also used by the demo seed and by converting a quotation.
 */
export function createSalesOrder(
  db: Db,
  input: { customer_id: number; warehouse_id: number; order_date?: string; delivery_date?: string | null; note?: string; lines: Line[] },
  userId: number,
  quotationId: number | null = null,
): number {
  validate(db, input.customer_id, input.warehouse_id, input.lines);
  return db.transaction(() => {
    for (const [i, l] of input.lines.entries()) {
      const available = onHand(db, l.product_id, input.warehouse_id) - reservedQty(db, l.product_id, input.warehouse_id);
      if (l.qty_milli > available) {
        const p = db.prepare('SELECT name FROM products WHERE id = ?').get(l.product_id) as { name: string };
        throw new HttpError(409, `Line ${i + 1}: only ${available / 1000} of ${p.name} is available to reserve in this warehouse, ${l.qty_milli / 1000} requested`);
      }
    }
    const id = Number(
      db
        .prepare('INSERT INTO sales_orders (number, customer_id, warehouse_id, quotation_id, order_date, delivery_date, note, ppn_rate_bp, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nextDocumentNumber(db, 'sales_order'), input.customer_id, input.warehouse_id, quotationId, input.order_date ?? jakartaToday(), input.delivery_date ?? null, input.note ?? '', getCompany(db).ppn_rate_bp, userId)
        .lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO sales_order_lines (order_id, product_id, qty_milli, unit_price) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) add.run(id, l.product_id, l.qty_milli, l.unit_price);
    return id;
  })();
}

export function cancelSalesOrder(db: Db, id: number): void {
  const o = db.prepare('SELECT number, status FROM sales_orders WHERE id = ?').get(id) as { number: string; status: string } | undefined;
  if (!o) throw new HttpError(404, 'Sales order not found');
  if (o.status !== 'open') throw new HttpError(409, `Sales order ${o.number} is ${o.status}, so it cannot be cancelled`);
  db.prepare(`UPDATE sales_orders SET status = 'cancelled', cancelled_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
}

export function salesOrderRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  app.get('/', (c) => {
    const q = parse(salesOrderListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.status) { where.push('o.status = ?'); args.push(q.status); }
    if (q.customer_id) { where.push('o.customer_id = ?'); args.push(q.customer_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM sales_orders o ${clause}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${SO_SUMMARY} ${clause} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as SoRow[];
    const body: Page<SalesOrderSummary> = { items: rows.map(soWithTax), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** On hand, reserved and available per product in one warehouse, for choosing what to sell. */
  app.get('/availability', (c) => {
    const wh = parseId(c.req.query('warehouse_id') ?? '');
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(wh)) throw new HttpError(404, 'Warehouse not found');
    const rows = db
      .prepare(
        `SELECT p.id AS product_id, p.sku, p.name, p.base_unit, p.price,
           COALESCE((SELECT SUM(m.qty_milli) FROM stock_moves m WHERE m.product_id = p.id AND m.warehouse_id = ?), 0) AS on_hand_milli,
           COALESCE((SELECT SUM(l.qty_milli) FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
                     WHERE o.status = 'open' AND o.warehouse_id = ? AND l.product_id = p.id), 0) AS reserved_milli
         FROM products p WHERE p.archived_at IS NULL ORDER BY p.name COLLATE NOCASE`,
      )
      .all(wh, wh) as Omit<Availability, 'available_milli'>[];
    const body: Availability[] = rows.map((r) => ({ ...r, available_milli: r.on_hand_milli - r.reserved_milli }));
    return c.json(body);
  });

  const detail = (id: number): SalesOrderDetail => {
    const head = db.prepare(`${SO_SUMMARY} WHERE o.id = ?`).get(id) as SoRow | undefined;
    if (!head) throw new HttpError(404, 'Sales order not found');
    const cust = db.prepare('SELECT address, npwp FROM customers WHERE id = ?').get(head.customer_id) as { address: string; npwp: string };
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_price, ${AMOUNT} AS amount
         FROM sales_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ? ORDER BY l.id`,
      )
      .all(id) as SaleLine[];
    const full: SalesOrderLine[] = lines.map((l) => ({
      ...l,
      on_hand_milli: onHand(db, l.product_id, head.warehouse_id),
      reserved_milli: reservedQty(db, l.product_id, head.warehouse_id),
    }));
    return { ...soWithTax(head), customer_address: cust.address, customer_npwp: cust.npwp, lines: full };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(salesOrderInputSchema, await readJson(c));
    return c.json(detail(createSalesOrder(db, input, c.get('user').id)), 201);
  });

  app.post('/:id/cancel', (c) => {
    const id = parseId(c.req.param('id'));
    cancelSalesOrder(db, id);
    return c.json(detail(id));
  });

  return app;
}

// ---------- quotations ----------

const Q_SUMMARY = `SELECT q.id, q.number, q.status, q.customer_id, c.name AS customer_name, q.warehouse_id, w.name AS warehouse_name,
    q.quote_date, q.valid_until, q.note, u.name AS created_by_name, q.ppn_rate_bp, q.sales_order_id, s.number AS sales_order_number,
    (SELECT COUNT(*) FROM quotation_lines l WHERE l.quotation_id = q.id) AS line_count,
    (SELECT COALESCE(SUM(${AMOUNT}), 0) FROM quotation_lines l WHERE l.quotation_id = q.id) AS dpp
  FROM quotations q JOIN customers c ON c.id = q.customer_id JOIN warehouses w ON w.id = q.warehouse_id
  JOIN users u ON u.id = q.created_by LEFT JOIN sales_orders s ON s.id = q.sales_order_id`;
type QRow = Omit<QuotationSummary, 'ppn' | 'total' | 'expired'>;
const qWithTax = (r: QRow): QuotationSummary => ({
  ...r,
  ...money(r.dpp, r.ppn_rate_bp),
  expired: (r.status === 'draft' || r.status === 'sent') && r.valid_until < jakartaToday(),
});

type QInput = QuotationInput;

/** Creates a draft quotation. Also used by the demo seed. */
export function createQuotation(db: Db, input: QInput, userId: number): number {
  validate(db, input.customer_id, input.warehouse_id, input.lines);
  const date = input.quote_date ?? jakartaToday();
  return db.transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO quotations (number, customer_id, warehouse_id, quote_date, valid_until, note, ppn_rate_bp, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nextDocumentNumber(db, 'quotation'), input.customer_id, input.warehouse_id, date, input.valid_until ?? addDays(date, 14), input.note ?? '', getCompany(db).ppn_rate_bp, userId).lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO quotation_lines (quotation_id, product_id, qty_milli, unit_price) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) add.run(id, l.product_id, l.qty_milli, l.unit_price);
    return id;
  })();
}

type QAction = 'send' | 'reject' | 'cancel';
const Q_RULES: Record<QAction, { from: string[]; to: string; verb: string }> = {
  send: { from: ['draft'], to: 'sent', verb: 'sent' },
  reject: { from: ['sent'], to: 'rejected', verb: 'rejected' },
  cancel: { from: ['draft', 'sent'], to: 'cancelled', verb: 'cancelled' },
};

export function transitionQuotation(db: Db, id: number, action: QAction): void {
  const q = db.prepare('SELECT number, status FROM quotations WHERE id = ?').get(id) as { number: string; status: string } | undefined;
  if (!q) throw new HttpError(404, 'Quotation not found');
  const rule = Q_RULES[action];
  if (!rule.from.includes(q.status)) throw new HttpError(409, `Quotation ${q.number} is ${q.status}, so it cannot be ${rule.verb}`);
  db.prepare(`UPDATE quotations SET status = ?, updated_at = ${NOW} WHERE id = ?`).run(rule.to, id);
}

/** Turns a draft or sent quotation into an open sales order, reserving the stock. Returns the order id. */
export function convertQuotation(db: Db, id: number, userId: number): number {
  const q = db.prepare('SELECT number, status, customer_id, warehouse_id, valid_until, note FROM quotations WHERE id = ?').get(id) as
    | { number: string; status: string; customer_id: number; warehouse_id: number; valid_until: string; note: string }
    | undefined;
  if (!q) throw new HttpError(404, 'Quotation not found');
  if (q.status !== 'draft' && q.status !== 'sent') throw new HttpError(409, `Quotation ${q.number} is ${q.status}, so it cannot be converted`);
  if (q.valid_until < jakartaToday()) throw new HttpError(409, `Quotation ${q.number} expired on ${q.valid_until}; make a new quotation`);
  const lines = db.prepare('SELECT product_id, qty_milli, unit_price FROM quotation_lines WHERE quotation_id = ? ORDER BY id').all(id) as Line[];
  return db.transaction(() => {
    const orderId = createSalesOrder(db, { customer_id: q.customer_id, warehouse_id: q.warehouse_id, note: q.note, lines }, userId, id);
    db.prepare(`UPDATE quotations SET status = 'converted', sales_order_id = ?, updated_at = ${NOW} WHERE id = ?`).run(orderId, id);
    return orderId;
  })();
}

export function quotationRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  app.get('/', (c) => {
    const q = parse(quotationListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.status) { where.push('q.status = ?'); args.push(q.status); }
    if (q.customer_id) { where.push('q.customer_id = ?'); args.push(q.customer_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM quotations q ${clause}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${Q_SUMMARY} ${clause} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as QRow[];
    const body: Page<QuotationSummary> = { items: rows.map(qWithTax), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): QuotationDetail => {
    const head = db.prepare(`${Q_SUMMARY} WHERE q.id = ?`).get(id) as QRow | undefined;
    if (!head) throw new HttpError(404, 'Quotation not found');
    const cust = db.prepare('SELECT address, npwp FROM customers WHERE id = ?').get(head.customer_id) as { address: string; npwp: string };
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_price, ${AMOUNT} AS amount
         FROM quotation_lines l JOIN products p ON p.id = l.product_id WHERE l.quotation_id = ? ORDER BY l.id`,
      )
      .all(id) as SaleLine[];
    return { ...qWithTax(head), customer_address: cust.address, customer_npwp: cust.npwp, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(quotationInputSchema, await readJson(c));
    return c.json(detail(createQuotation(db, input, c.get('user').id)), 201);
  });

  // Only a draft can be edited; once sent the quotation is what the customer saw.
  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const input = parse(quotationInputSchema, await readJson(c));
    const q = db.prepare('SELECT number, status, quote_date FROM quotations WHERE id = ?').get(id) as { number: string; status: string; quote_date: string } | undefined;
    if (!q) throw new HttpError(404, 'Quotation not found');
    if (q.status !== 'draft') throw new HttpError(409, `Quotation ${q.number} is ${q.status}; only a draft can be edited`);
    validate(db, input.customer_id, input.warehouse_id, input.lines);
    const date = input.quote_date ?? q.quote_date;
    db.transaction(() => {
      db.prepare(`UPDATE quotations SET customer_id = ?, warehouse_id = ?, quote_date = ?, valid_until = ?, note = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(input.customer_id, input.warehouse_id, date, input.valid_until ?? addDays(date, 14), input.note, id);
      db.prepare('DELETE FROM quotation_lines WHERE quotation_id = ?').run(id);
      const add = db.prepare('INSERT INTO quotation_lines (quotation_id, product_id, qty_milli, unit_price) VALUES (?, ?, ?, ?)');
      for (const l of input.lines) add.run(id, l.product_id, l.qty_milli, l.unit_price);
    })();
    return c.json(detail(id));
  });

  for (const action of ['send', 'reject', 'cancel'] as const) {
    app.post(`/:id/${action}`, (c) => {
      const id = parseId(c.req.param('id'));
      transitionQuotation(db, id, action);
      return c.json(detail(id));
    });
  }

  /** Converts the quotation to a sales order (reserving stock) and answers with the order. */
  app.post('/:id/convert', (c) => {
    const id = parseId(c.req.param('id'));
    const orderId = convertQuotation(db, id, c.get('user').id);
    return c.json({ quotation: detail(id), sales_order_id: orderId }, 201);
  });

  return app;
}
