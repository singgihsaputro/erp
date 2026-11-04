CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per alternative unit of a product: 1 <unit> = factor_milli / 1000 base units.
CREATE TABLE product_units (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  unit TEXT NOT NULL COLLATE NOCASE REFERENCES units (code),
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (product_id, unit)
);

ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories (id);
CREATE INDEX idx_products_category ON products (category_id);

INSERT INTO units (code, name) VALUES
  ('pcs', 'Pieces'), ('kg', 'Kilogram'), ('gram', 'Gram'), ('liter', 'Liter'),
  ('meter', 'Meter'), ('pack', 'Pack'), ('box', 'Box'), ('dus', 'Dus'),
  ('karung', 'Karung'), ('renceng', 'Renceng'), ('lusin', 'Lusin');
