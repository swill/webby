# Webby - Site Editor — Project Architecture

## Overview

A zero-dependency, browser-based inline editing system for static websites. The site owner opens their HTML files locally, edits content in-place, and publishes directly to GitHub Pages — no terminal, no CMS, no backend.

The system has two distinct modes:
- **Edit mode** — activated when `secrets.js` is present alongside the HTML files
- **Public mode** — the deployed site with no editor code, no credentials, no overhead

---

## Structure

### Local folder (on the site owner's computer)

```
my-site/
├── index.html          ← Main page; content + CSS vars + structure
├── about.html          ← Additional pages (multi-page sites)
├── webby-pages.json    ← Page inventory, auto-managed by Webby
├── secrets.js          ← Never published. Sets window.SITE_SECRETS
└── assets/
    └── *.jpg / *.png
```

This folder is **not** a git repository. Webby publishes HTML files and uploads images directly to GitHub via the REST API. `secrets.js` never leaves the local machine.

### Remote GitHub repository

```
username/repo-name  (GitHub)
├── index.html
├── about.html
├── webby-pages.json
└── assets/
    └── *.jpg / *.png
```

GitHub Pages is configured to serve from the root of the `main` branch ("Deploy from branch → main → / (root)"). Any push — including Webby's API commits — updates the live site automatically. No GitHub Actions workflow is required.

---

## The Editor Script (`webby.js`)

Hosted externally on GitHub Pages. Included in each HTML page only during local editing — stripped from the published output.

### Initialization

```
init()  [async]
  ├── injectToolbar()
  ├── activateZones()
  ├── activateNav()
  ├── bindMutationObserver()
  ├── bindLinkHandlers()
  ├── bindSelectionToolbar()
  ├── bindUndoRedo()
  └── initFileAccess()  [async]
        ├── Load FileSystemDirectoryHandle from IndexedDB
        │     (migrates v1.0.x per-page keys → per-directory keys automatically)
        ├── If found + permission granted → dirHandle = stored (silent)
        │     └── loadPagesInventory()
        └── Else → showAccessBanner()
  └── lastSyncedSharedSnapshot = getSharedSnapshot()  ← baseline for shared head + nav change detection
```

### Required Globals (set by `secrets.js`)

```js
window.SITE_SECRETS = {
  geminiKey:   "AIza...",   // Google AI Studio API key — free at aistudio.google.com
  githubToken: "ghp_...",   // Fine-grained PAT: contents read+write on the site repo
  repo:        "user/repo", // e.g. "jane/jane-osteopathy"
  branch:      "main"       // Deployment branch
};
```

### Key Constants

```js
const CURRENT_FILENAME = location.pathname.split('/').pop() || 'index.html';
const HANDLE_KEY = 'dir:' + location.href.substring(0, location.href.lastIndexOf('/') + 1);
// Keyed by site directory (not page path) so all pages in the same folder share one handle
```

---

## Core Modules

### 1. Zone Manager

Responsible for identifying and activating editable regions.

**Data attributes used in HTML:**

| Attribute | Purpose |
|---|---|
| `data-zone` | Marks a top-level editable section (e.g. `"hero"`, `"about"`). Also set as the element `id` for anchor links. |
| `data-zone-label` | Human-readable label shown in the delete confirmation |
| `data-editable` | Text node is directly editable via `contenteditable` |
| `data-editable-image` | Image can be replaced by clicking |

**Functions:**

```
activateZones()
  ├── Query all [data-zone] elements
  ├── For each: activateZone(section)
  │     ├── Add contenteditable + spellcheck to [data-editable] children
  │     ├── Bind image click handlers on all <img> in zone
  │     ├── Set section.id = section.dataset.zone (for anchor links)
  │     ├── injectDeleteButton(section)    ← hover-visible ✕ button with confirm + snapshotForUndo()
  │     └── injectReformatButton(section)  ← hover-visible ⟳ button → promptReformatSection()
  └── injectAddSectionButtons()
        └── Insert "Add Section" button before first zone and after each zone

deactivateZones()
  ├── Remove all contenteditable + spellcheck attributes
  └── Remove all [data-editor-ui] injections
```

