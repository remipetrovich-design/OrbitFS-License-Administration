# Custom License Manager

A standalone licensing authority and deployment/release control plane. It runs by itself: its database, users, authentication, settings, products, licenses, validation, activations, releases and deployment metadata all belong to this application.

## Architecture

```text
Admin browser
    -> Next.js server components/actions
    -> shared core services
    -> PostgreSQL

Billing Store / installed products / deployer / updater
    -> authenticated /api/v1/* integration boundary
    -> same shared core services
    -> PostgreSQL
```

The admin UI does **not** call the external integration API to manage itself. The UI and external API use the same internal services, so there is one licensing authority and no duplicated business logic.

Billing Store is a client, not a dependency. It can be offline without taking the License Manager down. Installed products likewise ask this system's validation API when they need a license decision.

## What this system owns

- Local Owner/Admin/Operator/Viewer accounts and sessions.
- Product registration and product status.
- License generation, hashing, issuing, suspension/revocation and expiry handling.
- Installation activations and last-seen information.
- Base-release and update-release metadata, channels, artifacts and checksums.
- System online/offline, licensing, maintenance, release and deployment controls.
- Audit records.

## Database

For a new PostgreSQL database, run `database/schema.sql`.

For an existing installation, run `database/migrate.sql` before deploying the new application.

License plaintext is never stored. Only a SHA-256 hash and last four characters are persisted.

## First deployment

1. Create a PostgreSQL database.
2. Run `database/schema.sql`.
3. Deploy the Next.js project to Vercel.
4. Configure `DATABASE_URL` and `DATABASE_SSL`.
5. Configure a long random `INTEGRATION_API_TOKEN`.
6. Either set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` and run `npm run bootstrap-admin`, or open `/setup` after the database is initialized and create the first Owner account.

Never put the integration token or database credentials in `NEXT_PUBLIC_*` variables.

## External API

Every integration endpoint except health requires:

`Authorization: Bearer INTEGRATION_API_TOKEN`

### Health

`GET /api/v1/license/health`

### License issuance

`POST /api/v1/license`

```json
{
  "product": "orbitfs",
  "customer_external_id": "customer-123",
  "external_reference": "order-456",
  "expires_at": "2030-01-01T00:00:00Z",
  "metadata": {}
}
```

The response contains the plaintext `license_key` once. The caller must securely store it.

### License validation

`POST /api/v1/license/validate`

```json
{
  "license_key": "LIC-...",
  "product": "orbitfs",
  "installation_id": "machine-123",
  "product_version": "2.0.0"
}
```

The manager hashes the supplied key, finds the registered product/license, checks authority state, product status, license status and expiry, then records the installation activation when valid.

### Base deployment

`GET /api/v1/deployment/base?product=orbitfs&channel=stable`

Returns the latest published base release for the product.

### Release updater

`GET /api/v1/releases?product=orbitfs&channel=stable&type=update`

`GET /api/v1/releases?product=orbitfs&channel=stable&type=base`

`POST /api/v1/releases`

The same release records are managed locally in the admin panel or supplied by an authenticated deployment/release client.

## Local administration

- `/` — control-plane overview
- `/licenses` — issue and inspect licenses
- `/products` — register/disable products
- `/releases` — create and inspect base/update releases
- `/users` — manage local users
- `/settings` — take external authority, licensing, release or deployment services online/offline
- `/api-docs` — integration contract

Turning **External authority offline** does not lock the administrator out of the panel. It causes external authority operations to return an unavailable response while the local control plane remains accessible.
