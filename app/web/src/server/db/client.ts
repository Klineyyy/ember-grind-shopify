import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy web/.env.example to web/.env.');
}

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10,
  // Keep DATE columns as 'YYYY-MM-DD' strings; avoids timezone drift on day buckets.
  dateStrings: ['DATE'],
  timezone: 'Z',
});

export const db = drizzle(pool, { schema, mode: 'default' });
export type DB = typeof db;
