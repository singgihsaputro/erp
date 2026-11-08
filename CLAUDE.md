# Working on this ERP

An ERP for Indonesian retail and distribution SMEs (UMKM): a shop or wholesaler
that buys from suppliers, keeps stock in one or more warehouses, and sells over
the counter (POS) and on invoice. It grows by **at least one feature a night**,
in the order `ROADMAP.md` lists them.

These conventions hold for every night. Changing one is a decision, not a
side effect: if a feature truly needs a different approach, say so in the
CHANGELOG entry and update this file in the same change.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, `strict: true` |
| API | [Hono](https://hono.dev) on `@hono/node-server`, request validation with `zod` |
| Database | SQLite through `better-sqlite3` |
| Web | React 19, Vite, Tailwind CSS v4, React Router, TanStack Query |
| Tests | Vitest — API tests call `app.request()` against a fresh in-memory database |
| Runtime | Node 22 |

npm workspaces, one repository:

```
apps/api/            Hono app; src/app.ts builds the app, src/server.ts listens
apps/api/migrations/ NNN_description.sql, applied in order on boot
apps/web/            React app; one folder per module under src/modules/
packages/shared/     zod schemas and the types inferred from them, used by both
docs/screenshots/    one PNG per feature that has a screen
```

## Root scripts — these must keep working

| Script | Does |
|---|---|
| `npm run dev` | API on :3001 and web on :5173 together; web proxies `/api` |
| `npm run build` | builds every workspace |
| `npm test` | every test, once, no watch |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run verify` | `typecheck`, then `test`, then `build`; stops at the first failure |
| `npm run seed` | resets the local database and loads the demo data |
| `npm run samples` | rewrites the sample supplier PDFs in `mock/invoices/` |
| `npm run screenshots` | signs in and walks the app in Chrome, saving `docs/screenshots/` (needs `npm run dev` on a fresh seed) |

The nightly workflow runs `npm ci && npm run verify` itself after the agent
finishes and refuses to publish the night if either fails, so commit
`package-lock.json` and never leave `verify` red.

Each night is worked as an issue and a pull request: the workflow opens an issue
for the next ROADMAP.md line and checks out `night/<date>-<id>` before the agent
starts; afterwards it opens a pull request that closes the issue, waits for
`.github/workflows/ci.yml` to pass on it, and squash-merges it as
`Night <date>: <feature> (#<pr>)`. One feature per pull request.

## Data rules

- **Money is an integer number of Rupiah.** No floats, no cents. Format with
  `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`.
- **Quantities are integers in thousandths of the base unit** (`qty_milli`), so
  1.5 kg of rice is `1500`. Products declare a base unit; other units (box of 12)
  are conversions to it.
- **Stock is a ledger.** Every change is a row in `stock_moves` (product,
  warehouse, signed quantity, unit cost, source document). On-hand is the sum of
  moves. Never update a stock number in place.
- **Costing is moving average**, recomputed on every inbound move.
- **Posted documents are immutable.** A posted invoice, receipt or journal is
  corrected by a reversing document, never edited or deleted. Drafts can change.
- **Document numbers** follow `PREFIX/YYYY/MM/NNNN` (e.g. `INV/2026/11/0007`),
  sequential per prefix per month, prefixes configurable in settings.
- **Tax** is PPN at the rate in company settings (default 11%). Prices are
  stored tax-exclusive; documents show DPP, PPN and total.
- **Dates** are stored as ISO strings; business days are in `Asia/Jakarta`.
- Every table has `id INTEGER PRIMARY KEY`, `created_at`, `updated_at`.
- **Migrations are append-only.** Never edit one that has shipped; add the next
  number.

## Sign-in and roles

- Every endpoint except `/api/health` and `/api/auth/*` sits behind
  `requireSignIn` (registered in `apps/api/src/app.ts`); route handlers read
  the user with `c.get('user')`. Mount new route groups after that guard.
- Restrict a module with `requireRole(...)` from `apps/api/src/auth.ts`, and give
  its sidebar item the same `roles` in `apps/web/src/App.tsx`. Roles are listed
  in `ROLES` in `packages/shared/src/auth.ts`; the super admin can do everything.
- The bootstrap account is `admin` / `superuser` (Super Admin), created only on a
  database with no users. Never change that rule or log passwords.
- API tests sign in with `signIn(createApp(db))` from `apps/api/test/helpers.ts`,
  which returns a client that sends the session cookie. Test the 401 for a new
  route group, and the 403 when it is role-restricted.

## Rules for every feature

1. **API first, validated.** Each endpoint validates its input with a zod schema
   from `packages/shared` and answers with sensible status codes (400 invalid,
   401 not signed in, 403 role not allowed, 404 missing, 409 conflict such as
   insufficient stock or an already-posted document, 422 unreadable upload).
2. **Tested.** Each feature adds API tests for the happy path, the validation
   errors, and the business rule that matters most (e.g. "cannot deliver more
   than was ordered"). Existing tests keep passing — never delete or weaken one
   to make a night go green.
3. **A real screen.** The feature is reachable from the sidebar, works against
   the real API, and handles loading, empty and error states.
4. **Demo data.** Extend the seed so the feature has something realistic to show:
   Indonesian product names, Rupiah prices, made-up companies and people — never
   a real business.
5. **Mock only.** No live third-party calls and no secrets. Anything external
   (payment gateways, e-Faktur, marketplaces) sits behind an interface with a
   mock implementation reading `mock/*.json`.
6. **No placeholders.** No `TODO`, `FIXME`, stubbed function bodies or lorem
   ipsum. If tonight's feature is too big, deliver a complete smaller slice and
   split the rest into a new roadmap line right after it.
7. **Screenshot.** If the feature has a screen, start the app, load the seed, and
   save `docs/screenshots/<ID>-<slug>.png` with `playwright-core` using
   `channel: 'chrome'` (Google Chrome is preinstalled on the runner). Add the
   step to `scripts/screenshots.mjs`, which already signs in as the super admin.
   Skip it, and say so in the CHANGELOG, if it genuinely cannot be captured.
8. **Record it.**
   - `ROADMAP.md`: change the item's `- [ ]` to `- [x]` and append ` — <night date>`.
   - `CHANGELOG.md`: a new entry at the top: what a user can now do, how to try
     it from the seeded demo, and any limitation.
   - `README.md`: keep the "Modules" list current, and the parts of
     "Architecture" a feature changes: the data model diagram when it adds a
     table, the repository layout when it adds a module, the roles table when it
     restricts something, and the decisions table when it makes one.

## UI

English labels, with the Indonesian business terms people actually use where
they are standard: Faktur, Surat Jalan, NPWP, PPN, Stock Opname. Desktop-first
admin layout (sidebar, header, content), but every screen must stay usable on a
phone. Tables paginate past 50 rows. Destructive actions confirm first.