### 2. Toolbar

Fixed-position bar injected at the top of the page in edit mode. Marked `data-editor-ui` so it is stripped on export/publish.

**Elements (left to right):**

- Site title with `●` dirty indicator (unsaved changes)
- Spacer
- Status message area
- **↩ Undo** button — disabled until undo stack has entries
- **↪ Redo** button — disabled until redo stack has entries
- **Pages** button → open/close Pages panel
- **Theme** button → open/close CSS variable + site identity editor
- **Export** button → download clean HTML for the current page
- **Publish** button → commit all pages and webby-pages.json to GitHub

**Functions:**

```
injectToolbar()   ← Create and prepend toolbar; adjust body padding-top;
                    shift fixed <nav> down by 44px if present
showStatus(msg)   ← Display temporary status text in toolbar
setDirty(bool)    ← Toggle ● indicator; schedules auto-save when true
```

### 3. File Persistence

Keeps HTML files on disk in sync with the current DOM state using the File System Access API. Only Chrome and Edge are supported — opening in any other browser shows a blocking message.

```
initFileAccess()
  ├── Load FileSystemDirectoryHandle from IndexedDB (with v1.0.x key migration)
  ├── If found: verifyPermission() → if granted, silently re-link → loadPagesInventory()
  └── If not found or denied: showAccessBanner()

showAccessBanner()
  └── Banner below toolbar: local path hint + "Select Folder" button
        └── On click: showDirectoryPicker() → store handle in IndexedDB
              → writeCurrentPageToLocalFile() → loadPagesInventory()

saveChanges()  ← called by auto-save timer
  ├── writeCurrentPageToLocalFile()
  └── syncSharedToOtherPagesIfChanged()

scheduleAutoSave()  ← debounced 1500ms; triggered by setDirty(true)
  └── saveChanges()

writeCurrentPageToLocalFile()
  └── serialize({ local: true }) → write CURRENT_FILENAME to dirHandle

writePageToLocalFile(filename, content)
  └── Write any page file (used by page generator and shared sync)

writeImageToLocalDir(file)
  └── Write to assets/ subdirectory in the linked folder
```

The `local: true` flag on `serialize()` preserves the `secrets.js` and `webby.js` script tags so edit mode activates correctly on the next open. The default `local: false` strips them for the deployed site.

### 4. Pages Inventory

Tracks all pages in a `webby-pages.json` manifest alongside the HTML files. Auto-created on first use; auto-upgraded for existing single-page sites.

```js
// Structure
{ "pages": [{ "file": "index.html", "title": "Home", "navLabel": "Home" }, ...] }
```

```
loadPagesInventory()
  ├── Try to read webby-pages.json from dirHandle
  ├── If found: parse + ensure CURRENT_FILENAME is registered
  └── If not found: seed from current page → savePagesInventory()

savePagesInventory()
  └── Write webby-pages.json to dirHandle
```

### 5. Shared Head + Nav Sync

On every auto-save, compares a JSON snapshot of the current page's shared head elements plus the nav against the snapshot from the last sync. If anything changed, the updated elements are written into every other page file on disk.

Also triggered immediately (not via auto-save timer) after: Reformat Nav, Add Page, Delete Page.

**Synced** (page-to-page, whole-site):
- `<nav>`
- Main `<style>` (CSS variables + base styles — whatever the theme editor writes to)
- `<style id="__webby-nav-styles">` (nav-specific CSS)
- `<link rel="icon">` and `<link rel="apple-touch-icon">` (favicon)
- Google Fonts `<link>`s matching `fonts.googleapis.com` or `fonts.gstatic.com` (including preconnects)

**NOT synced** (intentionally page-specific):
- `<title>`, `<meta name="description">`, `<meta name="keywords">`

