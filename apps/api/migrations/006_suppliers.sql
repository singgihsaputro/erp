CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  npwp TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT 'cash' CHECK (payment_terms IN ('cash', 'net_14', 'net_30')),
  note TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_suppliers_name ON suppliers (name COLLATE NOCASE) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX idx_suppliers_npwp ON suppliers (npwp) WHERE npwp != '' AND archived_at IS NULL;
