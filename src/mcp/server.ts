import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { queryOne, queryAll, query } from '../db';
import { broadcast } from '../websocket';
import { parseChecklist, serializeChecklist, normaliseChecklistInput } from '../routes/items';

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

    // For images/files, truncate content and indicate it's available.
    // For checklists, parse JSON into a structured `checklist` field.
    const mapped = items.map((i: any) => {
      if (i.type === 'text') return i;
      if (i.type === 'checklist') {
        const list = parseChecklist(i.content);
        return { ...i, content: undefined, checklist: list.items };
      }
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

    // For binary items, describe but don't send full content.
    // For checklists, parse into a structured field.
    const mapped = items.map((i: any) => {
      if (i.type === 'checklist') {
        const list = parseChecklist(i.content);
        return { ...i, content: undefined, checklist: list.items };
      }
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

  server.tool(
    'push_checklist',
    'Push a checklist of items the user can tick off in the browser. Returns the item id and the per-checkbox ids needed to toggle items later.',
    {
      page: z.string().optional().default('general').describe('Page slug or ID'),
      items: z.array(z.string()).min(1).describe('Checklist item texts, in order'),
      label: z.string().optional().describe('Optional title for the checklist'),
    },
    async ({ page, items, label }) => {
      const pageRow = await queryOne('SELECT id FROM pages WHERE slug = $1 OR id::text = $1', [page]);
      if (!pageRow) return { content: [{ type: 'text', text: 'Page not found' }], isError: true };

      const checklistItems = normaliseChecklistInput(items);
      if (checklistItems.length === 0) {
        return { content: [{ type: 'text', text: 'items must contain at least one non-empty entry' }], isError: true };
      }

      const content = serializeChecklist({ items: checklistItems });
      const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [pageRow.id]);
      const item = await queryOne(
        'INSERT INTO items (page_id, type, content, label, position) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [pageRow.id, 'checklist', content, label || null, (maxPos?.max ?? -1) + 1]
      );

      // Re-read the row so the broadcast carries the current shape (incl. position, selected, created_at)
      const full = await queryOne('SELECT * FROM items WHERE id = $1', [item.id]);
      broadcast({ type: 'item:added', item: full });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            item_id: item.id,
            page,
            label: label || null,
            checklist: checklistItems,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'toggle_checklist_item',
    'Tick or untick a single item inside a checklist card.',
    {
      item_id: z.number().describe('The checklist card id (the item.id returned by push_checklist)'),
      check_id: z.string().describe('The per-checkbox id (returned in the checklist array)'),
      checked: z.boolean().optional().describe('Force a state. Omit to toggle.'),
    },
    async ({ item_id, check_id, checked }) => {
      const existing = await queryOne('SELECT id, page_id, content FROM items WHERE id = $1 AND type = $2', [item_id, 'checklist']);
      if (!existing) return { content: [{ type: 'text', text: 'Checklist not found' }], isError: true };

      const list = parseChecklist(existing.content);
      const target = list.items.find(i => i.id === check_id);
      if (!target) return { content: [{ type: 'text', text: `check_id "${check_id}" not found in checklist` }], isError: true };
      target.checked = typeof checked === 'boolean' ? checked : !target.checked;

      const item = await queryOne(
        'UPDATE items SET content = $1 WHERE id = $2 RETURNING id, page_id, type, content, label, position, selected, created_at',
        [serializeChecklist(list), existing.id]
      );
      broadcast({ type: 'item:updated', item });

      return {
        content: [{
          type: 'text',
          text: `Set "${target.text}" → ${target.checked ? 'checked' : 'unchecked'}`,
        }],
      };
    },
  );

  server.tool(
    'update_checklist',
    'Replace the items and/or label of an existing checklist card. Use this to add/remove items or rename the title.',
    {
      item_id: z.number().describe('The checklist card id'),
      items: z.array(z.union([
        z.string(),
        z.object({
          id: z.string().optional(),
          text: z.string(),
          checked: z.boolean().optional(),
        }),
      ])).optional().describe('Replacement items. Strings become unchecked items; objects keep their id/checked state.'),
      label: z.string().nullable().optional().describe('New title. Pass null to clear.'),
    },
    async ({ item_id, items, label }) => {
      const existing = await queryOne('SELECT id, page_id, content, label FROM items WHERE id = $1 AND type = $2', [item_id, 'checklist']);
      if (!existing) return { content: [{ type: 'text', text: 'Checklist not found' }], isError: true };

      let newContent = existing.content;
      if (items !== undefined) {
        const next = normaliseChecklistInput(items);
        newContent = serializeChecklist({ items: next });
      }
      const newLabel = label === undefined ? existing.label : (label || null);

      const item = await queryOne(
        'UPDATE items SET content = $1, label = $2 WHERE id = $3 RETURNING id, page_id, type, content, label, position, selected, created_at',
        [newContent, newLabel, existing.id]
      );
      broadcast({ type: 'item:updated', item });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            item_id: item.id,
            label: item.label,
            checklist: parseChecklist(item.content).items,
          }, null, 2),
        }],
      };
    },
  );

  server.tool('move_item', 'Move an item to a different page', {
    item_id: z.number().describe('Item ID to move'),
    target_page: z.string().describe('Target page slug or ID'),
  }, async ({ item_id, target_page }) => {
    const item = await queryOne('SELECT id, page_id FROM items WHERE id = $1', [item_id]);
    if (!item) return { content: [{ type: 'text', text: 'Item not found' }], isError: true };

    const targetPageRow = await queryOne('SELECT id, name, slug FROM pages WHERE slug = $1 OR id::text = $1', [target_page]);
    if (!targetPageRow) return { content: [{ type: 'text', text: 'Target page not found' }], isError: true };

    if (item.page_id === targetPageRow.id) {
      return { content: [{ type: 'text', text: `Item #${item_id} is already on page "${targetPageRow.name}"` }] };
    }

    const fromPageId = item.page_id;
    const maxPos = await queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) as max FROM items WHERE page_id = $1', [targetPageRow.id]);
    const updated = await queryOne(
      'UPDATE items SET page_id = $1, position = $2 WHERE id = $3 RETURNING id, page_id, type, filename, label, position',
      [targetPageRow.id, (maxPos?.max ?? -1) + 1, item_id]
    );
    broadcast({ type: 'item:moved', item: updated, fromPageId });
    return { content: [{ type: 'text', text: `Moved item #${item_id} to page "${targetPageRow.name}"` }] };
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