```
getNavHTML()
  └── Clone nav → strip [data-editor-ui] + data-webby-nav-bound → return outerHTML

getMainStyleElement(root)
  └── First <style> in head whose id isn't a __webby-* managed id

getSharedHeadElements()
  └── { mainStyle, navStyle, favicon, appleIcon, googleFontLinks }

getSharedSnapshot()
  └── JSON.stringify({ nav, mainStyle.text, navStyle.text, favicon.outerHTML,
                        appleIcon.outerHTML, googleFontLinks (sorted) })

syncSharedToOtherPagesIfChanged()
  ├── snapshot = getSharedSnapshot()
  ├── if snapshot === lastSyncedSharedSnapshot → return (no-op)
  ├── activeMarker = extractActiveMarker(sourceNav, CURRENT_FILENAME)  ← { classes, ariaCurrent } or null
  └── For each page in pagesInventory (skip current):
        ├── Read page file from dirHandle → DOMParser
        ├── Replace <nav> → retargetActiveMarker(newNav, activeMarker, page.file)  ← per-page "current link" styling
        ├── Replace main <style> textContent (insert if missing)
        ├── Upsert/remove <style id="__webby-nav-styles">
        ├── syncLinkRelInDoc(doc, 'icon', …) + apple-touch-icon
        ├── syncGoogleFontLinksInDoc(doc, googleFontLinks)  ← clears old, inserts fresh copies before first <style>
        └── Write back
  └── lastSyncedSharedSnapshot = snapshot
```

**Active-link retargeting** — the sync copies the source nav verbatim but then rewrites the "current page" marker for each destination. Without this, every synced page would end up with the source page's link highlighted as active.

Recognised markers (`ACTIVE_CLASS_CANDIDATES`): CSS classes `active`, `current`, `is-active`, `is-current`, `selected`, and the `aria-current` attribute. `extractActiveMarker()` reads whichever are present on the anchor(s) matching `CURRENT_FILENAME`; `retargetActiveMarker()` strips all of them from the cloned nav and re-applies them to anchors whose `href` matches the destination page.

### 6. Mutation Observer

Tracks content changes for dirty-state management and auto-save triggering.

```
bindMutationObserver()
  ├── Disconnect any existing observer first (safe to call repeatedly, e.g. after undo/redo)
  ├── Observe subtree of <body> for characterData + childList
  ├── Ignore mutations originating from [data-editor-ui] elements
  └── On relevant change → setDirty(true) → scheduleAutoSave()
```

### 7. Image Manager

Handles image replacement without leaving the browser.

**Flow:**

1. User clicks an `<img>` element inside a zone (hover shows "Click to replace image" overlay)
2. Hidden `<input type="file">` triggers file picker
3. On file select:
   - Read as ArrayBuffer → base64 encode
   - Upload to `assets/` in GitHub repo via API
   - **If folder is linked:** write file to local `assets/`; set `src` to `./assets/filename`
   - **If no folder access:** display via blob URL locally; store `./assets/filename` in `data-webby-src`; serializer resolves on publish/export

```
bindImageHandler(img)
  └── Attach hover overlay + click → file picker → handleImageUpload()

handleImageUpload(file, imgEl)
  ├── Read as ArrayBuffer → base64Encode → github.uploadFile(`assets/${file.name}`)
  ├── If dirHandle: writeImageToLocalDir(file) → imgEl.src = `./assets/${file.name}`
  └── Else: imgEl.src = blobURL; imgEl.dataset.webbySrc = `./assets/${file.name}`
```

### 8. Selection Toolbar

Floating toolbar that appears above selected text inside any `[data-editable]` element.

**Buttons:**

