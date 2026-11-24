# Production secrets and transport security

Staging and production must inject credentials through the deployment platform's
secret manager. The application intentionally does not load `.env` files when
`NODE_ENV=production`; this keeps a copied local file from overriding managed
secrets. Configure the secret manager to expose only the required variables to
the container:

- `POSTGRES_PASSWORD`, `JWT_SECRET`, `AWS_SECRET_ACCESS_KEY`, `PINATA_JWT`
- `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY`, and provider webhook secrets
- `REDIS_PASSWORD` and any other integration credentials used by the deployment

Rotate credentials in the manager and restart the workload; never commit a
secret file or pass secrets in a Compose `env_file` for staging or production.
The checked-in `.env.example` is development-only documentation.

Production startup also requires `POSTGRES_SSL=true`, `REDIS_TLS=true`, and an
explicit `ALLOWED_ORIGINS` list. The database and cache clients therefore fail
closed instead of silently sending credentials over plaintext connections.
