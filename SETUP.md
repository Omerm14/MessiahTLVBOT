# Messiah setup

Messiah runs on free tiers:
- **Cloudflare** holds the app, the API and the database, and handles sign-in.
- **GitHub Actions** deploys on every push to `main` and runs the collector.

## Already set up (through the Cloudflare API)
- **D1 database** `messiah` (`7604a501-6930-4857-bb26-f689e0141eed`), with the tables from `migrations/`.
- **Pages project** `messiah`, served at <https://messiah-4rr.pages.dev>. These secrets are set on it:
  - `OWNER_EMAIL`
  - `ACCESS_TEAM_DOMAIN`
  - `ACCESS_AUD`
- **Sign-in (Cloudflare Access):**
  - Team domain: `messiah-tlv.cloudflareaccess.com`.
  - Login: a one-time code sent by email. Sessions last 30 days.
  - Who gets in: anyone who proves an email passes Access, and then Messiah's invite list decides who sees the board.
  - `/api/ingest` and `/api/telegram` skip the login and check their own keys.

## The one step left for you: GitHub secrets
Open <https://github.com/Omerm14/MessiahTLVBOT/settings/secrets/actions/new> and add two repository secrets:
- `CLOUDFLARE_API_TOKEN`: the same Cloudflare token you created for the setup.
- `CLOUDFLARE_ACCOUNT_ID`: `a6c2ecdb914619c7255cabc59897630c`

Then **Actions → Deploy → Run workflow**, or push anything to `main`.

## Optional: sign in with Google
Zero Trust → Settings → Authentication → Add new → Google. It needs a Google OAuth client; Cloudflare's guide walks through it. The email code works without it.

## Local development
```bash
npm install
npx wrangler d1 migrations apply messiah --local
npx wrangler d1 execute messiah --local --file dev/seed.sql   # demo data
npx wrangler pages dev --binding DEV_EMAIL=owner@example.com --binding OWNER_EMAIL=owner@example.com --port 8788
```
`DEV_EMAIL` stands in for the Access login, and it works only on localhost.
