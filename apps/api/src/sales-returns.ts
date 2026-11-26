import { Hono } from 'hono';
import {
  srInputSchema,
  srListQuerySchema,
  type Page,
  type SrDetail,
  type SrInput,
  type SrInvoiceOption,
  type SrLine,
  type SrSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';
import { SALES_ROLES } from './sales-orders.js';

const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const AMOUNT = 'CAST(ROUND(l.qty_milli * l.unit_price / 1000.0) AS INTEGER)';

const SUMMARY = `SELECT r.id, r.number, r.credit_note_number, r.invoice_id, i.number AS invoice_number, r.customer_id, c.name AS customer_name,
    w.name AS warehouse_name, r.return_date, r.reason, r.dpp, r.ppn, r.total, r.credit_applied, r.total - r.credit_applied AS refund_due,
    (SELECT COUNT(*) FROM sales_return_lines l WHERE l.return_id = r.id) AS line_count, r.created_at
  FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id JOIN warehouses w ON w.id = r.warehouse_id`;

/** Per product of an invoice: what was billed, what already came back, at the invoiced price. */
function returnableLines(db: Db, invoiceId: number) {
  return db
    .prepare(
      `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli AS invoiced_milli, l.unit_price,
         (SELECT COALESCE(SUM(rl.qty_milli), 0) FROM sales_return_lines rl JOIN sales_returns r ON r.id = rl.return_id
            WHERE r.invoice_id = l.invoice_id AND rl.product_id = l.product_id) AS returned_milli
       FROM sales_invoice_lines l JOIN products p ON p.id = l.product_id WHERE l.invoice_id = ? ORDER BY l.id`,
    )
    .all(invoiceId) as { product_id: number; sku: string; name: string; base_unit: string; invoiced_milli: number; unit_price: number; returned_milli: number }[];
}

const outstandingOf = (db: Db, invoiceId: number): number => {
  const r = db
    .prepare(
      `SELECT i.amount_paid, i.amount_credited, i.ppn_rate_bp,
         (SELECT COALESCE(SUM(${AMOUNT}), 0) FROM sales_invoice_lines l WHERE l.invoice_id = i.id) AS dpp
       FROM sales_invoices i WHERE i.id = ?`,
    )
    .get(invoiceId) as { amount_paid: number; amount_credited: number; ppn_rate_bp: number; dpp: number };
  return r.dpp + Math.round((r.dpp * r.ppn_rate_bp) / 10_000) - r.amount_paid - r.amount_credited;
};

/**
 * Takes goods of a sales invoice back into the order's warehouse and issues a credit note at the invoiced
 * price: stock comes in, and the invoice's outstanding amount falls by the credit (capped at what was
 * outstanding; the rest is owed back to the customer). A line may not exceed what was invoiced and not yet
 * returned (409). Also used by the demo seed.
 */
export function returnSoldGoods(db: Db, input: SrInput, userId: number): number {
  const data = srInputSchema.parse(input);
  const inv = db
    .prepare(
      `SELECT i.id, i.number, i.order_id, i.customer_id, i.invoice_date, i.ppn_rate_bp, o.warehouse_id
       FROM sales_invoices i JOIN sales_orders o ON o.id = i.order_id WHERE i.id = ?`,
    )
    .get(data.invoice_id) as { id: number; number: string; order_id: number; customer_id: number; invoice_date: string; ppn_rate_bp: number; warehouse_id: number } | undefined;
  if (!inv) throw new HttpError(404, 'Sales invoice not found');
  const date = data.return_date ?? jakartaToday();
  if (date < inv.invoice_date) throw new HttpError(400, 'Return date cannot be before the invoice date');
  const avail = new Map(returnableLines(db, inv.id).map((l) => [l.product_id, l]));
  const seen = new Set<number>();
  for (const [i, l] of data.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const a = avail.get(l.product_id);
    if (!a) throw new HttpError(404, `Line ${i + 1}: product is not on ${inv.number}`);
    const left = a.invoiced_milli - a.returned_milli;
    if (l.qty_milli > left) throw new HttpError(409, `Line ${i + 1}: only ${qty(left)} of ${a.name} can still be returned from ${inv.number}, not ${qty(l.qty_milli)}`);
  }
  const priced = data.lines.map((l) => ({ ...l, unit_price: avail.get(l.product_id)!.unit_price }));
  const dpp = priced.reduce((s, l) => s + Math.round((l.qty_milli * l.unit_price) / 1000), 0);
  const ppn = Math.round((dpp * inv.ppn_rate_bp) / 10_000);
  const total = dpp + ppn;
  return db.transaction(() => {
    const applied = Math.min(total, Math.max(0, outstandingOf(db, inv.id)));
    const number = nextDocumentNumber(db, 'sales_return');
    const creditNote = nextDocumentNumber(db, 'credit_note');
    const id = Number(
      db
        .prepare(
          `INSERT INTO sales_returns (number, credit_note_number, invoice_id, order_id, customer_id, warehouse_id, return_date, reason, note, ppn_rate_bp, dpp, ppn, total, credit_applied, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(number, creditNote, inv.id, inv.order_id, inv.customer_id, inv.warehouse_id, date, data.reason, data.note, inv.ppn_rate_bp, dpp, ppn, total, applied, userId)
        .lastInsertRowid,
    );
    const cost = db.prepare('SELECT cost FROM products WHERE id = ?');
    for (const l of priced) {
      db.prepare('INSERT INTO sales_return_lines (return_id, product_id, qty_milli, unit_price) VALUES (?, ?, ?, ?)').run(id, l.product_id, l.qty_milli, l.unit_price);
      // Booked at the current average cost, so taking goods back does not move the moving average.
      postStockMove(db, {
        productId: l.product_id, warehouseId: inv.warehouse_id, qtyMilli: l.qty_milli, unitCost: (cost.get(l.product_id) as { cost: number }).cost,
        sourceType: 'sales_return', sourceId: id, note: `${number} · ${creditNote} · ${inv.number} · ${data.reason}`,
      });
    }
    if (applied > 0) {
      db.prepare("UPDATE sales_invoices SET amount_credited = amount_credited + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(applied, inv.id);
    }
    return id;
  })();
}

export function salesReturnRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);

  app.get('/', (c) => {
    const q = parse(srListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: number[] = [];
    if (q.customer_id) { where.push('r.customer_id = ?'); args.push(q.customer_id); }
    if (q.invoice_id) { where.push('r.invoice_id = ?'); args.push(q.invoice_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM sales_returns r ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as SrSummary[];
    const body: Page<SrSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** Invoices that still have goods that can come back, with the returnable quantity per line. */
  app.get('/invoices', (c) => {
    const heads = db
      .prepare(
        `SELECT i.id, i.number, c.name AS customer_name, i.invoice_date, w.name AS warehouse_name
         FROM sales_invoices i JOIN sales_orders o ON o.id = i.order_id JOIN customers c ON c.id = i.customer_id
         JOIN warehouses w ON w.id = o.warehouse_id ORDER BY i.id DESC LIMIT 200`,
      )
      .all() as Omit<SrInvoiceOption, 'lines' | 'outstanding'>[];
    const out: SrInvoiceOption[] = [];
    for (const h of heads) {
      const lines = returnableLines(db, h.id).map((l) => ({
        product_id: l.product_id, sku: l.sku, name: l.name, base_unit: l.base_unit, invoiced_milli: l.invoiced_milli,
        returned_milli: l.returned_milli, returnable_milli: l.invoiced_milli - l.returned_milli, unit_price: l.unit_price,
      }));
      if (lines.some((l) => l.returnable_milli > 0)) out.push({ ...h, outstanding: outstandingOf(db, h.id), lines });
    }
    return c.json(out);
  });

  const detail = (id: number): SrDetail => {
    const head = db.prepare(`${SUMMARY} WHERE r.id = ?`).get(id) as SrSummary | undefined;
    if (!head) throw new HttpError(404, 'Sales return not found');
    const extra = db
      .prepare(
        `SELECT r.note, r.ppn_rate_bp, u.name AS created_by_name, c.address AS customer_address, c.npwp AS customer_npwp
         FROM sales_returns r JOIN users u ON u.id = r.created_by JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`,
      )
      .get(id) as Pick<SrDetail, 'note' | 'ppn_rate_bp' | 'created_by_name' | 'customer_address' | 'customer_npwp'>;
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_price, ${AMOUNT} AS amount
         FROM sales_return_lines l JOIN products p ON p.id = l.product_id WHERE l.return_id = ? ORDER BY l.id`,
      )
      .all(id) as SrLine[];
    return { ...head, ...extra, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(srInputSchema, await readJson(c));
    return c.json(detail(returnSoldGoods(db, input, c.get('user').id)), 201);
  });

  return app;
}
