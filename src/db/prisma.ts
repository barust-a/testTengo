import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

const DEFAULT_DATABASE_URL = 'postgres://tengo:tengo@localhost:5432/tenders';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL }),
});

export type Db = typeof prisma;
export type { Prisma } from '../generated/prisma/client.js';
