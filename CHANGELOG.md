# Changelog

Newest night first. Each entry says what a user can now do, how to try it from
the seeded demo, and any limitation.

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
