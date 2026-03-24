/* MCliPpy — Client */

const state = {
  pages: [],
  currentPage: null,
  items: [],
  ws: null,
  dragItem: null,
};

// ── API helpers ──

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  // Only set Content-Type for non-FormData requests
  if (!(opts.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── WebSocket ──

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${proto}//${location.host}/ws`);

  state.ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWSMessage(msg);
  };

  state.ws.onclose = () => {
    setTimeout(connectWS, 2000);
  };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'item:added':
      if (msg.item.page_id === state.currentPage?.id) {
        state.items.push(msg.item);
        renderItems();
      }
      break;

    case 'item:removed':
      if (msg.pageId === state.currentPage?.id) {
        state.items = state.items.filter(i => i.id !== msg.itemId);
        renderItems();
      }
      break;

    case 'item:updated':
      if (msg.item.page_id === state.currentPage?.id) {
        const idx = state.items.findIndex(i => i.id === msg.item.id);
        if (idx >= 0) { state.items[idx] = { ...state.items[idx], ...msg.item }; renderItems(); }
      }
      break;

    case 'item:selected':
      if (msg.pageId === state.currentPage?.id) {
        const item = state.items.find(i => i.id === msg.itemId);
        if (item) { item.selected = msg.selected; renderItems(); }
      }
      break;

    case 'items:selection':
      msg.itemIds.forEach(id => {
        const item = state.items.find(i => i.id === id);
        if (item) item.selected = msg.selected;
      });
      renderItems();
      break;

    case 'items:deselect-all':
      if (msg.pageId === state.currentPage?.id) {
        state.items.forEach(i => i.selected = false);
        renderItems();
      }
      break;

    case 'items:reordered':
      const orderMap = {};
      msg.itemIds.forEach((id, i) => orderMap[id] = i);
      state.items.sort((a, b) => (orderMap[a.id] ?? a.position) - (orderMap[b.id] ?? b.position));
      renderItems();
      break;

    case 'page:added':
      state.pages.push(msg.page);
      renderTabs();
      break;

    case 'page:removed':
      state.pages = state.pages.filter(p => p.id !== msg.pageId);
      if (state.currentPage?.id === msg.pageId) {
        state.currentPage = state.pages[0] || null;
        loadItems();
      }
      renderTabs();
      break;
  }
}

// ── Pages ──

async function loadPages() {
  state.pages = await api('/pages');
  if (!state.currentPage && state.pages.length > 0) {
    const hash = location.hash.slice(1);
    state.currentPage = state.pages.find(p => p.slug === hash) || state.pages[0];
  }
  renderTabs();
  await loadItems();
}

function renderTabs() {
  const select = document.getElementById('page-select');
  select.innerHTML = '';
  state.pages.forEach(page => {
    const opt = document.createElement('option');
    opt.value = page.id;
    opt.textContent = page.name;
    if (state.currentPage?.id === page.id) opt.selected = true;
    select.appendChild(opt);
  });
  select.onchange = () => {
    const page = state.pages.find(p => p.id === parseInt(select.value));
    if (page) switchPage(page);
  };
}

async function switchPage(page) {
  state.currentPage = page;
  location.hash = page.slug;
  renderTabs();
  await loadItems();
}

async function createPage(name) {
  const page = await api('/pages', { method: 'POST', body: JSON.stringify({ name }) });
  state.pages.push(page);
  renderTabs();
  switchPage(page);
}

async function deletePage(id) {
  if (state.pages.length <= 1) return;
  if (!confirm('Delete this page and all its items?')) return;
  await api(`/pages/${id}`, { method: 'DELETE' });
  state.pages = state.pages.filter(p => p.id !== id);
  if (state.currentPage?.id === id) {
    state.currentPage = state.pages[0];
    await loadItems();
  }
  renderTabs();
}

// ── Items ──

async function loadItems() {
  if (!state.currentPage) { state.items = []; renderItems(); return; }
  const items = await api(`/items/page/${state.currentPage.id}`);
  state.items = items;
  renderItems();
}

