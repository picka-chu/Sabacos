# Motion Studio monorepo

A TypeScript monorepo (npm workspaces) hosting two independent products:

- **Motion Studio** (`packages/core`, `apps/server`, `apps/web`) — the original project.
- **Sabacos** — a cosmetics shopping Telegram Mini App (see below).

## Workspaces

| Package | Description |
| --- | --- |
| `packages/core` | Motion Studio shared core |
| `apps/server` | Motion Studio API server |
| `apps/web` | Motion Studio web app |
| `packages/sabacos-core` | Sabacos shared domain: types, zod schemas, money (halala), i18n (EN/AM), initData HMAC, totals |
| `apps/sabacos-server` | Sabacos Hono API + grammY bot (telegram invoices via Chapa) |
| `apps/sabacos-web` | Sabacos Telegram Mini App (React + Vite + wouter) |
| `apps/sabacos-admin` | Sabacos super-admin web dashboard |

## Commands

```bash
npm run typecheck   # typecheck every workspace
npm run test        # run all workspace tests
npm run build       # typecheck + build all workspaces
```

> On Windows PowerShell, use `npm.cmd` instead of `npm` (the `.ps1` shim is blocked).

---

# Sabacos

Premium cosmetics shopping bot for Telegram with native invoice payments.

- **Storefront**: Telegram Mini App (`apps/sabacos-web`) — bilingual EN/አማርኛ, ETB.
- **Payments**: native Telegram invoices via **Chapa** (`provider_token` from BotFather).
- **Backend**: `apps/sabacos-server` — Hono REST API + grammY bot webhook.
- **Database**: Supabase (Postgres) with RLS, atomic order finalization via `finalize_order_payment()`.
- **Admin**: `apps/sabacos-admin` — email/password login (Supabase Auth), manage products, categories, orders, settings.

## Money

All monetary values are stored and transported as integer **halala** (`1 ETB = 100 halala`).
Formatting happens only at the UI edge (`formatETB`). Minimum order subtotal: `10,000` halala (100 ETB).

## Order lifecycle

```
pending_payment → paid → processing → shipped → delivered
        ↘ cancelled (terminal)
```

Payments: `pending → success | failed | refunded`.

## Setup

### 1. Supabase

Apply `supabase/migrations/0001_init.sql` (schema, RLS, `next_order_seq()`, `finalize_order_payment()`, `product-images` storage bucket).

### 2. Server env

See `apps/sabacos-server/.env.example`:

| Var | Description |
| --- | --- |
| `BOT_TOKEN` | Telegram bot token |
| `CHAPA_PROVIDER_TOKEN` | Chapa provider token from BotFather (starts with `284685063:TEST:...`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS; server only) |
| `WEBAPP_URL` | URL of the deployed Mini App |
| `ADMIN_DASHBOARD_URL` | URL of the deployed admin dashboard |
| `WEBHOOK_URL` | (prod) HTTPS callback URL → `/webhook` |
| `WEBHOOK_SECRET` | Required in production; shared secret for Telegram webhook authentication |
| `ADMIN_CHANNEL_ID` | optional Telegram channel/chat to notify on orders |
| `PORT` | default `8788` |

### 3. Seed

```bash
npm run seed -w @sabacos/server
```

Seeds categories, sample products, settings, and (if `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` are set) an admin profile linked to a Supabase Auth user.

### 4. Frontends

- `apps/sabacos-web`: set `VITE_API_URL` (default `/api/v1`). Dev proxy → `localhost:8788`.
- `apps/sabacos-admin`: set `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

### 5. Bot

Use BotFather to set the Mini App menu button, the invoice provider token, and point the webhook at the server.

## Webhooks / payments flow

1. Mini App calls `POST /api/v1/checkout` (Telegram initData auth) → order created `pending_payment`.
2. Server calls `sendInvoice` with Chapa `provider_token`.
3. Telegram `pre_checkout_query` → server validates order status/amount/currency/stock.
4. `successful_payment` → `finalize_order_payment()` RPC atomically marks order paid and clears stock.
5. Admin channel notified; receipt sent to the customer; Mini App polls `GET /api/v1/orders/:id`.

## Tests

```bash
npm run test -w @sabacos/core      # 25 tests (money, status, i18n, initData, schemas, totals)
npm run test -w @sabacos/server    # 10 tests (checkout, env)
npm run e2e -w @sabacos/web        # Playwright smoke tests (uses system Chrome channel)
```

See `DEPLOYMENT.md` for production deployment notes.