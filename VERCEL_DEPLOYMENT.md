# OrbitFS License Master V2 — Vercel deployment

## Deploy

Import this repository into any Vercel account or team you control. Use the repository root and the Next.js preset.

Install command: `npm ci`

Build command: `npm run build`

Production branch: `main`

## Environment variables

Configure these in Vercel Production, Preview and Development as required:

`DATABASE_URL` — PostgreSQL connection string for the License Master database.

`DATABASE_SSL` — `true` for hosted PostgreSQL.

`SUPABASE_POOLER_HOST` — optional; only needed when using the supported Supabase pooler configuration.

`INTEGRATION_API_TOKEN` — optional legacy/bootstrap integration credential. Managed API keys created inside License Master are preferred.

`MASTER_API_TOKEN`, `BILLING_API_TOKEN`, `DEPLOYER_API_TOKEN` — optional machine-key fallbacks. They can use the same value when that key has the required scopes, but managed API keys are preferred and are stored in the License Master database.

`ADMIN_API_TOKEN` — optional server-to-server admin credential for endpoints that explicitly use the admin API token.

`GITHUB_RELEASE_TOKEN` — required when the Base source repository is private and License Master must create/read GitHub release assets.

`BOOTSTRAP_ADMIN_EMAIL` — optional initial administrator.

`BOOTSTRAP_ADMIN_PASSWORD` — optional initial administrator password.

Never commit real values or expose server secrets as `NEXT_PUBLIC_*` variables.

## Release pipeline

Release builders submit candidates through the canonical `POST /api/v1/releases` intake. The License Master then validates the release and controls its technical state.

The customer/update retrieval surface is `/api/v1/updater`. Deployment authorization and telemetry use `/api/v1/deployer`.

The resulting flow is:

`V1-vercel-base / V1-vercel-engine` → release build/package → License Master `/api/v1/releases` → validation/technical approval → Billing Store final publication → customer updater/deployer.

## API boundary

License Master is the authoritative licensing, release and deployment-control system. Its own admin UI reads/writes its own database through server-side application code. External systems such as V2 Billing Store communicate with License Master through authenticated managed API keys.

V2 Billing Store uses its server-only `BILLING_API_TOKEN` for licensing, products and release operations. Deployment operations use `DEPLOYER_API_TOKEN`.

The old License API and old database are not required by this repository.

## New-account setup

1. Import `main` into the new Vercel account.
2. Create/configure the PostgreSQL database for License Master.
3. Add the variables from `.env.example`.
4. Add `GITHUB_RELEASE_TOKEN` if the release source repository remains private.
5. Deploy.
6. Complete `/setup` if bootstrap values were not used.
7. In License Master, create managed API keys for Billing Store and deployment clients with the required scopes.
8. Put the appropriate keys into the downstream server-only secret stores.

No License Master private signing material should be placed in the Billing Store project.

## Production deployment verification

Production is deployed from `main`. Functional changes must go through the manual production deployment flow before they are considered live. The Base Deployment page and Releases & Updates page are separate production routes: `/releases/base` and `/releases`.

## Canonical hosts

- Admin UI: `https://panel.incendiarynetworks.cc`
- External API: `https://incendiarynetworks.cc/api/v1`
- External integration endpoints: `https://incendiarynetworks.cc/api/v1/*`
- API root: `https://incendiarynetworks.cc/api/v1`
