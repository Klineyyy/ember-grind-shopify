import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './client.js';

await migrate(db, { migrationsFolder: './drizzle' });
console.log('✔ Migrations applied');
await pool.end();
