import pg from 'pg';
import { readFileSync } from 'node:fs';
import { config } from './config.js';

pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> number
pg.types.setTypeParser(1082, (v) => v);             // date -> 'YYYY-MM-DD'

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
export const q = (text, params) => pool.query(text, params);

export async function migrate() {
  await q(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}
