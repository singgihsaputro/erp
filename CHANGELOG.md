# Changelog

Newest night first. Each entry says what a user can now do, how to try it from
the seeded demo, and any limitation.

## 2026-11-08 — F008 User management

**What you can do now**
- The Super Admin opens **Users** (sidebar, *Administration*) to see every account with role, status and last sign-in, and to search by name or username.
- Add accounts with the roles Owner, Admin, Cashier, Warehouse (or another Super Admin), edit a name or role, reset a password, and disable or re-enable an account.
- Resetting a password or disabling an account signs that person out everywhere at once.
- Other roles do not see the menu item and get 403 from the API.

**Try it**: `npm run seed && npm run dev`, sign in as `admin` / `superuser`, open *Users*: four active demo staff and one disabled cashier (`rina.kasir`). Demo staff use password `demo-12345`.

**API**: `GET/POST /api/users` (`?q=`), `GET/PUT /api/users/:id`, `POST /api/users/:id/reset-password|disable|enable`. Usernames are unique, case-insensitive (409). You cannot disable yourself, and the last active Super Admin cannot be disabled or demoted (409). Passwords need 8+ characters.

**Limitations**: accounts are never deleted, only disabled. Per-module role rules from earlier nights are unchanged; the demo staff are seeded after the super admin so the first-start bootstrap rule is untouched.

## 2026-11-07 — F007 Customers

**What you can do now**
- Open **Customers** in the sidebar for the customer directory: name, contact
  person, phone, email, address, NPWP, credit limit (Rupiah), payment terms and
  price tier (Retail, Grosir, Member).
- Search by name, contact, NPWP or phone, filter by price tier; the list paginates past 50 rows.
- Add, edit, archive and restore customers (owner, admin and super admin; other
  roles can look but get 403 on changes).
- NPWP is checked (15 or 16 digits) and stored formatted.

**Try it**: `npm run seed && npm run dev`, sign in, open *Customers*: six
customers across all three tiers; tick *Show archived* for a dormant one.

**API**: `GET/POST /api/customers` (`?q=`, `?tier=`, `?archived=1`), `GET/PUT /api/customers/:id`,
`POST /api/customers/:id/archive|restore`. Name and NPWP must be unique among
active customers (409); credit limit is a non-negative whole number of Rupiah.

**Limitations**: credit limit, payment terms and price tier are recorded but not
yet enforced or applied; that arrives with sales documents and tier pricing.

## 2026-11-06 — F006 Suppliers

**What you can do now**
- Open **Suppliers** in the sidebar for the supplier directory: name, contact
  person, phone, email, address, NPWP and payment terms (Cash, Net 14, Net 30).
- Search by name, contact, NPWP or phone; the list paginates past 50 rows.
- Add, edit, archive and restore suppliers (owner, admin and super admin; other
  roles can look but get 403 on changes).
- NPWP is checked (15 or 16 digits) and stored formatted, e.g. `01.234.567.8-412.000`.

**Try it**: `npm run seed && npm run dev`, sign in, open *Suppliers*: the three
suppliers of the sample PDF invoices plus one more; tick *Show archived* for a
discontinued one.

**API**: `GET/POST /api/suppliers` (`?q=`, `?archived=1`), `GET/PUT /api/suppliers/:id`,
`POST /api/suppliers/:id/archive|restore`. Name and NPWP must be unique among
active suppliers (409); restoring one that now collides is refused.

**Limitations**: suppliers are not yet linked to the invoice inbox or to
purchase orders (F016 onwards); payment terms are recorded but not yet used.

## 2026-11-05 — F005 Warehouses

**What you can do now**
- Open **Warehouses** in the sidebar to see every stock location as a card with
  its code, address, number of products, units on hand and stock value.
- Add and edit warehouses, make one the default, and archive or restore them
  (owner, admin and super admin; other roles can look but get 403 on changes).
- **View stock** lists on-hand per product in that warehouse.
- Built as part of this night because it was missing: the **stock ledger table**
  `stock_moves` (product, warehouse, signed `qty_milli`, `unit_cost`, source).
  On-hand per warehouse is the sum of its moves.

**Try it**: `npm run seed && npm run dev`, sign in, open *Warehouses*: Toko
Utama (default), Gudang Belakang and Gudang Cikarang, each with its own opening
stock.

**API**: `GET/POST /api/warehouses`, `GET/PUT /api/warehouses/:id`,
`GET /api/warehouses/:id/stock`, `POST /api/warehouses/:id/make-default|archive|restore`,
`?archived=1` to list archived ones. Archiving is refused (409) for the default
warehouse or one still holding stock; the code is locked once a warehouse has moves.

**Limitations**: there is no screen or endpoint yet to post stock movements
(opening balances, adjustments and transfers arrive in F010–F012); the demo's
opening stock is seeded straight into the ledger. Stock value uses each move's
unit cost, not yet the moving average.

