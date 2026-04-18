/**
 * webby.js — v1.1.0
 * Zero-dependency browser-based site editor.
 * Activates only when window.SITE_SECRETS is present (local edit mode).
 * Stripped from exported/published HTML automatically.
 */
(function () {
  'use strict';

  const VERSION = '1.1.0';

  if (!window.SITE_SECRETS) return;

  const { geminiKey, githubToken, repo, branch = 'main' } = window.SITE_SECRETS;

  // ─── State ────────────────────────────────────────────────────────────────

  let isDirty = false;
  let mutationObserver = null;
  let statusTimer = null;
  let originalBodyPaddingTop = '';
  let originalNavTop = null; // set when a fixed nav is shifted down for the toolbar
  let autoSaveTimer = null;
  let dirHandle = null; // FileSystemDirectoryHandle when folder access is granted
  let pagesInventory = null; // { pages: [{ file, title, navLabel }] } — loaded from webby-pages.json
  let lastSyncedNavHTML = ''; // snapshot of nav after last sync; change detection for auto-save

  const UNDO_LIMIT = 20;
  let undoStack = [];
  let redoStack = [];

  // Webby requires the File System Access API. Only Chromium-based browsers
  // (Chrome, Edge) are supported. Safari and Firefox are not supported.
  if (!('showDirectoryPicker' in window)) {
    const msg = document.createElement('div');
    Object.assign(msg.style, {
      position: 'fixed', inset: '0', zIndex: '9999999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(18,18,31,0.92)', fontFamily: 'system-ui, sans-serif',
    });
    msg.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:32px 36px;max-width:420px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.3);">
        <div style="font-size:32px;margin-bottom:12px;">🌐</div>
        <h2 style="margin:0 0 10px;font-size:17px;color:#111;">Unsupported Browser</h2>
        <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
          Webby requires access to the local file system and works in
          <strong>Chrome</strong> and <strong>Edge</strong>.<br><br>
          Please open this page in Chrome or Edge to use the editor.
        </p>
      </div>`;
    document.body.appendChild(msg);
    return;
  }

  // Derive the current page's filename from the URL (e.g. "about.html", "index.html")
  const CURRENT_FILENAME = (location.pathname.split('/').pop()) || 'index.html';

  // Key the stored folder handle by site directory so all pages in the same folder
  // share one handle — previously keyed by pathname which differed per page.
  const _siteDir = location.href.substring(0, location.href.lastIndexOf('/') + 1);
  const HANDLE_KEY = 'dir:' + _siteDir;

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

    const undoBtn = toolbarBtn('↩');
    undoBtn.id = '__webby-undo-btn';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.35';

    const redoBtn = toolbarBtn('↪');
    redoBtn.id = '__webby-redo-btn';
    redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    redoBtn.disabled = true;
    redoBtn.style.opacity = '0.35';

    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);

    const pagesBtn = toolbarBtn('Pages');
    const themeBtn = toolbarBtn('Theme');
    const exportBtn = toolbarBtn('Export');
    const publishBtn = toolbarBtn('Publish', true);

    pagesBtn.addEventListener('click', openPagesPanel);
    themeBtn.addEventListener('click', openThemeEditor);
    exportBtn.addEventListener('click', exportToFile);
    publishBtn.addEventListener('click', publishSite);

    bar.append(title, spacer, status, undoBtn, redoBtn, pagesBtn, themeBtn, exportBtn, publishBtn);
    document.body.prepend(bar);

    // Push body content down so toolbar doesn't overlap
    originalBodyPaddingTop = document.body.style.paddingTop || '';
    const current = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    document.body.style.paddingTop = (current + 44) + 'px';

    // If the page has a fixed nav, shift it down so the toolbar doesn't overlap it
    const nav = document.querySelector('nav');
    if (nav && getComputedStyle(nav).position === 'fixed') {
      originalNavTop = nav.style.top || '';
      const navTop = parseFloat(getComputedStyle(nav).top) || 0;
      nav.style.top = (navTop + 44) + 'px';
    }
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
  // File System Access API (Chrome, Edge):
  //   - User selects their site folder once; handle is stored in IndexedDB.
  //   - Auto-save writes the current page to disk; images are saved to assets/.
  //   - On reload the file on disk is always current — nothing to restore.

  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveChanges, 1500);
  }

  async function saveChanges() {
    if (dirHandle) {
      await writeCurrentPageToLocalFile();
      await syncNavToOtherPagesIfChanged();
    }
    // No dirHandle yet — changes accumulate in the DOM until the folder is linked.
  }

  // ── File System Access path ──────────────────────────────────────────────

  async function writeCurrentPageToLocalFile() {
    try {
      const fh = await dirHandle.getFileHandle(CURRENT_FILENAME, { create: true });
      const writable = await fh.createWritable();
      await writable.write(serialize({ local: true }));
      await writable.close();
    } catch (e) {
      // Lost access (e.g. folder moved) — drop handle and prompt re-link
      dirHandle = null;
      showAccessBanner();
    }
  }

  // Write any page file (used when creating new pages or syncing other pages)
  async function writePageToLocalFile(filename, content) {
    if (!dirHandle) return;
    try {
      const fh = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (_) {}
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
      tx.objectStore('handles').put(handle, HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadHandleFromDB() {
    const db = await openHandleDB();
    // Try the current key first
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (handle) return handle;

    // Migration: v1.0.x stored the handle under the page pathname, not the site directory.
    // Try that old key format and re-store under the new key if found.
    const oldKey = 'dir:' + location.pathname;
    if (oldKey === HANDLE_KEY) return null; // same key — nothing to migrate
    const legacyHandle = await new Promise(resolve => {
      try {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get(oldKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    if (legacyHandle) {
      // Re-store under the new key so future loads use the correct key
      await storeHandleInDB(legacyHandle);
    }
    return legacyHandle;
  }

  async function verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (await handle.requestPermission(opts) === 'granted') return true;
    return false;
  }

  // Called at init — silently restores folder access or shows the access banner
  // Called at init — silently restores folder access or shows the link banner
  async function initFileAccess() {
    try {
      const stored = await loadHandleFromDB();
      if (stored && await verifyPermission(stored)) {
        dirHandle = stored;
        await loadPagesInventory(); // load or seed the pages manifest
        return; // Silent success — folder is linked, auto-save is active
      }
    } catch (_) {}
    showAccessBanner();
  }

  // Blocking modal — the editor cannot save without a linked, writable folder,
  // so the overlay covers the page and has no dismiss button. It only closes
  // once showDirectoryPicker returns a handle with readwrite permission granted.
  function showAccessBanner() {
    if (document.getElementById('__webby-access-banner')) return;

    const overlay = el('div', { id: '__webby-access-banner', 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999999',
      background: 'rgba(18,18,31,0.92)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
      padding: '20px',
      boxSizing: 'border-box',
    });

    const hintPath = location.protocol === 'file:'
      ? decodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')))
      : null;
    const hintHtml = hintPath
      ? `<div style="margin-top:14px;background:#f3f4f6;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:12px;color:#374151;word-break:break-all;">${hintPath}</div>`
      : '';

    const modal = el('div');
    css(modal, {
      background: '#fff',
      borderRadius: '12px',
      padding: '32px 36px',
      maxWidth: '480px',
      width: '100%',
      textAlign: 'center',
      boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
      boxSizing: 'border-box',
    });

    modal.innerHTML = `
      <div style="font-size:36px;margin-bottom:14px;">💾</div>
      <h2 style="margin:0 0 10px;font-size:18px;color:#111;">Folder access required</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#555;line-height:1.6;">
        Webby needs write access to your site folder so edits save directly to your files.
        Without this permission, the editor cannot save your changes.
      </p>
      ${hintHtml}
      <button id="__webby-banner-grant"
        style="margin-top:22px;background:#3b82f6;color:#fff;border:none;font-weight:600;padding:10px 22px;border-radius:6px;cursor:pointer;font-size:14px;font-family:inherit;">
        Select Folder
      </button>
      <div id="__webby-banner-error" style="margin-top:12px;font-size:12px;color:#ef4444;min-height:16px;"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const errEl = modal.querySelector('#__webby-banner-error');
    modal.querySelector('#__webby-banner-grant').addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
        // Confirm the handle is actually writable before clearing the overlay
        if (!(await verifyPermission(handle))) {
          errEl.textContent = 'Write permission was not granted. Please try again.';
          return;
        }
        dirHandle = handle;
        await storeHandleInDB(handle);
        overlay.remove();
        await writeCurrentPageToLocalFile();
        await loadPagesInventory();
        lastSyncedNavHTML = getNavHTML();
        showStatus('Folder linked ✓ — edits now save to your files automatically');
      } catch (e) {
        if (e.name !== 'AbortError') errEl.textContent = e.message || 'Could not access folder';
      }
    });
  }

  // ─── Pages Inventory ──────────────────────────────────────────────────────
  //
  // webby-pages.json tracks all pages managed by the editor.
  // It lives alongside the HTML files in the site folder and is pushed to GitHub on publish.
  // Structure: { "pages": [{ "file": "index.html", "title": "Home", "navLabel": "Home" }] }

  async function loadPagesInventory() {
    if (!dirHandle) {
      // No folder access — seed a minimal in-memory inventory for the current page
      pagesInventory = { pages: [{ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME }] };
      return;
    }
    try {
      const fh = await dirHandle.getFileHandle('webby-pages.json');
      const inventoryFile = await fh.getFile();
      pagesInventory = JSON.parse(await inventoryFile.text());
      // Ensure the current page is registered
      if (!pagesInventory.pages.find(p => p.file === CURRENT_FILENAME)) {
        pagesInventory.pages.push({ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME });
        await savePagesInventory();
      }
    } catch (_) {
      // File doesn't exist yet — seed from the current page and write it
      pagesInventory = { pages: [{ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME }] };
      await savePagesInventory();
    }
  }

  async function savePagesInventory() {
    if (!dirHandle || !pagesInventory) return;
    try {
      const fh = await dirHandle.getFileHandle('webby-pages.json', { create: true });
      const writable = await fh.createWritable();
      await writable.write(JSON.stringify(pagesInventory, null, 2));
      await writable.close();
    } catch (_) {}
  }

  // ─── Nav Sync ─────────────────────────────────────────────────────────────
  //
  // On every auto-save we snapshot the current nav and compare against the last
  // synced version. If it changed, we push the updated nav into every other local
  // page file. This covers all edit paths: link popover, AI reformat, direct typing.

  function getNavHTML() {
    const nav = document.querySelector('nav');
    if (!nav) return '';
    const clone = nav.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
    clone.removeAttribute('data-webby-nav-bound');
    return clone.outerHTML;
  }

  async function syncNavToOtherPagesIfChanged() {
    if (!dirHandle || !pagesInventory) return;
    const currentNavHTML = getNavHTML();
    if (!currentNavHTML || currentNavHTML === lastSyncedNavHTML) return;

    for (const page of pagesInventory.pages) {
      if (page.file === CURRENT_FILENAME) continue;
      try {
        const fh = await dirHandle.getFileHandle(page.file);
        const pageFile = await fh.getFile();
        const text = await pageFile.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const existingNav = doc.querySelector('nav');
        if (!existingNav) continue;
        const tmp = document.createElement('div');
        tmp.innerHTML = currentNavHTML;
        const newNav = tmp.querySelector('nav');
        if (!newNav) continue;
        existingNav.replaceWith(newNav);
        const updated = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        const writeFh = await dirHandle.getFileHandle(page.file, { create: false });
        const writable = await writeFh.createWritable();
        await writable.write(updated);
        await writable.close();
      } catch (_) {} // Non-fatal — skip pages that can't be read/written
    }

    lastSyncedNavHTML = currentNavHTML;
  }

  // ─── Zone Manager ─────────────────────────────────────────────────────────

  function activateZones() {
    document.querySelectorAll('[data-zone]').forEach(zone => activateZone(zone));
    injectAddSectionButtons();
  }

  function preventBlockOnEnter(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // execCommand('insertLineBreak') inserts <br> and positions the cursor correctly,
    // avoiding the <div>-wrapping that browsers default to in contenteditable.
    document.execCommand('insertLineBreak');
  }

  function activateZone(section) {
    section.querySelectorAll('[data-editable]').forEach(node => {
      node.contentEditable = 'true';
      node.setAttribute('spellcheck', 'true');
      // Browsers (especially Chrome) insert <div> on Enter inside contenteditable,
      // which breaks styling and leaves new content without data-editable.
      // Force <br> instead so inline text elements stay flat.
      node.addEventListener('keydown', preventBlockOnEnter);
    });
    // Bind image handlers to ALL images in the zone — not just those with
    // data-editable-image, so bootstrap-generated images are always editable.
    section.querySelectorAll('img').forEach(img => {
      if (img.closest('[data-editor-ui]')) return;
      if (img.dataset.webbyBound) return; // already activated (e.g. re-injection)
      img.dataset.webbyBound = '1';
      bindImageHandler(img);
    });
    // Ensure the section has an id matching its zone slug so anchor links work when deployed
    if (section.dataset.zone && !section.id) section.id = section.dataset.zone;
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
      top: '60px',
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
      if (!confirm(`Delete "${label}"?`)) return;
      snapshotForUndo();
      // Clean up adjacent add-button
      const next = section.nextElementSibling;
      if (next && next.classList.contains('__webby-add-wrap')) next.remove();
      // Clean up any section-specific style block
      const slug = section.dataset.zone;
      if (slug) {
        const sectionStyle = document.getElementById('__webby-section-' + slug + '-styles');
        if (sectionStyle) sectionStyle.remove();
      }
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
      top: '60px',
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

    // Highlight the section outline while hovering the reformat button
    btn.addEventListener('mouseenter', () => {
      section.style.outline = '2px solid rgba(59,130,246,0.6)';
      section.style.outlineOffset = '-2px';
    });
    btn.addEventListener('mouseleave', () => {
      section.style.outline = '';
      section.style.outlineOffset = '';
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
        placeholder="e.g. Remove the section title and add a third box to the right of the other two.  Add a centered button at the bottom of each box."
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

    let sectionPending = false;
    const close = () => { if (!sectionPending) overlay.remove(); };
    cancelBtn.addEventListener('click', close);
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
      textarea.disabled = true;
      sectionPending = true;

      try {
        snapshotForUndo();
        await reformatSection(section, description);
        overlay.remove();
        showStatus('Section reformatted ✓');
      } catch (err) {
        sectionPending = false;
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try Again';
        cancelBtn.disabled = false;
        textarea.disabled = false;
      }
    });
  }

  async function reformatSection(section, description) {
    const prompt = buildReformatPrompt(section, description);
    const responseText = await callGeminiAPI(prompt);
    const { css, html } = parseSectionResponse(responseText);

    if (!html) throw new Error('AI returned no valid HTML element.');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const newSection = tmp.querySelector('section');
    if (!newSection) throw new Error('AI returned no valid HTML element.');

    // Upsert a dedicated style element keyed to this section's zone slug
    const slug = section.dataset.zone || ('section-' + Date.now());
    const styleId = '__webby-section-' + slug + '-styles';
    let sectionStyleEl = document.getElementById(styleId);
    if (!sectionStyleEl) {
      sectionStyleEl = document.createElement('style');
      sectionStyleEl.id = styleId;
      document.head.appendChild(sectionStyleEl);
    }
    if (css) sectionStyleEl.textContent = css;

    section.replaceWith(newSection);
    activateZone(newSection);
    refreshAddButtons();
    setDirty(true);
  }

  function parseSectionResponse(text) {
    const cssMatch  = text.match(/<section-css>([\s\S]*?)<\/section-css>/);
    const htmlMatch = text.match(/<section-html>([\s\S]*?)<\/section-html>/);
    return {
      css:  cssMatch  ? cssMatch[1].trim()  : '',
      html: htmlMatch ? htmlMatch[1].trim() : text.trim(), // fallback: treat whole response as HTML
    };
  }

  function buildReformatPrompt(section, description) {
    const styleEl = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    // Include any existing section-specific styles so AI can build on them
    const slug = section.dataset.zone || '';
    const existingStyleEl = slug ? document.getElementById('__webby-section-' + slug + '-styles') : null;
    const existingSectionCSS = existingStyleEl ? existingStyleEl.textContent : '';

    // Clean copy of the section — strip editor UI before sending to AI
    const clone = section.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));
    clone.querySelectorAll('[data-webby-bound]').forEach(el => el.removeAttribute('data-webby-bound'));

    return `You are reformatting an existing HTML section for a website — both its HTML structure and its CSS.

CSS VARIABLES IN USE (use these, never hardcode colours or sizes):
${styleBlock}

${existingSectionCSS ? `EXISTING SECTION-SPECIFIC CSS (currently in a separate style block):\n${existingSectionCSS}\n` : ''}
EXISTING SECTION HTML (reformat this):
${clone.outerHTML}

REFORMAT INSTRUCTION:
"${description}"

RULES:
- Preserve ALL existing text content, images, and links exactly as-is unless the instruction explicitly says to change them
- You may freely change HTML structure, CSS classes, layout, responsive behaviour, and media queries
- Use only the CSS variables defined above — no hardcoded colours or font sizes
- Keep data-zone and data-zone-label attributes on the <section> element
- Keep data-editable on all text elements and data-editable-image on all img elements
- Return your response in EXACTLY this format with no other text:

<section-css>
/* all CSS needed for this section, including media queries */
</section-css>

<section-html>
<section>...</section>
</section-html>`;
  }

  // ─── Nav Editor ───────────────────────────────────────────────────────────

  function activateNav() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    if (nav.dataset.webbyNavBound) return;
    nav.dataset.webbyNavBound = '1';

    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = '⟳ Reformat Nav';
    css(btn, {
      position: 'absolute',
      top: '4px',
      right: '4px',
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

    nav.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    });
    nav.addEventListener('mouseleave', () => {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    });

    btn.addEventListener('mouseenter', () => {
      nav.style.outline = '2px solid rgba(59,130,246,0.6)';
      nav.style.outlineOffset = '-2px';
    });
    btn.addEventListener('mouseleave', () => {
      nav.style.outline = '';
      nav.style.outlineOffset = '';
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      promptReformatNav(nav);
    });

    if (getComputedStyle(nav).position === 'static') {
      nav.style.position = 'relative';
    }
    nav.appendChild(btn);
  }

  function promptReformatNav(nav) {
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

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:28px 24px;width:480px;max-width:94vw;box-shadow:0 16px 48px rgba(0,0,0,0.22);font-family:system-ui,sans-serif;">
        <h3 style="margin:0 0 6px;font-size:16px;color:#111;font-weight:700">Reformat: Navigation</h3>
        <p style="margin:0 0 14px;font-size:13px;color:#555;">Describe how to restructure the navigation. Links and labels are preserved unless you ask to change them.</p>
        <textarea
          id="__webby-reformat-nav-desc"
          placeholder="e.g. Make it a sticky horizontal bar with the logo on the left and links on the right, with a hamburger menu on mobile"
          style="width:100%;box-sizing:border-box;height:90px;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;outline:none;"
        ></textarea>
        <p id="__webby-reformat-nav-error" style="display:none;margin:8px 0 0;font-size:12px;color:#ef4444;"></p>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
          <button id="__webby-reformat-nav-cancel"
            style="padding:7px 16px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;font-family:inherit;">
            Cancel
          </button>
          <button id="__webby-reformat-nav-submit"
            style="padding:7px 16px;border:none;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600;">
            Reformat with AI
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#__webby-reformat-nav-desc');
    const errorEl  = overlay.querySelector('#__webby-reformat-nav-error');
    const submitBtn = overlay.querySelector('#__webby-reformat-nav-submit');
    const cancelBtn = overlay.querySelector('#__webby-reformat-nav-cancel');

    setTimeout(() => textarea.focus(), 50);

    textarea.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitBtn.click();
    });

    let navPending = false;
    cancelBtn.addEventListener('click', () => { if (!navPending) overlay.remove(); });

    submitBtn.addEventListener('click', async () => {
      const description = textarea.value.trim();
      if (!description) { textarea.focus(); return; }
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Reformatting…';
      cancelBtn.disabled = true;
      textarea.disabled = true;
      navPending = true;
      try {
        snapshotForUndo();
        await reformatNav(nav, description);
        overlay.remove();
        showStatus('Nav reformatted ✓');
      } catch (err) {
        navPending = false;
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reformat with AI';
        cancelBtn.disabled = false;
        textarea.disabled = false;
      }
    });
  }

  async function reformatNav(nav, description) {
    const prompt = buildReformatNavPrompt(nav, description);
    const responseText = await callGeminiAPI(prompt);
    const { css, html } = parseNavResponse(responseText);

    if (!html) throw new Error('AI did not return a valid <nav> element.');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const newNav = tmp.querySelector('nav');
    if (!newNav) throw new Error('AI did not return a valid <nav> element.');

    // Upsert a dedicated nav style element so we never touch the main <style> block
    let navStyleEl = document.getElementById('__webby-nav-styles');
    if (!navStyleEl) {
      navStyleEl = document.createElement('style');
      navStyleEl.id = '__webby-nav-styles';
      document.head.appendChild(navStyleEl);
    }
    if (css) navStyleEl.textContent = css;

    delete newNav.dataset.webbyNavBound;
    nav.replaceWith(newNav);

    // Re-apply toolbar offset to the new nav if it is fixed
    if (getComputedStyle(newNav).position === 'fixed') {
      const navTop = parseFloat(getComputedStyle(newNav).top) || 0;
      if (navTop < 44) newNav.style.top = '44px';
    }

    // Scripts inside dynamically-inserted HTML don't execute automatically.
    // Re-run them now so hamburger toggle listeners are bound to the new nav elements.
    rerunInlineScripts(newNav);

    activateNav();

    // Force immediate sync to other pages — don't rely on the auto-save timer
    // for a deliberate nav change (same pattern as generatePage / deletePageFromSite).
    lastSyncedNavHTML = '';
    await syncNavToOtherPagesIfChanged();

    setDirty(true);
  }

  function parseNavResponse(text) {
    const cssMatch  = text.match(/<nav-css>([\s\S]*?)<\/nav-css>/);
    const htmlMatch = text.match(/<nav-html>([\s\S]*?)<\/nav-html>/);
    return {
      css:  cssMatch  ? cssMatch[1].trim()  : '',
      html: htmlMatch ? htmlMatch[1].trim() : text.trim(), // fallback: treat whole response as HTML
    };
  }

  function buildReformatNavPrompt(nav, description) {
    const styleEl = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    // Include any existing nav-specific styles so AI can see what's already there
    const existingNavStyles = document.getElementById('__webby-nav-styles');
    const existingNavCSS = existingNavStyles ? existingNavStyles.textContent : '';

    const clone = nav.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
    clone.removeAttribute('data-webby-nav-bound');

    return `You are making a targeted change to an existing website navigation element.

CSS VARIABLES IN USE (use these if any style changes are needed — never hardcode colours or sizes):
${styleBlock}
${existingNavCSS ? `
EXISTING NAV-SPECIFIC CSS (this is the live CSS currently driving the nav):
${existingNavCSS}
` : ''}
EXISTING NAV HTML:
${clone.outerHTML}

CHANGE INSTRUCTION:
"${description}"

RULES:
- Make ONLY the changes required by the instruction — leave everything else exactly as-is
- Preserve ALL existing JavaScript, event handlers, and inline <script> elements unless explicitly told to change them
- Preserve ALL existing CSS classes, IDs, data attributes, and aria attributes unless directly involved in the change
- Preserve ALL mobile responsive behaviour, hamburger menu functionality, and CSS media queries unless explicitly told to change them
- If the instruction only involves adding, removing, or renaming links: modify ONLY those elements in the HTML — make no CSS changes and return no <nav-css> block
- If CSS changes ARE required: use only the CSS variables defined above, keep the hamburger menu working (position fixed/absolute, solid background, z-index 9000+, closes on link click and desktop resize)
- For any inline <script> toggle logic: bind events to the <nav> element (not document or window) using event delegation via currentScript, e.g.: (function(){ const n=document.currentScript.closest('nav'); n.addEventListener('click',function(e){ if(e.target.closest('.your-toggle-class')) toggle(); }); })(). This way listeners are cleaned up automatically when the nav is replaced and re-bound when the script re-runs.
- Return your response in EXACTLY this format — include <nav-css> ONLY if CSS actually needs to change:

<nav-html>
<nav>...</nav>
</nav-html>

<nav-css>
/* include this block ONLY if CSS changes are needed; omit entirely for link-only changes */
</nav-css>`;
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

  // ─── Pages Manager ────────────────────────────────────────────────────────

  function openPagesPanel() {
    const existing = document.getElementById('__webby-pages-panel');
    if (existing) { existing.remove(); return; }

    // Close theme panel if open
    const themePanel = document.getElementById('__webby-theme-panel');
    if (themePanel) themePanel.remove();

    if (!pagesInventory) {
      showStatus('Link your site folder to manage pages', true);
      return;
    }

    const panel = el('div', { id: '__webby-pages-panel', 'data-editor-ui': '' });
    css(panel, {
      position: 'fixed',
      top: '44px',
      right: '0',
      bottom: '0',
      width: '270px',
      background: '#fff',
      borderLeft: '1px solid #e5e7eb',
      zIndex: '999998',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
      display: 'flex',
      flexDirection: 'column',
    });

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
      flexShrink: '0',
    });
    header.innerHTML = `<strong style="font-size:13px;color:#111">Pages</strong>
      <button id="__webby-pages-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;line-height:1;">&times;</button>`;
    header.querySelector('#__webby-pages-close').addEventListener('click', () => panel.remove());

    const list = el('div');
    css(list, { flex: '1', padding: '12px 16px', overflowY: 'auto' });

    pagesInventory.pages.forEach(page => {
      const row = el('div');
      css(row, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '9px 0',
        borderBottom: '1px solid #f3f4f6',
      });

      const isCurrent = page.file === CURRENT_FILENAME;
      const info = el('div');
      css(info, { flex: '1', minWidth: '0' });

      const nameEl = el('div');
      nameEl.textContent = page.navLabel || page.title || page.file;
      css(nameEl, {
        fontWeight: isCurrent ? '700' : '500',
        fontSize: '12px',
        color: isCurrent ? '#3b82f6' : '#111',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });

      const fileEl = el('div');
      fileEl.textContent = page.file + (isCurrent ? ' — current' : '');
      css(fileEl, { fontSize: '10px', color: '#9ca3af', marginTop: '1px' });

      info.append(nameEl, fileEl);
      row.append(info);

      if (!isCurrent) {
        const openBtn = el('a');
        openBtn.textContent = 'Open →';
        openBtn.href = './' + page.file;
        css(openBtn, {
          fontSize: '11px',
          color: '#3b82f6',
          textDecoration: 'none',
          flexShrink: '0',
          padding: '3px 8px',
          borderRadius: '4px',
          background: 'rgba(59,130,246,0.08)',
          whiteSpace: 'nowrap',
        });

        const delBtn = el('button');
        delBtn.textContent = '✕';
        delBtn.title = 'Delete page';
        css(delBtn, {
          flexShrink: '0',
          padding: '3px 7px',
          background: 'transparent',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: '4px',
          color: '#ef4444',
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: 'inherit',
        });
        delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'rgba(239,68,68,0.08)'; });
        delBtn.addEventListener('mouseleave', () => { delBtn.style.background = 'transparent'; });
        delBtn.addEventListener('click', async () => {
          const label = page.navLabel || page.title || page.file;
          if (!confirm(`Delete "${label}" (${page.file})?\n\nThis will remove the page and all nav links pointing to it. This cannot be undone.`)) return;
          panel.remove();
          await deletePageFromSite(page);
        });

        row.append(openBtn, delBtn);
      }

      list.appendChild(row);
    });

    const footer = el('div');
    css(footer, {
      padding: '12px 16px',
      borderTop: '1px solid #e5e7eb',
      background: '#fff',
      flexShrink: '0',
    });

    const addBtn = el('button');
    addBtn.textContent = '+ Add Page';
    css(addBtn, {
      width: '100%',
      padding: '8px',
      background: dirHandle ? '#3b82f6' : '#e5e7eb',
      color: dirHandle ? '#fff' : '#9ca3af',
      border: 'none',
      borderRadius: '6px',
      cursor: dirHandle ? 'pointer' : 'default',
      fontSize: '12px',
      fontWeight: '600',
      fontFamily: 'inherit',
    });
    if (dirHandle) {
      addBtn.addEventListener('mouseenter', () => { addBtn.style.background = '#2563eb'; });
      addBtn.addEventListener('mouseleave', () => { addBtn.style.background = '#3b82f6'; });
      addBtn.addEventListener('click', () => { panel.remove(); promptAddPage(); });
    }
    footer.appendChild(addBtn);

    if (!dirHandle) {
      const note = el('div');
      note.textContent = 'Link your site folder to add pages.';
      css(note, { fontSize: '11px', color: '#9ca3af', marginTop: '6px', textAlign: 'center' });
      footer.appendChild(note);
    }

    panel.append(header, list, footer);
    document.body.appendChild(panel);
  }

  function promptAddPage() {
    if (!dirHandle) {
      showStatus('Link your site folder to add pages', true);
      return;
    }

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
      width: '520px',
      maxWidth: '92vw',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:16px;color:#111;font-weight:700">Add New Page</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#666;line-height:1.5">
        Describe the new page. The AI will generate it using your site's existing theme and navigation.
      </p>
      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Page description</span>
        <textarea
          id="__webby-addpage-desc"
          placeholder="e.g. A services page listing massage therapy, physiotherapy, and acupuncture. Each service gets a card with a title, short description, and a Book Now button."
          style="width:100%;height:96px;padding:10px 12px;border:1px solid #ddd;border-radius:6px;
                 font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;
                 line-height:1.5;outline:none;transition:border-color 0.15s;"
        ></textarea>
      </label>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Navigation label</span>
        <input id="__webby-addpage-label" type="text" placeholder="e.g. Services"
          style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;
                 font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;" />
      </label>
      <p style="margin:0 0 16px;font-size:11px;color:#9ca3af;">
        Filename: <span id="__webby-addpage-fname" style="font-family:monospace;">—</span>
      </p>
      <p id="__webby-addpage-error" style="display:none;margin:0 0 12px;font-size:12px;color:#ef4444;"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="__webby-addpage-cancel"
          style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:6px;
                 cursor:pointer;font-size:13px;font-family:inherit;color:#444;">
          Cancel
        </button>
        <button id="__webby-addpage-submit"
          style="padding:8px 18px;background:#3b82f6;color:#fff;border:none;border-radius:6px;
                 cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:background 0.15s;">
          Generate with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const descInput  = modal.querySelector('#__webby-addpage-desc');
    const labelInput = modal.querySelector('#__webby-addpage-label');
    const fnameEl    = modal.querySelector('#__webby-addpage-fname');
    const errorEl    = modal.querySelector('#__webby-addpage-error');
    const submitBtn  = modal.querySelector('#__webby-addpage-submit');
    const cancelBtn  = modal.querySelector('#__webby-addpage-cancel');

    function labelToFilename(label) {
      return label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.html';
    }

    labelInput.addEventListener('input', () => {
      fnameEl.textContent = labelInput.value.trim() ? labelToFilename(labelInput.value) : '—';
    });

    descInput.focus();
    descInput.addEventListener('focus', () => { descInput.style.borderColor = '#3b82f6'; });
    descInput.addEventListener('blur',  () => { descInput.style.borderColor = '#ddd'; });
    labelInput.addEventListener('focus', () => { labelInput.style.borderColor = '#3b82f6'; });
    labelInput.addEventListener('blur',  () => { labelInput.style.borderColor = '#ddd'; });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = '#2563eb'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = '#3b82f6'; });

    let pending = false;
    cancelBtn.addEventListener('click', () => { if (!pending) overlay.remove(); });
    descInput.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });

    submitBtn.addEventListener('click', async () => {
      const description = descInput.value.trim();
      const navLabel    = labelInput.value.trim();
      if (!description) { descInput.style.borderColor  = '#ef4444'; descInput.focus();  return; }
      if (!navLabel)    { labelInput.style.borderColor = '#ef4444'; labelInput.focus(); return; }

      const filename = labelToFilename(navLabel);
      if (pagesInventory.pages.find(p => p.file === filename)) {
        errorEl.textContent = `A page named "${filename}" already exists.`;
        errorEl.style.display = 'block';
        return;
      }

      errorEl.style.display = 'none';
      submitBtn.disabled   = true;
      submitBtn.textContent = 'Generating…';
      cancelBtn.disabled   = true;
      descInput.disabled   = true;
      labelInput.disabled  = true;
      pending = true;

      try {
        snapshotForUndo();
        await generatePage(description, navLabel, filename);
        overlay.remove();
        showStatus(`Page "${navLabel}" created ✓`);
      } catch (err) {
        pending = false;
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled   = false;
        submitBtn.textContent = 'Try Again';
        cancelBtn.disabled   = false;
        descInput.disabled   = false;
        labelInput.disabled  = false;
      }
    });
  }

  async function generatePage(description, navLabel, filename) {
    const prompt       = buildPagePrompt(description, navLabel, filename);
    const responseText = await callGeminiAPI(prompt);
    const html         = parseHTMLFromResponse(responseText);

    if (!html || !html.toLowerCase().includes('<html')) throw new Error('AI returned invalid HTML.');

    // Write the new page file to disk
    const doc = new DOMParser().parseFromString(html, 'text/html');
    await writePageToLocalFile(filename, html);

    // Register in inventory
    const pageTitle = doc.querySelector('title') ? doc.querySelector('title').textContent.trim() : navLabel;
    pagesInventory.pages.push({ file: filename, title: pageTitle, navLabel });
    await savePagesInventory();

    // Add the new page link to the current nav programmatically — avoids relying on the AI
    // to correctly preserve hamburger menus, mobile styles, and inline scripts.
    const currentNav = document.querySelector('nav');
    if (currentNav) {
      addLinkToNav(currentNav, navLabel, './' + filename);
      // Re-activate so the reformat button is re-bound to the updated nav
      delete currentNav.dataset.webbyNavBound;
      activateNav();
    }

    // Force re-sync: push the updated nav (with new link) to all pages including the new file
    lastSyncedNavHTML = '';
    await syncNavToOtherPagesIfChanged();

    setDirty(true);
  }

  // Programmatically insert a new nav link into an existing <nav> element.
  // Handles both list-based navs (<ul>/<ol> with <li><a>) and flat navs (<a> directly).
  // If the nav has multiple link lists (e.g. desktop + mobile copy), updates all of them.
  function addLinkToNav(navEl, label, href) {
    let added = false;

    // Strategy 1: list-based nav — add to every <ul>/<ol> that contains page links
    navEl.querySelectorAll('ul, ol').forEach(list => {
      const items = list.querySelectorAll('li');
      if (!items.length) return;
      const lastItem = items[items.length - 1];
      const anchor   = lastItem.querySelector('a');
      if (!anchor) return;

      const newItem = lastItem.cloneNode(true);
      const newA    = newItem.querySelector('a');
      if (!newA) return;
      newA.setAttribute('href', href);
      newA.textContent = label;
      // Strip active/current state classes that belong to other pages
      newA.classList.remove('active', 'current', 'is-active', 'is-current', 'selected');
      list.appendChild(newItem);
      added = true;
    });

    if (added) return true;

    // Strategy 2: flat nav — bare <a> elements (skip logo links that contain an <img>)
    const anchors = Array.from(navEl.querySelectorAll('a[href]'))
      .filter(a => !a.querySelector('img'));
    if (!anchors.length) return false;

    const last = anchors[anchors.length - 1];
    const newA  = last.cloneNode(true);
    newA.setAttribute('href', href);
    newA.textContent = label;
    newA.classList.remove('active', 'current', 'is-active', 'is-current', 'selected');
    last.after(newA);
    return true;
  }

  function buildPagePrompt(description, navLabel, filename) {
    const styleEl    = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    // Include nav-specific CSS if present — hamburger styles often live here after a reformat
    const navStyleEl = document.getElementById('__webby-nav-styles');
    const navCSS     = navStyleEl ? navStyleEl.textContent.trim() : '';

    const nav = document.querySelector('nav');
    let navHTML = '';
    if (nav) {
      const clone = nav.cloneNode(true);
      clone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
      clone.removeAttribute('data-webby-nav-bound');
      navHTML = clone.outerHTML;
    }

    const exampleZone = document.querySelector('[data-zone]');
    let exampleHTML = '';
    let containerInstruction = '';
    if (exampleZone) {
      const clone = exampleZone.cloneNode(true);
      clone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
      clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
      clone.querySelectorAll('[spellcheck]').forEach(n => n.removeAttribute('spellcheck'));
      exampleHTML = clone.outerHTML;

      // Detect the container wrapper used inside sections so the AI replicates it exactly.
      // We look for a direct child div whose class appears in a max-width or --container-width
      // rule in the stylesheet — that's the layout container the site uses.
      const directDivs = Array.from(exampleZone.children).filter(c => c.tagName === 'DIV');
      const containerEl = directDivs.find(div => {
        if (!div.className) return false;
        // Check each class name against the style block for a max-width or container-width reference
        return div.className.split(/\s+/).some(cls =>
          styleBlock.includes('.' + cls) &&
          (styleBlock.includes('max-width') || styleBlock.includes('container-width'))
        );
      }) || directDivs[0]; // fallback: first direct child div

      if (containerEl && containerEl.className) {
        containerInstruction = `\nCONTAINER WRAPPER: Every section's content must be wrapped in <div class="${containerEl.className}">...</div> — exactly as shown in the example section. Never render content edge-to-edge unless the example section explicitly does so.`;
      }
    }

    const siteTitle = document.title || 'Website';
    const metaDesc  = document.querySelector('meta[name="description"]');
    const siteDesc  = metaDesc ? metaDesc.getAttribute('content') : '';
    const pagesList = pagesInventory
      ? pagesInventory.pages.map(p => `  - ${p.navLabel}: ./${p.file}`).join('\n')
      : `  - ${CURRENT_FILENAME}`;

    return `You are generating a new HTML page for a multi-page website.

SITE TITLE: ${siteTitle}${siteDesc ? '\nSITE DESCRIPTION: ' + siteDesc : ''}

EXISTING PAGES:
${pagesList}

NEW PAGE: "${navLabel}" → ${filename}

CSS VARIABLES AND BASE STYLES (copy this <style> block into the new page verbatim):
${styleBlock}

CURRENT NAVIGATION (copy this EXACTLY as-is — do not add, remove, or change anything; the new page link will be inserted automatically after generation):
${navHTML}
${navCSS ? `
CURRENT NAVIGATION CSS (copy this verbatim into a <style id="__webby-nav-styles"> block in <head>, immediately after the main <style> block — do not modify it):
${navCSS}
` : ''}
EXAMPLE SECTION (match this markup style, class patterns, and data-* attributes exactly):
${exampleHTML}
${containerInstruction}
PAGE DESCRIPTION:
"${description}"

REQUIREMENTS:
1. Return a complete, valid HTML document starting with <!DOCTYPE html>
2. Copy the <style> block and any Google Fonts <link> from above into the new page's <head>
3. Copy the nav HTML exactly as shown — do not modify it in any way (the new page link is handled separately)
4. If CURRENT NAVIGATION CSS is provided above, copy it verbatim into a <style id="__webby-nav-styles"> block in <head>, immediately after the main <style> block
5. Every <section> must have: data-zone="{slug}" and data-zone-label="{Human Label}"
6. Every editable text element must have: data-editable
7. Every <img> must have: data-editable-image and src="./assets/placeholder.jpg"
8. Include immediately after the <style> block (and nav CSS block if present) in <head>:
   <script src="./secrets.js"></script>
   <script src="https://swill.github.io/webby/webby.js"></script>
9. Set an appropriate <title> and <meta name="description"> for this page
10. Use only CSS variables from the style block — no hardcoded colours or font sizes
11. Placeholder content should be realistic and relevant to the page description

Return ONLY the complete HTML. No explanation, no markdown fences. Start with <!DOCTYPE html>.`;
  }

  // Remove all nav links pointing to `filename` from a given nav element.
  // Removes the closest <li> parent if present, otherwise the <a> itself.
  function removePageFromNav(navEl, filename) {
    if (!navEl) return;
    const normalized = filename.replace(/^\.\//, '');
    navEl.querySelectorAll('a[href]').forEach(a => {
      const href = (a.getAttribute('href') || '').replace(/^\.\//, '').split('#')[0];
      if (href === normalized) {
        const li = a.closest('li');
        if (li) li.remove();
        else a.remove();
      }
    });
  }

  async function deletePageFromSite(page) {
    const { file: filename, navLabel } = page;
    snapshotForUndo();

    // 1. Remove nav links pointing to this page from the current DOM
    removePageFromNav(document.querySelector('nav'), filename);

    // 2. Remove from inventory and save
    pagesInventory.pages = pagesInventory.pages.filter(p => p.file !== filename);
    await savePagesInventory();

    // 3. Delete the local file (non-fatal if it fails or API unavailable)
    if (dirHandle) {
      try { await dirHandle.removeEntry(filename); } catch (_) {}
    }

    // 4. Force nav re-sync so the deleted page's link is removed from all remaining pages
    lastSyncedNavHTML = '';
    await syncNavToOtherPagesIfChanged();

    setDirty(true);
    showStatus(`Page "${navLabel}" deleted ✓`);
  }

  // ─── Mutation Observer ────────────────────────────────────────────────────

  function bindMutationObserver() {
    if (mutationObserver) mutationObserver.disconnect();
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

  // ─── Undo / Redo ─────────────────────────────────────────────────────────
  //
  // Snapshot-based undo for structural operations (AI actions, delete, etc.).
  // Text edits rely on the browser's native contenteditable undo (Ctrl+Z).

  function captureSnapshot() {
    // Clone body without editor UI or runtime-only attributes
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
    bodyClone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    bodyClone.querySelectorAll('[spellcheck]').forEach(n => n.removeAttribute('spellcheck'));
    bodyClone.querySelectorAll('[data-webby-bound]').forEach(n => n.removeAttribute('data-webby-bound'));
    bodyClone.querySelectorAll('[data-webby-nav-bound]').forEach(n => n.removeAttribute('data-webby-nav-bound'));

    const styleEl = document.querySelector('style');

    const sectionStyles = [];
    document.querySelectorAll('style[id^="__webby-section-"]').forEach(s => {
      sectionStyles.push({ id: s.id, content: s.textContent });
    });
    const navStyleEl = document.getElementById('__webby-nav-styles');

    return {
      bodyHTML:      bodyClone.innerHTML,
      styleContent:  styleEl ? styleEl.textContent : '',
      sectionStyles,
      navStyles:     navStyleEl ? navStyleEl.textContent : null,
    };
  }

  function snapshotForUndo() {
    undoStack.push(captureSnapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function restoreSnapshot(snapshot) {
    // Disconnect observer before mass DOM mutation
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }

    // Close any open overlays so their stale DOM references are dropped
    closeLinkPopover();
    hideSelectionToolbar();

    // Save editor UI nodes (toolbar, banner, panels) — they have live event listeners
    const editorEls = Array.from(document.body.children).filter(c => c.hasAttribute('data-editor-ui'));

    // Replace body content (body.style is preserved; only children are replaced)
    document.body.innerHTML = snapshot.bodyHTML;

    // Re-attach editor UI (all position:fixed so order doesn't matter visually)
    editorEls.forEach(edEl => document.body.appendChild(edEl));

    // Restore main style block
    const styleEl = document.querySelector('style');
    if (styleEl && snapshot.styleContent) styleEl.textContent = snapshot.styleContent;

    // Restore section-specific and nav style blocks
    document.querySelectorAll('style[id^="__webby-section-"]').forEach(s => s.remove());
    const existingNavStyles = document.getElementById('__webby-nav-styles');
    if (existingNavStyles) existingNavStyles.remove();
    snapshot.sectionStyles.forEach(({ id, content }) => {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = content;
      document.head.appendChild(s);
    });
    if (snapshot.navStyles) {
      const s = document.createElement('style');
      s.id = '__webby-nav-styles';
      s.textContent = snapshot.navStyles;
      document.head.appendChild(s);
    }

    // Re-activate editing on restored content
    activateZones();
    activateNav();
    const restoredNav = document.querySelector('nav');
    if (restoredNav) rerunInlineScripts(restoredNav);
    bindMutationObserver();

    // Re-baseline nav sync so the next auto-save doesn't over-eagerly sync
    lastSyncedNavHTML = getNavHTML();

    setDirty(true);
    updateUndoRedoButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(captureSnapshot());
    restoreSnapshot(undoStack.pop());
    showStatus('Undone');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(captureSnapshot());
    restoreSnapshot(redoStack.pop());
    showStatus('Redone');
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('__webby-undo-btn');
    const redoBtn = document.getElementById('__webby-redo-btn');
    if (undoBtn) {
      undoBtn.disabled      = undoStack.length === 0;
      undoBtn.style.opacity = undoStack.length === 0 ? '0.35' : '1';
    }
    if (redoBtn) {
      redoBtn.disabled      = redoStack.length === 0;
      redoBtn.style.opacity = redoStack.length === 0 ? '0.35' : '1';
    }
  }

  function bindUndoRedo() {
    document.addEventListener('keydown', e => {
      // Let the browser handle Ctrl+Z inside contenteditable (text undo)
      if (e.target.isContentEditable) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
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
        snapshotForUndo();
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
    const { css, html } = parseSectionResponse(responseText);

    if (!html) throw new Error('AI returned no valid HTML element.');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const section = tmp.querySelector('section');
    if (!section) throw new Error('AI returned no valid HTML element.');

    const slug = section.dataset.zone || ('section-' + Date.now());
    if (css) {
      const styleId = '__webby-section-' + slug + '-styles';
      let sectionStyleEl = document.getElementById(styleId);
      if (!sectionStyleEl) {
        sectionStyleEl = document.createElement('style');
        sectionStyleEl.id = styleId;
        document.head.appendChild(sectionStyleEl);
      }
      sectionStyleEl.textContent = css;
    }

    injectNewSection(section, insertAfterZone);
  }

  function buildSectionPrompt(description) {
    const styleEl = document.querySelector('style');
    const styleBlock = styleEl ? styleEl.textContent : '';

    const exampleZone = document.querySelector('[data-zone]');
    let exampleHTML = '';
    if (exampleZone) {
      const clone = exampleZone.cloneNode(true);
      clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
      clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
      clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));
      exampleHTML = clone.outerHTML;
    }

    return `You are generating a new HTML section for a website — both its HTML and any CSS it needs.

CSS VARIABLES IN USE (use these, never hardcode colours or sizes):
${styleBlock}

EXISTING SECTION EXAMPLE (match this markup style and class patterns):
${exampleHTML}

TASK:
Generate a new section for the following description:
"${description}"

RULES:
- Use only the CSS variables defined above — no hardcoded colors or font sizes
- Include data-zone="{slug}" and data-zone-label="{Human Label}" on the <section>
- Add data-editable on every user-editable text element (headings, paragraphs, spans, list items)
- Add data-editable-image on any <img> elements; use src="./assets/placeholder.jpg"
- Use semantic, accessible HTML
- If the section needs layout, responsive columns, or media queries, put that CSS in the section-css block
- Return your response in EXACTLY this format with no other text:

<section-css>
/* CSS for this section including any media queries — omit block entirely if no CSS needed */
</section-css>

<section-html>
<section>...</section>
</section-html>`;
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

  function injectNewSection(section, insertAfterZone) {

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

    // Remove internal binding markers
    clone.querySelectorAll('img[data-webby-bound]').forEach(img => {
      img.removeAttribute('data-webby-bound');
    });
    const navClone = clone.querySelector('nav[data-webby-nav-bound]');
    if (navClone) navClone.removeAttribute('data-webby-nav-bound');

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

    // Restore fixed nav top if it was shifted for the toolbar
    if (originalNavTop !== null) {
      const navClone = clone.querySelector('nav');
      if (navClone) {
        if (originalNavTop) {
          navClone.style.top = originalNavTop;
        } else {
          navClone.style.removeProperty('top');
        }
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
        if (res.status === 409) {
          throw new Error('__sha_conflict__');
        }
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

    const btns = document.querySelectorAll('#__webby-toolbar button');
    btns.forEach(b => { b.disabled = true; });

    const pageCount = pagesInventory ? pagesInventory.pages.length : 1;
    showStatus(pageCount > 1 ? `Publishing ${pageCount} pages…` : 'Publishing…');

    let errorFiles = [];

    try {
      // 1. Publish the current page
      const currentHtml = serialize({ local: false });
      const currentSha  = await github.getFileSHA(CURRENT_FILENAME);
      try {
        await github.putFile(CURRENT_FILENAME, currentHtml, currentSha);
      } catch (e) {
        if (e.message !== '__sha_conflict__') throw e;
      }

      // 2. Publish all other pages from local files (stripping editor scripts from each)
      if (dirHandle && pagesInventory) {
        for (const page of pagesInventory.pages) {
          if (page.file === CURRENT_FILENAME) continue;
          try {
            const fh       = await dirHandle.getFileHandle(page.file);
            const pageFile = await fh.getFile();
            const text     = await pageFile.text();
            const doc      = new DOMParser().parseFromString(text, 'text/html');
            doc.querySelectorAll('script').forEach(s => {
              const src = s.getAttribute('src') || '';
              if (src.includes('secrets.js') || src.includes('webby.js')) s.remove();
            });
            const stripped = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
            const pageSha  = await github.getFileSHA(page.file);
            await github.putFile(page.file, stripped, pageSha);
          } catch (pageErr) {
            if (pageErr.message !== '__sha_conflict__') errorFiles.push(page.file);
          }
        }

        // 3. Publish the pages inventory
        try {
          const inventoryJson  = JSON.stringify(pagesInventory, null, 2);
          const inventorySha   = await github.getFileSHA('webby-pages.json');
          await github.putFile('webby-pages.json', inventoryJson, inventorySha);
        } catch (_) {}
      }

      setDirty(false);
      if (errorFiles.length) {
        showStatus(`Published ✓ (${errorFiles.length} page(s) failed: ${errorFiles.join(', ')})`, true);
      } else {
        showStatus('Published ✓ — deploying…');
      }
    } catch (err) {
      showStatus('Publish failed: ' + err.message, true);
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // ─── Favicon Helpers ──────────────────────────────────────────────────────

  function convertImageToPng(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to convert image to PNG'));
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
      img.src = url;
    });
  }

  function upsertMetaTag(name, content) {
    let tag = document.querySelector(`meta[name="${name}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = name;
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', content);
  }

  function upsertFaviconLinks(href) {
    const head = document.head;

    let iconLink = head.querySelector('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      head.appendChild(iconLink);
    }
    iconLink.type = 'image/png';
    iconLink.href = href;

    let appleLink = head.querySelector('link[rel="apple-touch-icon"]');
    if (!appleLink) {
      appleLink = document.createElement('link');
      appleLink.rel = 'apple-touch-icon';
      head.appendChild(appleLink);
    }
    appleLink.href = href;
  }

  // ─── Theme Editor ─────────────────────────────────────────────────────────

  function openThemeEditor() {
    if (document.getElementById('__webby-theme-panel')) {
      document.getElementById('__webby-theme-panel').remove();
      return;
    }
    // Close pages panel if open (they occupy the same side-panel slot)
    const pagesPanel = document.getElementById('__webby-pages-panel');
    if (pagesPanel) pagesPanel.remove();

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

    // ── Favicon section ──────────────────────────────────────────────────────
    const faviconSection = el('div');
    css(faviconSection, { marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #f3f4f6' });

    const faviconTitle = el('div');
    faviconTitle.textContent = 'Site Identity';
    css(faviconTitle, {
      fontWeight: '700',
      textTransform: 'uppercase',
      fontSize: '10px',
      color: '#9ca3af',
      letterSpacing: '0.08em',
      marginBottom: '10px',
    });

    const faviconRow = el('div');
    css(faviconRow, { display: 'flex', alignItems: 'center', gap: '12px' });

    // Preview box
    const faviconPreview = el('div');
    css(faviconPreview, {
      width: '48px',
      height: '48px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      background: '#f9fafb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      overflow: 'hidden',
      flexShrink: '0',
      position: 'relative',
    });

    // Populate preview from existing <link rel="icon">
    const existingIcon = document.querySelector('link[rel="icon"]');
    const faviconImg = el('img');
    if (existingIcon && existingIcon.href) {
      faviconImg.src = existingIcon.href;
      css(faviconImg, { width: '100%', height: '100%', objectFit: 'contain' });
      faviconPreview.appendChild(faviconImg);
    } else {
      faviconPreview.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
    }

    // Hover overlay
    const faviconHint = el('div');
    faviconHint.textContent = 'Click to set';
    css(faviconHint, {
      position: 'absolute',
      inset: '0',
      background: 'rgba(0,0,0,0.45)',
      color: '#fff',
      fontSize: '9px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      opacity: '0',
      transition: 'opacity 0.15s',
      borderRadius: '5px',
    });
    faviconPreview.appendChild(faviconHint);
    faviconPreview.addEventListener('mouseenter', () => { faviconHint.style.opacity = '1'; });
    faviconPreview.addEventListener('mouseleave', () => { faviconHint.style.opacity = '0'; });

    const faviconMeta = el('div');
    css(faviconMeta, { flex: '1', minWidth: '0' });
    const faviconLabel = el('div');
    faviconLabel.textContent = 'Favicon';
    css(faviconLabel, { fontWeight: '600', fontSize: '12px', color: '#374151', marginBottom: '2px' });
    const faviconSub = el('div');
    faviconSub.textContent = existingIcon ? 'favicon.png' : 'None set';
    css(faviconSub, { fontSize: '10px', color: '#9ca3af' });
    faviconMeta.append(faviconLabel, faviconSub);

    // Hidden file input
    const faviconInput = el('input');
    faviconInput.type = 'file';
    faviconInput.accept = 'image/*';
    css(faviconInput, { display: 'none' });
    faviconInput.setAttribute('data-editor-ui', '');

    faviconPreview.addEventListener('click', () => faviconInput.click());

    faviconInput.addEventListener('change', async () => {
      const file = faviconInput.files[0];
      if (!file) return;
      faviconSub.textContent = 'Uploading…';
      try {
        const pngBlob = await convertImageToPng(file);
        const arrayBuffer = await pngBlob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = '';
        uint8.forEach(b => { binary += String.fromCharCode(b); });
        const base64 = btoa(binary);

        await github.uploadFile('assets/favicon.png', base64);

        if (dirHandle) {
          const fileHandle = await dirHandle.getFileHandle('assets/favicon.png', { create: true })
            .catch(async () => {
              // assets/ subfolder may not exist yet
              const assetsDir = await dirHandle.getDirectoryHandle('assets', { create: true });
              return assetsDir.getFileHandle('favicon.png', { create: true });
            });
          const writable = await fileHandle.createWritable();
          await writable.write(pngBlob);
          await writable.close();
        }

        upsertFaviconLinks('./assets/favicon.png');

        // Update preview
        const blobUrl = URL.createObjectURL(pngBlob);
        faviconPreview.innerHTML = '';
        const newImg = el('img');
        newImg.src = blobUrl;
        css(newImg, { width: '100%', height: '100%', objectFit: 'contain' });
        faviconPreview.append(newImg, faviconHint);
        faviconSub.textContent = 'favicon.png';
        setDirty(true);
        showStatus('Favicon updated ✓');
      } catch (err) {
        faviconSub.textContent = 'Error — try again';
        showStatus('Favicon error: ' + err.message, true);
      }
      faviconInput.value = '';
    });

    faviconRow.append(faviconPreview, faviconMeta);

    // Page title row
    const titleRow = el('div');
    css(titleRow, { marginTop: '12px' });

    const titleLabel = el('label');
    titleLabel.textContent = 'Page title';
    css(titleLabel, { display: 'block', fontSize: '11px', color: '#374151', fontWeight: '600', marginBottom: '4px' });

    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.value = document.title || '';
    titleInput.placeholder = 'My Site';
    css(titleInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'inherit',
    });
    titleInput.addEventListener('input', () => {
      document.title = titleInput.value;
      const titleEl = document.querySelector('title');
      if (titleEl) titleEl.textContent = titleInput.value;
      // Also update the toolbar site name if present
      const toolbarTitle = document.getElementById('__webby-title');
      if (toolbarTitle) toolbarTitle.textContent = titleInput.value || 'Site Editor';
      setDirty(true);
    });

    titleRow.append(titleLabel, titleInput);

    // Description row
    const descRow = el('div');
    css(descRow, { marginTop: '12px' });

    const descLabel = el('label');
    descLabel.textContent = 'Meta description';
    css(descLabel, { display: 'block', fontSize: '11px', color: '#374151', fontWeight: '600', marginBottom: '4px' });

    const existingDesc = document.querySelector('meta[name="description"]');
    const descInput = el('textarea');
    descInput.value = existingDesc ? (existingDesc.getAttribute('content') || '') : '';
    descInput.placeholder = 'A short description of the site for search engines (150–160 characters)';
    css(descInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'inherit',
      resize: 'vertical',
      height: '62px',
    });
    descInput.addEventListener('input', () => {
      upsertMetaTag('description', descInput.value);
      setDirty(true);
    });

    descRow.append(descLabel, descInput);

    // Keywords row
    const kwRow = el('div');
    css(kwRow, { marginTop: '12px' });

    const kwLabel = el('label');
    kwLabel.textContent = 'Keywords';
    css(kwLabel, { display: 'block', fontSize: '11px', color: '#374151', fontWeight: '600', marginBottom: '4px' });

    const kwHint = el('div');
    kwHint.textContent = 'Comma-separated';
    css(kwHint, { fontSize: '10px', color: '#9ca3af', marginBottom: '4px' });

    const existingKw = document.querySelector('meta[name="keywords"]');
    const kwInput = el('input');
    kwInput.type = 'text';
    kwInput.value = existingKw ? (existingKw.getAttribute('content') || '') : '';
    kwInput.placeholder = 'osteopath, sports therapy, London';
    css(kwInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'inherit',
    });
    kwInput.addEventListener('input', () => {
      upsertMetaTag('keywords', kwInput.value);
      setDirty(true);
    });

    kwRow.append(kwLabel, kwHint, kwInput);

    faviconSection.append(faviconTitle, faviconRow, faviconInput, titleRow, descRow, kwRow);
    content.appendChild(faviconSection);
    // ── end favicon section ──────────────────────────────────────────────────

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
        section.appendChild(makeVarRow(varName, varValue, styleEl));
      }

      // "Add font variable" button — only on the Typography group
      if (groupName === 'Typography') {
        const addFontBtn = el('button');
        addFontBtn.textContent = '＋ Add font variable';
        css(addFontBtn, {
          marginTop: '6px',
          padding: '3px 8px',
          background: 'none',
          border: '1px dashed #d1d5db',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#6b7280',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          fontFamily: 'inherit',
        });

        addFontBtn.addEventListener('click', () => {
          addFontBtn.style.display = 'none';

          const form = el('div');
          css(form, { marginTop: '6px' });

          // Row 1: prefix label + name input
          const nameRow = el('div');
          css(nameRow, { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' });

          const prefix = el('span');
          prefix.textContent = '--font-';
          css(prefix, { fontSize: '11px', fontFamily: 'monospace', color: '#9ca3af', flexShrink: '0' });

          const nameInput = el('input');
          nameInput.type = 'text';
          nameInput.placeholder = 'display';
          css(nameInput, { flex: '1', minWidth: '0', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' });

          nameRow.append(prefix, nameInput);

          // Row 2: value input
          const valueInput = el('input');
          valueInput.type = 'text';
          valueInput.placeholder = "'Playfair Display', serif";
          css(valueInput, { width: '100%', boxSizing: 'border-box', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', marginBottom: '6px' });

          // Row 3: action buttons
          const btnRow = el('div');
          css(btnRow, { display: 'flex', gap: '6px' });

          const confirmBtn = el('button');
          confirmBtn.textContent = 'Add';
          css(confirmBtn, { padding: '3px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' });

          const cancelBtn = el('button');
          cancelBtn.textContent = 'Cancel';
          css(cancelBtn, { padding: '3px 10px', background: 'none', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' });

          btnRow.append(confirmBtn, cancelBtn);
          form.append(nameRow, valueInput, btnRow);
          section.appendChild(form);
          nameInput.focus();

          cancelBtn.addEventListener('click', () => {
            form.remove();
            addFontBtn.style.display = '';
          });

          const doAdd = () => {
            const nameSuffix = nameInput.value.trim().replace(/[^a-z0-9-]/gi, '-');
            const value = valueInput.value.trim();
            if (!nameSuffix || !value) { nameInput.focus(); return; }

            const varName = '--font-' + nameSuffix;
            // Guard against duplicates
            if (document.documentElement.style.getPropertyValue(varName) ||
                styleEl.textContent.includes(varName + ':')) {
              nameInput.style.borderColor = '#ef4444';
              nameInput.title = 'Variable already exists';
              return;
            }

            addStyleVar(styleEl, varName, value);
            document.documentElement.style.setProperty(varName, value);
            setDirty(true);

            form.remove();
            addFontBtn.style.display = '';
            // Insert the new row before the add button
            section.insertBefore(makeVarRow(varName, value, styleEl), addFontBtn);
          };

          confirmBtn.addEventListener('click', doAdd);
          valueInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
          nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') valueInput.focus(); });
        });

        section.appendChild(addFontBtn);
      }

      content.appendChild(section);
    }

    panel.append(header, content);
    document.body.appendChild(panel);
  }

  function makeVarRow(varName, varValue, styleEl) {
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

    if (isColor) {
      const hexVal = toHex(trimmed);

      const picker = el('input');
      picker.type = 'color';
      picker.value = hexVal;
      css(picker, { width: '28px', height: '26px', padding: '1px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', flexShrink: '0' });

      const hexInput = el('input');
      hexInput.type = 'text';
      hexInput.value = hexVal;
      css(hexInput, { width: '72px', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', flexShrink: '0' });

      const apply = val => {
        document.documentElement.style.setProperty(varName, val);
        updateStyleVar(styleEl, varName, val);
        setDirty(true);
      };
      picker.addEventListener('input', () => {
        hexInput.value = picker.value;
        apply(picker.value);
      });
      hexInput.addEventListener('input', () => {
        const val = hexInput.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(val)) {
          picker.value = val;
          apply(val);
        }
      });

      row.append(label, picker, hexInput);
    } else {
      const input = el('input');
      input.type = 'text';
      input.value = trimmed;
      css(input, { width: '110px', padding: '3px 7px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' });
      input.addEventListener('input', () => {
        document.documentElement.style.setProperty(varName, input.value);
        updateStyleVar(styleEl, varName, input.value);
        setDirty(true);
      });
      row.append(label, input);
    }

    return row;
  }

  function addStyleVar(styleEl, varName, value) {
    // Append the new variable inside the :root {} block
    styleEl.textContent = styleEl.textContent.replace(
      /(:root\s*\{[^}]*)(\})/,
      (_, body, close) => `${body}  ${varName}: ${value};\n${close}`
    );
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

  // Re-execute inline <script> elements within a container. Scripts parsed via
  // innerHTML or replaceWith are inert — the browser does not run them. Replacing
  // each <script> with a fresh element forces execution, rebinding any event listeners
  // that were attached to elements now in the live DOM.
  function rerunInlineScripts(el) {
    el.querySelectorAll('script:not([src])').forEach(old => {
      const fresh = document.createElement('script');
      Array.from(old.attributes).forEach(a => fresh.setAttribute(a.name, a.value));
      fresh.textContent = old.textContent;
      old.replaceWith(fresh);
    });
  }

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

  // ─── Selection Toolbar (bold / italic / link) ─────────────────────────────

  let selectionToolbar = null;

  function bindSelectionToolbar() {
    document.addEventListener('mouseup', onSelectionChange);
    document.addEventListener('keyup', onSelectionChange);
    document.addEventListener('mousedown', e => {
      if (selectionToolbar && !selectionToolbar.contains(e.target)) {
        hideSelectionToolbar();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideSelectionToolbar();
    });
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideSelectionToolbar();
      return;
    }
    const node = sel.anchorNode;
    const editable = node &&
      (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest('[data-editable]');
    if (!editable) { hideSelectionToolbar(); return; }
    showSelectionToolbar(sel);
  }

  function showSelectionToolbar(sel) {
    hideSelectionToolbar();
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    // Clone the range so we can restore it after the native color picker
    // steals focus, or after the flyout is opened.
    const savedRange = range.cloneRange();

    const bar = el('div', { id: '__webby-sel-toolbar', 'data-editor-ui': '' });
    css(bar, {
      position: 'fixed',
      zIndex: '1000002',
      background: '#1e293b',
      borderRadius: '6px',
      padding: '3px 5px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '2px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
    });

    const row = el('div');
    css(row, { display: 'flex', alignItems: 'center', gap: '2px' });

    const flyout = el('div', { 'data-editor-ui': '' });
    css(flyout, {
      display: 'none',
      padding: '6px 4px 3px',
      marginTop: '4px',
      borderTop: '1px solid rgba(255,255,255,0.12)',
    });

    const boldActive   = document.queryCommandState('bold');
    const italicActive = document.queryCommandState('italic');

    const boldBtn = makeSelBtn('B', boldActive, () => {
      const anchor = window.getSelection()?.anchorNode;
      const strongContainer = anchor && (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
      document.execCommand('bold');
      if (strongContainer) normalizeStrong(strongContainer);
      hideSelectionToolbar();
    });
    css(boldBtn, { fontWeight: '700', fontFamily: 'Georgia, serif' });

    const italicBtn = makeSelBtn('I', italicActive, () => {
      const anchor = window.getSelection()?.anchorNode;
      const emContainer = anchor && (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
      document.execCommand('italic');
      if (emContainer) normalizeEm(emContainer);
      hideSelectionToolbar();
    });
    css(italicBtn, { fontStyle: 'italic', fontFamily: 'Georgia, serif' });

    const codeRangeNode = (() => {
      try { const n = sel.getRangeAt(0).commonAncestorContainer; return n.nodeType === Node.TEXT_NODE ? n.parentElement : n; } catch (_) { return null; }
    })();
    const codeActive = !!(codeRangeNode && codeRangeNode.closest('code'));

    const CODE_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    const codeBtn = makeSelBtn('', codeActive, () => {
      const curSel = window.getSelection();
      if (!curSel || curSel.isCollapsed) { hideSelectionToolbar(); return; }
      const r = curSel.getRangeAt(0);
      let container = r.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) container = container.parentElement;
      const existingCode = container && container.closest('code');
      if (existingCode) {
        const parent = existingCode.parentNode;
        while (existingCode.firstChild) parent.insertBefore(existingCode.firstChild, existingCode);
        existingCode.remove();
      } else {
        const codeEl = document.createElement('code');
        try {
          r.surroundContents(codeEl);
        } catch (_) {
          codeEl.appendChild(r.extractContents());
          r.insertNode(codeEl);
        }
        // Re-select inside the new <code> element so mouseup re-shows the toolbar
        // with the correct active state (anchorNode inside <code>, not its parent)
        const newRange = document.createRange();
        newRange.selectNodeContents(codeEl);
        curSel.removeAllRanges();
        curSel.addRange(newRange);
      }
      setDirty(true);
      hideSelectionToolbar();
    });
    codeBtn.innerHTML = CODE_SVG;

    const LINK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    const linkBtn = makeSelBtn('', false, () => {
      const node = sel.anchorNode;
      const existingLink = node &&
        (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest('a');
      if (existingLink) {
        hideSelectionToolbar();
        openLinkPopover(existingLink);
        return;
      }
      // Wrap selection in a new <a> using a sentinel href, then open the popover
      document.execCommand('createLink', false, '__webby_new__');
      const newLink = document.querySelector('a[href="__webby_new__"]');
      if (newLink) {
        newLink.setAttribute('href', '');
        hideSelectionToolbar();
        openLinkPopover(newLink);
      } else {
        hideSelectionToolbar();
      }
    });
    linkBtn.innerHTML = LINK_SVG;

    // Color button — opens a flyout with theme colors and a custom picker
    const COLOR_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 5 12a7 7 0 1 0 14 0z"/></svg>`;
    const colorBtn = makeSelBtn('', false, () => {
      toggleFlyout(flyout, 'color', () => populateColorFlyout(flyout, savedRange));
    });
    colorBtn.innerHTML = COLOR_SVG;
    colorBtn.title = 'Text color';

    // Font button — opens a flyout with theme fonts
    const fontBtn = makeSelBtn('Aa', false, () => {
      toggleFlyout(flyout, 'font', () => populateFontFlyout(flyout, savedRange));
    });
    css(fontBtn, { fontFamily: 'Georgia, serif', fontWeight: '600', fontSize: '12px' });
    fontBtn.title = 'Font family';

    row.append(boldBtn, italicBtn, colorBtn, fontBtn, codeBtn, linkBtn);
    bar.append(row, flyout);
    document.body.appendChild(bar);
    selectionToolbar = bar;

    // Position above selection; flip below if too close to top of viewport
    const bRect = bar.getBoundingClientRect();
    let top  = rect.top  - bRect.height - 8;
    let left = rect.left + rect.width / 2 - bRect.width / 2;
    if (top < 8) top = rect.bottom + 8;
    left = Math.max(8, Math.min(window.innerWidth - bRect.width - 8, left));
    css(bar, { top: top + 'px', left: left + 'px' });
  }

  // ─── Selection toolbar: color / font flyouts ──────────────────────────────

  function toggleFlyout(flyout, mode, populate) {
    if (flyout.dataset.mode === mode && flyout.style.display !== 'none') {
      flyout.style.display = 'none';
      flyout.dataset.mode = '';
      flyout.innerHTML = '';
      repositionSelectionToolbar();
      return;
    }
    flyout.innerHTML = '';
    flyout.dataset.mode = mode;
    flyout.style.display = 'block';
    populate();
    repositionSelectionToolbar();
  }

  function repositionSelectionToolbar() {
    if (!selectionToolbar) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const bRect = selectionToolbar.getBoundingClientRect();
    let top  = rect.top  - bRect.height - 8;
    let left = rect.left + rect.width / 2 - bRect.width / 2;
    if (top < 8) top = rect.bottom + 8;
    left = Math.max(8, Math.min(window.innerWidth - bRect.width - 8, left));
    css(selectionToolbar, { top: top + 'px', left: left + 'px' });
  }

  function getThemeVars(prefix) {
    const styleEl = document.querySelector('style');
    if (!styleEl) return [];
    const vars = parseCSSVars(styleEl.textContent);
    return Object.entries(vars).filter(([k]) => k.startsWith(prefix));
  }

  function restoreSavedRange(savedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  // Wrap the current selection in a <span> with an inline style. Used for
  // color and font-family applied from the selection toolbar flyouts.
  function wrapSelectionInStyledSpan(property, value) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const anchor = sel.anchorNode;
    const editable = anchor &&
      (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
    if (!editable) return;
    const span = document.createElement('span');
    span.style[property] = value;
    try {
      r.surroundContents(span);
    } catch (_) {
      // surroundContents throws when the range crosses element boundaries —
      // extract + insert preserves the selection contents across the boundary.
      span.appendChild(r.extractContents());
      r.insertNode(span);
    }
    setDirty(true);
  }

  function populateColorFlyout(flyout, savedRange) {
    const grid = el('div');
    css(grid, { display: 'flex', flexWrap: 'wrap', gap: '5px', maxWidth: '220px' });

    const colors = getThemeVars('--color');
    if (!colors.length) {
      const empty = el('div');
      empty.textContent = 'No theme colors defined';
      css(empty, { color: '#94a3b8', fontSize: '11px', padding: '2px 4px' });
      flyout.appendChild(empty);
      return;
    }

    colors.forEach(([varName, varValue]) => {
      const swatch = el('button', { 'data-editor-ui': '', title: varName.replace(/^--/, '') });
      css(swatch, {
        width: '22px',
        height: '22px',
        padding: '0',
        border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: '4px',
        cursor: 'pointer',
        background: varValue,
      });
      swatch.addEventListener('mousedown', e => {
        e.preventDefault();
        restoreSavedRange(savedRange);
        wrapSelectionInStyledSpan('color', `var(${varName})`);
        hideSelectionToolbar();
      });
      grid.appendChild(swatch);
    });

    // Custom color — native picker wrapped in a label so the click opens it
    const customWrap = el('label', { 'data-editor-ui': '', title: 'Custom color' });
    css(customWrap, {
      width: '22px',
      height: '22px',
      border: '1px dashed rgba(255,255,255,0.4)',
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      position: 'relative',
      overflow: 'hidden',
    });
    customWrap.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

    const colorInput = el('input', { 'data-editor-ui': '' });
    colorInput.type = 'color';
    css(colorInput, {
      position: 'absolute', inset: '0', opacity: '0', cursor: 'pointer', border: 'none', padding: '0',
    });
    colorInput.addEventListener('change', () => {
      restoreSavedRange(savedRange);
      wrapSelectionInStyledSpan('color', colorInput.value);
      hideSelectionToolbar();
    });
    customWrap.appendChild(colorInput);
    grid.appendChild(customWrap);

    flyout.appendChild(grid);
  }

  function populateFontFlyout(flyout, savedRange) {
    const list = el('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '220px' });

    const fonts = getThemeVars('--font').filter(([k]) => !k.includes('size') && !k.includes('line-height') && !k.includes('weight'));
    if (!fonts.length) {
      const empty = el('div');
      empty.textContent = 'No theme fonts defined';
      css(empty, { color: '#94a3b8', fontSize: '11px', padding: '2px 4px' });
      flyout.appendChild(empty);
      return;
    }

    fonts.forEach(([varName, varValue]) => {
      const item = el('button', { 'data-editor-ui': '', title: varValue });
      item.textContent = varName.replace(/^--font-?/, '') || 'font';
      css(item, {
        padding: '5px 8px',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        color: '#e8e8f0',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: varValue,
        textAlign: 'left',
        width: '100%',
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        restoreSavedRange(savedRange);
        wrapSelectionInStyledSpan('fontFamily', `var(${varName})`);
        hideSelectionToolbar();
      });
      list.appendChild(item);
    });

    flyout.appendChild(list);
  }

  function makeSelBtn(label, active, action) {
    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = label;
    css(btn, {
      width: '28px',
      height: '28px',
      padding: '0',
      background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
      border: 'none',
      borderRadius: '4px',
      color: '#e8e8f0',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: '1',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = active ? 'rgba(255,255,255,0.18)' : 'transparent';
    });
    // mousedown + preventDefault keeps the selection alive while we act on it
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      action();
    });
    return btn;
  }

  function hideSelectionToolbar() {
    if (selectionToolbar) {
      selectionToolbar.remove();
      selectionToolbar = null;
    }
  }

  function normalizeEm(container) {
    Array.from(container.querySelectorAll('i')).forEach(iEl => {
      const em = document.createElement('em');
      while (iEl.firstChild) em.appendChild(iEl.firstChild);
      iEl.replaceWith(em);
    });
    Array.from(container.querySelectorAll('em')).forEach(em => {
      if (em.previousSibling && em.previousSibling.nodeName === 'EM') {
        const prev = em.previousSibling;
        while (em.firstChild) prev.appendChild(em.firstChild);
        em.remove();
      }
    });
  }

  function normalizeStrong(container) {
    Array.from(container.querySelectorAll('b')).forEach(bEl => {
      const strong = document.createElement('strong');
      while (bEl.firstChild) strong.appendChild(bEl.firstChild);
      bEl.replaceWith(strong);
    });
    Array.from(container.querySelectorAll('strong')).forEach(strong => {
      if (strong.previousSibling && strong.previousSibling.nodeName === 'STRONG') {
        const prev = strong.previousSibling;
        while (strong.firstChild) prev.appendChild(strong.firstChild);
        strong.remove();
      }
    });
  }

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

    // Only intercept links inside editable zones or the nav
    if (!link.closest('[data-zone]') && !link.closest('nav')) return;

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
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:12px;font-weight:600;text-transform:uppercase;
                     letter-spacing:0.05em;color:#9ca3af;">Edit Link</span>
        <a id="__webby-link-goto" href="#" target="_self"
          style="font-size:11px;color:#3b82f6;text-decoration:none;padding:2px 7px;
                 border-radius:4px;background:rgba(59,130,246,0.08);display:none;">
          Go to link →
        </a>
      </div>

      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Display text</span>
        <input id="__webby-link-text" type="text" value=""
          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;
                 font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;" />
      </label>

      <label style="display:block;margin-bottom:6px;">
        <span style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">URL</span>
        <input id="__webby-link-url" type="text" value=""
          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;
                 font-size:13px;box-sizing:border-box;font-family:monospace;outline:none;" />
      </label>

      <div id="__webby-link-picker-wrap" style="margin-bottom:10px;">
        <select id="__webby-link-picker"
          style="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;
                 font-size:12px;font-family:inherit;color:#374151;background:#fff;outline:none;">
          <option value="">— Jump to a page or section —</option>
        </select>
      </div>

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
    const textInput  = popover.querySelector('#__webby-link-text');
    const urlInput   = popover.querySelector('#__webby-link-url');
    const blankCheck = popover.querySelector('#__webby-link-blank');
    const gotoBtn    = popover.querySelector('#__webby-link-goto');
    const picker     = popover.querySelector('#__webby-link-picker');

    textInput.value    = link.textContent;
    urlInput.value     = link.getAttribute('href') || '';
    blankCheck.checked = link.getAttribute('target') === '_blank';

    // Show / update the "Go to link" button whenever the URL is non-empty
    function refreshGotoBtn() {
      const href = urlInput.value.trim();
      if (href && href !== '#') {
        gotoBtn.href = href;
        gotoBtn.style.display = '';
      } else {
        gotoBtn.style.display = 'none';
      }
    }
    refreshGotoBtn();

    // Populate page picker from inventory (current page zones immediately; other pages async)
    if (pagesInventory) {
      pagesInventory.pages.forEach(page => {
        const group = document.createElement('optgroup');
        group.label = (page.navLabel || page.title || page.file) + ' (' + page.file + ')';

        const pageOpt = document.createElement('option');
        pageOpt.value = './' + page.file;
        pageOpt.textContent = page.navLabel || page.title || page.file;
        group.appendChild(pageOpt);

        if (page.file === CURRENT_FILENAME) {
          // Zones are available directly from the DOM
          document.querySelectorAll('[data-zone]').forEach(zone => {
            const slug  = zone.dataset.zone;
            const label = zone.dataset.zoneLabel || slug;
            if (!slug) return;
            const opt = document.createElement('option');
            opt.value       = './' + page.file + '#' + slug;
            opt.textContent = '  #' + label;
            group.appendChild(opt);
          });
          picker.appendChild(group);
        } else {
          // Append the page-level entry immediately; zones loaded async
          picker.appendChild(group);
          if (dirHandle) {
            dirHandle.getFileHandle(page.file).then(fh => fh.getFile()).then(f => f.text()).then(text => {
              const doc = new DOMParser().parseFromString(text, 'text/html');
              doc.querySelectorAll('[data-zone]').forEach(zone => {
                const slug  = zone.dataset.zone;
                const label = zone.dataset.zoneLabel || slug;
                if (!slug) return;
                const opt = document.createElement('option');
                opt.value       = './' + page.file + '#' + slug;
                opt.textContent = '  #' + label;
                group.appendChild(opt);
              });
            }).catch(() => {});
          }
        }
      });

      picker.addEventListener('change', () => {
        if (!picker.value) return;
        urlInput.value = picker.value;
        link.setAttribute('href', picker.value);
        refreshGotoBtn();
        setDirty(true);
        picker.value = ''; // reset so same option can be re-selected
      });
    } else {
      // No inventory — hide the picker
      popover.querySelector('#__webby-link-picker-wrap').style.display = 'none';
    }

    // Position below the link, within viewport
    positionPopover(popover, link);

    // Live updates
    textInput.addEventListener('input', () => {
      link.textContent = textInput.value;
      setDirty(true);
    });
    urlInput.addEventListener('input', () => {
      link.setAttribute('href', urlInput.value);
      refreshGotoBtn();
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
    const popH = 330; // approximate height before render (taller with page picker)
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
    injectToolbar();
    activateZones();
    activateNav();
    bindMutationObserver();
    bindLinkHandlers();
    bindSelectionToolbar();
    bindUndoRedo();
    showStatus('Edit mode active');

    // Silently re-links folder if previously granted, else shows the link banner.
    // loadPagesInventory is called inside initFileAccess when a handle is available.
    await initFileAccess();

    // Baseline the nav state so the first auto-save doesn't spuriously sync.
    lastSyncedNavHTML = getNavHTML();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Webby = { version: VERSION, serialize, exportToFile, publish: publishSite };

})();
