import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { queryOne, queryAll, query } from '../db';
import { broadcast } from '../websocket';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mclippy',
    version: '1.0.0',
  });

  // ── Read tools ──

  server.tool('list_pages', 'List all clipboard pages', {}, async () => {
    const pages = await queryAll('SELECT id, name, slug, position FROM pages ORDER BY position, id');
    return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
  });

  server.tool('get_page', 'Get all items on a page', {
    page: z.string().describe('Page slug or ID'),
  }, async ({ page }) => {
    const pageRow = await queryOne(
      'SELECT id, name, slug FROM pages WHERE slug = $1 OR id::text = $1',
      [page]
    );
    if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };

    const items = await queryAll(
      'SELECT id, type, content, filename, mime_type, file_size, label, position, selected, created_at FROM items WHERE page_id = $1 ORDER BY position, id',
      [pageRow.id]
    );

    // For images/files, truncate content and indicate it's available
    const mapped = items.map((i: any) => {
      if (i.type === 'text') return i;
      return {
        ...i,
        content: `[${i.type}: ${i.filename || 'unnamed'}, ${formatBytes(i.file_size)}. Use get item endpoint to retrieve full content]`,
      };
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ page: pageRow, items: mapped }, null, 2) }],
    };
  });

  server.tool('get_selected', 'Get all currently selected items', {
    page: z.string().optional().describe('Optional page slug or ID to filter by'),
  }, async ({ page }) => {
    let items;
    if (page) {
      const pageRow = await queryOne('SELECT id FROM pages WHERE slug = $1 OR id::text = $1', [page]);
      if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
      items = await queryAll('SELECT id, type, content, filename, mime_type, file_size, label, position, created_at FROM items WHERE selected = true AND page_id = $1 ORDER BY position', [pageRow.id]);
    } else {
      items = await queryAll('SELECT i.id, i.type, i.content, i.filename, i.mime_type, i.file_size, i.label, i.position, i.created_at, p.name as page_name, p.slug as page_slug FROM items i JOIN pages p ON i.page_id = p.id WHERE i.selected = true ORDER BY i.page_id, i.position');
    }

    // For binary items, describe but don't send full content
    const mapped = items.map((i: any) => {
      if (i.type !== 'text') {
        return { ...i, content: `[${i.type}: ${i.filename}, ${formatBytes(i.file_size)}]` };
      }
      return i;
    });

    return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
  });

  // ── Write tools ──

  server.tool('push_text', 'Push text content to the clipboard', {
    page: z.string().optional().default('general').describe('Page slug or ID (default: general)'),
    content: z.string().describe('Text or markdown content'),
    label: z.string().optional().describe('Optional label for the item'),
  }, async ({ page, content, label }) => {
    const pageRow = await queryOne('SELECT id FROM pages WHERE slug = $1 OR id::text = $1', [page]);
    if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };

    const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [pageRow.id]);
    const item = await queryOne(
      'INSERT INTO items (page_id, type, content, label, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [pageRow.id, 'text', content, label || null, (maxPos?.max ?? -1) + 1]
    );
    broadcast({ type: 'item:added', item });
    return { content: [{ type: 'text', text: `Added text item #${item.id} to page "${page}"` }] };
  });

  server.tool('push_image', 'Push an image to the clipboard', {
    page: z.string().optional().default('general').describe('Page slug or ID'),
    content: z.string().describe('Base64-encoded image data'),
    filename: z.string().optional().default('image.png').describe('Filename'),
    mime_type: z.string().optional().default('image/png').describe('MIME type'),
    label: z.string().optional().describe('Optional label'),
  }, async ({ page, content, filename, mime_type, label }) => {
    const pageRow = await queryOne('SELECT id FROM pages WHERE slug = $1 OR id::text = $1', [page]);
    if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };

    const file_size = Buffer.from(content, 'base64').length;
    const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [pageRow.id]);
    const item = await queryOne(
      'INSERT INTO items (page_id, type, content, filename, mime_type, file_size, label, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, page_id, type, filename, mime_type, file_size, label, position, selected, created_at',
      [pageRow.id, 'image', content, filename, mime_type, file_size, label || null, (maxPos?.max ?? -1) + 1]
    );
    broadcast({ type: 'item:added', item: { ...item, has_content: true } });
    return { content: [{ type: 'text', text: `Added image "${filename}" (${formatBytes(file_size)}) to page "${page}"` }] };
  });

  server.tool('push_file', 'Push a file attachment to the clipboard', {
    page: z.string().optional().default('general').describe('Page slug or ID'),
    content: z.string().describe('Base64-encoded file data'),
    filename: z.string().describe('Filename with extension'),
    mime_type: z.string().optional().default('application/octet-stream').describe('MIME type'),
    label: z.string().optional().describe('Optional label'),
  }, async ({ page, content, filename, mime_type, label }) => {
    const pageRow = await queryOne('SELECT id FROM pages WHERE slug = $1 OR id::text = $1', [page]);
    if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };

    const file_size = Buffer.from(content, 'base64').length;
    const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [pageRow.id]);
    const item = await queryOne(
      'INSERT INTO items (page_id, type, content, filename, mime_type, file_size, label, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, page_id, type, filename, mime_type, file_size, label, position, selected, created_at',
      [pageRow.id, 'file', content, filename, mime_type, file_size, label || null, (maxPos?.max ?? -1) + 1]
    );
    broadcast({ type: 'item:added', item: { ...item, has_content: true } });
    return { content: [{ type: 'text', text: `Added file "${filename}" (${formatBytes(file_size)}) to page "${page}"` }] };
  });

  server.tool('remove_item', 'Remove an item from the clipboard', {
    item_id: z.number().describe('Item ID to remove'),
  }, async ({ item_id }) => {
    const item = await queryOne('SELECT id, page_id FROM items WHERE id = $1', [item_id]);
    if (!item) return { content: [{ type: 'text', text: 'Item not found' }], isError: true };
    await query('DELETE FROM items WHERE id = $1', [item_id]);
    broadcast({ type: 'item:removed', itemId: item.id, pageId: item.page_id });
    return { content: [{ type: 'text', text: `Removed item #${item_id}` }] };
  });

  server.tool('select_item', 'Select one or more items (visible to all clients)', {
    item_ids: z.array(z.number()).describe('Item IDs to select'),
  }, async ({ item_ids }) => {
    await query('UPDATE items SET selected = true WHERE id = ANY($1)', [item_ids]);
    broadcast({ type: 'items:selection', itemIds: item_ids, selected: true });
    return { content: [{ type: 'text', text: `Selected ${item_ids.length} item(s)` }] };
  });

  server.tool('deselect_item', 'Deselect one or more items', {
    item_ids: z.array(z.number()).describe('Item IDs to deselect'),
  }, async ({ item_ids }) => {
    await query('UPDATE items SET selected = false WHERE id = ANY($1)', [item_ids]);
    broadcast({ type: 'items:selection', itemIds: item_ids, selected: false });
    return { content: [{ type: 'text', text: `Deselected ${item_ids.length} item(s)` }] };
  });

  server.tool('create_page', 'Create a new clipboard page', {
    name: z.string().describe('Page name (e.g. "Project Alpha", "Design Assets")'),
  }, async ({ name }) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await queryOne('SELECT id FROM pages WHERE slug = $1', [slug]);
    if (existing) return { content: [{ type: 'text', text: `Page "${name}" already exists` }], isError: true };

    const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM pages');
    const page = await queryOne(
      'INSERT INTO pages (name, slug, position) VALUES ($1, $2, $3) RETURNING *',
      [name, slug, (maxPos?.max ?? -1) + 1]
    );
    broadcast({ type: 'page:added', page });
    return { content: [{ type: 'text', text: `Created page "${name}" (slug: ${slug})` }] };
  });

  return server;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
