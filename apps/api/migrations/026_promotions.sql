-- Promotions: a percentage or fixed discount, or "buy X get Y free", on one product between two dates.
-- percent_off applies to the line total; amount_off is Rupiah off per base unit; buy/free quantities are
-- thousandths of the base unit. min_qty_milli is the smallest quantity a discount promotion needs.
-- Dates are Asia/Jakarta business days (YYYY-MM-DD), both ends inclusive.
CREATE TABLE promotions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed', 'buy_x_get_y')),
  product_id INTEGER NOT NULL REFERENCES products (id),
  percent_off INTEGER CHECK (percent_off IS NULL OR (percent_off BETWEEN 1 AND 100)),
  amount_off INTEGER CHECK (amount_off IS NULL OR amount_off > 0),
  buy_qty_milli INTEGER CHECK (buy_qty_milli IS NULL OR buy_qty_milli > 0),
  free_qty_milli INTEGER CHECK (free_qty_milli IS NULL OR free_qty_milli > 0),
  min_qty_milli INTEGER NOT NULL DEFAULT 1000 CHECK (min_qty_milli > 0),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX promotions_product ON promotions (product_id, starts_on, ends_on);
