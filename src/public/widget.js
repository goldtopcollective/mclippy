/**
 * MCliPpy Embeddable Widget
 *
 * Drop this into any page to get a MCliPpy upload zone:
 *   <script src="https://your-mclippy-instance.example.com/widget.js"
 *           data-api-key="YOUR_KEY"
 *           data-page="general"></script>
 *
 * Or create it manually:
 *   MCliPpy.init({ apiKey: '...', page: 'general', target: '#my-container' });
 */
(function () {
  const MCLIPPY_URL = (document.currentScript && document.currentScript.src)
    ? new URL(document.currentScript.src).origin
    : '';

  const scriptEl = document.currentScript;
  const scriptApiKey = scriptEl?.dataset.apiKey || '';
  const scriptPage = scriptEl?.dataset.page || 'general';
  const scriptTarget = scriptEl?.dataset.target || '';

  // ── API ──

  async function upload(apiKey, page, file) {
    const isImage = file.type.startsWith('image/');
    const formData = new FormData();
    formData.append('file', file);

    // First resolve page ID
    const pagesRes = await fetch(`${MCLIPPY_URL}/api/pages`, {
      headers: { 'X-API-Key': apiKey },
    });
    const pages = await pagesRes.json();
    const pageObj = pages.find(p => p.slug === page || p.id.toString() === page);
    if (!pageObj) throw new Error(`MCliPpy page "${page}" not found`);

    formData.append('page_id', pageObj.id);

    const res = await fetch(`${MCLIPPY_URL}/api/items/${isImage ? 'image' : 'file'}`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function uploadText(apiKey, page, text) {
    const pagesRes = await fetch(`${MCLIPPY_URL}/api/pages`, {
      headers: { 'X-API-Key': apiKey },
    });
    const pages = await pagesRes.json();
    const pageObj = pages.find(p => p.slug === page || p.id.toString() === page);
    if (!pageObj) throw new Error(`MCliPpy page "${page}" not found`);

    const res = await fetch(`${MCLIPPY_URL}/api/items/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ page_id: pageObj.id, content: text }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ── Widget UI ──

  function createWidget(container, apiKey, page) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mclippy-widget';
    wrapper.innerHTML = `
      <style>
        .mclippy-widget {
          border: 2px dashed #30363d; border-radius: 8px; padding: 1.5rem;
          text-align: center; background: #161b22; color: #e6edf3;
          font-family: -apple-system, system-ui, sans-serif; transition: all 0.2s;
        }
        .mclippy-widget:hover, .mclippy-widget.drag-hover {
          border-color: #f78166; background: rgba(247,129,102,0.1);
        }
        .mclippy-widget .mclippy-title {
          font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;
        }
        .mclippy-widget .mclippy-title span { color: #f78166; }
        .mclippy-widget .mclippy-sub { font-size: 0.75rem; color: #8b949e; }
        .mclippy-widget label { color: #f78166; cursor: pointer; text-decoration: underline; }
        .mclippy-widget .mclippy-status {
          font-size: 0.75rem; margin-top: 0.5rem; min-height: 1em;
        }
        .mclippy-widget .mclippy-ok { color: #238636; }
        .mclippy-widget .mclippy-err { color: #f85149; }
      </style>
      <div class="mclippy-title">M<span>Cli</span>Ppy</div>
      <div class="mclippy-sub">Drop files here or <label for="mclippy-file-${page}">browse</label></div>
      <input type="file" id="mclippy-file-${page}" multiple hidden>
      <div class="mclippy-status"></div>
    `;

    const statusEl = wrapper.querySelector('.mclippy-status');
    const fileInput = wrapper.querySelector('input[type="file"]');

    function setStatus(msg, ok) {
      statusEl.className = 'mclippy-status ' + (ok ? 'mclippy-ok' : 'mclippy-err');
      statusEl.textContent = msg;
      if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }

    async function handleFiles(files) {
      for (const file of files) {
        try {
          await upload(apiKey, page, file);
          setStatus(`Sent ${file.name}`, true);
        } catch (e) {
          setStatus(`Failed: ${e.message}`, false);
        }
      }
    }

    wrapper.addEventListener('dragover', (e) => { e.preventDefault(); wrapper.classList.add('drag-hover'); });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-hover'));
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-hover');
      if (e.dataTransfer.files.length > 0) {
        handleFiles(Array.from(e.dataTransfer.files));
      } else {
        const text = e.dataTransfer.getData('text/plain');
        if (text) uploadText(apiKey, page, text).then(() => setStatus('Sent text', true)).catch(e => setStatus(e.message, false));
      }
    });

    fileInput.addEventListener('change', () => {
      handleFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });

    // Also handle paste in the widget
    wrapper.tabIndex = 0;
    wrapper.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) handleFiles([file]);
        } else if (item.kind === 'string' && item.type === 'text/plain') {
          item.getAsString(text => {
            if (text.trim()) uploadText(apiKey, page, text).then(() => setStatus('Sent text', true)).catch(err => setStatus(err.message, false));
          });
        }
      }
    });

    container.appendChild(wrapper);
    return { upload: (file) => upload(apiKey, page, file), uploadText: (text) => uploadText(apiKey, page, text) };
  }

  // ── Public API ──

  window.MCliPpy = {
    init: function (opts = {}) {
      const apiKey = opts.apiKey || scriptApiKey;
      const page = opts.page || scriptPage;
      const target = opts.target ? document.querySelector(opts.target) : null;

      if (!apiKey) {
        console.error('MCliPpy: apiKey is required (set data-api-key on script tag or pass to init())');
        return;
      }

      const container = target || document.createElement('div');
      if (!target) {
        // Auto-insert after script tag
        scriptEl?.parentNode?.insertBefore(container, scriptEl.nextSibling);
      }

      return createWidget(container, apiKey, page);
    },
    upload,
    uploadText,
  };

  // Auto-init if data-api-key is set on script tag
  if (scriptApiKey) {
    document.addEventListener('DOMContentLoaded', () => {
      const target = scriptTarget ? document.querySelector(scriptTarget) : null;
      const container = target || document.createElement('div');
      if (!target) scriptEl?.parentNode?.insertBefore(container, scriptEl.nextSibling);
      createWidget(container, scriptApiKey, scriptPage);
    });
  }
})();
