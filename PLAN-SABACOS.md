# Sabacos — Cosmetics Shopping Telegram Mini App

A production-ready cosmetics store delivered as a Telegram Mini App with native
Telegram invoice payments (Chapa provider), a Supabase Postgres backend, a
super-admin web dashboard, and a bilingual (English / Amharic) premium minimal UI.

## Product concept

Customers open the shop from a Telegram bot (inline "Open Shop" button), browse a
curated cosmetics catalog, add items to a cart, and pay directly in Telegram via a
native invoice charged through **Chapa** (the merchant provider registered with
BotFather). Payments, carts, orders, inventory, and admin controls all live in
Supabase. Admins run a separate web dashboard for products, orders, stock, stats,
and store settings.

## Architecture

```
Telegram                    @sabacos/web (Mini App)          @sabacos/admin (Dashboard)
  Bot <--webhook-->    @sabacos/server (Node + Hono + grammY)
                          |  REST /api/v1   |   Telegram Bot API
                          |                 +-- sendInvoice (Chapa provider token)
                   Supabase (Postgres + Storage)
                     profiles, categories, products, cart_items,
                     orders, order_items, payments, settings
```

Rules:
- **Payments are native Telegram invoices.** `sendInvoice` with the Chapa provider
  token obtained from BotFather; `pre_checkout_query` validates price/stock/order
  integrity server-side; `successful_payment` finalizes the order atomically.
- **Telegram identity for customers.** The Mini App sends `initData`; the server
  verifies the HMAC-SHA256 signature with the bot token, then upserts a profile.
- **Admin identity via Supabase Auth** (email + password JWT) mapped to `profiles.role`.
- **Money is integer halala.** `1 ETB = 100 halala`. All prices stored/transported as
  integer amounts; formatting only at the UI edge (avoids float drift).
- **Every order mutation is idempotent and re-validated** against live product prices
  and stock before invoicing and again on payment.

## Workspaces

| Workspace        | Package           | Purpose                                   |
|------------------|-------------------|-------------------------------------------|
| `packages/core`  | `@sabacos/core`   | Zod schemas, types, i18n (EN/AM), currency, status machine |
| `apps/server`    | `@sabacos/server` | grammY bot + Hono REST API + webhook      |
| `apps/web`       | `@sabacos/web`    | Telegram Mini App (React + Vite)          |
| `apps/admin`     | `@sabacos/admin`  | Super-admin web dashboard (React + Vite)  |

## Data model (Supabase Postgres)

- `profiles` — id (uuid), telegram_id (unique), telegram_username, first_name,
  last_name, phone, role (`customer|admin`), created_at, updated_at.
- `categories` — id, slug (unique), name_en, name_am, sort_order, is_active.
- `products` — id, category_id, sku (unique), name_en, name_am, description_en,
  description_am, price_halala (int), compare_at_halala (int, nullable), stock (int),
  image_urls (text[]), is_active, is_featured, created_at, updated_at.
- `cart_items` — id, profile_id, product_id, qty, unique(profile_id, product_id).
- `orders` — id, order_no (readable, e.g. `SB-000123`), profile_id, status, subtotal_halala,
  delivery_fee_halala, total_halala, customer_name, phone, address, note,
  invoice_payload (telegram), telegram_payment_charge_id, provider_payment_charge_id,
  payment_status, created_at, updated_at.
- `order_items` — id, order_id, product_id, name_snapshot (en/am jsonb), sku, price_halala,
  qty, subtotal_halala.
- `payments` — id, order_id, amount_halala, currency, provider, status, telegram_payment_id,
  provider_charge_id, created_at.
- `settings` — key (pk), value (jsonb): delivery_fee_halala, free_delivery_threshold_halala,
  shop_name, shop_phone, admin_channel_id, currency.

Order status machine: `pending_payment → paid → processing → shipped → delivered`,
with `cancelled` (or `refunded` after payment) as terminal exits. Payment status:
`pending → success | failed | refunded`.

## Bot & payments flow

1. `/start` → brand greeting + inline `web_app` button ("Open Shop").
2. Checkout in the Mini App → `POST /api/v1/checkout` → server creates `orders` row
   (`pending_payment`), re-validates stock/price, calls `sendInvoice` (payload = order id,
   currency `ETB`, provider token = Chapa).
3. User pays in chat → `pre_checkout_query` → server verifies the order is still open,
   prices match, stock exists → `answerPreCheckoutQuery(true/false)`.
4. `successful_payment` → transaction: order → `paid`, order_items written, stock
   decremented, payment row inserted, admin channel notified, receipt sent to user.
5. Mini App polls `GET /api/v1/orders/:id` until `paid`, then shows confirmation.

## REST API (Hono, `/api/v1`)

- `POST /auth/telegram` — validate initData, upsert profile → profile.
- Catalog (public): `GET /categories`, `GET /products?category&q&featured&page`,
  `GET /products/:id`.
- Cart (user): `GET|POST|PATCH|DELETE /cart`, `DELETE /cart`.
- Checkout (user): `POST /checkout`; `GET /orders`, `GET /orders/:id`.
- Admin (Supabase JWT + role=admin):
  - `GET /admin/stats`, `GET /admin/orders`, `PATCH /admin/orders/:id/status`.
  - CRUD `/admin/categories`, CRUD `/admin/products`, `POST /admin/products/:id/images`.
  - `GET|PUT /admin/settings`.
- `GET /health`.

## Mini App UI (premium minimal)

- Telegram WebApp SDK: theme vars, light/dark, MainButton/back handling, safe areas.
- Design tokens: ivory canvas, deep-charcoal ink, blush-rose accent, warm gold detail,
  serif display for the Sabacos wordmark, generous spacing, 16–20px radii, soft shadows.
- Screens: Home (brand hero + category chips + featured), Shop (grid + filters),
  Product (gallery, price, stock, qty, add-to-cart), Cart, Checkout (contact/address +
  Pay via Telegram), Orders (list + detail with status timeline), Profile
  (identity, saved address, EN/AM toggle).
- Bottom tab bar: Home / Shop / Cart / Orders / Profile.

## Admin Dashboard

- Supabase Auth login → sidebar layout: Dashboard, Products, Categories, Orders,
  Settings.
- Dashboard: revenue (today/7d/all), order counts, low-stock alerts, recent orders.
- Products: table + editor with image upload (Supabase Storage), stock, pricing,
  EN/AM fields, featured/active toggles.
- Orders: filterable table, detail drawer, status transitions, payment info.
- Settings: delivery fee, free-delivery threshold, shop contact, admin channel.

## Testing & hardening

- Core: vitest (currency math, schemas, status machine, i18n keys parity).
- Server: vitest with mocked Supabase + mocked grammY (initData validation,
  checkout, pre_checkout, successful_payment, admin RBAC, idempotency).
- Web: unit tests for stores/helpers + Playwright smoke (boot, catalog, add-to-cart).
- Hardening: zod-validated env at boot, centralized error envelope, RBAC on every
  admin route, HMAC + webhook validation, idempotent payment finalization,
  rate-limit on checkout, README + deploy notes.

## Roadmap

| Step | Deliverable | Status |
|---|---|---|
| 1 | Master plan + workspace scaffold | pending |
| 2 | Core package + unit tests | pending |
| 3 | Supabase schema + migrations + seed | pending |
| 4 | Server: bot + REST API + payments | pending |
| 5 | Mini App frontend | pending |
| 6 | Admin dashboard | pending |
| 7 | Test pass (core/server/web) | pending |
| 8 | Hardening + docs + production build | pending |