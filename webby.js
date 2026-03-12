/**
 * webby.js — v0.10.0
 * Zero-dependency browser-based site editor.
 * Activates only when window.SITE_SECRETS is present (local edit mode).
 * Stripped from exported/published HTML automatically.
 */
(function () {
  'use strict';

  const VERSION = '0.10.0';

  if (!window.SITE_SECRETS) return;

  const { geminiKey, githubToken, repo, branch = 'main' } = window.SITE_SECRETS;

  // ─── State ────────────────────────────────────────────────────────────────

  let isDirty = false;
  let mutationObserver = null;
  let statusTimer = null;
  let originalBodyPaddingTop = '';
  let autoSaveTimer = null;
  let dirHandle = null; // FileSystemDirectoryHandle when folder access is granted

  const FS_SUPPORTED = 'showDirectoryPicker' in window;
  const DRAFT_KEY = '__webby_draft_' + location.pathname; // localStorage fallback key

  // ─── Toolbar ──────────────────────────────────────────────────────────────

  function injectToolbar() {
    const bar = el('div', {
      id: '__webby-toolbar',
      'data-editor-ui': '',
    });

    css(bar, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '999999',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '0 16px',
      height: '44px',
      background: '#12121f',
      color: '#e8e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      boxSizing: 'border-box',
    });

    const title = el('span', { id: '__webby-title' });
    title.textContent = document.title || 'Site Editor';
    css(title, { fontWeight: '600', fontSize: '13px', letterSpacing: '0.01em' });

    const status = el('span', { id: '__webby-status' });
    css(status, { fontSize: '11px', opacity: '0.65', marginLeft: '4px' });

    const spacer = el('div');
    css(spacer, { flex: '1' });

    const themeBtn = toolbarBtn('Theme');
    const exportBtn = toolbarBtn('Export');
    const publishBtn = toolbarBtn('Publish', true);

    themeBtn.addEventListener('click', openThemeEditor);
    exportBtn.addEventListener('click', exportToFile);
    publishBtn.addEventListener('click', publishSite);

    bar.append(title, status, spacer, themeBtn, exportBtn, publishBtn);
    document.body.prepend(bar);

    // Push body content down so toolbar doesn't overlap
    originalBodyPaddingTop = document.body.style.paddingTop || '';
    const current = parseFloat(document.body.style.paddingTop) || 0;
    document.body.style.paddingTop = (current + 44) + 'px';
  }

  function toolbarBtn(label, primary = false) {
    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = label;
    css(btn, {
      padding: '5px 13px',
      border: primary ? 'none' : '1px solid rgba(255,255,255,0.2)',
      borderRadius: '5px',
      background: primary ? '#3b82f6' : 'transparent',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: 'inherit',
      fontWeight: primary ? '600' : '400',
      transition: 'background 0.15s',
    });
    const hoverBg = primary ? '#2563eb' : 'rgba(255,255,255,0.1)';
    const baseBg = primary ? '#3b82f6' : 'transparent';
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseleave', () => { btn.style.background = baseBg; });
    return btn;
  }

  function showStatus(msg, isError = false) {
    const statusEl = document.getElementById('__webby-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#f87171' : '#86efac';
    statusEl.style.opacity = '1';
    clearTimeout(statusTimer);
    if (!isError) {
      statusTimer = setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.opacity = '0.65';
      }, 4000);
    }
  }

  function setDirty(val) {
    isDirty = val;
    const titleEl = document.getElementById('__webby-title');
    if (titleEl) titleEl.textContent = (val ? '● ' : '') + (document.title || 'Site Editor');
    if (val) scheduleAutoSave();
  }

  // ─── File persistence ─────────────────────────────────────────────────────
  //
  // Primary path: File System Access API (Chrome/Edge/Safari)
  //   - User selects their site folder once; handle is stored in IndexedDB.
  //   - Auto-save writes index.html to disk; images are saved to assets/ locally.
  //   - On reload the file itself has the latest content — nothing to restore.
  //
  // Fallback path: localStorage (Firefox and other unsupported browsers)
  //   - Changes are cached in localStorage and restored on reload.
  //   - A banner explains that Chrome/Edge/Safari gives a better experience.

  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveChanges, 1500);
  }

  async function saveChanges() {
    if (dirHandle) {
      await writeIndexToLocalFile();
    } else {
      writeDraftToCache();
    }
  }

  // ── File System Access path ──────────────────────────────────────────────

  async function writeIndexToLocalFile() {
    try {
      const fh = await dirHandle.getFileHandle('index.html');
      const writable = await fh.createWritable();
      await writable.write(serialize({ local: true }));
      await writable.close();
    } catch (e) {
      // Lost access (e.g. folder moved) — drop handle and fall back
      dirHandle = null;
      writeDraftToCache();
      showAccessBanner();
    }
  }

  async function writeImageToLocalDir(file) {
    if (!dirHandle) return;
    try {
      const assetsDir = await dirHandle.getDirectoryHandle('assets', { create: true });
      const fh = await assetsDir.getFileHandle(file.name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(file);
      await writable.close();
    } catch (e) {
      // Non-fatal — image is still on GitHub even if local write fails
    }
  }

  // IndexedDB — persists FileSystemDirectoryHandle across sessions

  function openHandleDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('__webby_fs', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function storeHandleInDB(handle) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'dir');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadHandleFromDB() {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('dir');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (await handle.requestPermission(opts) === 'granted') return true;
    return false;
  }

  // Called at init — silently restores folder access or shows the access banner
  async function initFileAccess() {
    if (!FS_SUPPORTED) {
      showAccessBanner();
      return;
    }
    try {
      const stored = await loadHandleFromDB();
      if (stored && await verifyPermission(stored)) {
        dirHandle = stored;
        return; // Silent success — folder is linked, auto-save is active
      }
    } catch (_) {}
    showAccessBanner();
  }

  function showAccessBanner() {
    if (document.getElementById('__webby-access-banner')) return;

    const banner = el('div', { id: '__webby-access-banner', 'data-editor-ui': '' });
    css(banner, {
      position: 'fixed',
      top: '44px',
      left: '0',
      right: '0',
      zIndex: '999997',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '7px 16px',
      background: '#1e3655',
      color: '#cbd5e1',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      boxSizing: 'border-box',
    });

    const btnStyle = 'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;';

    // Derive the folder path from the file:// URL for display as a hint
    const hintPath = location.protocol === 'file:'
      ? decodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')))
      : null;
    const hintHtml = hintPath
      ? `<span style="font-family:monospace;font-size:11px;opacity:0.75;margin-left:4px;">(${hintPath})</span>`
      : '';

    if (!FS_SUPPORTED) {
      banner.innerHTML = `
        <span>⚠️ Your browser doesn't support saving directly to files. Use <strong>Chrome</strong> or <strong>Edge</strong> for the best experience. Your changes are saved in the browser for now.</span>
        <button id="__webby-banner-dismiss" style="${btnStyle}background:transparent;border:1px solid rgba(255,255,255,0.25);color:#cbd5e1;">Dismiss</button>
      `;
    } else {
      banner.innerHTML = `
        <span style="flex:1">💾 <strong>Link your site folder</strong> so edits save directly to your files — nothing gets lost on reload. ${hintHtml}</span>
        <button id="__webby-banner-grant" style="${btnStyle}background:#3b82f6;border:none;color:#fff;font-weight:600;">Select Folder</button>
        <button id="__webby-banner-dismiss" style="${btnStyle}background:transparent;border:1px solid rgba(255,255,255,0.25);color:#cbd5e1;">Not now</button>
      `;
      banner.querySelector('#__webby-banner-grant').addEventListener('click', async () => {
        try {
          // startIn: 'documents' is the best hint the API allows — we can't pass an
          // exact path, so we show the path in the banner text instead.
          const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
          dirHandle = handle;
          await storeHandleInDB(handle);
          removeBanner();
          await writeIndexToLocalFile();
          showStatus('Folder linked ✓ — edits now save to your files automatically');
        } catch (e) {
          if (e.name !== 'AbortError') showStatus('Could not access folder: ' + e.message, true);
        }
      });
    }

    banner.querySelector('#__webby-banner-dismiss').addEventListener('click', removeBanner);
    document.body.insertBefore(banner, document.body.firstChild);

    // Shift body down so the banner doesn't overlap content
    const current = parseFloat(document.body.style.paddingTop) || 0;
    document.body.style.paddingTop = (current + 36) + 'px';
  }

  function removeBanner() {
    const banner = document.getElementById('__webby-access-banner');
    if (!banner) return;
    const current = parseFloat(document.body.style.paddingTop) || 0;
    document.body.style.paddingTop = Math.max(0, current - 36) + 'px';
    banner.remove();
  }

  // ── localStorage fallback path ───────────────────────────────────────────

  function writeDraftToCache() {
    try { localStorage.setItem(DRAFT_KEY, serialize({ local: true })); } catch (_) {}
  }

  function clearDraftCache() {
    localStorage.removeItem(DRAFT_KEY);
  }

  // Restores from localStorage cache (fallback only). Returns true if restored.
  function restoreFromCache() {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (!saved) return false;
    try {
      const doc = new DOMParser().parseFromString(saved, 'text/html');
      const savedStyle = doc.querySelector('style');
      const liveStyle = document.querySelector('style');
      if (savedStyle && liveStyle) liveStyle.textContent = savedStyle.textContent;
      document.body.innerHTML = doc.body.innerHTML;
      return true;
    } catch (_) { return false; }
  }

  // ─── Zone Manager ─────────────────────────────────────────────────────────

  function activateZones() {
    document.querySelectorAll('[data-zone]').forEach(zone => activateZone(zone));
    injectAddSectionButtons();
  }

  function activateZone(section) {
    section.querySelectorAll('[data-editable]').forEach(node => {
      node.contentEditable = 'true';
      node.setAttribute('spellcheck', 'true');
    });
    // Bind image handlers to ALL images in the zone — not just those with
    // data-editable-image, so bootstrap-generated images are always editable.
    section.querySelectorAll('img').forEach(img => {
      if (img.closest('[data-editor-ui]')) return;
      if (img.dataset.webbyBound) return; // already activated (e.g. re-injection)
      img.dataset.webbyBound = '1';
      bindImageHandler(img);
    });
    injectDeleteButton(section);
    injectReformatButton(section);
  }

  function deactivateZones() {
    document.querySelectorAll('[data-editable]').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
    });
    document.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
  }

  function injectDeleteButton(section) {
    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = '✕ Delete Section';
    css(btn, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      zIndex: '1000',
      padding: '4px 9px',
      background: 'rgba(239,68,68,0.88)',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px',
      opacity: '0',
      transition: 'opacity 0.15s',
      pointerEvents: 'none',
    });

    section.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    });
    section.addEventListener('mouseleave', () => {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    });

    // Highlight the section outline while hovering the delete button
    btn.addEventListener('mouseenter', () => {
      section.style.outline = '2px solid rgba(239,68,68,0.6)';
      section.style.outlineOffset = '-2px';
    });
    btn.addEventListener('mouseleave', () => {
      section.style.outline = '';
      section.style.outlineOffset = '';
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const label = section.dataset.zoneLabel || section.dataset.zone || 'this section';
      if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
      // Clean up adjacent add-button
      const next = section.nextElementSibling;
      if (next && next.classList.contains('__webby-add-wrap')) next.remove();
      section.remove();
      setDirty(true);
      refreshAddButtons();
    });

    if (getComputedStyle(section).position === 'static') {
      section.style.position = 'relative';
    }
    section.appendChild(btn);
  }

  function injectReformatButton(section) {
    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = '⟳ Reformat';
    css(btn, {
      position: 'absolute',
      top: '10px',
      right: '130px',
      zIndex: '1000',
      padding: '4px 9px',
      background: 'rgba(59,130,246,0.88)',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px',
      opacity: '0',
      transition: 'opacity 0.15s',
      pointerEvents: 'none',
    });

    section.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    });
    section.addEventListener('mouseleave', () => {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      promptReformatSection(section);
    });

    section.appendChild(btn);
  }

  function promptReformatSection(section) {
    const label = section.dataset.zoneLabel || section.dataset.zone || 'Section';

    const overlay = el('div', { 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.55)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const modal = el('div');
    css(modal, {
      background: '#fff',
      borderRadius: '10px',
      padding: '28px',
      width: '500px',
      maxWidth: '92vw',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:16px;color:#111;font-weight:700">Reformat: ${label}</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#666;line-height:1.5">
        Describe how you want the layout or structure changed. Content (text, images) will not be changed unless you ask.
      </p>
      <textarea
        id="__webby-reformat-desc"
        placeholder="e.g. Show 4 columns on desktop but a single column on mobile instead of 2 columns"
        style="width:100%;height:96px;padding:10px 12px;border:1px solid #ddd;border-radius:6px;
               font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;
               line-height:1.5;outline:none;transition:border-color 0.15s;"
      ></textarea>
      <p id="__webby-reformat-error" style="display:none;margin:8px 0 0;font-size:12px;color:#ef4444;"></p>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button id="__webby-reformat-cancel"
          style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:6px;
                 cursor:pointer;font-size:13px;font-family:inherit;color:#444;">
          Cancel
        </button>
        <button id="__webby-reformat-submit"
          style="padding:8px 18px;background:#3b82f6;color:#fff;border:none;border-radius:6px;
                 cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:background 0.15s;">
          Reformat with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const textarea = modal.querySelector('#__webby-reformat-desc');
    const errorEl = modal.querySelector('#__webby-reformat-error');
    const submitBtn = modal.querySelector('#__webby-reformat-submit');
    const cancelBtn = modal.querySelector('#__webby-reformat-cancel');

    textarea.focus();
    textarea.addEventListener('focus', () => { textarea.style.borderColor = '#3b82f6'; });
    textarea.addEventListener('blur', () => { textarea.style.borderColor = '#ddd'; });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = '#2563eb'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = '#3b82f6'; });

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });

    submitBtn.addEventListener('click', async () => {
      const description = textarea.value.trim();
      if (!description) { textarea.style.borderColor = '#ef4444'; return; }

      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Reformatting…';
      cancelBtn.disabled = true;

      try {
        await reformatSection(section, description);
        overlay.remove();
        showStatus('Section reformatted ✓');
      } catch (err) {
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try Again';
        cancelBtn.disabled = false;
      }
    });
  }

  async function reformatSection(section, description) {
    const prompt = buildReformatPrompt(section, description);
    const responseText = await callGeminiAPI(prompt);
    const html = parseHTMLFromResponse(responseText);

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const newSection = tmp.firstElementChild;
    if (!newSection) throw new Error('AI returned no valid HTML element.');

    section.replaceWith(newSection);
    activateZone(newSection);
    refreshAddButtons();
    setDirty(true);
  }

  function buildReformatPrompt(section, description) {
    const styleEl = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    // Clean copy of the section — strip editor UI before sending to AI
    const clone = section.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));
    clone.querySelectorAll('[data-webby-bound]').forEach(el => el.removeAttribute('data-webby-bound'));

    return `You are reformatting an existing HTML section for a website.

STYLE CONTEXT (CSS variables and base styles in use):
<style>
${styleBlock}
</style>

EXISTING SECTION HTML (reformat this):
${clone.outerHTML}

REFORMAT INSTRUCTION:
"${description}"

RULES:
- Preserve ALL existing text content, images, and links exactly as-is unless the instruction explicitly says to change them
- Only change HTML structure, CSS classes, layout, and responsive behaviour
- Use only the CSS variables already defined in the style context — no hardcoded colours or sizes
- Keep data-zone and data-zone-label attributes on the <section> element
- Keep data-editable on all text elements and data-editable-image on all img elements
- Return ONLY the reformatted <section> element — no explanation, no markdown fences, nothing else`;
  }

  function injectAddSectionButtons() {
    const zones = Array.from(document.querySelectorAll('[data-zone]'));
    if (!zones.length) return;

    // Insert one add-button before the first zone
    zones[0].before(makeAddButton(null));

    // Insert one add-button after each zone
    zones.forEach(zone => zone.after(makeAddButton(zone)));
  }

  function refreshAddButtons() {
    document.querySelectorAll('.__webby-add-wrap').forEach(el => el.remove());
    injectAddSectionButtons();
  }

  function makeAddButton(insertAfterZone) {
    const wrap = el('div', { 'data-editor-ui': '', class: '__webby-add-wrap' });
    css(wrap, {
      display: 'flex',
      justifyContent: 'center',
      padding: '2px 0',
      opacity: '0',
      transition: 'opacity 0.2s',
    });

    const btn = el('button');
    btn.textContent = '+ Add Section';
    css(btn, {
      padding: '4px 16px',
      background: 'rgba(18,18,31,0.75)',
      color: '#e8e8f0',
      border: '1px dashed rgba(255,255,255,0.35)',
      borderRadius: '20px',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'system-ui, sans-serif',
      backdropFilter: 'blur(4px)',
      transition: 'background 0.15s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(59,130,246,0.8)'; btn.style.borderColor = 'transparent'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(18,18,31,0.75)'; btn.style.borderColor = 'rgba(255,255,255,0.35)'; });
    btn.addEventListener('click', () => promptAddSection(insertAfterZone));
    wrap.appendChild(btn);

    // Show wrap when neighboring zones are hovered, or the wrap itself
    const show = () => { wrap.style.opacity = '1'; };
    const hide = () => { wrap.style.opacity = '0'; };

    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', hide);

    if (insertAfterZone) {
      insertAfterZone.addEventListener('mouseenter', show);
      insertAfterZone.addEventListener('mouseleave', hide);
    }

    const nextZone = insertAfterZone
      ? insertAfterZone.nextElementSibling
      : document.querySelector('[data-zone]');
    if (nextZone && nextZone.hasAttribute('data-zone')) {
      nextZone.addEventListener('mouseenter', show);
      nextZone.addEventListener('mouseleave', hide);
    }

    return wrap;
  }

  // ─── Mutation Observer ────────────────────────────────────────────────────

  function bindMutationObserver() {
    mutationObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        // Ignore changes originating from editor UI itself
        if (m.target.closest && m.target.closest('[data-editor-ui]')) continue;
        if (m.target.nodeType === Node.ELEMENT_NODE && m.target.hasAttribute('data-editor-ui')) continue;
        if (m.type === 'characterData' || m.type === 'childList') {
          setDirty(true);
          return;
        }
      }
    });
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  // ─── Image Manager ────────────────────────────────────────────────────────

  function bindImageHandler(img) {
    css(img, { cursor: 'pointer' });

    // Overlay hint
    const parent = img.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const hint = el('div', { 'data-editor-ui': '' });
    hint.textContent = 'Click to replace image';
    css(hint, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      padding: '6px 12px',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.2s',
      whiteSpace: 'nowrap',
      zIndex: '10',
    });
    parent.appendChild(hint);

    img.addEventListener('mouseenter', () => { hint.style.opacity = '1'; });
    img.addEventListener('mouseleave', () => { hint.style.opacity = '0'; });

    img.addEventListener('click', () => {
      const input = el('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        if (input.files[0]) handleImageUpload(input.files[0], img);
      });
      input.click();
    });
  }

  async function handleImageUpload(file, imgEl) {
    showStatus('Uploading image...');
    try {
      const buffer = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(buffer);
      const path = `assets/${file.name}`;
      await github.uploadFile(path, b64);

      if (dirHandle) {
        // Folder is linked — save the image file locally so ./assets/... resolves correctly
        await writeImageToLocalDir(file);
        imgEl.src = `./${path}`;
        imgEl.removeAttribute('data-webby-src');
      } else {
        // No local file access — display via blob URL; serializer swaps to relative path
        imgEl.src = URL.createObjectURL(new Blob([buffer], { type: file.type }));
        imgEl.dataset.webbySrc = `./${path}`;
      }

      setDirty(true);
      showStatus('Image uploaded ✓');
    } catch (err) {
      showStatus('Image upload failed: ' + err.message, true);
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ─── AI Section Generator ─────────────────────────────────────────────────

  function promptAddSection(insertAfterZone) {
    const overlay = el('div', { 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.55)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const modal = el('div');
    css(modal, {
      background: '#fff',
      borderRadius: '10px',
      padding: '28px',
      width: '500px',
      maxWidth: '92vw',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:16px;color:#111;font-weight:700">Add New Section</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#666;line-height:1.5">
        Describe the section you want. Be specific — the more detail you give, the better the result.
      </p>
      <textarea
        id="__webby-ai-desc"
        placeholder="e.g. A testimonials section with 3 client quotes in cards, showing name, role, and a star rating"
        style="width:100%;height:96px;padding:10px 12px;border:1px solid #ddd;border-radius:6px;
               font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;
               line-height:1.5;outline:none;transition:border-color 0.15s;"
      ></textarea>
      <p id="__webby-ai-error" style="display:none;margin:8px 0 0;font-size:12px;color:#ef4444;"></p>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button id="__webby-ai-cancel"
          style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:6px;
                 cursor:pointer;font-size:13px;font-family:inherit;color:#444;">
          Cancel
        </button>
        <button id="__webby-ai-submit"
          style="padding:8px 18px;background:#3b82f6;color:#fff;border:none;border-radius:6px;
                 cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:background 0.15s;">
          Generate with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const textarea = modal.querySelector('#__webby-ai-desc');
    const errorEl = modal.querySelector('#__webby-ai-error');
    const submitBtn = modal.querySelector('#__webby-ai-submit');
    const cancelBtn = modal.querySelector('#__webby-ai-cancel');

    textarea.focus();
    textarea.addEventListener('focus', () => { textarea.style.borderColor = '#3b82f6'; });
    textarea.addEventListener('blur', () => { textarea.style.borderColor = '#ddd'; });

    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = '#2563eb'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = '#3b82f6'; });

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });

    submitBtn.addEventListener('click', async () => {
      const description = textarea.value.trim();
      if (!description) {
        textarea.style.borderColor = '#ef4444';
        return;
      }

      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Generating…';
      cancelBtn.disabled = true;

      try {
        await generateSection(description, insertAfterZone);
        overlay.remove();
        showStatus('Section added ✓');
      } catch (err) {
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try Again';
        cancelBtn.disabled = false;
      }
    });
  }

  async function generateSection(description, insertAfterZone) {
    const prompt = buildSectionPrompt(description);
    const responseText = await callGeminiAPI(prompt);
    const html = parseHTMLFromResponse(responseText);
    injectNewSection(html, insertAfterZone);
  }

  function buildSectionPrompt(description) {
    const styleEl = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    const exampleZone = document.querySelector('[data-zone]');
    let exampleHTML = '';
    if (exampleZone) {
      const clone = exampleZone.cloneNode(true);
      // Strip editor-injected attributes from example
      clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
      clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
      clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));
      exampleHTML = clone.outerHTML;
    }

    return `You are generating a new HTML section for a website.

STYLE CONTEXT (CSS variables and base styles in use):
<style>
${styleBlock}
</style>

EXISTING SECTION EXAMPLE (match this markup style and class patterns exactly):
${exampleHTML}

TASK:
Generate a single <section> element for the following description:
"${description}"

RULES:
- Use only the CSS variables already defined above — no hardcoded colors or sizes
- Match the class naming conventions shown in the example
- Include data-zone="{slug}" and data-zone-label="{Human Label}" on the <section>
- Add data-editable on every user-editable text element (headings, paragraphs, spans, list items)
- Add data-editable-image on any <img> elements; use src="./assets/placeholder.jpg"
- Use semantic, accessible HTML
- Return ONLY the raw <section> element — no explanation, no markdown fences, nothing else`;
  }

  async function callGeminiAPI(prompt) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!res.ok) {
      let errMsg = `Gemini API error ${res.status}`;
      try { errMsg = (await res.json()).error?.message || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }

  function parseHTMLFromResponse(text) {
    return text
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
  }

  function injectNewSection(html, insertAfterZone) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const section = tmp.firstElementChild;
    if (!section) throw new Error('AI returned no valid HTML element.');

    if (insertAfterZone) {
      // Insert after the zone's trailing add-button if it exists
      const next = insertAfterZone.nextElementSibling;
      if (next && next.classList.contains('__webby-add-wrap')) {
        next.after(section);
      } else {
        insertAfterZone.after(section);
      }
    } else {
      const firstZone = document.querySelector('[data-zone]');
      if (firstZone) {
        const prev = firstZone.previousElementSibling;
        if (prev && prev.classList.contains('__webby-add-wrap')) {
          prev.before(section);
        } else {
          firstZone.before(section);
        }
      } else {
        document.body.appendChild(section);
      }
    }

    activateZone(section);
    refreshAddButtons();
    setDirty(true);
  }

  // ─── Serializer / Exporter ────────────────────────────────────────────────

  // serialize({ local: false }) — for publish/export: strips secrets.js + webby.js so
  //   the deployed site has no editor code or credentials.
  // serialize({ local: true })  — for local file save: keeps those script tags so edit
  //   mode still activates next time the file is opened.
  function serialize({ local = false } = {}) {
    const clone = document.documentElement.cloneNode(true);

    // Remove all editor UI (toolbar, modals, buttons, hints)
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());

    // Remove editor-injected attributes
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));

    // Resolve locally-displayed blob URLs back to their published relative paths
    clone.querySelectorAll('img[data-webby-src]').forEach(img => {
      img.setAttribute('src', img.dataset.webbySrc);
      img.removeAttribute('data-webby-src');
    });

    // Remove internal binding marker added by activateZone
    clone.querySelectorAll('img[data-webby-bound]').forEach(img => {
      img.removeAttribute('data-webby-bound');
    });

    // For publish/export only: strip secrets.js and webby.js so they never go live
    if (!local) {
      clone.querySelectorAll('script').forEach(s => {
        const src = s.getAttribute('src') || '';
        if (src.includes('secrets.js') || src.includes('webby.js')) s.remove();
      });
    }

    // Restore original body padding
    const body = clone.querySelector('body');
    if (body) {
      if (originalBodyPaddingTop) {
        body.style.paddingTop = originalBodyPaddingTop;
      } else {
        body.style.removeProperty('padding-top');
      }
    }

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function exportToFile() {
    const html = serialize();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'index.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDirty(false);
    clearDraftCache();
    showStatus('Exported ✓');
  }

  // ─── GitHub Publisher ─────────────────────────────────────────────────────

  const github = {
    headers() {
      return {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
    },

    async getFileSHA(path) {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
        { headers: this.headers() }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub ${res.status}: could not fetch file SHA`);
      return (await res.json()).sha;
    },

    async putFile(path, content, sha) {
      const body = {
        message: 'Update site content via Webby',
        content: btoa(unescape(encodeURIComponent(content))),
        branch,
      };
      if (sha) body.sha = sha;

      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
        { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) }
      );
      if (!res.ok) {
        let msg = `GitHub ${res.status}`;
        try { msg = (await res.json()).message || msg; } catch (_) {}
        throw new Error(msg);
      }
    },

    async uploadFile(path, base64Content) {
      const sha = await this.getFileSHA(path);
      const body = {
        message: `Upload asset: ${path}`,
        content: base64Content,
        branch,
      };
      if (sha) body.sha = sha;

      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
        { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) }
      );
      if (!res.ok) {
        let msg = `GitHub upload error ${res.status}`;
        try { msg = (await res.json()).message || msg; } catch (_) {}
        throw new Error(msg);
      }
    },
  };

  async function publishSite() {
    if (!githubToken || !repo) {
      showStatus('Missing GitHub credentials in secrets.js', true);
      return;
    }

    const publishBtn = document.getElementById('__webby-publish-btn') ||
      document.querySelector('[data-editor-ui]'); // fallback
    const btns = document.querySelectorAll('#__webby-toolbar button');

    btns.forEach(b => { b.disabled = true; });
    showStatus('Publishing…');

    try {
      const html = serialize();
      const sha = await github.getFileSHA('index.html');
      await github.putFile('index.html', html, sha);
      setDirty(false);
      clearDraftCache();
      showStatus('Published ✓ — deploying…');
    } catch (err) {
      showStatus('Publish failed: ' + err.message, true);
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // ─── Theme Editor ─────────────────────────────────────────────────────────

  function openThemeEditor() {
    if (document.getElementById('__webby-theme-panel')) {
      document.getElementById('__webby-theme-panel').remove();
      return;
    }

    const styleEl = document.querySelector('style');
    if (!styleEl) {
      showStatus('No <style> block found', true);
      return;
    }

    const vars = parseCSSVars(styleEl.textContent);
    if (!Object.keys(vars).length) {
      showStatus('No CSS variables found in <style>', true);
      return;
    }

    const panel = el('div', { id: '__webby-theme-panel', 'data-editor-ui': '' });
    css(panel, {
      position: 'fixed',
      top: '44px',
      right: '0',
      bottom: '0',
      width: '270px',
      background: '#fff',
      borderLeft: '1px solid #e5e7eb',
      zIndex: '999998',
      overflowY: 'auto',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
    });

    // Header
    const header = el('div');
    css(header, {
      padding: '12px 16px',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: '0',
      background: '#fff',
      zIndex: '1',
    });
    header.innerHTML = `<strong style="font-size:13px;color:#111">Theme Variables</strong>
      <button style="background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;line-height:1;">&times;</button>`;
    header.querySelector('button').addEventListener('click', () => panel.remove());

    // Content
    const content = el('div');
    css(content, { padding: '12px 16px 24px' });

    const groups = groupVars(vars);
    for (const [groupName, groupVars] of Object.entries(groups)) {
      const section = el('div');
      css(section, { marginBottom: '20px' });

      const groupTitle = el('div');
      groupTitle.textContent = groupName;
      css(groupTitle, {
        fontWeight: '700',
        textTransform: 'uppercase',
        fontSize: '10px',
        color: '#9ca3af',
        letterSpacing: '0.08em',
        marginBottom: '10px',
      });
      section.appendChild(groupTitle);

      for (const [varName, varValue] of Object.entries(groupVars)) {
        const row = el('div');
        css(row, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' });

        const label = el('label');
        label.textContent = varName.replace(/^--/, '');
        label.title = varName;
        css(label, {
          flex: '1',
          color: '#374151',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        });

        const trimmed = varValue.trim();
        const isColor = /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
          /^rgba?\(/.test(trimmed) ||
          /^hsla?\(/.test(trimmed);

        let input;
        if (isColor) {
          input = el('input');
          input.type = 'color';
          input.value = toHex(trimmed);
          css(input, { width: '36px', height: '26px', padding: '1px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' });
        } else {
          input = el('input');
          input.type = 'text';
          input.value = trimmed;
          css(input, { width: '110px', padding: '3px 7px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' });
        }

        input.addEventListener('input', () => {
          document.documentElement.style.setProperty(varName, input.value);
          updateStyleVar(styleEl, varName, input.value);
          setDirty(true);
        });

        row.append(label, input);
        section.appendChild(row);
      }
      content.appendChild(section);
    }

    panel.append(header, content);
    document.body.appendChild(panel);
  }

  function parseCSSVars(css) {
    const vars = {};
    const re = /(--[\w-]+)\s*:\s*([^;}\n]+)/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      vars[m[1].trim()] = m[2].trim();
    }
    return vars;
  }

  function groupVars(vars) {
    const groups = { Colors: {}, Typography: {}, Spacing: {}, Layout: {} };
    for (const [k, v] of Object.entries(vars)) {
      if (k.includes('color')) groups.Colors[k] = v;
      else if (k.includes('font') || k.includes('line-height')) groups.Typography[k] = v;
      else if (k.includes('space')) groups.Spacing[k] = v;
      else groups.Layout[k] = v;
    }
    // Remove empty groups
    return Object.fromEntries(Object.entries(groups).filter(([, g]) => Object.keys(g).length));
  }

  function updateStyleVar(styleEl, varName, value) {
    // Escape special regex chars in varName
    const escaped = varName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    styleEl.textContent = styleEl.textContent.replace(
      new RegExp(`(${escaped}\\s*:\\s*)[^;\\n}]+`),
      `$1${value}`
    );
  }

  function toHex(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      const [, a, b, c] = color;
      return `#${a}${a}${b}${b}${c}${c}`;
    }
    // Resolve via a temp element
    const tmp = document.createElement('div');
    tmp.style.color = color;
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    tmp.remove();
    const m = computed.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
    return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function el(tag, attrs = {}) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    return node;
  }

  function css(node, styles) {
    Object.assign(node.style, styles);
  }

  // ─── Link Editor ──────────────────────────────────────────────────────────

  let activeLinkPopover = null;

  function bindLinkHandlers() {
    // Capture phase so we intercept before the browser follows the href
    document.addEventListener('click', handleLinkClick, true);
  }

  function handleLinkClick(e) {
    // Let editor UI links (toolbar buttons etc.) work normally
    if (e.target.closest('[data-editor-ui]')) return;

    const link = e.target.closest('a');
    if (!link) {
      // Click outside any link — close popover if open
      if (activeLinkPopover && !activeLinkPopover.contains(e.target)) {
        closeLinkPopover();
      }
      return;
    }

    // Only intercept links inside editable zones
    if (!link.closest('[data-zone]')) return;

    e.preventDefault();
    e.stopPropagation();
    openLinkPopover(link);
  }

  function openLinkPopover(link) {
    closeLinkPopover();

    const popover = el('div', { 'data-editor-ui': '', id: '__webby-link-popover' });
    css(popover, {
      position: 'fixed',
      zIndex: '1000001',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '14px 16px',
      width: '320px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
    });

    popover.innerHTML = `
      <div style="font-weight:600;color:#111;margin-bottom:12px;font-size:12px;
                  text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;">Edit Link</div>

      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Display text</span>
        <input id="__webby-link-text" type="text" value=""
          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;
                 font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;" />
      </label>

      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">URL</span>
        <input id="__webby-link-url" type="text" value=""
          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;
                 font-size:13px;box-sizing:border-box;font-family:monospace;outline:none;" />
      </label>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
        <input id="__webby-link-blank" type="checkbox"
          style="width:15px;height:15px;cursor:pointer;accent-color:#3b82f6;" />
        <span style="font-size:12px;color:#374151;">Open in new tab</span>
      </label>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="__webby-link-remove"
          style="padding:5px 11px;border:1px solid #fca5a5;background:#fff;color:#ef4444;
                 border-radius:5px;cursor:pointer;font-size:12px;font-family:inherit;">
          Remove link
        </button>
        <button id="__webby-link-done"
          style="padding:5px 14px;background:#3b82f6;color:#fff;border:none;
                 border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">
          Done
        </button>
      </div>
    `;

    document.body.appendChild(popover);
    activeLinkPopover = popover;

    // Populate fields
    const textInput = popover.querySelector('#__webby-link-text');
    const urlInput = popover.querySelector('#__webby-link-url');
    const blankCheck = popover.querySelector('#__webby-link-blank');

    textInput.value = link.textContent;
    urlInput.value = link.getAttribute('href') || '';
    blankCheck.checked = link.getAttribute('target') === '_blank';

    // Position below the link, within viewport
    positionPopover(popover, link);

    // Live updates
    textInput.addEventListener('input', () => {
      link.textContent = textInput.value;
      setDirty(true);
    });
    urlInput.addEventListener('input', () => {
      link.setAttribute('href', urlInput.value);
      setDirty(true);
    });
    blankCheck.addEventListener('change', () => {
      if (blankCheck.checked) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
      setDirty(true);
    });

    popover.querySelector('#__webby-link-done').addEventListener('click', closeLinkPopover);

    popover.querySelector('#__webby-link-remove').addEventListener('click', () => {
      // Unwrap: replace <a> with its text content
      const text = document.createTextNode(link.textContent);
      link.replaceWith(text);
      setDirty(true);
      closeLinkPopover();
    });

    // Focus URL field if empty, otherwise text field
    if (!urlInput.value) {
      urlInput.focus();
    } else {
      textInput.focus();
      textInput.select();
    }
  }

  function closeLinkPopover() {
    if (activeLinkPopover) {
      activeLinkPopover.remove();
      activeLinkPopover = null;
    }
  }

  function positionPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const popH = 230; // approximate height before render
    const popW = 320;

    let top = rect.bottom + margin;
    let left = rect.left;

    // Flip above if not enough space below
    if (top + popH > window.innerHeight - margin) {
      top = rect.top - popH - margin;
    }
    // Clamp horizontally
    if (left + popW > window.innerWidth - margin) {
      left = window.innerWidth - popW - margin;
    }
    if (left < margin) left = margin;

    css(popover, { top: top + 'px', left: left + 'px' });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    // localStorage restore only applies in the fallback (no File System Access) path.
    // When the folder is linked, the file on disk is always up to date — no restore needed.
    if (!FS_SUPPORTED) {
      const restored = restoreFromCache();
      if (restored) setDirty(true);
    }

    injectToolbar();
    activateZones();
    bindMutationObserver();
    bindLinkHandlers();
    showStatus('Edit mode active');

    // Async — silently re-links folder if previously granted, else shows banner
    await initFileAccess();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Webby = { version: VERSION, serialize, exportToFile, publish: publishSite };

})();
