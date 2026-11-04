# Changelog

Newest night first. Each entry says what a user can now do, how to try it from
the seeded demo, and any limitation.

## 2026-11-03 — F001 Products (plus the app skeleton)

**What you can do now**
- Manage the product catalogue: search by name, SKU or barcode, create and edit
  products, archive them (with a confirmation) and restore them from the
  Archived filter. Tables paginate at 50 rows.
- The sidebar layout works on a phone (menu button) as well as on desktop.

**Try it**: `npm ci && npm run seed && npm run dev`, then open
http://localhost:5173. The seed loads 27 active products (Indonesian groceries
and household goods, prices in Rupiah) and one archived product.

**Also built tonight (the skeleton)**: npm workspaces (`apps/api`, `apps/web`,
`packages/shared`), Hono API with zod validation, SQLite with append-only
migrations (`001_products.sql`), React/Vite/Tailwind web app, Vitest, and the
root scripts `dev`, `build`, `test`, `typecheck`, `verify`, `seed`.
`npm run screenshots` re-captures `docs/screenshots/F001-products.png` against a
running app.

**API**: `GET /api/products` (`q`, `status`, `page`, `page_size`),
`GET/PUT /api/products/:id`, `POST /api/products`, `POST /api/products/:id/archive`
and `/restore`. 400 invalid input, 404 missing, 409 duplicate SKU/barcode or
repeated archive/restore.

**Limitations**: base units are free text with a suggested list until F002
(units and conversions); products have no category yet; there is no sign-in
until F006. Barcodes are optional and unique when present.
