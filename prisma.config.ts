import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Same .env as the `pnpm ingest` and `pnpm start` scripts.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgres://tengo:tengo@localhost:5432/tenders',
  },
});
