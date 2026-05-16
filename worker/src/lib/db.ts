import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // limite menor de conexões no worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg pool in worker', err);
});

export default pool;
export const query = (text: string, params?: any[]) => pool.query(text, params);
