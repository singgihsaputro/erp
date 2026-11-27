import { Hono } from 'hono';
import { priceListQuerySchema, priceResolveQuerySchema, priceRuleInputSchema, type Page, type PriceListProduct, type PriceRule, type PriceTier, type ResolvedPrice } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { SALES_ROLES } from './sales-orders.js';

/** Who may change prices. Cashiers read them (the order and POS forms use them) but do not set them. */
export const PRICE_MANAGER_ROLES = ['super_admin', 'owner', 'admin'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

type Candidate = { id: number; min_qty_milli: number; price: number };
const best = (db: Db, productId: number, tier: PriceTier, qty: number): Candidate | undefined =>
  db
    .prepare('SELECT id, min_qty_milli, price FROM price_list_rules WHERE product_id = ? AND tier = ? AND min_qty_milli <= ? ORDER BY min_qty_milli DESC LIMIT 1')
    .get(productId, tier, qty) as Candidate | undefined;

/**
 * The selling price of a product for a customer tier and quantity: the rule of that tier with the
 * highest minimum quantity not above the quantity; else the retail quantity break; else the product's price.
 */
export function resolvePrice(db: Db, productId: number, tier: PriceTier, qtyMilli: number): ResolvedPrice {
  const product = db.prepare('SELECT price FROM products WHERE id = ?').get(productId) as { price: number } | undefined;
  if (!product) throw new HttpError(404, 'Product not found');
  const own = best(db, productId, tier, qtyMilli);
  const rule = own ?? (tier === 'retail' ? undefined : best(db, productId, 'retail', qtyMilli));
  const common = { product_id: productId, tier, qty_milli: qtyMilli };
  if (!rule) return { ...common, unit_price: product.price, source: 'base', rule_id: null, min_qty_milli: null };
  return { ...common, unit_price: rule.price, source: own ? 'tier_rule' : 'retail_rule', rule_id: rule.id, min_qty_milli: rule.min_qty_milli };
}

export function customerTier(db: Db, customerId: number): PriceTier {
  const c = db.prepare('SELECT price_tier FROM customers WHERE id = ?').get(customerId) as { price_tier: PriceTier } | undefined;
  if (!c) throw new HttpError(404, 'Customer not found');
  return c.price_tier;
}

/** Fills in the price of every line that has none, from the price list of the customer's tier. */
export function priceLines<T extends { product_id: number; qty_milli: number; unit_price?: number }>(db: Db, customerId: number, lines: T[]): (T & { unit_price: number })[] {
  const tier = customerTier(db, customerId);
  return lines.map((l) => ({ ...l, unit_price: l.unit_price ?? resolvePrice(db, l.product_id, tier, l.qty_milli).unit_price }));
}

export function priceListRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);
  const manage = requireRole(...PRICE_MANAGER_ROLES) as never;

  app.get('/', (c) => {
    const q = parse(priceListQuerySchema, c.req.query());
    const like = `%${(q.q ?? '').replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const where = "WHERE p.archived_at IS NULL AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products p ${where}`).get(like, like) as { n: number }).n;
    const products = db
      .prepare(`SELECT p.id AS product_id, p.sku, p.name, p.base_unit, p.price FROM products p ${where} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(like, like, q.page_size, (q.page - 1) * q.page_size) as Omit<PriceListProduct, 'rules'>[];
    const rules = db.prepare('SELECT id, product_id, tier, min_qty_milli, price FROM price_list_rules WHERE product_id = ? ORDER BY tier, min_qty_milli');
    const body: Page<PriceListProduct> = { items: products.map((p) => ({ ...p, rules: rules.all(p.product_id) as PriceRule[] })), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** The price a customer would get for a product and quantity. */
  app.get('/resolve', (c) => {
    const q = parse(priceResolveQuerySchema, c.req.query());
    return c.json(resolvePrice(db, q.product_id, customerTier(db, q.customer_id), q.qty_milli));
  });

  /** Adds a rule, or changes the price of the rule with the same product, tier and minimum quantity. */
  app.put('/rules', manage, async (c) => {
    const r = parse(priceRuleInputSchema, await readJson(c));
    const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(r.product_id) as { archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, 'Product not found');
    if (p.archived_at) throw new HttpError(409, 'Product is archived');
    const existing = db.prepare('SELECT id FROM price_list_rules WHERE product_id = ? AND tier = ? AND min_qty_milli = ?').get(r.product_id, r.tier, r.min_qty_milli) as { id: number } | undefined;
    if (existing) db.prepare(`UPDATE price_list_rules SET price = ?, updated_at = ${NOW} WHERE id = ?`).run(r.price, existing.id);
    const id = existing?.id ?? Number(db.prepare('INSERT INTO price_list_rules (product_id, tier, min_qty_milli, price) VALUES (?, ?, ?, ?)').run(r.product_id, r.tier, r.min_qty_milli, r.price).lastInsertRowid);
    return c.json(db.prepare('SELECT id, product_id, tier, min_qty_milli, price FROM price_list_rules WHERE id = ?').get(id) as PriceRule, existing ? 200 : 201);
  });

  // Rules are configuration, not posted documents; documents keep the price they were made with.
  app.delete('/rules/:id', manage, (c) => {
    const id = parseId(c.req.param('id'));
    if (db.prepare('DELETE FROM price_list_rules WHERE id = ?').run(id).changes === 0) throw new HttpError(404, 'Price rule not found');
    return c.body(null, 204);
  });

  return app;
}