| Button | Action |
|---|---|
| **B** | `execCommand('bold')` → normalizes `<b>` → `<strong>` |
| *I* | `execCommand('italic')` → normalizes `<i>` → `<em>` |
| 🎨 | Color flyout — theme swatches + custom picker + "Remove color" |
| Aa | Font flyout — theme font vars + "Clear font styling" |
| A↕ | Font-size flyout — em-based presets (Smaller 0.75 / Small 0.875 / **Normal** / Large 1.25 / Larger 1.5 / Huge 2). Relative `em` units so a bump inside a heading stays heading-scaled and a bump in body stays body-scaled. "Normal" strips the font-size property instead of writing a redundant `font-size: 1em`. |
| `</>` | Wrap/unwrap selection in `<code>` |
| 🔗 | Wrap selection in `<a>` → open link popover |

```
bindSelectionToolbar()
  └── Listens for mouseup/keyup; shows toolbar when selection is non-empty inside [data-editable]

showSelectionToolbar(sel)
  └── Position above selection (flip below if near top of viewport)

hideSelectionToolbar()
  └── Called on mousedown outside toolbar, Escape key, or after button action
```

**Inline-style spans (color / font / font-size):**

Every span created by the color, font, and font-size flyouts is tagged `data-webby-style`.
`wrapSelectionInStyledSpan(prop, val)` calls
`clearInlineStyleFromSelection(prop, { onlyIfFullyCovered: true })` first so
repeated changes to the same property replace rather than nest — no more
`<span font-A><span font-B><span font-C>…</span></span></span>` trails of
dead references. Legacy nests authored before the marker existed collapse on
re-apply for the same reason.

Scope is any inline-styled `<span>`, webby-owned or hand-authored. The
**full-coverage guard** is what keeps this safe: a property is only stripped
from a span if the selection covers ALL of that span's contents, so
hand-authored markup that extends beyond the selection is never mutated
(partial selections still nest — correct, since the outer style still applies
to the unselected portion). Explicit "Remove color" / "Clear font" /
"Normal" (font-size) buttons drop the guard since the user is being explicit.

The `data-webby-style` marker is stripped in publish output
(`serialize({local: false})`) but preserved in local saves + snapshots so it
survives re-opens and undo/redo.

### 9. Link Editor

Intercepts clicks on `<a>` elements inside `[data-zone]` or `<nav>` and shows a popover editor.

**Popover fields:**

- **Display text** — updates `textContent` live
- **URL** — updates `href` live
- **Go to link →** — opens the linked URL (shown when URL is non-empty)
- **Page/section picker** — dropdown grouped by page; current page zones from DOM, other pages' zones loaded async from disk via `dirHandle`
- **Open in new tab** — toggles `target="_blank"` + `rel="noopener noreferrer"`
- **Remove link** — unwraps `<a>` leaving plain text

```
bindLinkHandlers()
  └── document.addEventListener('click', handleLinkClick, true)  ← capture phase

openLinkPopover(link)
  └── Position near link → populate fields → bind live-update handlers

positionPopover(popover, anchor)
  └── Place below anchor; flip above if insufficient space below; clamp horizontally
```

### 10. Section Reformat

AI-powered layout restructuring for individual sections. Preserves content (text, images, links) while changing structure.

```
promptReformatSection(section)  ← triggered by ⟳ hover button on section
  └── Modal: describe layout change → on submit → snapshotForUndo() → reformatSection()

reformatSection(section, description)
  ├── buildReformatPrompt() — sends: main style block + section-specific CSS + clean section HTML
  ├── callGeminiAPI(prompt)
  ├── parseSectionResponse() — expects <section-css>...</section-css> <section-html>...</section-html>
  ├── Upsert <style id="__webby-section-{slug}-styles"> for the returned CSS
  └── section.replaceWith(newSection) → activateZone(newSection)
```

### 11. Nav Editor

AI-powered navigation restructuring. Makes minimal targeted changes; syncs immediately to all other pages.

