CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  npwp TEXT NOT NULL DEFAULT '',
  credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms TEXT NOT NULL DEFAULT 'cash' CHECK (payment_terms IN ('cash', 'net_14', 'net_30')),
  price_tier TEXT NOT NULL DEFAULT 'retail' CHECK (price_tier IN ('retail', 'grosir', 'member')),
  note TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_customers_name ON customers (name COLLATE NOCASE) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX idx_customers_npwp ON customers (npwp) WHERE npwp != '' AND archived_at IS NULL;
