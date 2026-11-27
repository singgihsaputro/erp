-- Price lists: a selling price per product, customer price tier and minimum quantity ("grosir from 10 pcs").
-- A rule applies to quantities of at least min_qty_milli of the base unit. Products keep their normal
-- price (products.price); rules only override it. Prices are tax-exclusive Rupiah.
CREATE TABLE price_list_rules (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  tier TEXT NOT NULL CHECK (tier IN ('retail', 'grosir', 'member')),
  min_qty_milli INTEGER NOT NULL DEFAULT 1000 CHECK (min_qty_milli > 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (product_id, tier, min_qty_milli)
);