## 2026-11-04 — F004 Categories and units

**What you can do now**
- Open **Categories & units** in the sidebar to add, rename and delete product
  categories and units of measure. A category or unit that products still use
  cannot be deleted (409).
- Give a product a category in the product form, and filter the product list
  by category.
- Define a product's other units as conversions to its base unit: *1 dus =
  40 pcs*, *1 karung = 25 kg*. Quantities may have up to three decimals and are
  stored as thousandths (`factor_milli`, 40 pcs = `40000`), like all quantities.
- A product's base unit must now be a defined unit (eleven common ones ship in
  the migration: pcs, kg, gram, liter, meter, pack, box, dus, karung, renceng,
  lusin).

**Try it**: `npm run seed && npm run dev`, sign in, open *Categories & units*,
then Products → Edit "Mi Instan Goreng Spesial 85 g" to see 1 dus = 40 pcs.

**API**: `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id`;
`GET/POST /api/units`, `PUT/DELETE /api/units/:id`; `GET/PUT
/api/products/:id/units` (PUT replaces the whole set); `category_id` on
products and as a list filter.

**Limitations**: categories are flat (no tree); a unit's code cannot be renamed,
only its display name; a product's base unit cannot change while it has
conversions. The conversions are stored but no document uses them yet — they
are applied once purchasing and sales documents arrive.

## 2026-11-04 — F002 Sign-in and F003 PDF invoice extractor

Built together in one session rather than by the nightly run, on request.

### F002 Sign-in and the super admin

**What you can do now**
- Sign in with a username and password. On a database with no users the API
  creates **`admin` / `superuser`** with the **Super Admin** role.
- Sign out, and change your password from the header (8 characters or more);
  changing it signs you out on every other device.
- Every screen and every API endpoint except `/api/health` and
  `/api/auth/login` now needs a signed-in user; an expired session drops you
  back to the sign-in screen where you were.

**How it works**: passwords are salted scrypt hashes; sessions are random
tokens in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), stored only as
a SHA-256 hash and valid for 7 days. Five wrong passwords lock a username for
15 minutes. A wrong username and a wrong password get the same answer.
Roles exist in code (super admin, owner, admin, cashier, warehouse) and
endpoints check them with `requireRole`; only the super admin can be created
until F008 (user management).

**Try it**: `npm run seed && npm run dev`, open http://localhost:5173 and sign
in as `admin` / `superuser`.

**API**: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`,
`POST /api/auth/password`. 400 invalid, 401 not signed in or wrong password,
403 role not allowed, 429 locked after five failures.

**Limitations**: no user management screen yet (F008); the lockout is kept in
memory, so a restart clears it.

### F003 PDF invoice extractor

**What you can do now**
- Upload a supplier's PDF invoice (drag and drop, or several at once) in
  **Purchasing → Invoice inbox**.
- The ERP reads the supplier name and NPWP, invoice number, invoice and due
  dates (including "Jatuh Tempo: 30 hari"), every line (description, quantity
  with kg decimals, unit, unit price, amount) and the subtotal, discount, PPN
  and total, in Indonesian or English layouts and number formats.
- Each line is matched to a catalogue product: by SKU or barcode in the row
  first, otherwise by name, and left unmatched when unsure.
- The review screen shows the PDF beside the extracted fields. Every field says
  which line of the PDF it came from, or that it was not found. Checks run as
  you type: lines must add up to the subtotal, and subtotal − discount + PPN to
  the total; PPN at the stated rate, line arithmetic, unmatched products and a
  missing NPWP are warnings.
- Confirm (blocked while there are errors), reject with a reason, reopen a
  rejected one, or delete one that is not confirmed. A confirmed invoice can no
  longer change. The same file cannot be uploaded twice, and another invoice
  with the same supplier and number is flagged as a possible duplicate.

**Try it**: the seed puts two invoices in the inbox, one to review and one
confirmed. Upload `mock/invoices/berkah-niaga-grosir-CBN-2611-0087.pdf` to see a
fresh one read: it has a discount, a wrapped line and a product that is not in
the catalogue. `npm run samples` rewrites the three sample PDFs.

**API**: `GET/POST /api/invoice-extractions` (multipart, field `file`),
`GET/PUT /api/invoice-extractions/:id`, `GET …/:id/file`,
`POST …/:id/confirm|reject|reopen`, `DELETE …/:id`. Super admin, owner and
admin only. 400 invalid, 404 missing, 409 duplicate file or wrong state or
failed checks, 413 over 10 MB, 415 not a PDF, 422 unreadable or no text layer.

**Limitations**: reads PDFs that have a text layer; scanned images are refused
with a clear message until F052 (on-device OCR). Extraction is pattern-based,
so an unusual layout may need more correction by hand. A confirmed extraction
is not yet a supplier invoice in the books; F018 turns it into one.

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
