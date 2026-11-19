-- A supplier payment settles one or several invoices of one supplier. Each allocation adds to the
-- invoice's amount_paid. Posted payments are never edited or deleted.
CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('transfer', 'cash', 'giro')),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL CHECK (total > 0),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_supplier_payments_supplier ON supplier_payments (supplier_id);
CREATE TABLE supplier_payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES supplier_payments (id),
  invoice_id INTEGER NOT NULL REFERENCES supplier_invoices (id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX idx_supplier_payment_alloc_invoice ON supplier_payment_allocations (invoice_id);
