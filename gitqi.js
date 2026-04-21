/**
 * gitqi.js — v1.2.0
 * Zero-dependency browser-based site editor.
 * Activates only when window.SITE_SECRETS is present (local edit mode).
 * Stripped from exported/published HTML automatically.
 */
(function () {
  'use strict';

  const VERSION = '1.2.0';

  if (!window.SITE_SECRETS) return;

  // Base URL of this script on disk / CDN — used to locate sibling assets like
  // google-fonts.json. Captured here while document.currentScript is still valid
  // (it becomes null after the synchronous IIFE returns).
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const SCRIPT_BASE_URL = SCRIPT_SRC.substring(0, SCRIPT_SRC.lastIndexOf('/') + 1);

  // ─── Theme ────────────────────────────────────────────────────────────────
  // Mirrors the gitqi.com site palette + typography so the editor UI
  // feels stylistically consistent with the marketing site. These values are
  // used only inside editor UI elements (toolbar, modals, panels) — they are
  // never injected into the user's <head>, so the shared-head sync is unaffected.

  const T = {
    primary:   '#1a1b3a',  // deep navy — toolbar bg, headings, active states
    secondary: '#d946ef',  // magenta — reformat accent
    accent:    '#ff8c3c',  // orange — primary CTA (Publish, Submit)
    accent2:   '#2dd4bf',  // teal — link/info accent
    accent3:   '#fde047',  // yellow — highlights
    accent4:   '#f472b6',  // pink
    bg:        '#fdfbf5',  // cream — modal / panel bg
    bgAlt:     '#f3ede0',  // warm cream — inputs, subtle surfaces
    text:      '#1a1b3a',
    textMuted: '#5a5d7a',
    border:    'rgba(26, 27, 58, 0.12)',
    borderSoft:'rgba(26, 27, 58, 0.07)',
    danger:    '#e04a4a',
    success:   '#10b981',

    fontHead:  "'Fraunces', 'Playfair Display', Georgia, serif",
    fontBody:  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontMono:  "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",

    radius:    '14px',
    radiusSm:  '8px',
    radiusPill:'999px',

    shadow:    '0 20px 48px -16px rgba(26, 27, 58, 0.28)',
    shadowSm:  '0 6px 18px -8px rgba(26, 27, 58, 0.25)',
    shadowCta: '0 14px 32px -12px rgba(255, 140, 60, 0.55)',
  };

  const { geminiKey, githubToken, repo, branch = 'main' } = window.SITE_SECRETS;

  // ─── State ────────────────────────────────────────────────────────────────

  let isDirty = false;
  let mutationObserver = null;
  let statusTimer = null;
  let originalBodyPaddingTop = '';
  let originalNavTop = null; // set when a fixed nav is shifted down for the toolbar
  let autoSaveTimer = null;
  let dirHandle = null; // FileSystemDirectoryHandle when folder access is granted
  let pagesInventory = null; // { pages: [{ file, title, navLabel }] } — loaded from gitqi-pages.json
  let lastSyncedSharedSnapshot = ''; // JSON snapshot of shared head + nav after last sync; change detection for auto-save

  const UNDO_LIMIT = 20;
  let undoStack = [];
  let redoStack = [];

  // GitQi requires the File System Access API. Only Chromium-based browsers
  // (Chrome, Edge) are supported. Safari and Firefox are not supported.
  if (!('showDirectoryPicker' in window)) {
    const msg = document.createElement('div');
    Object.assign(msg.style, {
      position: 'fixed', inset: '0', zIndex: '9999999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(26, 27, 58, 0.85)', fontFamily: T.fontBody,
      padding: '20px', boxSizing: 'border-box',
    });
    msg.innerHTML = `
      <div style="background:${T.bg};border-radius:${T.radius};padding:34px 38px;max-width:440px;text-align:center;box-shadow:${T.shadow};font-family:${T.fontBody};">
        <div style="font-size:36px;margin-bottom:14px;">🌐</div>
        <h2 style="margin:0 0 10px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;">Unsupported Browser</h2>
        <p style="margin:0;font-size:14px;color:${T.textMuted};line-height:1.6;">
          GitQi requires access to the local file system and works in
          <strong style="color:${T.primary}">Chrome</strong> and <strong style="color:${T.primary}">Edge</strong>.<br><br>
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
      id: '__gitqi-toolbar',
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
      gap: '6px',
      padding: '0 18px',
      height: '44px',
      background: T.primary,
      color: T.bg,
      fontFamily: T.fontBody,
      fontSize: '13px',
      boxShadow: '0 8px 24px -10px rgba(26, 27, 58, 0.35)',
      boxSizing: 'border-box',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    });

    // Little gradient "W" mark — echoes the site nav logo
    const logo = el('span', { 'data-editor-ui': '' });
    logo.textContent = 'W';
    css(logo, {
      width: '26px', height: '26px',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '8px',
      fontFamily: T.fontHead, fontWeight: '700', fontSize: '14px',
      color: '#fff',
      background: `linear-gradient(135deg, ${T.accent} 0%, ${T.secondary} 55%, ${T.accent2} 100%)`,
      boxShadow: '0 6px 14px -6px rgba(217, 70, 239, 0.6)',
      marginRight: '4px',
      flexShrink: '0',
    });

    const title = el('span', { id: '__gitqi-title' });
    title.textContent = document.title || 'Site Editor';
    css(title, {
      fontFamily: T.fontHead,
      fontWeight: '500',
      fontSize: '15px',
      letterSpacing: '-0.01em',
      color: T.bg,
    });

    const status = el('span', { id: '__gitqi-status' });
    css(status, {
      fontSize: '11.5px',
      opacity: '0.7',
      marginLeft: '6px',
      letterSpacing: '0.01em',
      fontStyle: 'italic',
    });

    const spacer = el('div');
    css(spacer, { flex: '1' });

    const undoBtn = toolbarBtn('↩');
    undoBtn.id = '__gitqi-undo-btn';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.35';

    const redoBtn = toolbarBtn('↪');
    redoBtn.id = '__gitqi-redo-btn';
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

    bar.append(logo, title, spacer, status, undoBtn, redoBtn, pagesBtn, themeBtn, exportBtn, publishBtn);
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
      padding: '6px 15px',
      border: primary ? '2px solid transparent' : '1.5px solid rgba(253, 251, 245, 0.22)',
      borderRadius: T.radiusPill,
      background: primary ? T.accent : 'transparent',
      color: primary ? T.primary : T.bg,
      cursor: 'pointer',
      fontSize: '12.5px',
      fontFamily: T.fontBody,
      fontWeight: primary ? '600' : '500',
      letterSpacing: '-0.005em',
      lineHeight: '1',
      boxShadow: primary ? T.shadowCta : 'none',
      transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
    });
    btn.addEventListener('mouseenter', () => {
      if (primary) {
        btn.style.background = T.accent2;
        btn.style.transform = 'translateY(-1px)';
      } else {
        btn.style.background = 'rgba(253, 251, 245, 0.12)';
        btn.style.borderColor = 'rgba(253, 251, 245, 0.4)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (primary) {
        btn.style.background = T.accent;
        btn.style.transform = 'translateY(0)';
      } else {
        btn.style.background = 'transparent';
        btn.style.borderColor = 'rgba(253, 251, 245, 0.22)';
      }
    });
    return btn;
  }

  function showStatus(msg, isError = false) {
    const statusEl = document.getElementById('__gitqi-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? T.accent4 : T.accent3;
    statusEl.style.opacity = '1';
    clearTimeout(statusTimer);
    if (!isError) {
      statusTimer = setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.opacity = '0.7';
      }, 4000);
    }
  }

  function setDirty(val) {
    isDirty = val;
    const titleEl = document.getElementById('__gitqi-title');
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
    // Drop <link>s for fonts that are no longer referenced before we persist or sync.
    // Running it here (rather than per-font-change) also cleans up state that predates
    // the prune logic, on the first save after upgrade.
    pruneUnusedGoogleFontLinks();
    if (dirHandle) {
      await writeCurrentPageToLocalFile();
      await syncSharedToOtherPagesIfChanged();
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
      const req = indexedDB.open('__gitqi_fs', 1);
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
    if (oldKey !== HANDLE_KEY) {
      const legacyHandle = await new Promise(resolve => {
        try {
          const tx = db.transaction('handles', 'readonly');
          const req = tx.objectStore('handles').get(oldKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
      if (legacyHandle) {
        await storeHandleInDB(legacyHandle);
        return legacyHandle;
      }
    }

    // Legacy Webby migration: v1.2.x and earlier used the IndexedDB database
    // name "__webby_fs". If the new "__gitqi_fs" database is empty, copy the
    // handle over from the legacy DB and delete the legacy DB so future loads
    // are clean. Runs only when the new DB has no handle — idempotent after
    // the first successful migration.
    const migratedHandle = await new Promise(resolve => {
      try {
        const legacyReq = indexedDB.open('__webby_fs', 1);
        legacyReq.onupgradeneeded = e => {
          // Legacy DB didn't exist — abort (newly created empty DB will be
          // cleaned up in onsuccess).
          e.target.result.createObjectStore('handles');
        };
        legacyReq.onsuccess = e => {
          const legacyDb = e.target.result;
          let done = false;
          const finish = val => { if (!done) { done = true; legacyDb.close(); resolve(val); } };
          try {
            const tx = legacyDb.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get(HANDLE_KEY);
            req.onsuccess = () => finish(req.result || null);
            req.onerror = () => finish(null);
          } catch (_) { finish(null); }
        };
        legacyReq.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    if (migratedHandle) {
      await storeHandleInDB(migratedHandle);
      try { indexedDB.deleteDatabase('__webby_fs'); } catch (_) {}
      return migratedHandle;
    }
    // No legacy handle found — still delete the empty legacy DB we may have
    // just created by opening it.
    try { indexedDB.deleteDatabase('__webby_fs'); } catch (_) {}
    return null;
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
    if (document.getElementById('__gitqi-access-banner')) return;

    const overlay = el('div', { id: '__gitqi-access-banner', 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999999',
      background: 'rgba(26, 27, 58, 0.88)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fontBody,
      padding: '20px',
      boxSizing: 'border-box',
    });

    const hintPath = location.protocol === 'file:'
      ? decodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')))
      : null;
    const hintHtml = hintPath
      ? `<div style="margin-top:16px;background:${T.bgAlt};padding:10px 14px;border-radius:${T.radiusSm};font-family:${T.fontMono};font-size:12px;color:${T.primary};word-break:break-all;border:1px solid ${T.borderSoft};">${hintPath}</div>`
      : '';

    const modal = el('div');
    css(modal, {
      background: T.bg,
      borderRadius: T.radius,
      padding: '36px 38px',
      maxWidth: '480px',
      width: '100%',
      textAlign: 'center',
      boxShadow: T.shadow,
      boxSizing: 'border-box',
      fontFamily: T.fontBody,
      position: 'relative',
      overflow: 'hidden',
    });

    modal.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg, ${T.accent}, ${T.secondary} 50%, ${T.accent2});"></div>
      <div style="font-size:38px;margin-bottom:14px;">💾</div>
      <h2 style="margin:0 0 10px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;line-height:1.15;">Folder access required</h2>
      <p style="margin:0;font-size:14px;color:${T.textMuted};line-height:1.6;">
        GitQi needs write access to your site folder so edits save directly to your files.
        Without this permission, the editor cannot save your changes.
      </p>
      ${hintHtml}
      <button id="__gitqi-banner-grant"
        style="margin-top:22px;background:${T.accent};color:${T.primary};border:2px solid transparent;font-weight:600;padding:11px 26px;border-radius:${T.radiusPill};cursor:pointer;font-size:14px;font-family:${T.fontBody};box-shadow:${T.shadowCta};letter-spacing:-0.005em;transition:transform 0.2s ease, background 0.2s ease;">
        Select Folder
      </button>
      <div id="__gitqi-banner-error" style="margin-top:14px;font-size:12.5px;color:${T.danger};min-height:16px;"></div>
    `;
    const grantBtn = modal.querySelector('#__gitqi-banner-grant');
    grantBtn.addEventListener('mouseenter', () => { grantBtn.style.background = T.accent2; grantBtn.style.transform = 'translateY(-2px)'; });
    grantBtn.addEventListener('mouseleave', () => { grantBtn.style.background = T.accent; grantBtn.style.transform = 'translateY(0)'; });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const errEl = modal.querySelector('#__gitqi-banner-error');
    modal.querySelector('#__gitqi-banner-grant').addEventListener('click', async () => {
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
        lastSyncedSharedSnapshot = getSharedSnapshot();
        showStatus('Folder linked ✓ — edits now save to your files automatically');
      } catch (e) {
        if (e.name !== 'AbortError') errEl.textContent = e.message || 'Could not access folder';
      }
    });
  }

  // ─── Pages Inventory ──────────────────────────────────────────────────────
  //
  // gitqi-pages.json tracks all pages managed by the editor.
  // It lives alongside the HTML files in the site folder and is pushed to GitHub on publish.
  // Structure: { "pages": [{ "file": "index.html", "title": "Home", "navLabel": "Home" }] }

  async function loadPagesInventory() {
    if (!dirHandle) {
      // No folder access — seed a minimal in-memory inventory for the current page
      pagesInventory = { pages: [{ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME }] };
      return;
    }
    try {
      const fh = await dirHandle.getFileHandle('gitqi-pages.json');
      const inventoryFile = await fh.getFile();
      pagesInventory = JSON.parse(await inventoryFile.text());
      // Ensure the current page is registered
      if (!pagesInventory.pages.find(p => p.file === CURRENT_FILENAME)) {
        pagesInventory.pages.push({ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME });
        await savePagesInventory();
      }
      return;
    } catch (_) {
      // fall through to legacy migration / seed
    }

    // Legacy Webby migration: if webby-pages.json exists but gitqi-pages.json
    // doesn't, read the old file, write it as gitqi-pages.json, then delete
    // the old one. Idempotent — only runs when gitqi-pages.json is absent.
    try {
      const legacyFh = await dirHandle.getFileHandle('webby-pages.json');
      const legacyFile = await legacyFh.getFile();
      pagesInventory = JSON.parse(await legacyFile.text());
      if (!pagesInventory.pages.find(p => p.file === CURRENT_FILENAME)) {
        pagesInventory.pages.push({ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME });
      }
      await savePagesInventory();
      try { await dirHandle.removeEntry('webby-pages.json'); } catch (_) {}
      return;
    } catch (_) {
      // No legacy file either — seed from the current page and write it
      pagesInventory = { pages: [{ file: CURRENT_FILENAME, title: document.title || CURRENT_FILENAME, navLabel: document.title || CURRENT_FILENAME }] };
      await savePagesInventory();
    }
  }

  async function savePagesInventory() {
    if (!dirHandle || !pagesInventory) return;
    try {
      const fh = await dirHandle.getFileHandle('gitqi-pages.json', { create: true });
      const writable = await fh.createWritable();
      await writable.write(JSON.stringify(pagesInventory, null, 2));
      await writable.close();
    } catch (_) {}
  }

  // ─── Shared Head + Nav Sync ───────────────────────────────────────────────
  //
  // On every auto-save we snapshot the current page's shared head elements plus
  // the nav, and compare against the last synced version. If anything changed,
  // we push the updated shared elements into every other local page file.
  //
  // Synced: <nav>, main <style> (CSS variables + base styles),
  //   <style id="__gitqi-nav-styles">, <link rel="icon">,
  //   <link rel="apple-touch-icon">, Google Fonts <link>s and their preconnects.
  // NOT synced: <title>, <meta name="description">, <meta name="keywords"> —
  //   these are intentionally page-specific.

  function getNavHTML() {
    const nav = document.querySelector('nav');
    if (!nav) return '';
    const clone = nav.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
    clone.removeAttribute('data-gitqi-nav-bound');
    return clone.outerHTML;
  }

  // The main <style> block is the first <style> that isn't one of GitQi's
  // managed blocks (nav or per-section). Matches what the theme editor uses.
  function getMainStyleElement(root) {
    const head = root.head || root;
    const styles = Array.from(head.querySelectorAll('style'));
    return styles.find(s => !s.id || !s.id.startsWith('__gitqi-')) || null;
  }

  function getSharedHeadElements() {
    const head = document.head;
    return {
      mainStyle: getMainStyleElement(document),
      navStyle:  head.querySelector('style#__gitqi-nav-styles'),
      favicon:   head.querySelector('link[rel="icon"]'),
      appleIcon: head.querySelector('link[rel="apple-touch-icon"]'),
      googleFontLinks: Array.from(head.querySelectorAll(
        'link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]'
      )),
    };
  }

  function getSharedSnapshot() {
    const s = getSharedHeadElements();
    return JSON.stringify({
      nav:       getNavHTML(),
      mainStyle: s.mainStyle ? s.mainStyle.textContent : '',
      navStyle:  s.navStyle  ? s.navStyle.textContent  : '',
      favicon:   s.favicon   ? s.favicon.outerHTML     : '',
      appleIcon: s.appleIcon ? s.appleIcon.outerHTML   : '',
      googleFontLinks: s.googleFontLinks.map(l => l.outerHTML).sort(),
    });
  }

  // Normalize an href to a plain filename for comparison (drops ./, fragment, query).
  function normalizeHref(href) {
    return (href || '').replace(/^\.\//, '').split('#')[0].split('?')[0];
  }

  // Match an anchor href against a page filename, tolerating common home-link
  // aliases ("./", "/", "", ".") that all resolve to index.html.
  function hrefMatchesFilename(href, filename) {
    const norm = normalizeHref(href);
    if (norm === filename) return true;
    if (filename === 'index.html' && (norm === '' || norm === '.' || norm === '/')) return true;
    return false;
  }

  // Common "current page" marker classes used by hand-written and AI-generated navs.
  const ACTIVE_CLASS_CANDIDATES = ['active', 'current', 'is-active', 'is-current', 'selected'];

  // Inspect the source nav to learn how the current page marks its own link as active.
  // Returns { classes, ariaCurrent } or null if no recognised marker is present.
  // Only classes from ACTIVE_CLASS_CANDIDATES are treated as active markers — this
  // avoids false positives on unrelated unique classes (e.g. `has-megamenu`).
  function extractActiveMarker(navEl, sourceFilename) {
    const sourceAnchors = Array.from(navEl.querySelectorAll('a[href]'))
      .filter(a => hrefMatchesFilename(a.getAttribute('href'), sourceFilename));
    if (!sourceAnchors.length) return null;

    const ref = sourceAnchors[0];
    const classes = Array.from(ref.classList).filter(c => ACTIVE_CLASS_CANDIDATES.includes(c));
    const ariaCurrent = ref.getAttribute('aria-current');
    if (!classes.length && !ariaCurrent) return null;
    return { classes, ariaCurrent };
  }

  // Remove all known active markers from every anchor in `navEl`, then apply
  // `marker` to anchors whose href targets `destFilename`.
  function retargetActiveMarker(navEl, marker, destFilename) {
    navEl.querySelectorAll('a').forEach(a => {
      ACTIVE_CLASS_CANDIDATES.forEach(c => a.classList.remove(c));
      a.removeAttribute('aria-current');
      if (a.hasAttribute('class') && a.classList.length === 0) a.removeAttribute('class');
    });
    if (!marker) return;
    navEl.querySelectorAll('a[href]').forEach(a => {
      if (!hrefMatchesFilename(a.getAttribute('href'), destFilename)) return;
      marker.classes.forEach(c => a.classList.add(c));
      if (marker.ariaCurrent) a.setAttribute('aria-current', marker.ariaCurrent);
    });
  }

  async function syncSharedToOtherPagesIfChanged() {
    if (!dirHandle || !pagesInventory) return;
    const snapshot = getSharedSnapshot();
    if (snapshot === lastSyncedSharedSnapshot) return;

    const shared = getSharedHeadElements();
    const currentNavHTML = getNavHTML();
    const sourceNav = document.querySelector('nav');
    const activeMarker = sourceNav ? extractActiveMarker(sourceNav, CURRENT_FILENAME) : null;

    for (const page of pagesInventory.pages) {
      if (page.file === CURRENT_FILENAME) continue;
      try {
        const fh = await dirHandle.getFileHandle(page.file);
        const pageFile = await fh.getFile();
        const text = await pageFile.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        migrateLegacyWebbyMarkersInDoc(doc);

        // Replace <nav> — re-target the "current page" active marker so each
        // destination page marks its own link, not the link of the source page.
        // Prefer the source's marker, but fall back to the destination's own
        // existing marker if the source has none. This prevents the sync from
        // wiping active markers off every page just because the source page's
        // nav happens to be in a transient state without one.
        if (currentNavHTML) {
          const existingNav = doc.querySelector('nav');
          if (existingNav) {
            const destMarker = activeMarker || extractActiveMarker(existingNav, page.file);
            const tmp = doc.createElement('div');
            tmp.innerHTML = currentNavHTML;
            const newNav = tmp.querySelector('nav');
            if (newNav) {
              retargetActiveMarker(newNav, destMarker, page.file);
              existingNav.replaceWith(newNav);
            }
          }
        }

        // Replace main <style>
        if (shared.mainStyle) {
          const destMain = getMainStyleElement(doc);
          if (destMain) {
            destMain.textContent = shared.mainStyle.textContent;
          } else {
            const s = doc.createElement('style');
            s.textContent = shared.mainStyle.textContent;
            doc.head.appendChild(s);
          }
        }

        // Replace nav style block (or remove if source no longer has one)
        const destNavStyle = doc.head.querySelector('style#__gitqi-nav-styles');
        if (shared.navStyle) {
          if (destNavStyle) {
            destNavStyle.textContent = shared.navStyle.textContent;
          } else {
            const s = doc.createElement('style');
            s.id = '__gitqi-nav-styles';
            s.textContent = shared.navStyle.textContent;
            doc.head.appendChild(s);
          }
        } else if (destNavStyle) {
          destNavStyle.remove();
        }

        // Sync favicon links
        syncLinkRelInDoc(doc, 'icon', shared.favicon);
        syncLinkRelInDoc(doc, 'apple-touch-icon', shared.appleIcon);

        // Sync Google Fonts <link>s (plus preconnects)
        syncGoogleFontLinksInDoc(doc, shared.googleFontLinks);

        const updated = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        const writeFh = await dirHandle.getFileHandle(page.file, { create: false });
        const writable = await writeFh.createWritable();
        await writable.write(updated);
        await writable.close();
      } catch (_) {} // Non-fatal — skip pages that can't be read/written
    }

    lastSyncedSharedSnapshot = snapshot;
  }

  // Upsert or remove a <link rel="X"> in `doc` to match the source element.
  // Source null → any existing link with that rel is removed.
  function syncLinkRelInDoc(doc, rel, source) {
    let link = doc.head.querySelector(`link[rel="${rel}"]`);
    if (source) {
      if (!link) {
        link = doc.createElement('link');
        doc.head.appendChild(link);
      }
      Array.from(link.attributes).forEach(a => link.removeAttribute(a.name));
      Array.from(source.attributes).forEach(a => link.setAttribute(a.name, a.value));
    } else if (link) {
      link.remove();
    }
  }

  // Replace all Google Fonts <link>s in `doc` with copies of `sourceLinks`.
  // Inserted before the first <style> so fonts load before inline CSS references them.
  function syncGoogleFontLinksInDoc(doc, sourceLinks) {
    doc.head.querySelectorAll(
      'link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]'
    ).forEach(l => l.remove());
    const firstStyle = doc.head.querySelector('style');
    sourceLinks.forEach(src => {
      const link = doc.createElement('link');
      Array.from(src.attributes).forEach(a => link.setAttribute(a.name, a.value));
      if (firstStyle) doc.head.insertBefore(link, firstStyle);
      else doc.head.appendChild(link);
    });
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
      if (img.dataset.gitqiBound) return; // already activated (e.g. re-injection)
      img.dataset.gitqiBound = '1';
      bindImageHandler(img);
    });
    // Bind video handlers to [data-editable-video] wrappers (iframes eat pointer
    // events so we bind on the wrapper and inject a click-intercept overlay).
    section.querySelectorAll('[data-editable-video]').forEach(wrapper => {
      if (wrapper.closest('[data-editor-ui]')) return;
      if (wrapper.dataset.gitqiVideoBound) return;
      wrapper.dataset.gitqiVideoBound = '1';
      bindVideoHandler(wrapper);
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
      padding: '5px 12px',
      background: T.accent4,
      color: '#fff',
      border: 'none',
      borderRadius: T.radiusPill,
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: T.fontBody,
      fontWeight: '600',
      letterSpacing: '-0.005em',
      boxShadow: '0 6px 14px -6px rgba(244, 114, 182, 0.55)',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease, background 0.18s ease',
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
      section.style.outline = `2px dashed ${T.accent4}`;
      section.style.outlineOffset = '-2px';
      btn.style.background = T.danger;
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      section.style.outline = '';
      section.style.outlineOffset = '';
      btn.style.background = T.accent4;
      btn.style.transform = 'translateY(0)';
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const label = section.dataset.zoneLabel || section.dataset.zone || 'this section';
      if (!confirm(`Delete "${label}"?`)) return;
      snapshotForUndo();
      // Clean up adjacent add-button
      const next = section.nextElementSibling;
      if (next && next.classList.contains('__gitqi-add-wrap')) next.remove();
      // Clean up any section-specific style block
      const slug = section.dataset.zone;
      if (slug) {
        const sectionStyle = document.getElementById('__gitqi-section-' + slug + '-styles');
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
      right: '160px',
      zIndex: '1000',
      padding: '5px 12px',
      background: T.secondary,
      color: '#fff',
      border: 'none',
      borderRadius: T.radiusPill,
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: T.fontBody,
      fontWeight: '600',
      letterSpacing: '-0.005em',
      boxShadow: '0 6px 14px -6px rgba(217, 70, 239, 0.5)',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
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
      section.style.outline = `2px dashed ${T.secondary}`;
      section.style.outlineOffset = '-2px';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      section.style.outline = '';
      section.style.outlineOffset = '';
      btn.style.transform = 'translateY(0)';
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
      background: 'rgba(26, 27, 58, 0.65)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fontBody,
    });

    const modal = el('div');
    css(modal, {
      background: T.bg,
      borderRadius: T.radius,
      padding: '30px 32px',
      width: '520px',
      maxWidth: '92vw',
      fontFamily: T.fontBody,
      boxShadow: T.shadow,
      position: 'relative',
      overflow: 'hidden',
      borderTop: `5px solid ${T.secondary}`,
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;line-height:1.15">Reformat <span style="color:${T.secondary};font-style:italic">${label}</span></h3>
      <p style="margin:0 0 18px;font-size:13.5px;color:${T.textMuted};line-height:1.55">
        Describe how you want the layout or structure changed. Content (text, images) will not be changed unless you ask.
      </p>
      <textarea
        id="__gitqi-reformat-desc"
        placeholder="e.g. Remove the section title and add a third box to the right of the other two. Add a centered button at the bottom of each box."
        style="width:100%;height:104px;padding:12px 14px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
               font-size:13.5px;font-family:${T.fontBody};resize:vertical;box-sizing:border-box;
               line-height:1.55;outline:none;background:#fff;color:${T.primary};
               transition:border-color 0.18s ease, box-shadow 0.18s ease;"
      ></textarea>
      <div style="margin-top:10px;padding:10px 12px;background:${T.bgAlt};border-radius:${T.radiusSm};
                  font-size:11.5px;color:${T.textMuted};line-height:1.55;border-left:3px solid ${T.secondary};">
        <strong style="color:${T.primary};font-weight:600;">Tip:</strong>
        ask to add <strong style="color:${T.primary};font-weight:600;">images</strong>
        (<em>"add a photo beside the text"</em>) or
        <strong style="color:${T.primary};font-weight:600;">YouTube videos</strong>
        (<em>"embed a video below the heading"</em>) — click any image afterwards to
        upload your own, or click any video to paste a YouTube URL. Existing images
        and videos are preserved unless you ask to change them.
      </div>
      <p id="__gitqi-reformat-error" style="display:none;margin:10px 0 0;font-size:12.5px;color:${T.danger};"></p>
      <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
        <button id="__gitqi-reformat-cancel"
          style="padding:9px 20px;border:1.5px solid ${T.border};background:transparent;border-radius:${T.radiusPill};
                 cursor:pointer;font-size:13px;font-family:${T.fontBody};font-weight:500;color:${T.primary};
                 transition:background 0.18s ease, border-color 0.18s ease;">
          Cancel
        </button>
        <button id="__gitqi-reformat-submit"
          style="padding:9px 22px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:13px;font-weight:600;
                 font-family:${T.fontBody};letter-spacing:-0.005em;box-shadow:${T.shadowCta};
                 transition:background 0.18s ease, transform 0.18s ease;">
          Reformat with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const textarea = modal.querySelector('#__gitqi-reformat-desc');
    const errorEl = modal.querySelector('#__gitqi-reformat-error');
    const submitBtn = modal.querySelector('#__gitqi-reformat-submit');
    const cancelBtn = modal.querySelector('#__gitqi-reformat-cancel');

    textarea.focus();
    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = T.secondary;
      textarea.style.boxShadow = '0 0 0 3px rgba(217, 70, 239, 0.12)';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = T.border;
      textarea.style.boxShadow = 'none';
    });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = T.accent2; submitBtn.style.transform = 'translateY(-2px)'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = T.accent; submitBtn.style.transform = 'translateY(0)'; });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

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
    const styleId = '__gitqi-section-' + slug + '-styles';
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
    const existingStyleEl = slug ? document.getElementById('__gitqi-section-' + slug + '-styles') : null;
    const existingSectionCSS = existingStyleEl ? existingStyleEl.textContent : '';

    // Clean copy of the section — strip editor UI before sending to AI
    const clone = section.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(el => el.removeAttribute('spellcheck'));
    clone.querySelectorAll('[data-gitqi-bound]').forEach(el => el.removeAttribute('data-gitqi-bound'));

    return `You are reformatting an existing HTML section for a website — both its HTML structure and its CSS.

CSS VARIABLES IN USE (use these, never hardcode colours or sizes):
${styleBlock}

${existingSectionCSS ? `EXISTING SECTION-SPECIFIC CSS (currently in a separate style block):\n${existingSectionCSS}\n` : ''}
EXISTING SECTION HTML (reformat this):
${clone.outerHTML}

REFORMAT INSTRUCTION:
"${description}"

RULES:
- Preserve ALL existing text content, images, videos, and links exactly as-is unless the instruction explicitly says to change them
- You may freely change HTML structure, CSS classes, layout, responsive behaviour, and media queries
- Use only the CSS variables defined above — no hardcoded colours or font sizes
- Keep data-zone and data-zone-label attributes on the <section> element
- Keep data-editable on all text elements and data-editable-image on all img elements
- Preserve any existing <div data-editable-video>...</div> wrappers verbatim (including the inline styles, the nested <iframe>, its src, and all its attributes) — you may reposition them but must not alter their internal structure
- If the instruction asks you to ADD a video, insert this exact wrapper (the user will replace the placeholder URL):
    <div data-editable-video style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:var(--radius);">
      <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="YouTube video player" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    </div>
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
    if (nav.dataset.gitqiNavBound) return;
    nav.dataset.gitqiNavBound = '1';

    const btn = el('button', { 'data-editor-ui': '' });
    btn.textContent = '⟳ Reformat Nav';
    css(btn, {
      position: 'absolute',
      top: '6px',
      right: '6px',
      zIndex: '1000',
      padding: '5px 12px',
      background: T.secondary,
      color: '#fff',
      border: 'none',
      borderRadius: T.radiusPill,
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: T.fontBody,
      fontWeight: '600',
      letterSpacing: '-0.005em',
      boxShadow: '0 6px 14px -6px rgba(217, 70, 239, 0.5)',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
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
      nav.style.outline = `2px dashed ${T.secondary}`;
      nav.style.outlineOffset = '-2px';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      nav.style.outline = '';
      nav.style.outlineOffset = '';
      btn.style.transform = 'translateY(0)';
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
      background: 'rgba(26, 27, 58, 0.65)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fontBody,
    });

    const modal = el('div');
    css(modal, {
      background: T.bg,
      borderRadius: T.radius,
      padding: '30px 32px',
      width: '500px',
      maxWidth: '92vw',
      fontFamily: T.fontBody,
      boxShadow: T.shadow,
      position: 'relative',
      overflow: 'hidden',
      borderTop: `5px solid ${T.secondary}`,
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;line-height:1.15">Reformat <span style="color:${T.secondary};font-style:italic">Navigation</span></h3>
      <p style="margin:0 0 18px;font-size:13.5px;color:${T.textMuted};line-height:1.55">
        Describe how to restructure the navigation. Links and labels are preserved unless you ask to change them.
      </p>
      <textarea
        id="__gitqi-reformat-nav-desc"
        placeholder="e.g. Make it a sticky horizontal bar with the logo on the left and links on the right, with a hamburger menu on mobile"
        style="width:100%;height:100px;padding:12px 14px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
               font-size:13.5px;font-family:${T.fontBody};resize:vertical;box-sizing:border-box;
               line-height:1.55;outline:none;background:#fff;color:${T.primary};
               transition:border-color 0.18s ease, box-shadow 0.18s ease;"
      ></textarea>
      <p id="__gitqi-reformat-nav-error" style="display:none;margin:10px 0 0;font-size:12.5px;color:${T.danger};"></p>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
        <button id="__gitqi-reformat-nav-cancel"
          style="padding:9px 20px;border:1.5px solid ${T.border};background:transparent;border-radius:${T.radiusPill};
                 cursor:pointer;font-size:13px;font-family:${T.fontBody};font-weight:500;color:${T.primary};
                 transition:background 0.18s ease, border-color 0.18s ease;">
          Cancel
        </button>
        <button id="__gitqi-reformat-nav-submit"
          style="padding:9px 22px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:13px;font-weight:600;
                 font-family:${T.fontBody};letter-spacing:-0.005em;box-shadow:${T.shadowCta};
                 transition:background 0.18s ease, transform 0.18s ease;">
          Reformat with AI
        </button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#__gitqi-reformat-nav-desc');
    const errorEl  = overlay.querySelector('#__gitqi-reformat-nav-error');
    const submitBtn = overlay.querySelector('#__gitqi-reformat-nav-submit');
    const cancelBtn = overlay.querySelector('#__gitqi-reformat-nav-cancel');

    setTimeout(() => textarea.focus(), 50);

    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = T.secondary;
      textarea.style.boxShadow = '0 0 0 3px rgba(217, 70, 239, 0.12)';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = T.border;
      textarea.style.boxShadow = 'none';
    });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = T.accent2; submitBtn.style.transform = 'translateY(-2px)'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = T.accent; submitBtn.style.transform = 'translateY(0)'; });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

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
    let navStyleEl = document.getElementById('__gitqi-nav-styles');
    if (!navStyleEl) {
      navStyleEl = document.createElement('style');
      navStyleEl.id = '__gitqi-nav-styles';
      document.head.appendChild(navStyleEl);
    }
    if (css) navStyleEl.textContent = css;

    delete newNav.dataset.gitqiNavBound;
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
    lastSyncedSharedSnapshot = '';
    await syncSharedToOtherPagesIfChanged();

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
    const existingNavStyles = document.getElementById('__gitqi-nav-styles');
    const existingNavCSS = existingNavStyles ? existingNavStyles.textContent : '';

    const clone = nav.cloneNode(true);
    clone.querySelectorAll('[data-editor-ui]').forEach(el => el.remove());
    clone.removeAttribute('data-gitqi-nav-bound');

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
    document.querySelectorAll('.__gitqi-add-wrap').forEach(el => el.remove());
    injectAddSectionButtons();
  }

  function makeAddButton(insertAfterZone) {
    const wrap = el('div', { 'data-editor-ui': '', class: '__gitqi-add-wrap' });
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
      padding: '6px 18px',
      background: 'rgba(26, 27, 58, 0.82)',
      color: T.bg,
      border: `1.5px solid ${T.accent3}`,
      borderRadius: T.radiusPill,
      cursor: 'pointer',
      fontSize: '11.5px',
      fontFamily: T.fontBody,
      fontWeight: '600',
      letterSpacing: '-0.005em',
      backdropFilter: 'blur(6px)',
      boxShadow: '0 10px 22px -12px rgba(26, 27, 58, 0.4)',
      transition: 'background 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = T.accent;
      btn.style.color = T.primary;
      btn.style.borderColor = 'transparent';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(26, 27, 58, 0.82)';
      btn.style.color = T.bg;
      btn.style.borderColor = T.accent3;
      btn.style.transform = 'translateY(0)';
    });
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
    const existing = document.getElementById('__gitqi-pages-panel');
    if (existing) { existing.remove(); return; }

    // Close theme panel if open
    const themePanel = document.getElementById('__gitqi-theme-panel');
    if (themePanel) themePanel.remove();

    if (!pagesInventory) {
      showStatus('Link your site folder to manage pages', true);
      return;
    }

    const panel = el('div', { id: '__gitqi-pages-panel', 'data-editor-ui': '' });
    css(panel, {
      position: 'fixed',
      top: '44px',
      right: '0',
      bottom: '0',
      width: '290px',
      background: T.bg,
      borderLeft: `1px solid ${T.border}`,
      zIndex: '999998',
      fontFamily: T.fontBody,
      fontSize: '13px',
      boxShadow: '-8px 0 28px -8px rgba(26, 27, 58, 0.18)',
      display: 'flex',
      flexDirection: 'column',
      color: T.primary,
    });

    const header = el('div');
    css(header, {
      padding: '16px 18px 14px',
      borderBottom: `1px solid ${T.borderSoft}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: '0',
      background: T.bg,
      zIndex: '1',
      flexShrink: '0',
    });
    header.innerHTML = `<strong style="font-size:17px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.015em">Pages</strong>
      <button id="__gitqi-pages-close" style="background:none;border:none;cursor:pointer;font-size:20px;color:${T.textMuted};line-height:1;padding:0 4px;transition:color 0.15s;">&times;</button>`;
    const closeBtn = header.querySelector('#__gitqi-pages-close');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = T.primary; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = T.textMuted; });
    closeBtn.addEventListener('click', () => panel.remove());

    const list = el('div');
    css(list, { flex: '1', padding: '10px 18px', overflowY: 'auto' });

    pagesInventory.pages.forEach(page => {
      const row = el('div');
      css(row, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '11px 0',
        borderBottom: `1px solid ${T.borderSoft}`,
      });

      const isCurrent = page.file === CURRENT_FILENAME;
      const info = el('div');
      css(info, { flex: '1', minWidth: '0' });

      const nameEl = el('div');
      nameEl.textContent = page.navLabel || page.title || page.file;
      css(nameEl, {
        fontWeight: isCurrent ? '600' : '500',
        fontSize: '13px',
        color: isCurrent ? T.secondary : T.primary,
        fontStyle: isCurrent ? 'italic' : 'normal',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });

      const fileEl = el('div');
      fileEl.textContent = page.file + (isCurrent ? ' — current' : '');
      css(fileEl, { fontSize: '10.5px', color: T.textMuted, marginTop: '2px', fontFamily: T.fontMono });

      info.append(nameEl, fileEl);
      row.append(info);

      if (!isCurrent) {
        const openBtn = el('a');
        openBtn.textContent = 'Open →';
        openBtn.href = './' + page.file;
        css(openBtn, {
          fontSize: '11.5px',
          color: T.primary,
          textDecoration: 'none',
          flexShrink: '0',
          padding: '5px 11px',
          borderRadius: T.radiusPill,
          background: T.bgAlt,
          border: `1px solid ${T.borderSoft}`,
          whiteSpace: 'nowrap',
          fontWeight: '500',
          transition: 'background 0.15s, border-color 0.15s',
        });
        openBtn.addEventListener('mouseenter', () => { openBtn.style.background = T.accent2; openBtn.style.borderColor = 'transparent'; });
        openBtn.addEventListener('mouseleave', () => { openBtn.style.background = T.bgAlt; openBtn.style.borderColor = T.borderSoft; });

        const delBtn = el('button');
        delBtn.textContent = '✕';
        delBtn.title = 'Delete page';
        css(delBtn, {
          flexShrink: '0',
          width: '26px',
          height: '26px',
          padding: '0',
          background: 'transparent',
          border: `1px solid ${T.borderSoft}`,
          borderRadius: '50%',
          color: T.textMuted,
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: T.fontBody,
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        });
        delBtn.addEventListener('mouseenter', () => { delBtn.style.background = T.accent4; delBtn.style.color = '#fff'; delBtn.style.borderColor = 'transparent'; });
        delBtn.addEventListener('mouseleave', () => { delBtn.style.background = 'transparent'; delBtn.style.color = T.textMuted; delBtn.style.borderColor = T.borderSoft; });
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
      padding: '14px 18px 18px',
      borderTop: `1px solid ${T.borderSoft}`,
      background: T.bg,
      flexShrink: '0',
    });

    const addBtn = el('button');
    addBtn.textContent = '+ Add Page';
    css(addBtn, {
      width: '100%',
      padding: '10px',
      background: dirHandle ? T.accent : T.bgAlt,
      color: dirHandle ? T.primary : T.textMuted,
      border: `2px solid transparent`,
      borderRadius: T.radiusPill,
      cursor: dirHandle ? 'pointer' : 'default',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: T.fontBody,
      letterSpacing: '-0.005em',
      boxShadow: dirHandle ? T.shadowCta : 'none',
      transition: 'background 0.18s ease, transform 0.18s ease',
    });
    if (dirHandle) {
      addBtn.addEventListener('mouseenter', () => { addBtn.style.background = T.accent2; addBtn.style.transform = 'translateY(-2px)'; });
      addBtn.addEventListener('mouseleave', () => { addBtn.style.background = T.accent; addBtn.style.transform = 'translateY(0)'; });
      addBtn.addEventListener('click', () => { panel.remove(); promptAddPage(); });
    }
    footer.appendChild(addBtn);

    if (!dirHandle) {
      const note = el('div');
      note.textContent = 'Link your site folder to add pages.';
      css(note, { fontSize: '11.5px', color: T.textMuted, marginTop: '8px', textAlign: 'center', fontStyle: 'italic' });
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
      background: 'rgba(26, 27, 58, 0.65)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fontBody,
    });

    const modal = el('div');
    css(modal, {
      background: T.bg,
      borderRadius: T.radius,
      padding: '30px 32px',
      width: '520px',
      maxWidth: '92vw',
      fontFamily: T.fontBody,
      boxShadow: T.shadow,
      position: 'relative',
      overflow: 'hidden',
      borderTop: `5px solid ${T.accent2}`,
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;line-height:1.15">Add <span style="color:${T.accent2};font-style:italic">New Page</span></h3>
      <p style="margin:0 0 18px;font-size:13.5px;color:${T.textMuted};line-height:1.55">
        Describe the new page. The AI will generate it using your site's existing theme and navigation.
      </p>
      <label style="display:block;margin-bottom:12px;">
        <span style="display:block;font-size:11px;font-weight:600;color:${T.primary};margin-bottom:5px;letter-spacing:0.04em;text-transform:uppercase;">Page description</span>
        <textarea
          id="__gitqi-addpage-desc"
          placeholder="e.g. A services page listing massage therapy, physiotherapy, and acupuncture. Each service gets a card with a title, short description, and a Book Now button."
          style="width:100%;height:100px;padding:12px 14px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:13.5px;font-family:${T.fontBody};resize:vertical;box-sizing:border-box;
                 line-height:1.55;outline:none;background:#fff;color:${T.primary};
                 transition:border-color 0.18s ease, box-shadow 0.18s ease;"
        ></textarea>
        <div style="margin-top:8px;padding:10px 12px;background:${T.bgAlt};border-radius:${T.radiusSm};
                    font-size:11.5px;color:${T.textMuted};line-height:1.55;border-left:3px solid ${T.accent2};">
          <strong style="color:${T.primary};font-weight:600;">Tip:</strong>
          ask for <strong style="color:${T.primary};font-weight:600;">images</strong>
          (<em>"a team photo at the top"</em>) or
          <strong style="color:${T.primary};font-weight:600;">YouTube videos</strong>
          (<em>"embed an intro video"</em>) — after the page is generated you can
          click any image to upload your own or click any video to paste a YouTube URL.
        </div>
      </label>
      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:${T.primary};margin-bottom:5px;letter-spacing:0.04em;text-transform:uppercase;">Navigation label</span>
        <input id="__gitqi-addpage-label" type="text" placeholder="e.g. Services"
          style="width:100%;padding:9px 12px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:13.5px;font-family:${T.fontBody};box-sizing:border-box;outline:none;background:#fff;color:${T.primary};
                 transition:border-color 0.18s ease, box-shadow 0.18s ease;" />
      </label>
      <p style="margin:0 0 16px;font-size:11.5px;color:${T.textMuted};">
        Filename: <span id="__gitqi-addpage-fname" style="font-family:${T.fontMono};color:${T.primary};">—</span>
      </p>
      <p id="__gitqi-addpage-error" style="display:none;margin:0 0 12px;font-size:12.5px;color:${T.danger};"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="__gitqi-addpage-cancel"
          style="padding:9px 20px;border:1.5px solid ${T.border};background:transparent;border-radius:${T.radiusPill};
                 cursor:pointer;font-size:13px;font-family:${T.fontBody};font-weight:500;color:${T.primary};
                 transition:background 0.18s ease, border-color 0.18s ease;">
          Cancel
        </button>
        <button id="__gitqi-addpage-submit"
          style="padding:9px 22px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:13px;font-weight:600;
                 font-family:${T.fontBody};letter-spacing:-0.005em;box-shadow:${T.shadowCta};
                 transition:background 0.18s ease, transform 0.18s ease;">
          Generate with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const descInput  = modal.querySelector('#__gitqi-addpage-desc');
    const labelInput = modal.querySelector('#__gitqi-addpage-label');
    const fnameEl    = modal.querySelector('#__gitqi-addpage-fname');
    const errorEl    = modal.querySelector('#__gitqi-addpage-error');
    const submitBtn  = modal.querySelector('#__gitqi-addpage-submit');
    const cancelBtn  = modal.querySelector('#__gitqi-addpage-cancel');

    function labelToFilename(label) {
      return label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.html';
    }

    labelInput.addEventListener('input', () => {
      fnameEl.textContent = labelInput.value.trim() ? labelToFilename(labelInput.value) : '—';
    });

    descInput.focus();
    const focusRing = (input) => {
      input.addEventListener('focus', () => {
        input.style.borderColor = T.accent2;
        input.style.boxShadow = '0 0 0 3px rgba(45, 212, 191, 0.15)';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = T.border;
        input.style.boxShadow = 'none';
      });
    };
    focusRing(descInput);
    focusRing(labelInput);
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = T.accent2; submitBtn.style.transform = 'translateY(-2px)'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = T.accent; submitBtn.style.transform = 'translateY(0)'; });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

    let pending = false;
    cancelBtn.addEventListener('click', () => { if (!pending) overlay.remove(); });
    descInput.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });

    submitBtn.addEventListener('click', async () => {
      const description = descInput.value.trim();
      const navLabel    = labelInput.value.trim();
      if (!description) { descInput.style.borderColor  = T.danger; descInput.focus();  return; }
      if (!navLabel)    { labelInput.style.borderColor = T.danger; labelInput.focus(); return; }

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
      delete currentNav.dataset.gitqiNavBound;
      activateNav();
    }

    // Force re-sync: push the updated nav (with new link) to all pages including the new file
    lastSyncedSharedSnapshot = '';
    await syncSharedToOtherPagesIfChanged();

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
    const navStyleEl = document.getElementById('__gitqi-nav-styles');
    const navCSS     = navStyleEl ? navStyleEl.textContent.trim() : '';

    const nav = document.querySelector('nav');
    let navHTML = '';
    if (nav) {
      const clone = nav.cloneNode(true);
      clone.querySelectorAll('[data-editor-ui]').forEach(n => n.remove());
      clone.removeAttribute('data-gitqi-nav-bound');
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
CURRENT NAVIGATION CSS (copy this verbatim into a <style id="__gitqi-nav-styles"> block in <head>, immediately after the main <style> block — do not modify it):
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
4. If CURRENT NAVIGATION CSS is provided above, copy it verbatim into a <style id="__gitqi-nav-styles"> block in <head>, immediately after the main <style> block
5. Every <section> must have: data-zone="{slug}" and data-zone-label="{Human Label}"
6. Every editable text element must have: data-editable
7. Every <img> must have: data-editable-image and src="./assets/placeholder.jpg"
8. For video embeds, use EXACTLY this wrapper (the placeholder video is a safe, always-embeddable demo — user will swap it):
     <div data-editable-video style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:var(--radius);">
       <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="YouTube video player" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
     </div>
   Never use <video> tags, other embed providers, or a different wrapper shape — the editor binds to the [data-editable-video] marker.
9. Include immediately after the <style> block (and nav CSS block if present) in <head>:
   <script src="./secrets.js"></script>
   <script src="https://swill.github.io/gitqi/gitqi.js"></script>
10. Set an appropriate <title> and <meta name="description"> for this page
11. Use only CSS variables from the style block — no hardcoded colours or font sizes
12. Placeholder content should be realistic and relevant to the page description

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
    lastSyncedSharedSnapshot = '';
    await syncSharedToOtherPagesIfChanged();

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
    bodyClone.querySelectorAll('[data-gitqi-bound]').forEach(n => n.removeAttribute('data-gitqi-bound'));
    bodyClone.querySelectorAll('[data-gitqi-nav-bound]').forEach(n => n.removeAttribute('data-gitqi-nav-bound'));
    bodyClone.querySelectorAll('[data-gitqi-video-bound]').forEach(n => n.removeAttribute('data-gitqi-video-bound'));

    const styleEl = document.querySelector('style');

    const sectionStyles = [];
    document.querySelectorAll('style[id^="__gitqi-section-"]').forEach(s => {
      sectionStyles.push({ id: s.id, content: s.textContent });
    });
    const navStyleEl = document.getElementById('__gitqi-nav-styles');

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
    closeVideoPopover();
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
    document.querySelectorAll('style[id^="__gitqi-section-"]').forEach(s => s.remove());
    const existingNavStyles = document.getElementById('__gitqi-nav-styles');
    if (existingNavStyles) existingNavStyles.remove();
    snapshot.sectionStyles.forEach(({ id, content }) => {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = content;
      document.head.appendChild(s);
    });
    if (snapshot.navStyles) {
      const s = document.createElement('style');
      s.id = '__gitqi-nav-styles';
      s.textContent = snapshot.navStyles;
      document.head.appendChild(s);
    }

    // Re-activate editing on restored content
    activateZones();
    activateNav();
    const restoredNav = document.querySelector('nav');
    if (restoredNav) rerunInlineScripts(restoredNav);
    bindMutationObserver();

    // Re-baseline sync so the next auto-save doesn't over-eagerly push stale shared state
    lastSyncedSharedSnapshot = getSharedSnapshot();

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
    const undoBtn = document.getElementById('__gitqi-undo-btn');
    const redoBtn = document.getElementById('__gitqi-redo-btn');
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
      background: T.primary,
      color: T.bg,
      padding: '8px 16px',
      borderRadius: T.radiusPill,
      fontSize: '12px',
      fontWeight: '500',
      fontFamily: T.fontBody,
      boxShadow: '0 8px 20px -6px rgba(26, 27, 58, 0.45)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.2s',
      whiteSpace: 'nowrap',
      zIndex: '10',
      border:'1px solid white',
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
        imgEl.removeAttribute('data-gitqi-src');
      } else {
        // No local file access — display via blob URL; serializer swaps to relative path
        imgEl.src = URL.createObjectURL(new Blob([buffer], { type: file.type }));
        imgEl.dataset.gitqiSrc = `./${path}`;
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

  // ─── Video Manager ────────────────────────────────────────────────────────
  //
  // Videos are embedded as <iframe> inside a <div data-editable-video> wrapper.
  // Iframes swallow pointer events, so we inject a transparent click-intercept
  // overlay on top of the iframe (analogous to the image hover hint) and open
  // a URL popover when clicked. Users paste a YouTube URL in any common form
  // and we normalise it to the /embed/ID form.

  let activeVideoPopover = null;

  // Accepts common YouTube URL shapes and returns the 11-char video id, or null.
  //   https://www.youtube.com/watch?v=ID
  //   https://youtu.be/ID
  //   https://www.youtube.com/embed/ID
  //   https://www.youtube-nocookie.com/embed/ID
  //   https://www.youtube.com/shorts/ID
  // Bare 11-char ids are also accepted so users can paste just the id.
  function extractYouTubeId(url) {
    if (!url) return null;
    const trimmed = url.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/embed\/([A-Za-z0-9_-]{11})/,
      /\/shorts\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function youtubeEmbedURL(id) {
    return 'https://www.youtube.com/embed/' + id;
  }

  function bindVideoHandler(wrapper) {
    if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

    // Transparent overlay over the iframe to intercept clicks + show hover hint.
    // Marked data-editor-ui so the serializer strips it from published output.
    const overlay = el('div', { 'data-editor-ui': '' });
    css(overlay, {
      position: 'absolute',
      inset: '0',
      cursor: 'pointer',
      zIndex: '10',
      background: 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s',
    });

    const hint = el('div');
    hint.textContent = 'Click to change video';
    css(hint, {
      background: T.primary,
      color: T.bg,
      padding: '8px 16px',
      borderRadius: T.radiusPill,
      fontSize: '12px',
      fontWeight: '500',
      fontFamily: T.fontBody,
      boxShadow: '0 8px 20px -6px rgba(26, 27, 58, 0.45)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.2s',
      whiteSpace: 'nowrap',
      border: '1px solid white',
    });
    overlay.appendChild(hint);

    overlay.addEventListener('mouseenter', () => {
      hint.style.opacity = '1';
      overlay.style.background = 'rgba(26, 27, 58, 0.12)';
    });
    overlay.addEventListener('mouseleave', () => {
      hint.style.opacity = '0';
      overlay.style.background = 'transparent';
    });

    overlay.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openVideoPopover(wrapper);
    });

    wrapper.appendChild(overlay);
  }

  function openVideoPopover(wrapper) {
    closeVideoPopover();

    const iframe = wrapper.querySelector('iframe');
    const currentURL = iframe ? (iframe.getAttribute('src') || '') : '';

    const popover = el('div', { 'data-editor-ui': '', id: '__gitqi-video-popover' });
    css(popover, {
      position: 'fixed',
      zIndex: '1000001',
      background: T.bg,
      border: `1px solid ${T.border}`,
      borderRadius: T.radius,
      padding: '16px 18px',
      width: '360px',
      boxShadow: T.shadow,
      fontFamily: T.fontBody,
      fontSize: '13px',
      color: T.primary,
    });

    popover.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;
                     letter-spacing:0.1em;color:${T.textMuted};">Edit Video</span>
        <a id="__gitqi-video-goto" href="#" target="_blank" rel="noopener noreferrer"
          style="font-size:11px;color:${T.primary};text-decoration:none;padding:4px 10px;
                 border-radius:${T.radiusPill};background:${T.bgAlt};border:1px solid ${T.borderSoft};display:none;font-weight:500;">
          Go to video →
        </a>
      </div>

      <label style="display:block;margin-bottom:10px;">
        <span style="display:block;font-size:11px;font-weight:600;color:${T.primary};margin-bottom:5px;letter-spacing:0.04em;text-transform:uppercase;">YouTube URL</span>
        <input id="__gitqi-video-url" type="text" placeholder="https://www.youtube.com/watch?v=…"
          style="width:100%;padding:7px 10px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:12.5px;box-sizing:border-box;font-family:${T.fontMono};background:#fff;color:${T.primary};outline:none;transition:border-color 0.15s;" />
      </label>

      <div id="__gitqi-video-error"
        style="display:none;font-size:11.5px;color:${T.danger};margin-bottom:10px;line-height:1.4;">
        Unrecognised YouTube URL. Paste a watch, youtu.be, embed, or shorts link.
      </div>

      <p style="margin:0 0 14px;font-size:11px;color:${T.textMuted};line-height:1.5;">
        Paste a YouTube link in any form — watch, youtu.be, embed, or shorts.
      </p>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="__gitqi-video-remove"
          style="padding:7px 14px;border:1.5px solid ${T.border};background:transparent;color:${T.textMuted};
                 border-radius:${T.radiusPill};cursor:pointer;font-size:12px;font-family:${T.fontBody};font-weight:500;
                 transition:background 0.15s, border-color 0.15s, color 0.15s;">
          Remove video
        </button>
        <button id="__gitqi-video-apply"
          style="padding:7px 18px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:12px;font-weight:600;font-family:${T.fontBody};
                 box-shadow:${T.shadowCta};transition:background 0.15s, transform 0.15s;">
          Apply
        </button>
      </div>
    `;

    document.body.appendChild(popover);
    activeVideoPopover = popover;

    const urlInput = popover.querySelector('#__gitqi-video-url');
    const gotoBtn  = popover.querySelector('#__gitqi-video-goto');
    const errorEl  = popover.querySelector('#__gitqi-video-error');
    const applyBtn = popover.querySelector('#__gitqi-video-apply');
    const removeBtn = popover.querySelector('#__gitqi-video-remove');

    urlInput.value = currentURL;

    function refreshGotoBtn() {
      const id = extractYouTubeId(urlInput.value);
      if (id) {
        gotoBtn.href = 'https://www.youtube.com/watch?v=' + id;
        gotoBtn.style.display = '';
      } else {
        gotoBtn.style.display = 'none';
      }
    }
    refreshGotoBtn();

    urlInput.addEventListener('input', () => {
      errorEl.style.display = 'none';
      urlInput.style.borderColor = T.secondary;
      refreshGotoBtn();
    });
    urlInput.addEventListener('focus', () => {
      urlInput.style.borderColor = T.secondary;
      urlInput.style.boxShadow = '0 0 0 3px rgba(217, 70, 239, 0.12)';
    });
    urlInput.addEventListener('blur', () => {
      urlInput.style.borderColor = T.border;
      urlInput.style.boxShadow = 'none';
    });

    function applyURL() {
      const raw = urlInput.value.trim();
      if (!raw) {
        errorEl.textContent = 'Please paste a YouTube URL.';
        errorEl.style.display = '';
        return;
      }
      const id = extractYouTubeId(raw);
      if (!id) {
        errorEl.textContent = 'Unrecognised YouTube URL. Paste a watch, youtu.be, embed, or shorts link.';
        errorEl.style.display = '';
        urlInput.style.borderColor = T.danger;
        return;
      }
      if (iframe) {
        iframe.setAttribute('src', youtubeEmbedURL(id));
        setDirty(true);
      }
      closeVideoPopover();
    }

    applyBtn.addEventListener('mouseenter', () => { applyBtn.style.background = T.accent2; applyBtn.style.transform = 'translateY(-1px)'; });
    applyBtn.addEventListener('mouseleave', () => { applyBtn.style.background = T.accent; applyBtn.style.transform = 'translateY(0)'; });
    applyBtn.addEventListener('click', applyURL);

    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyURL(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeVideoPopover(); }
    });

    removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = T.accent4; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = 'transparent'; });
    removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'transparent'; removeBtn.style.color = T.textMuted; removeBtn.style.borderColor = T.border; });
    removeBtn.addEventListener('click', () => {
      // Snapshot first — removing the wrapper is a structural change worth undoing.
      snapshotForUndo();
      wrapper.remove();
      setDirty(true);
      closeVideoPopover();
    });

    positionPopover(popover, wrapper);

    // Defer the outside-click listener to the next tick so the click that
    // opened the popover doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('mousedown', onVideoDocMouseDown, true);
    }, 0);

    urlInput.focus();
    urlInput.select();
  }

  function onVideoDocMouseDown(e) {
    if (!activeVideoPopover) return;
    if (activeVideoPopover.contains(e.target)) return;
    closeVideoPopover();
  }

  function closeVideoPopover() {
    if (activeVideoPopover) {
      activeVideoPopover.remove();
      activeVideoPopover = null;
      document.removeEventListener('mousedown', onVideoDocMouseDown, true);
    }
  }

  // ─── AI Section Generator ─────────────────────────────────────────────────

  function promptAddSection(insertAfterZone) {
    const overlay = el('div', { 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(26, 27, 58, 0.65)',
      zIndex: '1000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fontBody,
    });

    const modal = el('div');
    css(modal, {
      background: T.bg,
      borderRadius: T.radius,
      padding: '30px 32px',
      width: '500px',
      maxWidth: '92vw',
      fontFamily: T.fontBody,
      boxShadow: T.shadow,
      position: 'relative',
      overflow: 'hidden',
      borderTop: `5px solid ${T.accent2}`,
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:22px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.02em;line-height:1.15">Add <span style="color:${T.accent2};font-style:italic">New Section</span></h3>
      <p style="margin:0 0 18px;font-size:13.5px;color:${T.textMuted};line-height:1.55">
        Describe the section you want. Be specific — the more detail you give, the better the result.
      </p>
      <textarea
        id="__gitqi-ai-desc"
        placeholder="e.g. A testimonials section with 3 client quotes in cards, showing name, role, and a star rating"
        style="width:100%;height:104px;padding:12px 14px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
               font-size:13.5px;font-family:${T.fontBody};resize:vertical;box-sizing:border-box;
               line-height:1.55;outline:none;background:#fff;color:${T.primary};
               transition:border-color 0.18s ease, box-shadow 0.18s ease;"
      ></textarea>
      <div style="margin-top:10px;padding:10px 12px;background:${T.bgAlt};border-radius:${T.radiusSm};
                  font-size:11.5px;color:${T.textMuted};line-height:1.55;border-left:3px solid ${T.accent2};">
        <strong style="color:${T.primary};font-weight:600;">Tip:</strong>
        ask for <strong style="color:${T.primary};font-weight:600;">images</strong>
        (<em>"a hero photo of a sunrise"</em>) or
        <strong style="color:${T.primary};font-weight:600;">YouTube videos</strong>
        (<em>"embed a product demo video"</em>) — after it's generated you can click
        any image to upload your own or click any video to paste a YouTube URL.
      </div>
      <p id="__gitqi-ai-error" style="display:none;margin:10px 0 0;font-size:12.5px;color:${T.danger};"></p>
      <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
        <button id="__gitqi-ai-cancel"
          style="padding:9px 20px;border:1.5px solid ${T.border};background:transparent;border-radius:${T.radiusPill};
                 cursor:pointer;font-size:13px;font-family:${T.fontBody};font-weight:500;color:${T.primary};
                 transition:background 0.18s ease, border-color 0.18s ease;">
          Cancel
        </button>
        <button id="__gitqi-ai-submit"
          style="padding:9px 22px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:13px;font-weight:600;
                 font-family:${T.fontBody};letter-spacing:-0.005em;box-shadow:${T.shadowCta};
                 transition:background 0.18s ease, transform 0.18s ease;">
          Generate with AI
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const textarea = modal.querySelector('#__gitqi-ai-desc');
    const errorEl = modal.querySelector('#__gitqi-ai-error');
    const submitBtn = modal.querySelector('#__gitqi-ai-submit');
    const cancelBtn = modal.querySelector('#__gitqi-ai-cancel');

    textarea.focus();
    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = T.accent2;
      textarea.style.boxShadow = '0 0 0 3px rgba(45, 212, 191, 0.15)';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = T.border;
      textarea.style.boxShadow = 'none';
    });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.background = T.accent2; submitBtn.style.transform = 'translateY(-2px)'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.background = T.accent; submitBtn.style.transform = 'translateY(0)'; });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);

    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });

    submitBtn.addEventListener('click', async () => {
      const description = textarea.value.trim();
      if (!description) {
        textarea.style.borderColor = T.danger;
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
      const styleId = '__gitqi-section-' + slug + '-styles';
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
- For video embeds, use EXACTLY this pattern (the placeholder video is a safe, always-embeddable demo — user will swap it):
    <div data-editable-video style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:var(--radius);">
      <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="YouTube video player" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    </div>
  Never use <video> tags, other embed providers, or a different wrapper shape — the editor binds to the [data-editable-video] marker.
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
      if (next && next.classList.contains('__gitqi-add-wrap')) {
        next.after(section);
      } else {
        insertAfterZone.after(section);
      }
    } else {
      const firstZone = document.querySelector('[data-zone]');
      if (firstZone) {
        const prev = firstZone.previousElementSibling;
        if (prev && prev.classList.contains('__gitqi-add-wrap')) {
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

  // serialize({ local: false }) — for publish/export: strips secrets.js + gitqi.js so
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
    clone.querySelectorAll('img[data-gitqi-src]').forEach(img => {
      img.setAttribute('src', img.dataset.gitqiSrc);
      img.removeAttribute('data-gitqi-src');
    });

    // Remove internal binding markers
    clone.querySelectorAll('img[data-gitqi-bound]').forEach(img => {
      img.removeAttribute('data-gitqi-bound');
    });
    clone.querySelectorAll('[data-gitqi-video-bound]').forEach(v => {
      v.removeAttribute('data-gitqi-video-bound');
    });
    const navClone = clone.querySelector('nav[data-gitqi-nav-bound]');
    if (navClone) navClone.removeAttribute('data-gitqi-nav-bound');

    // Strip any inline style attribute on <html> — never meaningful output.
    // Older versions also wrote CSS vars here for live preview; cleaned up here
    // so those stale overrides don't leak into the published / saved HTML.
    clone.removeAttribute('style');

    // For publish/export only: strip secrets.js and gitqi.js so they never go live.
    // Also strips the legacy webby.js filename so a page that hasn't been
    // migrated in memory still publishes clean.
    if (!local) {
      clone.querySelectorAll('script').forEach(s => {
        const src = s.getAttribute('src') || '';
        if (src.includes('secrets.js') || src.includes('gitqi.js') || src.includes('webby.js')) s.remove();
      });
      // The data-gitqi-style marker is a runtime license to "unilaterally fix"
      // inline-styled spans during editing. Deployed HTML doesn't need it; the
      // spans stay with their inline styles intact.
      clone.querySelectorAll(`span[${GITQI_STYLE_ATTR}]`).forEach(s => {
        s.removeAttribute(GITQI_STYLE_ATTR);
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
        message: 'Update site content via GitQi',
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

    const btns = document.querySelectorAll('#__gitqi-toolbar button');
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
            migrateLegacyWebbyMarkersInDoc(doc);
            doc.querySelectorAll('script').forEach(s => {
              const src = s.getAttribute('src') || '';
              if (src.includes('secrets.js') || src.includes('gitqi.js') || src.includes('webby.js')) s.remove();
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
          const inventorySha   = await github.getFileSHA('gitqi-pages.json');
          await github.putFile('gitqi-pages.json', inventoryJson, inventorySha);
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

  // ─── Google Fonts ─────────────────────────────────────────────────────────
  //
  // Curated list of popular Google Fonts, grouped by category with sensible
  // weight sets. Selecting one in the theme editor injects the appropriate
  // <link rel="stylesheet"> (plus preconnects) into <head>; the sync then
  // propagates those links to every other page.

  // This array is the fallback catalog, used if the sibling google-fonts.json
  // manifest can't be fetched (offline, CORS hiccup, or never generated). At
  // init we try to replace its contents in place with the full manifest via
  // loadGoogleFontsManifest() — hence `let` rather than `const`. All consumers
  // (pickers, ensureGoogleFontLink, prune) read from this single reference.
  let GOOGLE_FONTS = [
    // Sans-serif
    { name: 'Inter',              cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Roboto',             cat: 'sans-serif', weights: '300;400;500;700' },
    { name: 'Open Sans',          cat: 'sans-serif', weights: '300;400;600;700' },
    { name: 'Lato',               cat: 'sans-serif', weights: '300;400;700;900' },
    { name: 'Montserrat',         cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Poppins',            cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Nunito',             cat: 'sans-serif', weights: '300;400;600;700' },
    { name: 'Raleway',            cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Work Sans',          cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Oswald',             cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Barlow',             cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'DM Sans',            cat: 'sans-serif', weights: '400;500;700' },
    { name: 'Manrope',            cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Rubik',              cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Space Grotesk',      cat: 'sans-serif', weights: '400;500;600;700' },
    { name: 'Outfit',             cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Plus Jakarta Sans',  cat: 'sans-serif', weights: '300;400;500;600;700' },
    { name: 'Figtree',            cat: 'sans-serif', weights: '400;500;600;700' },
    { name: 'Source Sans 3',      cat: 'sans-serif', weights: '300;400;600;700' },
    { name: 'Archivo',            cat: 'sans-serif', weights: '400;500;600;700' },
    { name: 'Kanit',              cat: 'sans-serif', weights: '300;400;500;600;700' },
    // Serif
    { name: 'Playfair Display',   cat: 'serif',      weights: '400;500;600;700;800' },
    { name: 'Merriweather',       cat: 'serif',      weights: '300;400;700' },
    { name: 'Lora',               cat: 'serif',      weights: '400;500;600;700' },
    { name: 'PT Serif',           cat: 'serif',      weights: '400;700' },
    { name: 'EB Garamond',        cat: 'serif',      weights: '400;500;600;700' },
    { name: 'Crimson Pro',        cat: 'serif',      weights: '300;400;500;600;700' },
    { name: 'Cormorant Garamond', cat: 'serif',      weights: '300;400;500;600;700' },
    { name: 'DM Serif Display',   cat: 'serif',      weights: '400' },
    { name: 'Libre Baskerville',  cat: 'serif',      weights: '400;700' },
    { name: 'Fraunces',           cat: 'serif',      weights: '300;400;500;600;700' },
    { name: 'Spectral',           cat: 'serif',      weights: '300;400;500;600;700' },
    { name: 'Source Serif 4',     cat: 'serif',      weights: '300;400;600;700' },
    // Display
    { name: 'Abril Fatface',      cat: 'display',    weights: '400' },
    { name: 'Bebas Neue',         cat: 'display',    weights: '400' },
    { name: 'Archivo Black',      cat: 'display',    weights: '400' },
    { name: 'Anton',              cat: 'display',    weights: '400' },
    { name: 'Righteous',          cat: 'display',    weights: '400' },
    { name: 'Lobster',            cat: 'display',    weights: '400' },
    { name: 'Pacifico',           cat: 'display',    weights: '400' },
    // Handwriting
    { name: 'Caveat',             cat: 'handwriting', weights: '400;500;600;700' },
    { name: 'Dancing Script',     cat: 'handwriting', weights: '400;500;600;700' },
    { name: 'Kalam',              cat: 'handwriting', weights: '300;400;700' },
    // Monospace
    { name: 'JetBrains Mono',     cat: 'monospace',  weights: '300;400;500;600;700' },
    { name: 'Fira Code',          cat: 'monospace',  weights: '300;400;500;600;700' },
    { name: 'Source Code Pro',    cat: 'monospace',  weights: '300;400;500;600;700' },
    { name: 'Roboto Mono',        cat: 'monospace',  weights: '300;400;500;600;700' },
    { name: 'IBM Plex Mono',      cat: 'monospace',  weights: '300;400;500;600;700' },
    { name: 'Space Mono',         cat: 'monospace',  weights: '400;700' },
    { name: 'DM Mono',            cat: 'monospace',  weights: '400;500' },
  ];

  // Full-catalog manifest loader. Fetches google-fonts.json from the same
  // directory as gitqi.js, validates it, and replaces the curated fallback
  // above. A localStorage copy is installed synchronously on the next load so
  // the picker shows the full catalog immediately instead of waiting for the
  // network. On any failure, the curated fallback remains active.
  const FONTS_MANIFEST_URL = SCRIPT_BASE_URL ? SCRIPT_BASE_URL + 'google-fonts.json' : '';
  const FONTS_CACHE_KEY = 'gitqi:fonts-manifest:v1';

  function installFontsManifest(data) {
    if (!Array.isArray(data) || data.length === 0) return false;
    const sample = data[0];
    if (!sample || typeof sample.name !== 'string' || typeof sample.weights !== 'string') return false;
    GOOGLE_FONTS = data;
    return true;
  }

  function loadGoogleFontsManifest() {
    try {
      const cached = localStorage.getItem(FONTS_CACHE_KEY);
      if (cached) installFontsManifest(JSON.parse(cached));
    } catch (_) { /* ignore cache read errors */ }

    if (!FONTS_MANIFEST_URL) return;
    fetch(FONTS_MANIFEST_URL, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && installFontsManifest(data)) {
          try { localStorage.setItem(FONTS_CACHE_KEY, JSON.stringify(data)); }
          catch (_) { /* quota exceeded — fine, fetch will refresh next time */ }
        }
      })
      .catch(() => { /* offline or CORS — curated fallback stays active */ });
  }

  const GENERIC_FALLBACK = {
    'sans-serif':  'system-ui, sans-serif',
    'serif':       'Georgia, serif',
    'display':     'system-ui, sans-serif',
    'handwriting': 'cursive',
    'monospace':   'ui-monospace, SFMono-Regular, Menlo, monospace',
  };

  // Build the CSS font-family stack for a Google Font entry.
  function fontFamilyStack(font) {
    return `'${font.name}', ${GENERIC_FALLBACK[font.cat] || 'sans-serif'}`;
  }

  // Insert <link> tags needed to load `font` if not already present.
  // Also ensures the preconnects to fonts.googleapis.com and fonts.gstatic.com
  // exist (both are recommended by Google for faster font loading).
  function ensureGoogleFontLink(font) {
    const head = document.head;
    const encoded = font.name.replace(/ /g, '+');

    // Preconnects
    if (!head.querySelector('link[rel="preconnect"][href="https://fonts.googleapis.com"]')) {
      const pc = document.createElement('link');
      pc.rel = 'preconnect';
      pc.href = 'https://fonts.googleapis.com';
      head.appendChild(pc);
    }
    if (!head.querySelector('link[rel="preconnect"][href="https://fonts.gstatic.com"]')) {
      const pc = document.createElement('link');
      pc.rel = 'preconnect';
      pc.href = 'https://fonts.gstatic.com';
      pc.setAttribute('crossorigin', '');
      head.appendChild(pc);
    }

    // Stylesheet for this family (skip if already present)
    const existing = Array.from(head.querySelectorAll('link[href*="fonts.googleapis.com/css"]'))
      .find(l => (l.getAttribute('href') || '').includes('family=' + encoded + ':') ||
                 (l.getAttribute('href') || '').includes('family=' + encoded + '&') ||
                 (l.getAttribute('href') || '').endsWith('family=' + encoded));
    if (!existing) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${font.weights}&display=swap`;
      head.appendChild(link);
    }
  }

  // Extract the family name from a Google Fonts stylesheet href.
  // e.g. ".../css2?family=Open+Sans:wght@400" → "Open Sans"
  function fontFamilyFromLinkHref(href) {
    const m = (href || '').match(/[?&]family=([^&:]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]).replace(/\+/g, ' '); }
    catch (_) { return m[1].replace(/\+/g, ' '); }
  }

  // Concatenate every CSS block GitQi manages (main <style>, nav style, per-section styles).
  // Used to detect whether a given font family is still referenced anywhere.
  function getAllManagedCSS() {
    const parts = [];
    const mainStyle = getMainStyleElement(document);
    if (mainStyle) parts.push(mainStyle.textContent);
    document.querySelectorAll('style#__gitqi-nav-styles, style[id^="__gitqi-section-"]')
      .forEach(s => parts.push(s.textContent));
    return parts.join('\n');
  }

  // Parse font-family and --font-* declarations out of a CSS string and return
  // the set of named families (unquoted, no generic fallbacks filtered out — we
  // only compare against known Google Font names, so extras are harmless).
  function extractReferencedFontNames(css) {
    const names = new Set();
    const declRe = /(?:font-family\s*:|--font[\w-]*\s*:)\s*([^;}]+)/gi;
    let m;
    while ((m = declRe.exec(css))) {
      m[1].split(',').forEach(part => {
        const name = part.trim().replace(/^['"]|['"]$/g, '').trim();
        if (name && !name.startsWith('var(')) names.add(name);
      });
    }
    return names;
  }

  // Remove Google Fonts stylesheet <link>s whose family no longer appears in any
  // managed CSS. When the last stylesheet is removed, the preconnects are cleared
  // too so abandoned fonts don't linger and slow down page load.
  function pruneUnusedGoogleFontLinks() {
    const head = document.head;
    const referenced = extractReferencedFontNames(getAllManagedCSS());
    head.querySelectorAll('link[href*="fonts.googleapis.com/css"]').forEach(link => {
      const family = fontFamilyFromLinkHref(link.getAttribute('href'));
      if (family && !referenced.has(family)) link.remove();
    });
    if (!head.querySelector('link[href*="fonts.googleapis.com/css"]')) {
      head.querySelectorAll(
        'link[rel="preconnect"][href="https://fonts.googleapis.com"],' +
        'link[rel="preconnect"][href="https://fonts.gstatic.com"]'
      ).forEach(l => l.remove());
    }
  }

  // ─── Font Previewer ───────────────────────────────────────────────────────
  //
  // Modal with live rendered previews of the full Google Fonts catalog. Fonts
  // load via a rate-limited queue using the FontFace API — registrations live
  // only in document.fonts, so nothing reaches disk, the serializer, the
  // shared-head sync, or the published site.
  //
  // The picker itself is "dumb" — it reports the selection via `onPick` but
  // does NOT commit <link> tags. Callers decide when to call
  // ensureGoogleFontLink() so that cancelled / aborted picks don't leak font
  // links into <head> (which shared-head sync would push to every page).

  const FONT_PREVIEW_SAMPLE_KEY = 'gitqi:font-preview-sample';
  const DEFAULT_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog';
  const FONT_CATEGORIES = [
    { key: 'all',         label: 'All' },
    { key: 'sans-serif',  label: 'Sans Serif' },
    { key: 'serif',       label: 'Serif' },
    { key: 'display',     label: 'Display' },
    { key: 'handwriting', label: 'Handwriting' },
    { key: 'monospace',   label: 'Monospace' },
  ];

  // Rate-limited font preview loader.
  //
  // Previously used @import into a growing <style> element, which forced the
  // browser to re-parse the whole preview stylesheet on every append and
  // re-cascade every font-related element on the page — that's what caused
  // the toolbar/title throb and the scroll stalls. The FontFace API registers
  // fonts directly into document.fonts without any DOM mutation, so only
  // elements that actually use the new family are affected.
  //
  // Flow per font: fetch Google's CSS2 response → parse out the @font-face
  // src URLs → new FontFace(...) for each weight variant → face.load() →
  // document.fonts.add(). Load completes with a real Promise, so preview rows
  // can flip from placeholder to sample text only when their font is truly
  // rendered.

  const previewLoadedFonts  = new Set();  // names whose FontFaces are registered + rendered
  const previewLoadingFonts = new Set();  // names currently fetching / loading
  const previewFailedFonts  = new Set();  // names that failed (won't retry)
  const previewQueuedFonts  = new Set();  // names currently in the queue
  const previewLoadQueue    = [];         // pending font objects, FIFO
  const previewLoadCallbacks = new Map(); // name → [fn, fn, ...] (fired when ready)

  const PREVIEW_LOAD_BATCH = 4;           // concurrent loads per tick
  const PREVIEW_LOAD_INTERVAL_MS = 250;   // ≈ 16 fonts/sec — gentle on Google + browser
  let previewLoadTimer = null;

  function onPreviewFontReady(name, callback) {
    if (previewLoadedFonts.has(name)) { callback(); return; }
    const list = previewLoadCallbacks.get(name) || [];
    list.push(callback);
    previewLoadCallbacks.set(name, list);
  }

  function firePreviewReady(name) {
    const cbs = previewLoadCallbacks.get(name);
    if (!cbs) return;
    previewLoadCallbacks.delete(name);
    cbs.forEach(cb => { try { cb(); } catch (_) { /* keep draining on single failure */ } });
  }

  async function loadPreviewFont(font) {
    if (previewLoadedFonts.has(font.name) || previewLoadingFonts.has(font.name)) return;
    previewLoadingFonts.add(font.name);
    try {
      const encoded = font.name.replace(/ /g, '+');
      const url = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${font.weights}&display=swap`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('css fetch failed: ' + res.status);
      const css = await res.text();
      // Parse every @font-face block in the response — one per weight variant.
      const faces = [];
      const faceRe = /@font-face\s*\{([^}]+)\}/g;
      let m;
      while ((m = faceRe.exec(css)) !== null) {
        const block = m[1];
        const srcM    = block.match(/src\s*:\s*([^;}]+)/i);
        const weightM = block.match(/font-weight\s*:\s*([^;]+)/i);
        const styleM  = block.match(/font-style\s*:\s*([^;]+)/i);
        if (!srcM) continue;
        faces.push(new FontFace(font.name, srcM[1].trim(), {
          weight:  weightM ? weightM[1].trim() : '400',
          style:   styleM  ? styleM[1].trim()  : 'normal',
          display: 'swap',
        }));
      }
      if (!faces.length) throw new Error('no @font-face in response');
      // Load all variants in parallel; register each one as it arrives.
      await Promise.all(faces.map(f => f.load().then(loaded => document.fonts.add(loaded))));
      previewLoadedFonts.add(font.name);
      firePreviewReady(font.name);
    } catch (_) {
      previewFailedFonts.add(font.name);
    } finally {
      previewLoadingFonts.delete(font.name);
    }
  }

  function drainPreviewLoadQueue() {
    if (!previewLoadQueue.length) { previewLoadTimer = null; return; }
    for (let i = 0; i < PREVIEW_LOAD_BATCH && previewLoadQueue.length; i++) {
      const font = previewLoadQueue.shift();
      previewQueuedFonts.delete(font.name);
      loadPreviewFont(font); // fire-and-forget; tracks its own state
    }
    previewLoadTimer = setTimeout(drainPreviewLoadQueue, PREVIEW_LOAD_INTERVAL_MS);
  }

  function queuePreviewFontLoad(font, priority) {
    if (previewLoadedFonts.has(font.name)) return;
    if (previewLoadingFonts.has(font.name)) return;
    if (previewFailedFonts.has(font.name))  return;
    if (previewQueuedFonts.has(font.name)) {
      if (!priority) return;
      // Already queued — bump to the head if we're prioritizing it.
      const idx = previewLoadQueue.findIndex(f => f.name === font.name);
      if (idx > 0) {
        previewLoadQueue.splice(idx, 1);
        previewLoadQueue.unshift(font);
      }
      return;
    }
    previewQueuedFonts.add(font.name);
    if (priority) previewLoadQueue.unshift(font);
    else          previewLoadQueue.push(font);
    if (!previewLoadTimer) previewLoadTimer = setTimeout(drainPreviewLoadQueue, 0);
  }

  // Enqueue the full catalog in popularity order so by the time the user
  // opens the previewer most popular fonts are already rendered. Safe to
  // call repeatedly — dedup sets make re-calls a no-op.
  function prewarmFontPreview() {
    for (const font of GOOGLE_FONTS) queuePreviewFontLoad(font, false);
  }

  function openFontPreviewer(onPick) {
    const overlay = el('div', { 'data-editor-ui': '' });
    css(overlay, {
      position: 'fixed', inset: '0', zIndex: '999998',
      background: 'rgba(26, 27, 58, 0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.fontBody,
    });

    const modal = el('div');
    css(modal, {
      width: '640px', maxWidth: '92vw', height: '80vh', maxHeight: '760px',
      background: T.bg, borderRadius: T.radius, boxShadow: T.shadow,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    });

    // Header
    const header = el('div');
    css(header, {
      padding: '14px 18px', borderBottom: `1px solid ${T.borderSoft}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: '0',
    });
    const title = el('h2');
    title.textContent = 'Font Previewer';
    css(title, { margin: '0', fontFamily: T.fontHead, fontSize: '18px', fontWeight: '600', color: T.primary });
    const closeBtn = el('button');
    closeBtn.textContent = '✕';
    css(closeBtn, { background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: T.textMuted, padding: '4px 10px', lineHeight: '1' });
    header.append(title, closeBtn);

    // Controls: sample text + category pills + search/sort row
    const controls = el('div');
    css(controls, {
      padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}`,
      display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: '0',
    });

    const sampleInput = el('input');
    sampleInput.type = 'text';
    sampleInput.placeholder = 'Sample text';
    try { sampleInput.value = localStorage.getItem(FONT_PREVIEW_SAMPLE_KEY) || DEFAULT_SAMPLE_TEXT; }
    catch (_) { sampleInput.value = DEFAULT_SAMPLE_TEXT; }
    css(sampleInput, {
      width: '100%', boxSizing: 'border-box', padding: '8px 12px',
      border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm,
      fontSize: '14px', fontFamily: T.fontBody, color: T.primary,
      background: '#fff', outline: 'none',
    });

    // Category pills
    const pillRow = el('div');
    css(pillRow, { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });
    let activeCategory = 'all';
    const pillEls = {};
    const stylePill = (btn, active) => {
      btn.style.background = active ? T.primary : 'transparent';
      btn.style.color = active ? T.bg : T.primary;
      btn.style.borderColor = active ? T.primary : T.border;
    };
    FONT_CATEGORIES.forEach(({ key, label }) => {
      const pill = el('button');
      pill.textContent = label;
      css(pill, {
        padding: '5px 11px', borderRadius: T.radiusPill,
        fontSize: '11.5px', fontFamily: T.fontBody, fontWeight: '500',
        cursor: 'pointer', border: `1.5px solid ${T.border}`,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      });
      stylePill(pill, key === activeCategory);
      pill.addEventListener('click', () => {
        activeCategory = key;
        Object.entries(pillEls).forEach(([k, b]) => stylePill(b, k === activeCategory));
        render();
      });
      pillEls[key] = pill;
      pillRow.appendChild(pill);
    });

    // Search + sort
    const searchRow = el('div');
    css(searchRow, { display: 'flex', gap: '8px', alignItems: 'center' });
    const searchInput = el('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search by name…';
    css(searchInput, {
      flex: '1', padding: '6px 10px',
      border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm,
      fontSize: '11.5px', fontFamily: T.fontBody, color: T.primary,
      background: '#fff', outline: 'none',
    });

    let sortMode = 'popularity';
    const sortBtn = el('button');
    sortBtn.textContent = 'Popularity';
    css(sortBtn, {
      padding: '6px 12px', background: 'transparent',
      border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm,
      fontSize: '11.5px', fontFamily: T.fontBody, fontWeight: '500',
      cursor: 'pointer', color: T.primary, whiteSpace: 'nowrap',
      transition: 'background 0.15s',
    });
    sortBtn.addEventListener('mouseenter', () => { sortBtn.style.background = T.bgAlt; });
    sortBtn.addEventListener('mouseleave', () => { sortBtn.style.background = 'transparent'; });
    sortBtn.addEventListener('click', () => {
      sortMode = sortMode === 'popularity' ? 'alpha' : 'popularity';
      sortBtn.textContent = sortMode === 'popularity' ? 'Popularity' : 'A–Z';
      render();
    });

    searchRow.append(searchInput, sortBtn);
    controls.append(sampleInput, pillRow, searchRow);

    // List
    const list = el('div');
    css(list, { flex: '1', overflowY: 'auto', padding: '4px 0' });

    let currentRows = [];
    // Pending priority-jump queue: items the user has scrolled to, waiting out a
    // short debounce so fast scrolls don't blast the rate-limiter with requests
    // for rows the user just passed by.
    const pendingPriority = new Set();
    let priorityTimer = null;
    function flushPriorityQueue() {
      priorityTimer = null;
      pendingPriority.forEach(font => queuePreviewFontLoad(font, true));
      pendingPriority.clear();
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.__gitqiFont) {
          pendingPriority.add(entry.target.__gitqiFont);
          observer.unobserve(entry.target);
        }
      });
      if (pendingPriority.size) {
        if (priorityTimer) clearTimeout(priorityTimer);
        priorityTimer = setTimeout(flushPriorityQueue, 500);
      }
    }, { root: list, rootMargin: '240px' });

    function render() {
      list.innerHTML = '';
      currentRows = [];
      const q = searchInput.value.toLowerCase().trim();
      let fonts = GOOGLE_FONTS;
      if (activeCategory !== 'all') fonts = fonts.filter(f => f.cat === activeCategory);
      if (q) fonts = fonts.filter(f => f.name.toLowerCase().includes(q));
      if (sortMode === 'alpha') fonts = fonts.slice().sort((a, b) => a.name.localeCompare(b.name));

      if (!fonts.length) {
        const empty = el('div');
        empty.textContent = 'No matches';
        css(empty, { padding: '24px', fontSize: '13px', color: T.textMuted, textAlign: 'center', fontStyle: 'italic' });
        list.appendChild(empty);
        return;
      }

      const sample = sampleInput.value || DEFAULT_SAMPLE_TEXT;
      fonts.forEach(font => {
        const row = el('div');
        row.__gitqiFont = font;
        css(row, {
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '10px 18px', cursor: 'pointer',
          borderBottom: `1px solid ${T.borderSoft}`,
          transition: 'background 0.12s',
        });

        const nameEl = el('div');
        nameEl.textContent = font.name;
        css(nameEl, {
          width: '140px', flexShrink: '0',
          fontSize: '11.5px', fontFamily: T.fontBody, fontWeight: '500',
          color: T.textMuted,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        });

        // Rows for not-yet-loaded fonts render in the default body font with a
        // "…" placeholder — this lets the entire list paint immediately so
        // scrolling stays smooth. Once the FontFace is registered, we flip the
        // row to the real font and replace "…" with the current sample text.
        const loaded = previewLoadedFonts.has(font.name);
        const sampleEl = el('div');
        sampleEl.textContent = loaded ? sample : '…';
        css(sampleEl, {
          flex: '1', minWidth: '0',
          fontSize: '20px', lineHeight: '1.3', color: loaded ? T.primary : T.textMuted,
          fontFamily: loaded ? fontFamilyStack(font) : T.fontBody,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        });
        if (!loaded) {
          onPreviewFontReady(font.name, () => {
            sampleEl.textContent = sampleInput.value || DEFAULT_SAMPLE_TEXT;
            sampleEl.style.fontFamily = fontFamilyStack(font);
            sampleEl.style.color = T.primary;
          });
        }

        row.append(nameEl, sampleEl);
        row.addEventListener('mouseenter', () => { row.style.background = T.bgAlt; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', () => {
          if (onPick) onPick(font, fontFamilyStack(font));
          close();
        });

        list.appendChild(row);
        currentRows.push(row);
        observer.observe(row);
      });
    }

    sampleInput.addEventListener('input', () => {
      const v = sampleInput.value || DEFAULT_SAMPLE_TEXT;
      try { localStorage.setItem(FONT_PREVIEW_SAMPLE_KEY, sampleInput.value); } catch (_) {}
      // Only update rows whose font has already loaded — unloaded rows keep
      // their "…" placeholder until the font arrives, then pick up the latest
      // sample via the onPreviewFontReady callback.
      currentRows.forEach(r => {
        if (r.children[1] && previewLoadedFonts.has(r.__gitqiFont.name)) {
          r.children[1].textContent = v;
        }
      });
    });
    searchInput.addEventListener('input', render);

    modal.append(header, controls, list);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
      observer.disconnect();
      if (priorityTimer) { clearTimeout(priorityTimer); priorityTimer = null; }
      pendingPriority.clear();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    render();
    setTimeout(() => sampleInput.focus(), 0);
  }

  // ─── Theme Editor ─────────────────────────────────────────────────────────

  function openThemeEditor() {
    if (document.getElementById('__gitqi-theme-panel')) {
      document.getElementById('__gitqi-theme-panel').remove();
      return;
    }
    // Close pages panel if open (they occupy the same side-panel slot)
    const pagesPanel = document.getElementById('__gitqi-pages-panel');
    if (pagesPanel) pagesPanel.remove();

    // Start prewarming the font preview cache. By the time the user opens the
    // font picker, most popular fonts are already rendered; scroll-into-view
    // still jumps the queue for anything not yet loaded.
    prewarmFontPreview();

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

    const panel = el('div', { id: '__gitqi-theme-panel', 'data-editor-ui': '' });
    css(panel, {
      position: 'fixed',
      top: '44px',
      right: '0',
      bottom: '0',
      width: '290px',
      background: T.bg,
      borderLeft: `1px solid ${T.border}`,
      zIndex: '999998',
      overflowY: 'auto',
      fontFamily: T.fontBody,
      fontSize: '13px',
      boxShadow: '-8px 0 28px -8px rgba(26, 27, 58, 0.18)',
      color: T.primary,
    });

    // Header
    const header = el('div');
    css(header, {
      padding: '16px 18px 14px',
      borderBottom: `1px solid ${T.borderSoft}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: '0',
      background: T.bg,
      zIndex: '1',
    });
    header.innerHTML = `<strong style="font-size:17px;color:${T.primary};font-family:${T.fontHead};font-weight:600;letter-spacing:-0.015em">Theme</strong>
      <button style="background:none;border:none;cursor:pointer;font-size:20px;color:${T.textMuted};line-height:1;padding:0 4px;transition:color 0.15s;">&times;</button>`;
    const themeClose = header.querySelector('button');
    themeClose.addEventListener('mouseenter', () => { themeClose.style.color = T.primary; });
    themeClose.addEventListener('mouseleave', () => { themeClose.style.color = T.textMuted; });
    themeClose.addEventListener('click', () => panel.remove());

    // Content
    const content = el('div');
    css(content, { padding: '16px 18px 28px' });

    // ── Favicon section ──────────────────────────────────────────────────────
    const faviconSection = el('div');
    css(faviconSection, { marginBottom: '22px', paddingBottom: '22px', borderBottom: `1px solid ${T.borderSoft}` });

    const faviconTitle = el('div');
    faviconTitle.textContent = 'Site Identity';
    css(faviconTitle, {
      fontWeight: '700',
      textTransform: 'uppercase',
      fontSize: '10px',
      color: T.textMuted,
      letterSpacing: '0.1em',
      marginBottom: '12px',
    });

    const faviconRow = el('div');
    css(faviconRow, { display: 'flex', alignItems: 'center', gap: '12px' });

    // Preview box
    const faviconPreview = el('div');
    css(faviconPreview, {
      width: '52px',
      height: '52px',
      border: `1px solid ${T.border}`,
      borderRadius: T.radiusSm,
      background: '#fff',
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
      faviconPreview.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${T.textMuted}" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
    }

    // Hover overlay
    const faviconHint = el('div');
    faviconHint.textContent = 'Click to set';
    css(faviconHint, {
      position: 'absolute',
      inset: '0',
      background: 'rgba(26, 27, 58, 0.75)',
      color: T.bg,
      fontSize: '9.5px',
      fontWeight: '600',
      letterSpacing: '0.03em',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      opacity: '0',
      transition: 'opacity 0.15s',
      borderRadius: T.radiusSm,
    });
    faviconPreview.appendChild(faviconHint);
    faviconPreview.addEventListener('mouseenter', () => { faviconHint.style.opacity = '1'; });
    faviconPreview.addEventListener('mouseleave', () => { faviconHint.style.opacity = '0'; });

    const faviconMeta = el('div');
    css(faviconMeta, { flex: '1', minWidth: '0' });
    const faviconLabel = el('div');
    faviconLabel.textContent = 'Favicon';
    css(faviconLabel, { fontWeight: '600', fontSize: '13px', color: T.primary, marginBottom: '3px' });
    const faviconSub = el('div');
    faviconSub.textContent = existingIcon ? 'favicon.png' : 'None set';
    css(faviconSub, { fontSize: '10.5px', color: T.textMuted, fontFamily: T.fontMono });
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
    css(titleRow, { marginTop: '14px' });

    const titleLabel = el('label');
    titleLabel.textContent = 'Page title';
    css(titleLabel, { display: 'block', fontSize: '11px', color: T.primary, fontWeight: '600', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' });

    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.value = document.title || '';
    titleInput.placeholder = 'My Site';
    css(titleInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '7px 10px',
      border: `1.5px solid ${T.border}`,
      borderRadius: T.radiusSm,
      fontSize: '12.5px',
      fontFamily: T.fontBody,
      background: '#fff',
      color: T.primary,
      outline: 'none',
      transition: 'border-color 0.15s',
    });
    titleInput.addEventListener('focus', () => { titleInput.style.borderColor = T.accent2; });
    titleInput.addEventListener('blur',  () => { titleInput.style.borderColor = T.border; });
    titleInput.addEventListener('input', () => {
      document.title = titleInput.value;
      const titleEl = document.querySelector('title');
      if (titleEl) titleEl.textContent = titleInput.value;
      // Also update the toolbar site name if present
      const toolbarTitle = document.getElementById('__gitqi-title');
      if (toolbarTitle) toolbarTitle.textContent = titleInput.value || 'Site Editor';
      setDirty(true);
    });

    titleRow.append(titleLabel, titleInput);

    // Description row
    const descRow = el('div');
    css(descRow, { marginTop: '14px' });

    const descLabel = el('label');
    descLabel.textContent = 'Meta description';
    css(descLabel, { display: 'block', fontSize: '11px', color: T.primary, fontWeight: '600', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' });

    const existingDesc = document.querySelector('meta[name="description"]');
    const descInput = el('textarea');
    descInput.value = existingDesc ? (existingDesc.getAttribute('content') || '') : '';
    descInput.placeholder = 'A short description of the site for search engines (150–160 characters)';
    css(descInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '7px 10px',
      border: `1.5px solid ${T.border}`,
      borderRadius: T.radiusSm,
      fontSize: '12.5px',
      fontFamily: T.fontBody,
      background: '#fff',
      color: T.primary,
      resize: 'vertical',
      height: '66px',
      outline: 'none',
      transition: 'border-color 0.15s',
    });
    descInput.addEventListener('focus', () => { descInput.style.borderColor = T.accent2; });
    descInput.addEventListener('blur',  () => { descInput.style.borderColor = T.border; });
    descInput.addEventListener('input', () => {
      upsertMetaTag('description', descInput.value);
      setDirty(true);
    });

    descRow.append(descLabel, descInput);

    // Keywords row
    const kwRow = el('div');
    css(kwRow, { marginTop: '14px' });

    const kwLabel = el('label');
    kwLabel.textContent = 'Keywords';
    css(kwLabel, { display: 'block', fontSize: '11px', color: T.primary, fontWeight: '600', marginBottom: '4px', letterSpacing: '0.04em', textTransform: 'uppercase' });

    const kwHint = el('div');
    kwHint.textContent = 'Comma-separated';
    css(kwHint, { fontSize: '10.5px', color: T.textMuted, marginBottom: '5px', fontStyle: 'italic' });

    const existingKw = document.querySelector('meta[name="keywords"]');
    const kwInput = el('input');
    kwInput.type = 'text';
    kwInput.value = existingKw ? (existingKw.getAttribute('content') || '') : '';
    kwInput.placeholder = 'osteopath, sports therapy, London';
    css(kwInput, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '7px 10px',
      border: `1.5px solid ${T.border}`,
      borderRadius: T.radiusSm,
      fontSize: '12.5px',
      fontFamily: T.fontBody,
      background: '#fff',
      color: T.primary,
      outline: 'none',
      transition: 'border-color 0.15s',
    });
    kwInput.addEventListener('focus', () => { kwInput.style.borderColor = T.accent2; });
    kwInput.addEventListener('blur',  () => { kwInput.style.borderColor = T.border; });
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
        color: T.textMuted,
        letterSpacing: '0.1em',
        marginBottom: '12px',
      });
      section.appendChild(groupTitle);

      for (const [varName, varValue] of Object.entries(groupVars)) {
        section.appendChild(makeVarRow(varName, varValue, styleEl));
      }

      // "Add color variable" button — only on the Colors group.
      // New --color-* vars are auto-picked up by the selection toolbar's text
      // color flyout (getThemeVars('--color')) and distributed to every page
      // by the shared-head sync (main <style> is synced site-wide).
      if (groupName === 'Colors') {
        const addColorBtn = el('button');
        addColorBtn.textContent = '＋ Add color variable';
        css(addColorBtn, {
          marginTop: '8px',
          padding: '7px 12px',
          background: 'transparent',
          border: `1.5px dashed ${T.border}`,
          borderRadius: T.radiusSm,
          fontSize: '11.5px',
          color: T.textMuted,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          fontFamily: T.fontBody,
          fontWeight: '500',
          transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        });
        addColorBtn.addEventListener('mouseenter', () => { addColorBtn.style.background = T.bgAlt; addColorBtn.style.borderColor = T.accent2; addColorBtn.style.color = T.primary; });
        addColorBtn.addEventListener('mouseleave', () => { addColorBtn.style.background = 'transparent'; addColorBtn.style.borderColor = T.border; addColorBtn.style.color = T.textMuted; });

        addColorBtn.addEventListener('click', () => {
          addColorBtn.style.display = 'none';

          const form = el('div');
          css(form, { marginTop: '6px' });

          // Row 1: prefix label + name input
          const nameRow = el('div');
          css(nameRow, { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' });

          const prefix = el('span');
          prefix.textContent = '--color-';
          css(prefix, { fontSize: '11px', fontFamily: T.fontMono, color: T.textMuted, flexShrink: '0' });

          const nameInput = el('input');
          nameInput.type = 'text';
          nameInput.placeholder = 'brand';
          css(nameInput, { flex: '1', minWidth: '0', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, background: '#fff', color: T.primary, outline: 'none' });

          nameRow.append(prefix, nameInput);

          // Row 2: native picker + hex input, kept in sync
          const valueRow = el('div');
          css(valueRow, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' });

          const colorPicker = el('input');
          colorPicker.type = 'color';
          colorPicker.value = '#6366f1';
          css(colorPicker, { width: '30px', height: '28px', padding: '1px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, cursor: 'pointer', flexShrink: '0', background: '#fff' });

          const hexInput = el('input');
          hexInput.type = 'text';
          hexInput.value = colorPicker.value;
          hexInput.spellcheck = false;
          css(hexInput, { flex: '1', minWidth: '0', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, background: '#fff', color: T.primary, outline: 'none' });

          colorPicker.addEventListener('input', () => { hexInput.value = colorPicker.value; });
          hexInput.addEventListener('input', () => {
            const v = hexInput.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(v)) colorPicker.value = v;
          });

          valueRow.append(colorPicker, hexInput);

          // Row 3: action buttons
          const btnRow = el('div');
          css(btnRow, { display: 'flex', gap: '6px' });

          const confirmBtn = el('button');
          confirmBtn.textContent = 'Add';
          css(confirmBtn, { padding: '5px 14px', background: T.accent, color: T.primary, border: '2px solid transparent', borderRadius: T.radiusPill, fontSize: '11.5px', fontWeight: '600', cursor: 'pointer', fontFamily: T.fontBody, boxShadow: T.shadowCta, transition: 'background 0.15s, transform 0.15s' });
          confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = T.accent2; confirmBtn.style.transform = 'translateY(-1px)'; });
          confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = T.accent; confirmBtn.style.transform = 'translateY(0)'; });

          const cancelBtn = el('button');
          cancelBtn.textContent = 'Cancel';
          css(cancelBtn, { padding: '5px 14px', background: 'transparent', border: `1.5px solid ${T.border}`, borderRadius: T.radiusPill, fontSize: '11.5px', cursor: 'pointer', fontFamily: T.fontBody, fontWeight: '500', color: T.primary, transition: 'background 0.15s' });
          cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
          cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

          btnRow.append(confirmBtn, cancelBtn);
          form.append(nameRow, valueRow, btnRow);
          section.appendChild(form);
          nameInput.focus();

          cancelBtn.addEventListener('click', () => {
            form.remove();
            addColorBtn.style.display = '';
          });

          const doAdd = () => {
            const nameSuffix = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const value = hexInput.value.trim();
            if (!nameSuffix || !/^#[0-9a-f]{6}$/i.test(value)) {
              (nameSuffix ? hexInput : nameInput).focus();
              return;
            }

            const varName = '--color-' + nameSuffix;
            if (styleEl.textContent.includes(varName + ':')) {
              nameInput.style.borderColor = T.danger;
              nameInput.title = 'Variable already exists';
              return;
            }

            addStyleVar(styleEl, varName, value);
            setDirty(true);

            form.remove();
            addColorBtn.style.display = '';
            section.insertBefore(makeVarRow(varName, value, styleEl), addColorBtn);
          };

          confirmBtn.addEventListener('click', doAdd);
          nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') hexInput.focus(); });
          hexInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
        });

        section.appendChild(addColorBtn);
      }

      // "Add font variable" button — only on the Typography group
      if (groupName === 'Typography') {
        const addFontBtn = el('button');
        addFontBtn.textContent = '＋ Add font variable';
        css(addFontBtn, {
          marginTop: '8px',
          padding: '7px 12px',
          background: 'transparent',
          border: `1.5px dashed ${T.border}`,
          borderRadius: T.radiusSm,
          fontSize: '11.5px',
          color: T.textMuted,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          fontFamily: T.fontBody,
          fontWeight: '500',
          transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        });
        addFontBtn.addEventListener('mouseenter', () => { addFontBtn.style.background = T.bgAlt; addFontBtn.style.borderColor = T.accent2; addFontBtn.style.color = T.primary; });
        addFontBtn.addEventListener('mouseleave', () => { addFontBtn.style.background = 'transparent'; addFontBtn.style.borderColor = T.border; addFontBtn.style.color = T.textMuted; });

        addFontBtn.addEventListener('click', () => {
          addFontBtn.style.display = 'none';

          const form = el('div');
          css(form, { marginTop: '6px' });

          // Row 1: prefix label + name input
          const nameRow = el('div');
          css(nameRow, { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' });

          const prefix = el('span');
          prefix.textContent = '--font-';
          css(prefix, { fontSize: '11px', fontFamily: T.fontMono, color: T.textMuted, flexShrink: '0' });

          const nameInput = el('input');
          nameInput.type = 'text';
          nameInput.placeholder = 'display';
          css(nameInput, { flex: '1', minWidth: '0', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, background: '#fff', color: T.primary, outline: 'none' });

          nameRow.append(prefix, nameInput);

          // Row 2: value input
          const valueInput = el('input');
          valueInput.type = 'text';
          valueInput.placeholder = "'Playfair Display', serif";
          css(valueInput, { width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, marginBottom: '6px', background: '#fff', color: T.primary, outline: 'none' });

          // Row 3: "Browse fonts" button — opens the font previewer modal.
          // Selection fills in the value only; the variable name is left for
          // the user to choose (names should describe the role, e.g. "display"
          // or "accent", not the current font — fonts change, names shouldn't).
          // The <link> is injected on commit (doAdd), not on preview click.
          let pickedFont = null;
          const browseBtn = el('button');
          browseBtn.textContent = 'Browse Google Fonts…';
          css(browseBtn, {
            width: '100%', boxSizing: 'border-box',
            padding: '7px 10px', marginBottom: '6px',
            background: 'transparent', border: `1.5px solid ${T.border}`,
            borderRadius: T.radiusSm,
            fontSize: '11.5px', fontFamily: T.fontBody, fontWeight: '500',
            color: T.primary, cursor: 'pointer', textAlign: 'center',
            transition: 'background 0.15s, border-color 0.15s',
          });
          browseBtn.addEventListener('mouseenter', () => { browseBtn.style.background = T.bgAlt; browseBtn.style.borderColor = T.accent2; });
          browseBtn.addEventListener('mouseleave', () => { browseBtn.style.background = 'transparent'; browseBtn.style.borderColor = T.border; });
          browseBtn.addEventListener('click', () => {
            openFontPreviewer((font, value) => {
              pickedFont = font;
              valueInput.value = value;
            });
          });
          // If the user types a custom value, the picked-font link is no longer
          // accurate — clear the tracked pick so we don't inject an unused link.
          valueInput.addEventListener('input', () => {
            if (pickedFont && !valueInput.value.includes(pickedFont.name)) pickedFont = null;
          });

          // Row 4: action buttons
          const btnRow = el('div');
          css(btnRow, { display: 'flex', gap: '6px' });

          const confirmBtn = el('button');
          confirmBtn.textContent = 'Add';
          css(confirmBtn, { padding: '5px 14px', background: T.accent, color: T.primary, border: '2px solid transparent', borderRadius: T.radiusPill, fontSize: '11.5px', fontWeight: '600', cursor: 'pointer', fontFamily: T.fontBody, boxShadow: T.shadowCta, transition: 'background 0.15s, transform 0.15s' });
          confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = T.accent2; confirmBtn.style.transform = 'translateY(-1px)'; });
          confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = T.accent; confirmBtn.style.transform = 'translateY(0)'; });

          const cancelBtn = el('button');
          cancelBtn.textContent = 'Cancel';
          css(cancelBtn, { padding: '5px 14px', background: 'transparent', border: `1.5px solid ${T.border}`, borderRadius: T.radiusPill, fontSize: '11.5px', cursor: 'pointer', fontFamily: T.fontBody, fontWeight: '500', color: T.primary, transition: 'background 0.15s' });
          cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = T.bgAlt; });
          cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });

          btnRow.append(confirmBtn, cancelBtn);
          form.append(nameRow, valueInput, browseBtn, btnRow);
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
            if (styleEl.textContent.includes(varName + ':')) {
              nameInput.style.borderColor = T.danger;
              nameInput.title = 'Variable already exists';
              return;
            }

            addStyleVar(styleEl, varName, value);
            if (pickedFont) ensureGoogleFontLink(pickedFont);
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
    css(row, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });

    const label = el('label');
    label.textContent = varName.replace(/^--/, '');
    label.title = varName;
    css(label, {
      flex: '1',
      color: T.primary,
      fontSize: '11.5px',
      fontFamily: T.fontMono,
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
      css(picker, { width: '30px', height: '28px', padding: '1px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, cursor: 'pointer', flexShrink: '0', background: '#fff' });

      const hexInput = el('input');
      hexInput.type = 'text';
      hexInput.value = hexVal;
      css(hexInput, { width: '78px', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, flexShrink: '0', background: '#fff', color: T.primary, outline: 'none' });

      const apply = val => {
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
      css(input, { width: '116px', padding: '5px 8px', border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: '11px', fontFamily: T.fontMono, background: '#fff', color: T.primary, outline: 'none' });
      const applyValue = val => {
        input.value = val;
        updateStyleVar(styleEl, varName, val);
        setDirty(true);
      };
      input.addEventListener('input', () => applyValue(input.value));

      // Font variables get a picker toggle: "Aa" button opens a Google Fonts
      // picker beneath the row. Excludes size / line-height / weight variables.
      const isFontFamily = varName.includes('font') &&
        !varName.includes('size') &&
        !varName.includes('line-height') &&
        !varName.includes('weight');

      if (!isFontFamily) {
        row.append(label, input);
        return row;
      }

      const toggleBtn = el('button');
      toggleBtn.textContent = 'Aa';
      toggleBtn.title = 'Pick a Google Font';
      css(toggleBtn, {
        width: '28px',
        height: '28px',
        padding: '0',
        border: `1.5px solid ${T.border}`,
        borderRadius: T.radiusSm,
        background: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
        fontFamily: T.fontHead,
        fontWeight: '600',
        color: T.primary,
        flexShrink: '0',
        transition: 'background 0.15s, border-color 0.15s',
      });
      toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = T.bgAlt; toggleBtn.style.borderColor = T.accent2; });
      toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = '#fff';   toggleBtn.style.borderColor = T.border; });

      // Narrow the value input so there's room for the toggle button
      css(input, { width: '84px' });

      row.append(label, input, toggleBtn);

      toggleBtn.addEventListener('click', () => {
        openFontPreviewer((font, value) => {
          applyValue(value);
          ensureGoogleFontLink(font);
        });
      });

      return row;
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

  function onSelectionChange(e) {
    // Mouse/key events originating inside the toolbar itself (e.g. mouseup after
    // clicking the color or font button) must not rebuild the toolbar — doing so
    // would wipe any open flyout before the user can pick an option.
    if (e && selectionToolbar && e.target && selectionToolbar.contains(e.target)) return;
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

    const bar = el('div', { id: '__gitqi-sel-toolbar', 'data-editor-ui': '' });
    css(bar, {
      position: 'fixed',
      zIndex: '1000002',
      background: T.primary,
      borderRadius: '12px',
      padding: '4px 6px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '2px',
      boxShadow: '0 14px 32px -10px rgba(26, 27, 58, 0.45)',
      fontFamily: T.fontBody,
    });

    const row = el('div');
    css(row, { display: 'flex', alignItems: 'center', gap: '2px' });

    const flyout = el('div', { 'data-editor-ui': '' });
    css(flyout, {
      display: 'none',
      padding: '8px 4px 4px',
      marginTop: '5px',
      borderTop: '1px solid rgba(253, 251, 245, 0.12)',
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
    css(boldBtn, { fontWeight: '700', fontFamily: T.fontHead });
    boldBtn.title = 'Bold';

    const italicBtn = makeSelBtn('I', italicActive, () => {
      const anchor = window.getSelection()?.anchorNode;
      const emContainer = anchor && (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
      document.execCommand('italic');
      if (emContainer) normalizeEm(emContainer);
      hideSelectionToolbar();
    });
    css(italicBtn, { fontStyle: 'italic', fontFamily: T.fontHead });
    italicBtn.title = 'Italic';

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
    codeBtn.title = 'Inline code';

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
      document.execCommand('createLink', false, '__gitqi_new__');
      const newLink = document.querySelector('a[href="__gitqi_new__"]');
      if (newLink) {
        newLink.setAttribute('href', '');
        hideSelectionToolbar();
        openLinkPopover(newLink);
      } else {
        hideSelectionToolbar();
      }
    });
    linkBtn.innerHTML = LINK_SVG;
    linkBtn.title = 'Link';

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
    css(fontBtn, { fontFamily: T.fontHead, fontWeight: '600', fontSize: '12px' });
    fontBtn.title = 'Font family';

    // Font-size button — opens a flyout with relative size presets
    const fontSizeBtn = makeSelBtn('A\u2195', false, () => {
      toggleFlyout(flyout, 'fontSize', () => populateFontSizeFlyout(flyout, savedRange));
    });
    css(fontSizeBtn, { fontFamily: T.fontHead, fontWeight: '600', fontSize: '12px' });
    fontSizeBtn.title = 'Font size';

    row.append(boldBtn, italicBtn, colorBtn, fontBtn, fontSizeBtn, codeBtn, linkBtn);
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

  // Marker on every span created by the selection toolbar. It's our "license
  // to unilaterally fix" — scoping auto-cleanup to these spans means we never
  // mutate hand-authored markup, and every text style we apply (color, font,
  // future font-size) goes through the same replace-don't-nest path.
  const GITQI_STYLE_ATTR = 'data-gitqi-style';

  // Wrap the current selection in a gitqi-owned <span> with an inline style.
  // Before wrapping, strip the same property from any inline-styled span the
  // selection fully covers so repeated font/color changes replace rather than
  // nest — and so legacy nests authored before this marker existed collapse
  // as soon as the user re-applies a style. A partial selection inside a
  // larger styled span still nests — correct, since the outer style still
  // applies to the unselected portion (and we never mutate hand-authored
  // markup whose extent isn't fully covered).
  function wrapSelectionInStyledSpan(property, value) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    clearInlineStyleFromSelection(property, { onlyIfFullyCovered: true });

    // Re-acquire the selection — cleanup may have unwrapped spans around it.
    const sel2 = window.getSelection();
    if (!sel2 || sel2.rangeCount === 0 || sel2.isCollapsed) return;
    const r = sel2.getRangeAt(0);
    const anchor = sel2.anchorNode;
    const editable = anchor &&
      (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
    if (!editable) return;
    const span = document.createElement('span');
    span.setAttribute(GITQI_STYLE_ATTR, '');
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

  // Remove an inline style property from <span>s touched by the current
  // selection. Unwraps spans that end up with no remaining styles or attributes.
  //
  // Scope is any inline-styled <span>, gitqi-owned or legacy — so pre-marker
  // nested styling collapses on re-apply or explicit clear. The full-coverage
  // guard is what keeps this safe: we only strip a property from a span if the
  // selection covers ALL of that span's contents. Hand-authored styling that
  // extends beyond the selection is never mutated.
  //
  //   onlyIfFullyCovered: true  — used by the pre-wrap cleanup.
  //   onlyIfFullyCovered: false — used by the explicit Remove / Clear buttons
  //     (user is being explicit, so any intersecting span is fair game).
  function clearInlineStyleFromSelection(property, { onlyIfFullyCovered = false } = {}) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    const anchor = sel.anchorNode;
    const editable = anchor &&
      (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor).closest('[data-editable]');
    if (!editable) return false;

    const candidates = new Set();
    editable.querySelectorAll('span').forEach(s => {
      if (r.intersectsNode(s)) candidates.add(s);
    });
    // Include span ancestors of the range endpoints — they enclose the
    // selection but wouldn't be caught by the intersectsNode descendant scan.
    const walkUp = node => {
      let n = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
      while (n && n !== editable) {
        if (n.tagName === 'SPAN') candidates.add(n);
        n = n.parentElement;
      }
    };
    walkUp(r.startContainer);
    walkUp(r.endContainer);

    let changed = false;
    candidates.forEach(span => {
      if (!span.style[property]) return;
      if (onlyIfFullyCovered) {
        const spanRange = document.createRange();
        spanRange.selectNodeContents(span);
        const startsBefore = r.compareBoundaryPoints(Range.START_TO_START, spanRange) <= 0;
        const endsAfter    = r.compareBoundaryPoints(Range.END_TO_END,   spanRange) >= 0;
        if (!(startsBefore && endsAfter)) return;
      }
      span.style[property] = '';
      changed = true;
      const styleAttr = span.getAttribute('style');
      if (!styleAttr || !styleAttr.trim()) {
        span.removeAttribute('style');
        span.removeAttribute(GITQI_STYLE_ATTR);
        if (span.attributes.length === 0) {
          const parent = span.parentNode;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          span.remove();
        }
      }
    });

    if (changed) setDirty(true);
    return changed;
  }

  function populateColorFlyout(flyout, savedRange) {
    const renderSwatches = () => {
      flyout.innerHTML = '';
      const grid = el('div');
      css(grid, { display: 'flex', flexWrap: 'wrap', gap: '5px', maxWidth: '220px' });

      const colors = getThemeVars('--color');
      colors.forEach(([varName, varValue]) => {
        const swatch = el('button', { 'data-editor-ui': '' });
        swatch.title = varName.replace(/^--/, '');
        css(swatch, {
          width: '24px', height: '24px', padding: '0',
          border: '1px solid rgba(253, 251, 245, 0.25)',
          borderRadius: '6px', cursor: 'pointer', background: varValue,
          transition: 'transform 0.12s',
        });
        swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.1)'; });
        swatch.addEventListener('mouseleave', () => { swatch.style.transform = 'scale(1)'; });
        swatch.addEventListener('mousedown', e => {
          e.preventDefault();
          restoreSavedRange(savedRange);
          wrapSelectionInStyledSpan('color', `var(${varName})`);
          hideSelectionToolbar();
        });
        grid.appendChild(swatch);
      });

      // Clear — remove any color styling from the selected text
      const clearBtn = el('button', { 'data-editor-ui': '' });
      clearBtn.title = 'Remove text color';
      css(clearBtn, {
        width: '24px', height: '24px', padding: '0',
        border: '1px solid rgba(253, 251, 245, 0.25)',
        borderRadius: '6px', cursor: 'pointer',
        background: 'rgba(253, 251, 245, 0.05)', color: T.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });
      clearBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 19 19 5"/></svg>`;
      clearBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        restoreSavedRange(savedRange);
        clearInlineStyleFromSelection('color');
        hideSelectionToolbar();
      });
      grid.appendChild(clearBtn);

      // Custom — opens an inline editor with native picker + hex input
      const customBtn = el('button', { 'data-editor-ui': '' });
      customBtn.title = 'Custom color (picker or hex)';
      css(customBtn, {
        width: '24px', height: '24px', padding: '0',
        border: `1px dashed ${T.accent3}`,
        borderRadius: '6px', cursor: 'pointer',
        background: 'transparent', color: T.accent3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });
      customBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
      // Defer the re-render past this event tick — otherwise flyout.innerHTML = ''
      // detaches customBtn during mousedown, and the subsequent mouseup (target now
      // outside the toolbar) triggers onSelectionChange and rebuilds the toolbar.
      customBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        setTimeout(() => { renderCustom(); repositionSelectionToolbar(); }, 0);
      });
      grid.appendChild(customBtn);

      flyout.appendChild(grid);

      if (!colors.length) {
        const hint = el('div');
        hint.textContent = 'No theme colors — use custom';
        css(hint, { color: 'rgba(253, 251, 245, 0.55)', fontSize: '11px', padding: '4px 2px 0', fontStyle: 'italic' });
        flyout.appendChild(hint);
      }
    };

    const renderCustom = () => {
      flyout.innerHTML = '';
      const panel = el('div');
      css(panel, { display: 'flex', flexDirection: 'column', gap: '6px', width: '220px' });

      const inputRowStyle = { display: 'flex', alignItems: 'center', gap: '6px' };
      const labelStyle = { fontSize: '11px', color: 'rgba(253, 251, 245, 0.7)', width: '30px', flexShrink: '0', fontWeight: '500' };

      // Native picker row
      const pickerRow = el('div');
      css(pickerRow, inputRowStyle);
      const pickerLabel = el('span');
      pickerLabel.textContent = 'Pick';
      css(pickerLabel, labelStyle);
      const colorInput = el('input', { 'data-editor-ui': '' });
      colorInput.type = 'color';
      colorInput.value = T.secondary;
      colorInput.title = 'Open color picker';
      css(colorInput, {
        width: '42px', height: '28px', padding: '2px',
        background: 'transparent',
        border: '1px solid rgba(253, 251, 245, 0.2)',
        borderRadius: '6px', cursor: 'pointer',
      });
      pickerRow.append(pickerLabel, colorInput);

      // Hex input row
      const hexRow = el('div');
      css(hexRow, inputRowStyle);
      const hexLabel = el('span');
      hexLabel.textContent = 'Hex';
      css(hexLabel, labelStyle);
      const hexInput = el('input', { 'data-editor-ui': '' });
      hexInput.type = 'text';
      hexInput.placeholder = '#aabbcc';
      hexInput.spellcheck = false;
      hexInput.value = colorInput.value;
      hexInput.title = 'Paste or type a hex code';
      css(hexInput, {
        flex: '1', minWidth: '0',
        padding: '4px 8px',
        background: 'rgba(253, 251, 245, 0.08)',
        border: '1px solid rgba(253, 251, 245, 0.18)',
        borderRadius: '6px',
        color: T.bg,
        fontFamily: T.fontMono, fontSize: '11px',
        outline: 'none',
      });
      hexRow.append(hexLabel, hexInput);

      // Button row
      const btnRow = el('div');
      css(btnRow, { display: 'flex', justifyContent: 'space-between', gap: '6px', marginTop: '4px' });
      const backBtn = el('button', { 'data-editor-ui': '' });
      backBtn.textContent = '← Theme';
      backBtn.title = 'Back to theme colors';
      css(backBtn, {
        padding: '5px 12px',
        background: 'transparent',
        border: '1px solid rgba(253, 251, 245, 0.22)',
        borderRadius: T.radiusPill, color: T.bg,
        fontSize: '11px', fontFamily: T.fontBody, fontWeight: '500',
        cursor: 'pointer',
      });
      const applyBtn = el('button', { 'data-editor-ui': '' });
      applyBtn.textContent = 'Apply';
      applyBtn.title = 'Apply this color to the selection';
      css(applyBtn, {
        padding: '5px 16px',
        background: T.accent, border: 'none',
        borderRadius: T.radiusPill, color: T.primary,
        fontSize: '11px', fontFamily: T.fontBody, fontWeight: '600',
        cursor: 'pointer',
      });
      btnRow.append(backBtn, applyBtn);

      // Sync picker → hex, and hex → picker (when valid 6-digit hex)
      colorInput.addEventListener('input', () => {
        hexInput.value = colorInput.value;
        hexInput.style.borderColor = 'rgba(253, 251, 245, 0.18)';
      });
      hexInput.addEventListener('input', () => {
        hexInput.style.borderColor = 'rgba(253, 251, 245, 0.18)';
        let v = hexInput.value.trim();
        if (v && v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) colorInput.value = v;
      });
      // stopPropagation prevents the document-level mousedown from hiding the
      // toolbar/flyout when the user clicks into the hex field to paste.
      hexInput.addEventListener('mousedown', e => e.stopPropagation());

      const tryApply = () => {
        let val = hexInput.value.trim();
        if (!val) val = colorInput.value;
        if (val[0] !== '#') val = '#' + val;
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) {
          hexInput.style.borderColor = T.danger;
          return;
        }
        restoreSavedRange(savedRange);
        wrapSelectionInStyledSpan('color', val);
        hideSelectionToolbar();
      };

      hexInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryApply(); }
      });
      applyBtn.addEventListener('mousedown', e => { e.preventDefault(); tryApply(); });
      backBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        setTimeout(() => { renderSwatches(); repositionSelectionToolbar(); }, 0);
      });

      panel.append(pickerRow, hexRow, btnRow);
      flyout.appendChild(panel);
    };

    renderSwatches();
  }

  function populateFontFlyout(flyout, savedRange) {
    const list = el('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '220px' });

    const fonts = getThemeVars('--font').filter(([k]) => !k.includes('size') && !k.includes('line-height') && !k.includes('weight'));
    if (!fonts.length) {
      const empty = el('div');
      empty.textContent = 'No theme fonts defined';
      css(empty, { color: 'rgba(253, 251, 245, 0.55)', fontSize: '11px', padding: '2px 4px', fontStyle: 'italic' });
      flyout.appendChild(empty);
      return;
    }

    fonts.forEach(([varName, varValue]) => {
      const item = el('button', { 'data-editor-ui': '', title: varValue });
      item.textContent = varName.replace(/^--font-?/, '') || 'font';
      css(item, {
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: T.bg,
        cursor: 'pointer',
        fontSize: '13.5px',
        fontFamily: varValue,
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.12s',
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(253, 251, 245, 0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        restoreSavedRange(savedRange);
        wrapSelectionInStyledSpan('fontFamily', `var(${varName})`);
        hideSelectionToolbar();
      });
      list.appendChild(item);
    });

    // Clear — strip font-family from gitqi-owned spans in the selection. Lets
    // the user revert text back to inheriting the zone's default font without
    // manually editing HTML.
    const clearBtn = el('button', { 'data-editor-ui': '' });
    clearBtn.title = 'Remove font styling from the selected text';
    css(clearBtn, {
      marginTop: '4px',
      padding: '6px 10px',
      background: 'transparent',
      border: 'none',
      borderTop: '1px solid rgba(253, 251, 245, 0.12)',
      color: 'rgba(253, 251, 245, 0.7)',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: T.fontBody,
      fontStyle: 'italic',
      textAlign: 'left',
      width: '100%',
      transition: 'color 0.12s, background 0.12s',
    });
    clearBtn.textContent = '✕  Clear font styling';
    clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = 'rgba(253, 251, 245, 0.08)'; clearBtn.style.color = T.bg; });
    clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = 'transparent'; clearBtn.style.color = 'rgba(253, 251, 245, 0.7)'; });
    clearBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      restoreSavedRange(savedRange);
      clearInlineStyleFromSelection('fontFamily');
      hideSelectionToolbar();
    });
    list.appendChild(clearBtn);

    flyout.appendChild(list);
  }

  // Relative presets in `em` so a bump inside a heading stays heading-scaled
  // and a bump in body stays body-scaled — the size is always relative to the
  // surrounding text. "Normal" has no value — it strips the font-size span
  // instead of writing a redundant font-size:1em.
  const FONT_SIZE_PRESETS = [
    { label: 'Smaller', value: '0.75em',  preview: '0.85em' },
    { label: 'Small',   value: '0.875em', preview: '0.92em' },
    { label: 'Normal',  value: null,      preview: '1em'    },
    { label: 'Large',   value: '1.25em',  preview: '1.12em' },
    { label: 'Larger',  value: '1.5em',   preview: '1.24em' },
    { label: 'Huge',    value: '2em',     preview: '1.4em'  },
  ];

  function populateFontSizeFlyout(flyout, savedRange) {
    const list = el('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '220px' });

    FONT_SIZE_PRESETS.forEach(({ label, value, preview }) => {
      const item = el('button', { 'data-editor-ui': '', title: value || 'Inherit surrounding size' });
      item.textContent = label;
      css(item, {
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: T.bg,
        cursor: 'pointer',
        fontSize: preview,
        fontFamily: T.fontBody,
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.12s',
        lineHeight: '1.25',
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(253, 251, 245, 0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        restoreSavedRange(savedRange);
        if (value) {
          wrapSelectionInStyledSpan('fontSize', value);
        } else {
          clearInlineStyleFromSelection('fontSize');
        }
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
      width: '30px',
      height: '30px',
      padding: '0',
      background: active ? 'rgba(45, 212, 191, 0.25)' : 'transparent',
      border: 'none',
      borderRadius: '8px',
      color: active ? T.accent2 : T.bg,
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: '1',
      transition: 'background 0.15s',
      fontFamily: T.fontBody,
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = active ? 'rgba(45, 212, 191, 0.38)' : 'rgba(253, 251, 245, 0.12)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = active ? 'rgba(45, 212, 191, 0.25)' : 'transparent';
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

    const popover = el('div', { 'data-editor-ui': '', id: '__gitqi-link-popover' });
    css(popover, {
      position: 'fixed',
      zIndex: '1000001',
      background: T.bg,
      border: `1px solid ${T.border}`,
      borderRadius: T.radius,
      padding: '16px 18px',
      width: '330px',
      boxShadow: T.shadow,
      fontFamily: T.fontBody,
      fontSize: '13px',
      color: T.primary,
    });

    popover.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;
                     letter-spacing:0.1em;color:${T.textMuted};">Edit Link</span>
        <a id="__gitqi-link-goto" href="#" target="_self"
          style="font-size:11px;color:${T.primary};text-decoration:none;padding:4px 10px;
                 border-radius:${T.radiusPill};background:${T.bgAlt};border:1px solid ${T.borderSoft};display:none;font-weight:500;">
          Go to link →
        </a>
      </div>

      <label style="display:block;margin-bottom:11px;">
        <span style="display:block;font-size:11px;font-weight:600;color:${T.primary};margin-bottom:5px;letter-spacing:0.04em;text-transform:uppercase;">Display text</span>
        <input id="__gitqi-link-text" type="text" value=""
          style="width:100%;padding:7px 10px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:13px;box-sizing:border-box;font-family:${T.fontBody};background:#fff;color:${T.primary};outline:none;transition:border-color 0.15s;" />
      </label>

      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;font-size:11px;font-weight:600;color:${T.primary};margin-bottom:5px;letter-spacing:0.04em;text-transform:uppercase;">URL</span>
        <input id="__gitqi-link-url" type="text" value=""
          style="width:100%;padding:7px 10px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:12.5px;box-sizing:border-box;font-family:${T.fontMono};background:#fff;color:${T.primary};outline:none;transition:border-color 0.15s;" />
      </label>

      <div id="__gitqi-link-picker-wrap" style="margin-bottom:12px;">
        <select id="__gitqi-link-picker"
          style="width:100%;padding:7px 10px;border:1.5px solid ${T.border};border-radius:${T.radiusSm};
                 font-size:12px;font-family:${T.fontBody};color:${T.primary};background:#fff;outline:none;cursor:pointer;">
          <option value="">— Jump to a page or section —</option>
        </select>
      </div>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:16px;">
        <input id="__gitqi-link-blank" type="checkbox"
          style="width:15px;height:15px;cursor:pointer;accent-color:${T.secondary};" />
        <span style="font-size:12.5px;color:${T.primary};">Open in new tab</span>
      </label>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="__gitqi-link-remove"
          style="padding:7px 14px;border:1.5px solid ${T.border};background:transparent;color:${T.textMuted};
                 border-radius:${T.radiusPill};cursor:pointer;font-size:12px;font-family:${T.fontBody};font-weight:500;
                 transition:background 0.15s, border-color 0.15s, color 0.15s;">
          Remove link
        </button>
        <button id="__gitqi-link-done"
          style="padding:7px 18px;background:${T.accent};color:${T.primary};border:2px solid transparent;
                 border-radius:${T.radiusPill};cursor:pointer;font-size:12px;font-weight:600;font-family:${T.fontBody};
                 box-shadow:${T.shadowCta};transition:background 0.15s, transform 0.15s;">
          Done
        </button>
      </div>
    `;

    document.body.appendChild(popover);
    activeLinkPopover = popover;

    // Populate fields
    const textInput  = popover.querySelector('#__gitqi-link-text');
    const urlInput   = popover.querySelector('#__gitqi-link-url');
    const blankCheck = popover.querySelector('#__gitqi-link-blank');
    const gotoBtn    = popover.querySelector('#__gitqi-link-goto');
    const picker     = popover.querySelector('#__gitqi-link-picker');

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
      popover.querySelector('#__gitqi-link-picker-wrap').style.display = 'none';
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

    // Focus rings on inputs
    [textInput, urlInput].forEach(inp => {
      inp.addEventListener('focus', () => { inp.style.borderColor = T.secondary; inp.style.boxShadow = '0 0 0 3px rgba(217, 70, 239, 0.12)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = T.border; inp.style.boxShadow = 'none'; });
    });

    const doneBtn = popover.querySelector('#__gitqi-link-done');
    doneBtn.addEventListener('mouseenter', () => { doneBtn.style.background = T.accent2; doneBtn.style.transform = 'translateY(-1px)'; });
    doneBtn.addEventListener('mouseleave', () => { doneBtn.style.background = T.accent; doneBtn.style.transform = 'translateY(0)'; });
    doneBtn.addEventListener('click', closeLinkPopover);

    const removeBtn = popover.querySelector('#__gitqi-link-remove');
    removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = T.accent4; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = 'transparent'; });
    removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'transparent'; removeBtn.style.color = T.textMuted; removeBtn.style.borderColor = T.border; });
    removeBtn.addEventListener('click', () => {
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

  // ─── Legacy Webby → GitQi migration ───────────────────────────────────────
  //
  // v1.2.x and earlier shipped as "Webby" and used the data-webby-*, __webby-*,
  // and webby-pages.json namespaces. On first load with GitQi we detect those
  // markers and rewrite them in place. The migration is silent and idempotent —
  // after the first auto-save writes the updated HTML, subsequent loads find
  // nothing to migrate and this is a no-op.
  //
  // In-DOM migration runs synchronously before activateZones() so the rest of
  // the editor only ever sees the new namespace. On-disk migration (pages
  // inventory file, script src in saved HTML) happens inside the code paths
  // that touch those things.

  function migrateLegacyWebbyMarkers() {
    let migrated = false;

    // 1. Rename data-webby-* attributes to data-gitqi-*.
    const attrMap = {
      'data-webby-src':       'data-gitqi-src',
      'data-webby-style':     'data-gitqi-style',
      'data-webby-bound':     'data-gitqi-bound',
      'data-webby-nav-bound': 'data-gitqi-nav-bound',
    };
    for (const [oldAttr, newAttr] of Object.entries(attrMap)) {
      document.querySelectorAll('[' + oldAttr + ']').forEach(node => {
        node.setAttribute(newAttr, node.getAttribute(oldAttr));
        node.removeAttribute(oldAttr);
        migrated = true;
      });
    }

    // 2. Rename __webby-nav-styles and __webby-section-*-styles <style> ids.
    const legacyNavStyle = document.getElementById('__webby-nav-styles');
    if (legacyNavStyle) {
      legacyNavStyle.id = '__gitqi-nav-styles';
      migrated = true;
    }
    document.querySelectorAll('style[id^="__webby-section-"]').forEach(s => {
      s.id = s.id.replace('__webby-section-', '__gitqi-section-');
      migrated = true;
    });

    // 3. Rewrite <script src=".../webby.js"> (or pinned webby-*.js) to gitqi.js
    //    so the saved HTML loads GitQi on its next open. The publish serializer
    //    strips any script whose src matches webby.js or gitqi.js regardless,
    //    so this is purely for the local edit-mode HTML.
    document.querySelectorAll('script[src]').forEach(s => {
      const src = s.getAttribute('src') || '';
      if (/(^|\/)webby(-[0-9][^/]*)?\.js(\?|#|$)/.test(src)) {
        s.setAttribute('src', src.replace(/webby(-[0-9][^/]*)?\.js/, 'gitqi.js'));
        migrated = true;
      }
    });

    if (migrated) setDirty(true);
  }

  // Same migration, applied to a parsed HTMLDocument read from disk. Used by
  // the shared-head sync and publish paths so legacy pages get rewritten on
  // any cross-page write, without requiring the user to open each page.
  function migrateLegacyWebbyMarkersInDoc(doc) {
    const attrMap = {
      'data-webby-src':       'data-gitqi-src',
      'data-webby-style':     'data-gitqi-style',
      'data-webby-bound':     'data-gitqi-bound',
      'data-webby-nav-bound': 'data-gitqi-nav-bound',
    };
    for (const [oldAttr, newAttr] of Object.entries(attrMap)) {
      doc.querySelectorAll('[' + oldAttr + ']').forEach(node => {
        node.setAttribute(newAttr, node.getAttribute(oldAttr));
        node.removeAttribute(oldAttr);
      });
    }
    const legacyNav = doc.getElementById('__webby-nav-styles');
    if (legacyNav) legacyNav.id = '__gitqi-nav-styles';
    doc.querySelectorAll('style[id^="__webby-section-"]').forEach(s => {
      s.id = s.id.replace('__webby-section-', '__gitqi-section-');
    });
    doc.querySelectorAll('script[src]').forEach(s => {
      const src = s.getAttribute('src') || '';
      if (/(^|\/)webby(-[0-9][^/]*)?\.js(\?|#|$)/.test(src)) {
        s.setAttribute('src', src.replace(/webby(-[0-9][^/]*)?\.js/, 'gitqi.js'));
      }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    loadGoogleFontsManifest();
    // Older versions wrote CSS vars as inline styles on <html> for live preview,
    // which then shadowed :root updates from undo/redo, reformat, and sync —
    // stripping any existing attribute lets the <style> :root block be the sole
    // source of truth going forward.
    document.documentElement.removeAttribute('style');
    injectToolbar();
    migrateLegacyWebbyMarkers();
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

    // Baseline the shared state so the first auto-save doesn't spuriously sync.
    lastSyncedSharedSnapshot = getSharedSnapshot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GitQi = { version: VERSION, serialize, exportToFile, publish: publishSite };

})();