```
activateNav()
  └── Injects ⟳ Reformat Nav hover button; marks nav with data-webby-nav-bound

promptReformatNav(nav) → snapshotForUndo() → reformatNav(nav, description)
  ├── buildReformatNavPrompt() — sends: style block + existing nav-specific CSS + nav HTML
  ├── callGeminiAPI(prompt)
  ├── parseNavResponse() — expects <nav-html>...</nav-html> + optional <nav-css>...</nav-css>
  │     (AI omits <nav-css> for content-only changes like adding/removing a link)
  ├── Upsert <style id="__webby-nav-styles"> only if CSS was returned
  ├── nav.replaceWith(newNav)
  ├── rerunInlineScripts(newNav)       ← rebinds hamburger toggle listeners on new elements
  ├── activateNav()
  └── lastSyncedSharedSnapshot = '' → syncSharedToOtherPagesIfChanged()  ← immediate force-sync

addLinkToNav(navEl, label, href)  ← programmatic link insertion (used by page generator)
  ├── Strategy 1: find all <ul>/<ol> with <li><a> → clone last item per list, update, append
  └── Strategy 2 (fallback): bare <a> elements → clone last, update, insert after
```

**Hamburger script pattern** — nav inline scripts should bind to the `<nav>` element (not `document` or `window`) so that listeners are cleaned up when the nav is replaced and re-bound when `rerunInlineScripts` re-executes them:
```js
(function() {
  const nav = document.currentScript.closest('nav');
  nav.addEventListener('click', function(e) {
    if (e.target.closest('.hamburger-class')) toggleNav();
  });
})();
```

### 12. Pages Manager

Multi-page site management. Requires folder access (`dirHandle`).

```
openPagesPanel()  ← toggled by Pages toolbar button
  ├── Lists all pages from pagesInventory
  ├── Open → links to ./{page.file}
  └── ✕ Delete → confirm → snapshotForUndo() → deletePageFromSite(page)

promptAddPage() / generatePage(description, navLabel, filename)
  ├── snapshotForUndo()
  ├── buildPagePrompt() — includes: style block, nav-specific CSS, nav HTML (verbatim),
  │     example section, container wrapper detection
  ├── callGeminiAPI(prompt)  ← AI generates page; copies nav exactly (link added separately)
  ├── writePageToLocalFile(filename, html)
  ├── Register in pagesInventory → savePagesInventory()
  ├── addLinkToNav(currentNav, navLabel, href)  ← programmatic nav update
  ├── activateNav()
  └── lastSyncedSharedSnapshot = '' → syncSharedToOtherPagesIfChanged()  ← distributes nav link + shared head to all pages (incl. new file)

deletePageFromSite(page)
  ├── removePageFromNav(navEl, filename)  ← strip nav links to the deleted page
  ├── pagesInventory.pages.filter(...)   ← remove from inventory + savePagesInventory()
  ├── dirHandle.removeEntry(filename)    ← delete local file
  └── lastSyncedSharedSnapshot = '' → syncSharedToOtherPagesIfChanged()  ← sync cleaned nav to all pages
```

### 13. AI Section Generator

Generates a new themed section and injects it at the chosen position.

```
promptAddSection(insertAfterZone)
  └── Modal → on submit → snapshotForUndo() → generateSection(description, insertAfterZone)

generateSection(description, insertAfterZone)
  ├── buildSectionPrompt() — sends: style block + example zone HTML
  ├── callGeminiAPI(prompt)
  ├── parseSectionResponse() — <section-css> + <section-html>
  ├── Upsert <style id="__webby-section-{slug}-styles"> for CSS
  └── injectNewSection(section, insertAfterZone) → activateZone(section)
```

### 14. Serializer / Exporter

Produces clean HTML from the current DOM state.

```
serialize({ local: false })   ← for publish/export
serialize({ local: true })    ← for local file save

Both modes:
  ├── Clone document.documentElement
  ├── Remove all [data-editor-ui] elements (toolbar, modals, add/delete/reformat buttons)
  ├── Remove contenteditable + spellcheck attributes
  ├── Remove data-webby-bound and data-webby-nav-bound attributes
  ├── Resolve img[data-webby-src]: replace blob URL src with stored relative path
  └── Restore original body padding-top and nav top offset

local: false only:
  └── Remove <script src="./secrets.js"> and <script src="...webby.js"> tags

exportToFile()
  └── serialize({ local: false }) → trigger download as current page filename
```

