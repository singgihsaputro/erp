# Changelog

Newest night first. Each entry says what a user can now do, how to try it from
the seeded demo, and any limitation.

## 2026-11-12 — F012 Stock transfers

**What you can do now**
- Open **Stock transfers** (sidebar, *Inventory*) to list transfers between warehouses, optionally by status (In transit, Received, Cancelled); click a number to see its lines.
- Owners, admins, warehouse staff and the super admin can send a **New transfer**: choose source and destination warehouses and several products. The stock leaves the source immediately and is *in transit* (in no warehouse) until someone presses **Receive** at the destination. A transfer still in transit can instead be **cancelled**, which returns the stock to the source. Both ask for confirmation. Other roles can read but get 403.
- Each transfer gets a number from the *Stock transfer* prefix and shows in product histories as *Transfer sent / received / cancelled*.

**Try it**: `npm run seed && npm run dev`, sign in as `admin` / `superuser`, open *Stock transfers* (one received, one in transit), open the in-transit one and receive it, then check *Stock* for Beras Premium in each warehouse.

**API**: `GET /api/stock/transfers[?status=&warehouse_id=&page=]`, `GET /api/stock/transfers/:id`, `POST /api/stock/transfers`, `POST /api/stock/transfers/:id/receive`, `POST /api/stock/transfers/:id/cancel`. Sending more than the source holds is 409; same source and destination is 400; receiving or cancelling a transfer that is not in transit is 409. Migration 011 adds `stock_transfers` and `stock_transfer_lines`.

**Limitations**: a transfer is received in full (no partial receipts); quantities are in the base unit only. Goods are booked at the average cost when sent, so product average cost is unchanged by a transfer.

## 2026-11-11 — F011 Stock adjustments

**What you can do now**
- Open **Stock adjustments** (sidebar, *Inventory*) to list every adjustment, newest first, optionally for one warehouse; click a number to see its lines.
- Owners, admins, warehouse staff and the super admin can post a **New adjustment**: choose a warehouse and a reason (Damaged, Lost, Expired or Correction), add several products and post. Damaged, lost and expired only remove stock; a Correction may add (at a cost you enter, default the current average) or remove.
- Each adjustment gets a number from the *Stock adjustment* prefix (`ADJ/YYYY/MM/NNNN` by default) and appears in the product's movement history as *Stock adjustment*. Other roles can read but get 403 on posting.

**Try it**: `npm run seed && npm run dev`, sign in as `admin` / `superuser`, open *Stock adjustments* (three seeded ones), then *Stock* and click *Mie Goreng* to see the removal in its ledger.

**API**: `GET /api/stock/adjustments[?warehouse_id=&page=]`, `GET /api/stock/adjustments/:id`, `POST /api/stock/adjustments`. Removing more than is on hand in that warehouse is 409; a product twice in one document is 400; the whole document posts or nothing does. Migration 010 adds `stock_adjustments` and `stock_adjustment_lines`; `postAdjustment()` in `apps/api/src/adjustments.ts` is reusable (stock opname, F014, will post through it).

**Limitations**: posted adjustments cannot be edited or deleted; correct one with another. Quantities are in the base unit only. Removals are booked at the product's average cost across warehouses.

## 2026-11-10 — F010 Opening stock and the stock ledger

**What you can do now**
- Open **Stock** (sidebar, *Inventory*) to see on-hand per product per warehouse with moving-average cost and value; search by name, SKU or barcode, filter by warehouse.
- Click a product to see its full movement history, newest first, with the running balance and the moving-average cost after each move (optionally for one warehouse only).
- Owners, admins, warehouse staff and the super admin can **Enter opening stock** for a warehouse (several products at once, decimal quantities such as 1,5 kg). Other roles can read but get 403.

**Try it**: `npm run seed && npm run dev`, sign in as `admin` / `superuser`, open *Stock* and click *Beras Premium Pandan Wangi 5 kg*: two opening balances and a restock at Rp71.000 move the average cost to Rp68.882.

**API**: `GET /api/stock`, `GET /api/stock/products/:id/moves[?warehouse_id=]`, `POST /api/stock/opening`. `postStockMove()` in `apps/api/src/stock.ts` is the one way to write the ledger: inbound moves re-average `products.cost` over all warehouses, outbound moves book at the current average. Migration 009 adds a unique index so a product has one opening balance per warehouse (409 otherwise).

**Limitations**: opening balances cannot be edited or removed; corrections arrive with stock adjustments (F011). Quantities are entered in the base unit only. Average cost is per product across warehouses, not per warehouse.

## 2026-11-09 — F009 Company settings

**What you can do now**
- Open **Company settings** (sidebar, *Administration*) to set the company name, address, phone, email, NPWP, logo and PPN rate (default 11%).
- Change the prefix of each kind of document (Faktur `INV`, Surat Jalan `SJ`, purchase order `PO`, journal `JV`, …). The screen shows the next number each would get this month.
- The company name and logo now show in the header instead of a hard-coded name.
- Owners, admins and the super admin can edit; other roles can read (403 on changes).

**Try it**: `npm run seed && npm run dev`, sign in as `admin` / `superuser`, open *Company settings*. Try PPN 12 or changing `INV` to `FK`.

**API**: `GET/PUT /api/settings/company`, `GET/PUT /api/settings/document-prefixes`. The PPN rate is stored in basis points (`ppn_rate_bp`, 1100 = 11%) so it stays an integer. Logos are PNG/JPEG/WebP data URLs under about 200 KB (SVG is refused). Two document types cannot share a prefix (400 within one request, 409 against an existing one).

**Also built**: `nextDocumentNumber(db, type)` in `apps/api/src/settings.ts` issues `PREFIX/YYYY/MM/NNNN`, sequential per prefix per month in Asia/Jakarta time. Later document features use it.

**Limitations**: nothing issues document numbers yet and no document uses the PPN rate yet; those arrive with the document features. Changing a prefix does not renumber existing documents. Migration 008 seeds the name "Toko Maju Jaya".

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
