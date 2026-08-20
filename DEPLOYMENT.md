# Sabacos — Deployment notes

Production deployment targets:

| App | Target | Env |
| --- | --- | --- |
| `apps/sabacos-server` | Any Node 24 runtime (Fly.io / Railway / Render / VPS) | `apps/sabacos-server/.env.example` |
| `apps/sabacos-web` | Static host (Cloudflare Pages / Netlify / Vercel) | `VITE_API_URL=https://<server>/api/v1` |
| `apps/sabacos-admin` | Static host | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

## Server

1. `npm ci`
2. Build: `npm run build -w @sabacos/server`
3. Set env vars (see `.env.example`).
4. Start: `npm run start -w @sabacos/server` (runs the built Hono app, exposing `/webhook` and `/api/v1/*`).
5. Register the webhook with Telegram (exact bot token):

   ```
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<server>/webhook"
   ```

   The bot sends `/start` with a Mini App button. Enable payments in **BotFather**:
   - `/mybots` → your bot → Payments → "Chapa" provider, then set the returned provider token as `CHAPA_PROVIDER_TOKEN`.

## Mini App & Admin

1. Build each app: `npm run build -w @sabacos-web` / `-w @sabacos-admin`.
2. Deploy the `dist/` folders to a static host behind HTTPS.
3. Point `WEBAPP_URL` / `ADMIN_DASHBOARD_URL` at them.
4. Set the Mini App menu button in BotFather → your bot → Bot Settings → Menu Button.

## Supabase

- Apply `supabase/migrations/0001_init.sql`.
- Create the `product-images` bucket (public).
- Create the admin auth user, then run the seed with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` to link `profiles.role = 'admin'`.
- Enable email auth (any email/password auth provider) for admin login.

## Going live

- **Chapa**: switch from the test provider token to the live provider token.
- **Prices**: all prices are integer halala — double check every product before launch.
- **Stock**: `finalize_order_payment()` decrements stock atomically; low-stock alerts surface in the admin dashboard.
- **Backups**: enable Supabase point-in-time recovery.

## Render (recommended)

A `render.yaml` blueprint at the repo root defines all three services (`sabacos-server` web service, `sabacos-web` + `sabacos-admin` static sites).

1. Push the repo (with `render.yaml`) to GitHub.
2. Render → **New +** → **Blueprint** → connect the `picka-chu/Sabacos` repo.
3. For each service, fill the `sync: false` env vars it needs.
4. After the first deploy, copy the server URL (`https://sabacos-server.onrender.com`) and set:
   - `sabacos-web` → `VITE_API_URL=https://sabacos-server.onrender.com/api/v1`
   - `sabacos-server` → `WEBHOOK_URL=https://sabacos-server.onrender.com`
   - `sabacos-server` → `WEBAPP_URL=https://sabacos-web.onrender.com`
5. **Redeploy** `sabacos-web` so the build inlines the new `VITE_API_URL`.

Notes:
- The webhook is registered automatically at startup (when `WEBHOOK_URL` is set), so no manual `setWebhook` is needed.
- The free plan sleeps after ~15 min idle; the bot will be unresponsive until Render wakes the service, and the first request after waking can be slow. Upgrade to a paid plan for always-on.
- After the server is up: apply `supabase/migrations/0001_init.sql`, create the `product-images` bucket, and run the seed on Render (Shell tab) with `npm run seed -w @sabacos/server`.

## Local dev

```bash
npm.cmd run dev -w @sabacos-server   # port 8788
npm.cmd run dev -w @sabacos-web      # port 5174, proxies /api → :8788
npm.cmd run dev -w @sabacos-admin    # port 5175, proxies /api → :8788
```

To exercise the bot locally, expose `:8788` with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8788`) and point the webhook there.