The serializer is idempotent — running it multiple times on the same DOM produces the same output.

### 15. GitHub Publisher

Pushes all pages and the pages inventory to GitHub via the REST API.

```
publishSite()
  ├── 1. Current page: serialize({ local: false }) → github.putFile(CURRENT_FILENAME, html, sha)
  ├── 2. All other pages (if dirHandle + pagesInventory):
  │     For each page: read from disk → DOMParser → strip editor scripts
  │         → github.putFile(page.file, stripped, sha)
  └── 3. Inventory: github.putFile('webby-pages.json', JSON, sha)

github.getFileSHA(path)
  └── GET /repos/{repo}/contents/{path}?ref={branch} → return .sha (null if 404)

github.putFile(path, content, sha)
  └── PUT /repos/{repo}/contents/{path}
        body: { message, content: btoa(unescape(encodeURIComponent(content))), sha, branch }

github.uploadFile(path, base64Content)
  └── getFileSHA(path) → putFile with pre-encoded binary content (for images)
```

SHA conflicts (HTTP 409) are silently swallowed for the current page; other pages with errors are reported in the status message.

### 16. Undo / Redo

Snapshot-based undo for structural operations. Text edits within `contenteditable` use the browser's native undo (Ctrl+Z). Capped at 20 entries.

```
snapshotForUndo()  ← called before: section delete, section reformat, nav reformat,
                      generate section, generate page, delete page
  └── captureSnapshot() → undoStack.push(); redoStack = []; updateUndoRedoButtons()

captureSnapshot()
  ├── Clone body — strip [data-editor-ui], contenteditable, spellcheck, binding attrs
  ├── Capture main <style> textContent
  ├── Capture all <style id="__webby-section-*"> elements
  └── Capture <style id="__webby-nav-styles"> if present

restoreSnapshot(snapshot)
  ├── Disconnect mutation observer
  ├── closeLinkPopover() + hideSelectionToolbar()
  ├── Save [data-editor-ui] child elements from body
  ├── document.body.innerHTML = snapshot.bodyHTML
  ├── Re-attach saved editor UI elements
  ├── Restore main style block + all section/nav style blocks
  ├── activateZones() + activateNav()
  ├── rerunInlineScripts(nav)   ← rebinds hamburger toggle after DOM replacement
  ├── bindMutationObserver()    ← restart observer (was disconnected)
  └── lastSyncedSharedSnapshot = getSharedSnapshot()

undo()  → redoStack.push(captureSnapshot()) → restoreSnapshot(undoStack.pop())
redo()  → undoStack.push(captureSnapshot()) → restoreSnapshot(redoStack.pop())

bindUndoRedo()
  └── Ctrl+Z → undo(); Ctrl+Shift+Z / Ctrl+Y → redo()
      (skips when e.target.isContentEditable — browser handles text undo there)
```

### 17. Theme Editor

Panel that exposes CSS custom properties and site identity fields as live inputs.

```
openThemeEditor()  ← toggled by Theme toolbar button; mutually exclusive with Pages panel
  ├── Site Identity section:
  │     ├── Favicon picker → convertImageToPng() → github.uploadFile() + local write → upsertFaviconLinks()
  │     │     (sync then propagates <link rel="icon"> + apple-touch-icon to all pages)
  │     ├── Page title input → document.title + <title>  ← page-specific, not synced
  │     ├── Meta description textarea → <meta name="description">  ← page-specific
  │     └── Keywords input → <meta name="keywords">  ← page-specific
  └── CSS Variables section (grouped: Colors / Typography / Spacing / Layout):
        ├── Color variables → color picker + hex input
        ├── Font-family variables → text input + "Aa" toggle button → makeGoogleFontPicker()
        │     └── Pick applies value + ensureGoogleFontLink(font)
        ├── Other variables → text input
        ├── "Add font variable" inline form (Typography group only):
        │     ├── --font-{name} + value inputs
        │     ├── makeGoogleFontPicker() below the value input
        │     │     (pick fills value only — name is user-chosen so it describes the role, not the font; <link> injected on Add, not on preview)
        │     └── On Add: addStyleVar() + ensureGoogleFontLink(pickedFont)
        └── On input: document.documentElement.style.setProperty() + patch <style> textContent
              (main <style> mutations then propagate to every page via the shared sync)
```

