import { Pool } from 'pg';
import { config } from './config';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function query(text: string, params?: any[]) {
  return getPool().query(text, params);
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query(text, params);
  return result.rows[0] || null;
}

export async function queryAll<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query(text, params);
  return result.rows;
}

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT,
      filename TEXT,
      mime_type TEXT,
      file_size INTEGER DEFAULT 0,
      label TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      selected BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_items_page ON items (page_id, position);

    ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;
    ALTER TABLE items ADD CONSTRAINT items_type_check
      CHECK (type IN ('text', 'image', 'file', 'checklist'));
  `);

  // Ensure a default page exists
  const defaultPage = await queryOne('SELECT id FROM pages WHERE slug = $1', ['general']);
  if (!defaultPage) {
    await query('INSERT INTO pages (name, slug, position) VALUES ($1, $2, 0)', ['General', 'general']);
  }

  console.log('Database migrated');
}
