# Production License Master domains

The License Master deployment uses one application with two public hostnames:

- Admin panel UI: `https://panel.incendiarynetworks.cc`
- External API: `https://incendiarynetworks.cc/api/v1`

Both hostnames must point to the same Vercel deployment of `Custom-licence-manager`. The API hostname is the canonical authority for customer license authorization and release-system integrations.

## API contract

The canonical external integration API is rooted at `/api/v1`:

- `GET /api/v1/license/health` — authenticated/internal health
- `POST /api/v1/license` — issue a license
- `POST /api/v1/license/validate` — public installed-product license validation
- `POST /api/v1/license/{id}/control` — license lifecycle control
- `GET /api/v1/products` — product catalogue
- `GET /api/v1/license` — authenticated license registry
- `GET /api/v1/releases` / `POST /api/v1/releases` — release intake/distribution
- `GET|POST /api/v1/releases/{id}` — release operations
- `GET /api/v1/releases/{id}/artifact` — release artifact
- `POST /api/v1/releases/{id}/validate` — release validation
- `GET|POST /api/v1/updater` — customer update/base release retrieval
- `POST /api/v1/deployer` — deployment authorization and deployment telemetry

There are also internal License Manager admin/auth routes under `/api/*`. Those are application-internal control-plane endpoints, not the external License Master integration contract. They must not be confused with or substituted for the versioned public integration API.

The admin UI is not the API authority URL. Billing Store, OrbitFS Base/license controller, release/deployer clients, and other external systems should use `https://incendiarynetworks.cc/api/v1` as their License Master API base. The browser-facing License Master administration interface should use `https://panel.incendiarynetworks.cc`.

## Vercel

Attach both custom domains to the same License Master Vercel project. Do not use the panel hostname or a Vercel deployment URL as the API authority. DNS/TLS and the Vercel custom-domain configuration are deployment settings rather than repository code, so the repository does not hard-code a Vercel project URL for the admin panel.