### 18. Google Fonts

Full Google Fonts catalog, sorted by popularity. A small curated list is compiled into `webby.js` as a fallback; at runtime `loadGoogleFontsManifest()` fetches the complete catalog from `google-fonts.json` (sibling of `webby.js`, generated via `make fonts`) and replaces the in-memory `GOOGLE_FONTS`. Entries are shaped `{ name, cat, weights }`; array order is popularity rank.

```
loadGoogleFontsManifest()   ← called at the top of init()
  ├── Fast path: read cached manifest from localStorage (key 'webby:fonts-manifest:v1')
  │     install synchronously if present
  └── Background fetch: {SCRIPT_BASE_URL}google-fonts.json → installFontsManifest()
        → write to localStorage on success. Failures are silent; curated fallback remains.

ensureGoogleFontLink(font)
  ├── Upsert <link rel="preconnect" href="https://fonts.googleapis.com">
  ├── Upsert <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  └── Append <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={name}:wght@{weights}&display=swap">
      (idempotent — skips insertion if a <link> for the family is already present)

openFontPreviewer(onPick)   ← modal, replaces the old inline picker
  ├── Header + close button
  ├── Sample text input (default "The quick brown fox…"; persisted in localStorage key
  │       'webby:font-preview-sample'; live-updates only rows whose font has finished
  │       loading — unloaded rows keep their "…" placeholder until ready)
  ├── Category pills: All / Sans Serif / Serif / Display / Handwriting / Monospace
  ├── Search box (filters by name) + sort toggle (Popularity / A–Z)
  └── Scrolling list of all GOOGLE_FONTS rows.
      ├── Rows for fonts not yet in previewLoadedFonts render in T.fontBody with a
      │     "…" placeholder so the whole list paints immediately (no layout thrash,
      │     no scroll stalls). onPreviewFontReady(name, cb) flips the row to the
      │     real family + current sample text when the FontFace registers.
      ├── IntersectionObserver (root=list, rootMargin=240px) collects visible
      │     fonts into a pending set and flushes them via queuePreviewFontLoad(
      │     font, priority=true) after a 500ms debounce — a fast scroll past many
      │     rows doesn't blast the rate-limiter with requests for fonts the user
      │     already scrolled past.
      └── Row click → onPick(font, fontFamilyStack(font)); caller commits the <link>
            via ensureGoogleFontLink(). The previewer itself never calls it, so
            cancelled / aborted previews don't leak links into <head>.

prewarmFontPreview()   ← called by openThemeEditor()
  └── Enqueues every GOOGLE_FONTS family in popularity (array) order so that by
      the time the user opens the picker, most popular families are already
      rendered. Safe to call repeatedly; the dedup sets make re-calls a no-op.

queuePreviewFontLoad(font, priority)  /  drainPreviewLoadQueue()  /  loadPreviewFont(font)
  ├── previewLoadedFonts:   Set<string>  ← names whose FontFaces are in document.fonts
  ├── previewLoadingFonts:  Set<string>  ← names currently fetching / loading
  ├── previewFailedFonts:   Set<string>  ← names that failed (no retry)
  ├── previewQueuedFonts:   Set<string>  ← names currently in the queue
  ├── previewLoadQueue:     font[]       ← FIFO; priority:true enqueues at head
  ├── previewLoadCallbacks: Map<name, fn[]>  ← row-flip callbacks, fired on load
  └── Drain tick kicks off PREVIEW_LOAD_BATCH (4) loadPreviewFont() calls every
      PREVIEW_LOAD_INTERVAL_MS (250ms) ≈ 16 fonts/sec. Each loadPreviewFont:
        fetch CSS2 URL → regex-parse @font-face blocks for src/weight/style →
        new FontFace() per variant → Promise.all(face.load() + document.fonts.add())
        → firePreviewReady(name) drains onPreviewFontReady callbacks.
      Rate limiting + FontFace API (vs. the old @import-into-<style> approach)
      is what keeps the toolbar/title from throbbing and the scroll from stalling
      under load: fonts register directly into document.fonts without mutating
      the DOM, so only the rows that actually use each family re-cascade.

  No preview state ever reaches disk or deployed output — FontFace registrations
  are runtime-only (not captured by serializer or snapshots), and the picker
  does not inject any <link> tags.

pruneUnusedGoogleFontLinks()   ← called at the top of saveChanges() on every auto-save
  ├── extractReferencedFontNames(getAllManagedCSS())  ← scans main <style>, nav style,
  │       and per-section styles for font-family: and --font-* declarations
  └── For each <link href*="fonts.googleapis.com/css">: if its family is not referenced,
      remove it. When the last stylesheet is removed, the preconnects are also cleared.
```

