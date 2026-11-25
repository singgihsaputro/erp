import { Hono } from 'hono';
import {
  cpInputSchema,
  cpListQuerySchema,
  formatRupiah,
  type CpAllocation,
  type CpDetail,
  type CpOpenInvoice,
  type CpSummary,
  type CreditStatus,
  type Page,
  type ReceivableBucket,
  type ReceivableRow,
  type ReceivablesReport,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { SALES_ROLES } from './sales-orders.js';

type Input = ReturnType<typeof cpInputSchema.parse>;

const LINE = 'CAST(ROUND(l.qty_milli * l.unit_price / 1000.0) AS INTEGER)';
/** SQL: invoice total (DPP + PPN) of the invoice aliased `i`. */
const INV_TOTAL = `((SELECT COALESCE(SUM(${LINE}), 0) FROM sales_invoice_lines l WHERE l.invoice_id = i.id)
   + CAST(ROUND((SELECT COALESCE(SUM(${LINE}), 0) FROM sales_invoice_lines l WHERE l.invoice_id = i.id) * i.ppn_rate_bp / 10000.0) AS INTEGER))`;

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const daysOverdue = (due: string, today: string) => Math.max(0, dayNumber(today) - dayNumber(due));
const bucketOf = (days: number): ReceivableBucket => (days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus');
const emptyBuckets = (): Record<ReceivableBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

/** What a customer owes on posted invoices, and what open orders will still bill (DPP + PPN of ordered, not yet invoiced). */
export function creditStatus(db: Db, customerId: number): CreditStatus {
  const c = db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(customerId) as { credit_limit: number } | undefined;
  if (!c) throw new HttpError(404, 'Customer not found');
  const receivables = (db.prepare(`SELECT COALESCE(SUM(${INV_TOTAL} - i.amount_paid), 0) AS n FROM sales_invoices i WHERE i.customer_id = ?`).get(customerId) as { n: number }).n;
  const orders = db.prepare("SELECT id, ppn_rate_bp FROM sales_orders WHERE customer_id = ? AND status = 'open'").all(customerId) as { id: number; ppn_rate_bp: number }[];
  const unbilled = db.prepare(
    `SELECT COALESCE(SUM(CAST(ROUND(MAX(l.qty_milli - (SELECT COALESCE(SUM(il.qty_milli), 0) FROM sales_invoice_lines il JOIN sales_invoices si ON si.id = il.invoice_id
       WHERE si.order_id = l.order_id AND il.product_id = l.product_id), 0) * l.unit_price / 1000.0) AS INTEGER)), 0) AS n
     FROM sales_order_lines l WHERE l.order_id = ?`,
  );
  let openOrders = 0;
  for (const o of orders) {
    const dpp = (unbilled.get(o.id) as { n: number }).n;
    openOrders += dpp + Math.round((dpp * o.ppn_rate_bp) / 10_000);
  }
  const exposure = receivables + openOrders;
  return { customer_id: customerId, credit_limit: c.credit_limit, receivables, open_orders: openOrders, exposure, available: c.credit_limit > 0 ? c.credit_limit - exposure : null };
}

/**
 * Refuses (409) a new order whose value would take the customer past the credit limit. A limit of 0
 * means none is set, so nothing is enforced. Used when a sales order is created.
 */
export function assertWithinCredit(db: Db, customerId: number, newOrderDpp: number, ppnRateBp: number): void {
  const s = creditStatus(db, customerId);
  if (s.available === null) return;
  const add = newOrderDpp + Math.round((newOrderDpp * ppnRateBp) / 10_000);
  if (add > s.available) {
    throw new HttpError(
      409,
      `Credit limit exceeded: limit ${formatRupiah(s.credit_limit)}, already ${formatRupiah(s.exposure)} (invoices ${formatRupiah(s.receivables)} + open orders ${formatRupiah(s.open_orders)}), this order adds ${formatRupiah(add)}`,
    );
  }
}

/** Posts a payment against invoices of one customer. Also used by the demo seed. */
export function receivePayment(db: Db, input: Input, userId: number): number {
  const cust = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customer_id);
  if (!cust) throw new HttpError(404, 'Customer not found');
  const seen = new Set<number>();
  for (const [i, a] of input.allocations.entries()) {
    if (seen.has(a.invoice_id)) throw new HttpError(400, `Line ${i + 1}: invoice is listed twice`);
    seen.add(a.invoice_id);
  }
  return db.transaction(() => {
    const total = input.allocations.reduce((s, a) => s + a.amount, 0);
    for (const [i, a] of input.allocations.entries()) {
      const inv = db
        .prepare(`SELECT i.number, i.customer_id, i.invoice_date, i.amount_paid, ${INV_TOTAL} AS total FROM sales_invoices i WHERE i.id = ?`)
        .get(a.invoice_id) as { number: string; customer_id: number; invoice_date: string; amount_paid: number; total: number } | undefined;
      if (!inv) throw new HttpError(404, `Line ${i + 1}: invoice not found`);
      if (inv.customer_id !== input.customer_id) throw new HttpError(400, `Line ${i + 1}: ${inv.number} belongs to another customer`);
      if (input.payment_date < inv.invoice_date) throw new HttpError(400, `Line ${i + 1}: payment date is before the date of ${inv.number}`);
      const outstanding = inv.total - inv.amount_paid;
      if (a.amount > outstanding) {
        throw new HttpError(409, `${inv.number}: cannot receive ${formatRupiah(a.amount)}, only ${formatRupiah(outstanding)} is outstanding`);
      }
    }
    const id = Number(
      db
        .prepare('INSERT INTO customer_payments (number, customer_id, payment_date, method, reference, note, total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nextDocumentNumber(db, 'customer_payment'), input.customer_id, input.payment_date, input.method, input.reference, input.note, total, userId).lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO customer_payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)');
    const bump = db.prepare("UPDATE sales_invoices SET amount_paid = amount_paid + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
    for (const a of input.allocations) {
      add.run(id, a.invoice_id, a.amount);
      bump.run(a.amount, a.invoice_id);
    }
    return id;
  })();
}

export function customerPaymentRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  const SUMMARY = `SELECT p.id, p.number, p.customer_id, c.name AS customer_name, p.payment_date, p.method, p.reference, p.total,
      (SELECT COUNT(*) FROM customer_payment_allocations a WHERE a.payment_id = p.id) AS invoice_count, p.created_at
    FROM customer_payments p JOIN customers c ON c.id = p.customer_id`;

  app.get('/', (c) => {
    const q = parse(cpListQuerySchema, c.req.query());
    const clause = q.customer_id ? 'WHERE p.customer_id = ?' : '';
    const args = q.customer_id ? [q.customer_id] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM customer_payments p ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as CpSummary[];
    const body: Page<CpSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** Unpaid invoices of one customer, oldest due date first. */
  app.get('/open-invoices', (c) => {
    const customerId = parseId(c.req.query('customer_id') ?? '');
    const today = jakartaToday();
    const rows = db
      .prepare(
        `SELECT i.id, i.number, i.invoice_date, i.due_date, ${INV_TOTAL} AS total, ${INV_TOTAL} - i.amount_paid AS outstanding
         FROM sales_invoices i WHERE i.customer_id = ? AND ${INV_TOTAL} - i.amount_paid > 0 ORDER BY i.due_date, i.id`,
      )
      .all(customerId) as Omit<CpOpenInvoice, 'days_overdue'>[];
    return c.json(rows.map((r): CpOpenInvoice => ({ ...r, days_overdue: daysOverdue(r.due_date, today) })));
  });

  /** Credit position of one customer: limit, receivables, open orders. */
  app.get('/credit/:customerId', (c) => c.json(creditStatus(db, parseId(c.req.param('customerId')))));

  /** Accounts receivable aging: what each customer owes, by how long it has been overdue. */
  app.get('/aging', (c) => {
    const today = jakartaToday();
    const rows = db
      .prepare(
        `SELECT i.customer_id, c.name AS customer_name, c.credit_limit, i.due_date, ${INV_TOTAL} - i.amount_paid AS outstanding
         FROM sales_invoices i JOIN customers c ON c.id = i.customer_id WHERE ${INV_TOTAL} - i.amount_paid > 0 ORDER BY c.name COLLATE NOCASE, i.due_date`,
      )
      .all() as { customer_id: number; customer_name: string; credit_limit: number; due_date: string; outstanding: number }[];
    const byCustomer = new Map<number, ReceivableRow>();
    const totals = { ...emptyBuckets(), total: 0 };
    for (const r of rows) {
      let row = byCustomer.get(r.customer_id);
      if (!row) {
        row = { customer_id: r.customer_id, customer_name: r.customer_name, credit_limit: r.credit_limit, invoice_count: 0, total: 0, exposure: 0, over_limit: false, buckets: emptyBuckets() };
        byCustomer.set(r.customer_id, row);
      }
      const b = bucketOf(daysOverdue(r.due_date, today));
      row.invoice_count++;
      row.total += r.outstanding;
      row.buckets[b] += r.outstanding;
      totals[b] += r.outstanding;
      totals.total += r.outstanding;
    }
    for (const row of byCustomer.values()) {
      row.exposure = creditStatus(db, row.customer_id).exposure;
      row.over_limit = row.credit_limit > 0 && row.exposure > row.credit_limit;
    }
    const body: ReceivablesReport = { as_of: today, rows: [...byCustomer.values()], totals };
    return c.json(body);
  });

  const detail = (id: number): CpDetail => {
    const head = db.prepare(`${SUMMARY} WHERE p.id = ?`).get(id) as CpSummary | undefined;
    if (!head) throw new HttpError(404, 'Payment not found');
    const extra = db.prepare('SELECT p.note, u.name AS created_by_name FROM customer_payments p JOIN users u ON u.id = p.created_by WHERE p.id = ?').get(id) as Pick<CpDetail, 'note' | 'created_by_name'>;
    const allocations = db
      .prepare('SELECT a.invoice_id, i.number AS invoice_number, a.amount FROM customer_payment_allocations a JOIN sales_invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY a.id')
      .all(id) as CpAllocation[];
    return { ...head, ...extra, allocations };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(cpInputSchema, await readJson(c));
    return c.json(detail(receivePayment(db, input, c.get('user').id)), 201);
  });

  return app;
}
