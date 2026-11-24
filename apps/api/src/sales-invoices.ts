import { Hono } from 'hono';
import {
  PAYMENT_TERMS_DAYS,
  salesInvoiceInputSchema,
  salesInvoiceListQuerySchema,
  type InvoiceableOrder,
  type Page,
  type PaymentTerms,
  type SaleLine,
  type SalesInvoiceDetail,
  type SalesInvoiceInput,
  type SalesInvoiceSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { DELIVERED, SALES_ROLES } from './sales-orders.js';

const AMOUNT = 'CAST(ROUND(l.qty_milli * l.unit_price / 1000.0) AS INTEGER)';
/** SQL: quantity of an order line (alias `l`) already invoiced. */
const INVOICED = `(SELECT COALESCE(SUM(il.qty_milli), 0) FROM sales_invoice_lines il JOIN sales_invoices i ON i.id = il.invoice_id
   WHERE i.order_id = l.order_id AND il.product_id = l.product_id)`;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const SUMMARY = `SELECT i.id, i.number, i.order_id, o.number AS order_number, i.customer_id, c.name AS customer_name, i.invoice_date, i.due_date,
    i.payment_terms, i.note, u.name AS created_by_name, i.ppn_rate_bp,
    (SELECT COUNT(*) FROM sales_invoice_lines l WHERE l.invoice_id = i.id) AS line_count,
    (SELECT COALESCE(SUM(${AMOUNT}), 0) FROM sales_invoice_lines l WHERE l.invoice_id = i.id) AS dpp
  FROM sales_invoices i JOIN sales_orders o ON o.id = i.order_id JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.created_by`;
type Row = Omit<SalesInvoiceSummary, 'ppn' | 'total'>;
const withTax = (r: Row): SalesInvoiceSummary => {
  const ppn = Math.round((r.dpp * r.ppn_rate_bp) / 10_000);
  return { ...r, ppn, total: r.dpp + ppn };
};

/** What is still to invoice on an order: delivered minus invoiced, per line. */
export function invoiceable(db: Db, orderId: number): InvoiceableOrder {
  const o = db
    .prepare('SELECT o.id, o.number, o.ppn_rate_bp, c.name AS customer_name, c.payment_terms FROM sales_orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?')
    .get(orderId) as { id: number; number: string; ppn_rate_bp: number; customer_name: string; payment_terms: string } | undefined;
  if (!o) throw new HttpError(404, 'Sales order not found');
  const lines = (
    db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_price, ${AMOUNT} AS amount,
           ${DELIVERED} AS delivered_milli, ${INVOICED} AS invoiced_milli
         FROM sales_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ? ORDER BY l.id`,
      )
      .all(orderId) as (SaleLine & { delivered_milli: number; invoiced_milli: number })[]
  ).map((l) => ({ ...l, invoiceable_milli: Math.max(l.delivered_milli - l.invoiced_milli, 0) }));
  return { order_id: o.id, order_number: o.number, customer_name: o.customer_name, payment_terms: o.payment_terms, ppn_rate_bp: o.ppn_rate_bp, lines };
}

/**
 * Posts a sales invoice for goods delivered on an order. A line may not exceed what is delivered
 * and not yet invoiced (409). Price and PPN rate come from the order; the due date follows the
 * customer's payment terms. Also used by the demo seed.
 */
export function createSalesInvoice(db: Db, input: SalesInvoiceInput, userId: number): number {
  const data = salesInvoiceInputSchema.parse(input);
  const open = invoiceable(db, data.order_id);
  const o = db.prepare('SELECT status, order_date, customer_id FROM sales_orders WHERE id = ?').get(data.order_id) as { status: string; order_date: string; customer_id: number };
  const date = data.invoice_date ?? jakartaToday();
  if (date < o.order_date) throw new HttpError(400, 'Invoice date cannot be before the order date');
  const byProduct = new Map(open.lines.map((l) => [l.product_id, l]));
  const seen = new Set<number>();
  for (const [i, l] of data.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const row = byProduct.get(l.product_id);
    if (!row) throw new HttpError(404, `Line ${i + 1}: product is not on ${open.order_number}`);
    if (l.qty_milli > row.invoiceable_milli) {
      throw new HttpError(409, `Line ${i + 1}: only ${row.invoiceable_milli / 1000} of ${row.name} delivered and not yet invoiced on ${open.order_number}, cannot invoice ${l.qty_milli / 1000}`);
    }
  }
  const days = PAYMENT_TERMS_DAYS[open.payment_terms as PaymentTerms] ?? 0;
  return db.transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO sales_invoices (number, order_id, customer_id, invoice_date, due_date, payment_terms, note, ppn_rate_bp, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nextDocumentNumber(db, 'sales_invoice'), data.order_id, o.customer_id, date, addDays(date, days), open.payment_terms, data.note, open.ppn_rate_bp, userId).lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO sales_invoice_lines (invoice_id, product_id, qty_milli, unit_price) VALUES (?, ?, ?, ?)');
    for (const l of data.lines) add.run(id, l.product_id, l.qty_milli, byProduct.get(l.product_id)!.unit_price);
    return id;
  })();
}

export function salesInvoiceRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  app.get('/', (c) => {
    const q = parse(salesInvoiceListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: number[] = [];
    if (q.customer_id) { where.push('i.customer_id = ?'); args.push(q.customer_id); }
    if (q.order_id) { where.push('i.order_id = ?'); args.push(q.order_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM sales_invoices i ${clause}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${SUMMARY} ${clause} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as Row[];
    const body: Page<SalesInvoiceSummary> = { items: rows.map(withTax), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** Delivered-but-not-invoiced quantities of an order, for the invoice form. */
  app.get('/invoiceable/:orderId', (c) => c.json(invoiceable(db, parseId(c.req.param('orderId')))));

  const detail = (id: number): SalesInvoiceDetail => {
    const head = db.prepare(`${SUMMARY} WHERE i.id = ?`).get(id) as Row | undefined;
    if (!head) throw new HttpError(404, 'Sales invoice not found');
    const cust = db.prepare('SELECT address, npwp FROM customers WHERE id = ?').get(head.customer_id) as { address: string; npwp: string };
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_price, ${AMOUNT} AS amount
         FROM sales_invoice_lines l JOIN products p ON p.id = l.product_id WHERE l.invoice_id = ? ORDER BY l.id`,
      )
      .all(id) as SaleLine[];
    return { ...withTax(head), customer_address: cust.address, customer_npwp: cust.npwp, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(salesInvoiceInputSchema, await readJson(c));
    return c.json(detail(createSalesInvoice(db, input, c.get('user').id)), 201);
  });

  return app;
}