The shared-head sync treats every `<link href*="fonts.googleapis.com">` and `<link href*="fonts.gstatic.com">` as site-wide — adding a font on any page distributes it to all other pages on the next auto-save. Because prune runs before the snapshot, abandoned font `<link>`s are also distributed — i.e. *removed* from every page — on the next sync.

### 19. DOM Helpers

```
rerunInlineScripts(el)
  └── For each inline <script> in el: replace with a fresh <script> element to force execution.
      Used after nav replacement (reformatNav, restoreSnapshot) to rebind hamburger listeners.
      Scripts parsed via innerHTML/replaceWith are inert — the browser does not run them.
```

---

## CSS Variable System

The base `<style>` block in each page must define CSS custom properties so AI-generated sections and pages can use them consistently.

**Required variables (minimum set):**

```css
:root {
  --color-primary:    #...;
  --color-secondary:  #...;
  --color-accent:     #...;
  --color-bg:         #...;
  --color-bg-alt:     #...;
  --color-text:       #...;
  --color-text-muted: #...;

  --font-heading: 'Font Name', sans-serif;
  --font-body:    'Font Name', sans-serif;
  --font-size-base: 1rem;
  --line-height-base: 1.6;

  --space-xs:  0.25rem;
  --space-sm:  0.5rem;
  --space-md:  1rem;
  --space-lg:  2rem;
  --space-xl:  4rem;

  --container-width: 1100px;
  --radius:          0.375rem;
  --shadow:          0 2px 12px rgba(0,0,0,0.08);
}
```

Additional style blocks used by Webby at runtime:
- `<style id="__webby-nav-styles">` — nav-specific CSS written by Reformat Nav
- `<style id="__webby-section-{slug}-styles">` — per-section CSS written by section Reformat / Add Section

---

## Secrets & Security Notes

- `secrets.js` lives only on the local machine — the site folder is not a git repo and `secrets.js` is never committed or transmitted anywhere except directly to the GitHub and Google APIs
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read+write` only
- The Gemini API key is used **client-side** — acceptable for personal/single-owner use; for shared or public use, proxy through a serverless function
- The exported/published HTML contains **no credentials** and **no editor code**

---

## Browser Compatibility

Webby requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API).

| Browser | Supported |
|---|---|
| Chrome 86+ | ✓ |
| Edge 86+ | ✓ |
| Safari | ✗ |
| Firefox | ✗ |

Opening a page in an unsupported browser shows a blocking modal and prevents the editor from loading entirely.

---

## Non-Goals (explicitly out of scope)

- Multi-user editing or auth
- Version history UI (git history serves this purpose)
- Any server-side component