function renderItems() {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = '';

  state.items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'item-card' + (item.selected ? ' selected' : '');
    card.dataset.id = item.id;
    card.draggable = true;

    // Click to toggle selection
    card.addEventListener('click', (e) => {
      if (e.target.closest('.item-actions') || e.target.closest('a') || e.target.tagName === 'IMG') return;
      toggleSelect(item);
    });

    // Drag events (desktop)
    card.addEventListener('dragstart', (e) => {
      state.dragItem = item;
      card.classList.add('dragging');
      document.getElementById('trash-zone').classList.remove('hidden');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.getElementById('trash-zone').classList.add('hidden');
      state.dragItem = null;
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (state.dragItem && state.dragItem.id !== item.id) {
        card.classList.add('drag-over');
      }
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (state.dragItem && state.dragItem.id !== item.id) {
        reorderItem(state.dragItem.id, item.id);
      }
    });

    // Header
    const header = document.createElement('div');
    header.className = 'item-header';

    const meta = document.createElement('div');
    meta.innerHTML = `<span class="item-type">${item.type}</span>`;
    if (item.label) meta.innerHTML += `<span class="item-label">${esc(item.label)}</span>`;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    // Move buttons (useful on mobile where drag doesn't work)
    if (index > 0) {
      const upBtn = document.createElement('button');
      upBtn.className = 'move-btn';
      upBtn.title = 'Move up';
      upBtn.innerHTML = '&#x25B2;';
      upBtn.onclick = (e) => { e.stopPropagation(); moveItem(index, index - 1); };
      actions.appendChild(upBtn);
    }
    if (index < state.items.length - 1) {
      const downBtn = document.createElement('button');
      downBtn.className = 'move-btn';
      downBtn.title = 'Move down';
      downBtn.innerHTML = '&#x25BC;';
      downBtn.onclick = (e) => { e.stopPropagation(); moveItem(index, index + 1); };
      actions.appendChild(downBtn);
    }

    // Edit button (text items only)
    if (item.type === 'text') {
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.title = 'Edit';
      editBtn.innerHTML = '&#x270E;';
      editBtn.onclick = (e) => { e.stopPropagation(); openEditModal(item); };
      actions.appendChild(editBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteItem(item.id); };
    actions.appendChild(deleteBtn);

    header.appendChild(meta);
    header.appendChild(actions);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'item-body';

    if (item.type === 'text') {
      body.className += ' text-body';
      body.innerHTML = marked.parse(item.content || '');
      body.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        body.classList.toggle('expanded');
      });
    } else if (item.type === 'image') {
      body.className += ' image-body';
      const img = document.createElement('img');
      img.src = `/api/items/${item.id}/download?inline=1`;
      img.alt = item.filename || 'image';
      img.loading = 'lazy';
      img.onclick = (e) => { e.stopPropagation(); openLightbox(img.src); };
      body.appendChild(img);
    } else {
      body.className += ' file-body';
      body.innerHTML = `
        <span class="file-icon">${getFileIcon(item.mime_type)}</span>
        <div class="file-info">
          <div class="filename">${esc(item.filename || 'file')}</div>
          <div class="filesize">${formatBytes(item.file_size || 0)}</div>
        </div>
        <a href="/api/items/${item.id}/download" target="_blank">Download</a>
      `;
    }

    card.appendChild(body);
    grid.appendChild(card);
  });
}

async function toggleSelect(item) {
  const newVal = !item.selected;
  item.selected = newVal;
  renderItems();
  await api(`/items/${item.id}/select`, { method: 'PATCH', body: JSON.stringify({ selected: newVal }) });
}

async function deleteItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  renderItems();
  await api(`/items/${id}`, { method: 'DELETE' });
}

async function moveItem(fromIndex, toIndex) {
  const ids = state.items.map(i => i.id);
  const [moved] = ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, moved);

  const reordered = [];
  ids.forEach(id => {
    const item = state.items.find(i => i.id === id);
    if (item) reordered.push(item);
  });
  state.items = reordered;
  renderItems();

  await api('/items/reorder', { method: 'POST', body: JSON.stringify({ item_ids: ids }) });
}

async function reorderItem(draggedId, targetId) {
  const ids = state.items.map(i => i.id);
  const fromIdx = ids.indexOf(draggedId);
  const toIdx = ids.indexOf(targetId);
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, draggedId);

  const reordered = [];
  ids.forEach(id => {
    const item = state.items.find(i => i.id === id);
    if (item) reordered.push(item);
  });
  state.items = reordered;
  renderItems();

  await api('/items/reorder', { method: 'POST', body: JSON.stringify({ item_ids: ids }) });
}

// ── Edit text ──

async function updateTextItem(id, content) {
  await api(`/items/${id}/text`, { method: 'PATCH', body: JSON.stringify({ content }) });
  const item = state.items.find(i => i.id === id);
  if (item) { item.content = content; renderItems(); }
}

function openEditModal(item) {
  const modal = document.getElementById('edit-modal');
  const textarea = document.getElementById('edit-textarea');
  textarea.value = item.content || '';
  modal.dataset.itemId = item.id;
  modal.classList.remove('hidden');
  textarea.focus();
}

// ── Adding items ──

async function addTextItem(content, label) {
  await api('/items/text', {
    method: 'POST',
    body: JSON.stringify({ page_id: state.currentPage.id, content, label }),
  });
}

async function addFileItem(file) {
  const formData = new FormData();
  formData.append('page_id', state.currentPage.id);
  formData.append('file', file);

  const isImage = file.type.startsWith('image/');
  await fetch(`/api/items/${isImage ? 'image' : 'file'}`, {
    method: 'POST',
    body: formData,
  });
}

// ── Drop zone ──

