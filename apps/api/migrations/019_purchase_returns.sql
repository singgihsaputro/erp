-- A purchase return sends goods of one goods receipt back to the supplier. Posting it writes an outbound
-- ledger move per line (source_type 'purchase_return') and, when the receipt has a supplier invoice,
-- credits the invoice: supplier_invoices.amount_credited rises by credit_applied, so what is owed falls.
-- credit_applied is capped at what was still outstanding; the rest (when the invoice was already paid)
-- is a refund the supplier owes, kept as total - credit_applied. Posted returns are never edited or deleted.
ALTER TABLE supplier_invoices ADD COLUMN amount_credited INTEGER NOT NULL DEFAULT 0 CHECK (amount_credited >= 0);
CREATE TABLE purchase_returns (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts (id),
  order_id INTEGER NOT NULL REFERENCES purchase_orders (id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  invoice_id INTEGER REFERENCES supplier_invoices (id),
  return_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL,
  dpp INTEGER NOT NULL CHECK (dpp >= 0),
  ppn INTEGER NOT NULL CHECK (ppn >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  credit_applied INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_purchase_returns_receipt ON purchase_returns (receipt_id);
CREATE INDEX idx_purchase_returns_supplier ON purchase_returns (supplier_id);
CREATE TABLE purchase_return_lines (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES purchase_returns (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (return_id, product_id)
);
