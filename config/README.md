`supabase-ca.crt` is Supabase's **public** Root 2021 CA certificate. It is not a
private key or an API credential. It was downloaded over HTTPS from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

The Prisma migration CLI uses this file. The matching PEM in
`src/lib/database-ca.ts` makes the certificate available in bundled serverless
functions without relying on a runtime filesystem path. Both connections verify
the certificate chain and hostname. Update both copies together if Supabase
changes its CA; do not disable TLS verification.
