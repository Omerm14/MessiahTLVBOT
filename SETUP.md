# Messiah setup (one time, about 15 minutes)

Messiah runs on free tiers. Cloudflare holds the app, the API and the database and handles sign-in; GitHub Actions runs the collector. After this setup, every `git push` to `main` deploys.

## 1. Cloudflare account and database
1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Create an API token: **My Profile → API Tokens → Create Token → Custom token** with these permissions:
   - Account → **D1 → Edit**
   - Account → **Cloudflare Pages → Edit**

   Copy the token and your **Account ID**, shown on the dashboard's right sidebar.
3. Create the database from this folder, then copy the printed `database_id` into `wrangler.toml`:
   ```bash
   npx wrangler d1 create messiah
   ```
   Alternatively, send me the token through the session's secure credential form and I'll do it.

## 2. Connect the repository to Cloudflare Pages
1. **Workers & Pages → Create → Pages → Connect to Git** and choose `MessiahTLVBOT`.
2. Production branch `main`. Leave the build command empty. Build output directory: `docs`.
3. In the project, open **Settings → Bindings → D1 database** and add binding `DB` → `messiah`.
4. In **Settings → Variables**, set `OWNER_EMAIL` to your email. Leave `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` for step 3.

## 3. Sign-in with Cloudflare Access (Google or email code)
1. **Zero Trust** (free plan, up to 50 users) → **Settings → Authentication**. Add **Google**. The **One-time PIN** email login is on by default.
2. **Access → Applications → Add → Self-hosted**:
   - Domains: your `*.pages.dev` address. If you add a custom domain later, add it here too.
   - Policy: **Allow**, include **Emails ending in** `@` (anyone who can sign in). Messiah itself decides who is invited.
   - Session duration: **1 month**.
3. Add a second application, **Bypass**, for the paths `/api/ingest` and `/api/telegram`. Those two check their own keys.
4. Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`) into the Pages variables `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`.

## 4. GitHub secrets (repository → Settings → Secrets and variables → Actions)
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: from step 1.
- `ANTHROPIC_API_KEY`: for the AI junk filter (optional).
- `TELEGRAM_BOT_TOKEN`: already set for the current bot.

## 5. First run
1. Push to `main`. The **Database** workflow applies the tables, and Pages deploys the app.
2. Open your `*.pages.dev` address, sign in with `OWNER_EMAIL`, and open **Settings** to set your search and invite people.

## Local development
```bash
npm install
npx wrangler d1 migrations apply messiah --local
npx wrangler d1 execute messiah --local --file dev/seed.sql   # demo data
npx wrangler pages dev --binding DEV_EMAIL=owner@example.com --binding OWNER_EMAIL=owner@example.com --port 8788
```
`DEV_EMAIL` stands in for the Access login, and it works only on localhost.
