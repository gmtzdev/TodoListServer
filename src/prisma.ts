import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client.ts';

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error('La variable de entorno DATABASE_URL no está configurada.');
}

const adapter = new PrismaBetterSqlite3({ url });

export const prisma = new PrismaClient({ adapter });
