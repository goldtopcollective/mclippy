import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query, queryOne, queryAll } from '../db';
import { broadcast } from '../websocket';
import { config } from '../config';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
});

// Get items for a page
router.get('/page/:pageId', async (req: Request, res: Response) => {
  const items = await queryAll(
    'SELECT id, page_id, type, content, filename, mime_type, file_size, label, position, selected, created_at FROM items WHERE page_id = $1 ORDER BY position, id',
    [parseInt(req.params.pageId)]
  );
  // Don't send full content for files/images in list view — send a flag
  const mapped = items.map(i => ({
    ...i,
    content: i.type === 'text' ? i.content : undefined,
    has_content: !!i.content,
  }));
  res.json(mapped);
});

// Get selected items (across all pages or specific page) — must be before /:id
router.get('/selected', async (req: Request, res: Response) => {
  const pageId = req.query.page_id;
  let items;
  if (pageId) {
    items = await queryAll('SELECT * FROM items WHERE selected = true AND page_id = $1 ORDER BY position', [parseInt(pageId as string)]);
  } else {
    items = await queryAll('SELECT * FROM items WHERE selected = true ORDER BY page_id, position');
  }
  res.json(items);
});

// Get full item (including binary content)
router.get('/:id', async (req: Request, res: Response) => {
  const item = await queryOne('SELECT * FROM items WHERE id = $1', [parseInt(req.params.id)]);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

// Download file/image
router.get('/:id/download', async (req: Request, res: Response) => {
  const item = await queryOne('SELECT content, filename, mime_type, type FROM items WHERE id = $1', [parseInt(req.params.id)]);
  if (!item || !item.content) { res.status(404).json({ error: 'Not found' }); return; }

  const buffer = Buffer.from(item.content, 'base64');
  res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${item.filename || 'download'}"`);
  res.send(buffer);
});

// Add text item
router.post('/text', async (req: Request, res: Response) => {
  const { page_id, content, label } = req.body;
  if (!page_id || !content) { res.status(400).json({ error: 'page_id and content required' }); return; }

  const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [page_id]);
  const item = await queryOne(
    'INSERT INTO items (page_id, type, content, label, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [page_id, 'text', content, label || null, (maxPos?.max ?? -1) + 1]
  );
  broadcast({ type: 'item:added', item });
  res.status(201).json(item);
});

// Add image item (base64 from API/MCP or file upload)
router.post('/image', upload.single('file'), async (req: Request, res: Response) => {
  const page_id = req.body.page_id;
  if (!page_id) { res.status(400).json({ error: 'page_id required' }); return; }

  let content: string, mime_type: string, filename: string, file_size: number;

  if (req.file) {
    content = req.file.buffer.toString('base64');
    mime_type = req.file.mimetype;
    filename = req.file.originalname;
    file_size = req.file.size;
  } else if (req.body.content) {
    content = req.body.content; // base64
    mime_type = req.body.mime_type || 'image/png';
    filename = req.body.filename || 'image';
    file_size = Buffer.from(content, 'base64').length;
  } else {
    res.status(400).json({ error: 'file or content required' }); return;
  }

  const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [page_id]);
  const item = await queryOne(
    'INSERT INTO items (page_id, type, content, filename, mime_type, file_size, label, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, page_id, type, filename, mime_type, file_size, label, position, selected, created_at',
    [page_id, 'image', content, filename, mime_type, file_size, req.body.label || null, (maxPos?.max ?? -1) + 1]
  );
  broadcast({ type: 'item:added', item: { ...item, has_content: true } });
  res.status(201).json(item);
});

// Add file item
router.post('/file', upload.single('file'), async (req: Request, res: Response) => {
  const page_id = req.body.page_id;
  if (!page_id) { res.status(400).json({ error: 'page_id required' }); return; }

  let content: string, mime_type: string, filename: string, file_size: number;

  if (req.file) {
    content = req.file.buffer.toString('base64');
    mime_type = req.file.mimetype;
    filename = req.file.originalname;
    file_size = req.file.size;
  } else if (req.body.content) {
    content = req.body.content;
    mime_type = req.body.mime_type || 'application/octet-stream';
    filename = req.body.filename || 'file';
    file_size = Buffer.from(content, 'base64').length;
  } else {
    res.status(400).json({ error: 'file or content required' }); return;
  }

  const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [page_id]);
  const item = await queryOne(
    'INSERT INTO items (page_id, type, content, filename, mime_type, file_size, label, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, page_id, type, filename, mime_type, file_size, label, position, selected, created_at',
    [page_id, 'file', content, filename, mime_type, file_size, req.body.label || null, (maxPos?.max ?? -1) + 1]
  );
  broadcast({ type: 'item:added', item: { ...item, has_content: true } });
  res.status(201).json(item);
});

// Update text item content
router.patch('/:id/text', async (req: Request, res: Response) => {
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content required' }); return; }
  const item = await queryOne(
    'UPDATE items SET content = $1 WHERE id = $2 AND type = $3 RETURNING id, page_id, type, content, label, position, selected',
    [content, parseInt(req.params.id), 'text']
  );
  if (!item) { res.status(404).json({ error: 'Not found or not a text item' }); return; }
  broadcast({ type: 'item:updated', item });
  res.json(item);
});

// Delete item
router.delete('/:id', async (req: Request, res: Response) => {
  const item = await queryOne('SELECT id, page_id FROM items WHERE id = $1', [parseInt(req.params.id)]);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  await query('DELETE FROM items WHERE id = $1', [parseInt(req.params.id)]);
  broadcast({ type: 'item:removed', itemId: item.id, pageId: item.page_id });
  res.json({ ok: true });
});

// Toggle selection
router.patch('/:id/select', async (req: Request, res: Response) => {
  const { selected } = req.body;
  const item = await queryOne(
    'UPDATE items SET selected = $1 WHERE id = $2 RETURNING id, page_id, selected',
    [selected ?? true, parseInt(req.params.id)]
  );
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  broadcast({ type: 'item:selected', itemId: item.id, pageId: item.page_id, selected: item.selected });
  res.json(item);
});

// Bulk select/deselect
router.post('/select', async (req: Request, res: Response) => {
  const { item_ids, selected } = req.body;
  if (!Array.isArray(item_ids)) { res.status(400).json({ error: 'item_ids array required' }); return; }
  await query('UPDATE items SET selected = $1 WHERE id = ANY($2)', [selected ?? true, item_ids]);
  broadcast({ type: 'items:selection', itemIds: item_ids, selected: selected ?? true });
  res.json({ ok: true });
});

// Clear all selections on a page
router.post('/deselect-all/:pageId', async (req: Request, res: Response) => {
  await query('UPDATE items SET selected = false WHERE page_id = $1', [parseInt(req.params.pageId)]);
  broadcast({ type: 'items:deselect-all', pageId: parseInt(req.params.pageId) });
  res.json({ ok: true });
});

// Reorder items
router.post('/reorder', async (req: Request, res: Response) => {
  const { item_ids } = req.body;
  if (!Array.isArray(item_ids)) { res.status(400).json({ error: 'item_ids array required' }); return; }

  for (let i = 0; i < item_ids.length; i++) {
    await query('UPDATE items SET position = $1 WHERE id = $2', [i, item_ids[i]]);
  }
  broadcast({ type: 'items:reordered', itemIds: item_ids });
  res.json({ ok: true });
});

export default router;