function initDropZone() {
  const zone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Only the zone itself triggers file browse — not child elements that handle their own clicks
  zone.addEventListener('click', (e) => {
    if (e.target.closest('.link-btn') || e.target.closest('label')) return;
    fileInput.click();
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.dragItem) zone.classList.add('drag-hover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-hover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-hover');
    if (state.dragItem) return;

    if (e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(addFileItem);
      return;
    }

    const text = e.dataTransfer.getData('text/plain');
    if (text) addTextItem(text);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      Array.from(fileInput.files).forEach(addFileItem);
    }
    fileInput.value = '';
  });

  // Paste handler (global)
  document.addEventListener('paste', (e) => {
    if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
    if (!state.currentPage) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) addFileItem(file);
      } else if (item.kind === 'string' && item.type === 'text/plain') {
        item.getAsString(text => {
          if (text.trim()) addTextItem(text);
        });
      }
    }
  });
}

// ── Trash zone ──

function initTrashZone() {
  const trash = document.getElementById('trash-zone');

  trash.addEventListener('dragover', (e) => {
    e.preventDefault();
    trash.classList.add('drag-hover');
  });
  trash.addEventListener('dragleave', () => trash.classList.remove('drag-hover'));
  trash.addEventListener('drop', (e) => {
    e.preventDefault();
    trash.classList.remove('drag-hover');
    if (state.dragItem) {
      deleteItem(state.dragItem.id);
    }
  });
}

// ── Modals ──

function initModals() {
  // Text paste modal
  const pasteBtn = document.getElementById('btn-paste-text');
  const pasteModal = document.getElementById('paste-modal');
  const pasteTextarea = document.getElementById('paste-textarea');

  pasteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pasteModal.classList.remove('hidden');
    pasteTextarea.focus();
  });

  document.getElementById('paste-cancel').onclick = () => {
    pasteModal.classList.add('hidden');
    pasteTextarea.value = '';
  };
  pasteModal.querySelector('.modal-backdrop').onclick = () => {
    pasteModal.classList.add('hidden');
    pasteTextarea.value = '';
  };
  document.getElementById('paste-submit').onclick = () => {
    const text = pasteTextarea.value.trim();
    if (text) addTextItem(text);
    pasteModal.classList.add('hidden');
    pasteTextarea.value = '';
  };

  // New page modal
  const pageBtn = document.getElementById('btn-new-page');
  const pageModal = document.getElementById('page-modal');
  const pageInput = document.getElementById('page-name-input');

  document.getElementById('btn-delete-page').onclick = () => {
    if (state.currentPage) deletePage(state.currentPage.id);
  };

  pageBtn.onclick = () => {
    pageModal.classList.remove('hidden');
    pageInput.focus();
  };
  document.getElementById('page-cancel').onclick = () => {
    pageModal.classList.add('hidden');
    pageInput.value = '';
  };
  pageModal.querySelector('.modal-backdrop').onclick = () => {
    pageModal.classList.add('hidden');
    pageInput.value = '';
  };
  document.getElementById('page-submit').onclick = () => {
    const name = pageInput.value.trim();
    if (name) createPage(name);
    pageModal.classList.add('hidden');
    pageInput.value = '';
  };
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('page-submit').click();
  });

  // Edit text modal
  const editModal = document.getElementById('edit-modal');
  const editTextarea = document.getElementById('edit-textarea');

  document.getElementById('edit-cancel').onclick = () => {
    editModal.classList.add('hidden');
    editTextarea.value = '';
  };
  editModal.querySelector('.modal-backdrop').onclick = () => {
    editModal.classList.add('hidden');
    editTextarea.value = '';
  };
  document.getElementById('edit-submit').onclick = () => {
    const text = editTextarea.value.trim();
    const itemId = parseInt(editModal.dataset.itemId);
    if (text && itemId) updateTextItem(itemId, text);
    editModal.classList.add('hidden');
    editTextarea.value = '';
  };
}

// ── Lightbox ──

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.classList.remove('hidden');
}

function initLightbox() {
  const lb = document.getElementById('lightbox');
  lb.querySelector('.lightbox-backdrop').onclick = () => lb.classList.add('hidden');
  document.getElementById('lightbox-close').onclick = () => lb.classList.add('hidden');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      lb.classList.add('hidden');
      document.getElementById('paste-modal').classList.add('hidden');
      document.getElementById('page-modal').classList.add('hidden');
      document.getElementById('edit-modal').classList.add('hidden');
    }
  });
}

// ── Helpers ──

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimeType) {
  if (!mimeType) return '\u{1F4C4}';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '\u{1F4CA}';
  if (mimeType.includes('pdf')) return '\u{1F4D5}';
  if (mimeType.includes('word') || mimeType.includes('document')) return '\u{1F4DD}';
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return '\u{1F4E6}';
  if (mimeType.includes('video')) return '\u{1F3AC}';
  if (mimeType.includes('audio')) return '\u{1F3B5}';
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml')) return '\u{1F4BB}';
  return '\u{1F4C4}';
}

// ── Theme toggle ──

function initTheme() {
  const btn = document.getElementById('btn-theme');
  const saved = localStorage.getItem('mclippy-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);

  btn.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('mclippy-theme', next);
  };
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-theme').textContent = theme === 'dark' ? '\u2600' : '\u263E';
}

// ── Init ──

async function init() {
  initTheme();
  connectWS();
  initDropZone();
  initTrashZone();
  initModals();
  initLightbox();
  await loadPages();
}

init();
