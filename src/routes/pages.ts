import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db';

const router = Router();

// List all pages
router.get('/', async (_req: Request, res: Response) => {
  const pages = await queryAll('SELECT id, name, slug, position, created_at FROM pages ORDER BY position, id');
  res.json(pages);
});

// Create page
router.post('/', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await queryOne('SELECT id FROM pages WHERE slug = $1', [slug]);
  if (existing) { res.status(409).json({ error: 'Page already exists' }); return; }

  const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM pages');
  const page = await queryOne(
    'INSERT INTO pages (name, slug, position) VALUES ($1, $2, $3) RETURNING *',
    [name, slug, (maxPos?.max ?? -1) + 1]
  );
  res.status(201).json(page);
});

// Delete page (can't delete last page)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const count = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM pages');
  if (parseInt(count?.count || '0') <= 1) {
    res.status(400).json({ error: 'Cannot delete the last page' });
    return;
  }
  await query('DELETE FROM pages WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Rename page
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const page = await queryOne(
    'UPDATE pages SET name = $1, slug = $2 WHERE id = $3 RETURNING *',
    [name, slug, id]
  );
  res.json(page);
});

export default router;
