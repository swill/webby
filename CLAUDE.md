# GitQi - Site Editor — Project Architecture

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
├── gitqi-pages.json    ← Page inventory, auto-managed by GitQi
├── secrets.js          ← Never published. Sets window.SITE_SECRETS
└── assets/
    └── *.jpg / *.png
```

This folder is **not** a git repository. GitQi publishes HTML files and uploads images directly to GitHub via the REST API. `secrets.js` never leaves the local machine.

### Remote GitHub repository

```
username/repo-name  (GitHub)
├── index.html
├── about.html
├── gitqi-pages.json
└── assets/
    └── *.jpg / *.png
```

GitHub Pages is configured to serve from the root of the `main` branch ("Deploy from branch → main → / (root)"). Any push — including GitQi's API commits — updates the live site automatically. No GitHub Actions workflow is required.

---

## The Editor Script (`gitqi.js`)

Single self-invoking IIFE, hosted externally on GitHub Pages. Included in each HTML page only during local editing — stripped from the published output.

### Required Globals (set by `secrets.js`)

```js
window.SITE_SECRETS = {
  geminiKey:   "AIza...",   // Google AI Studio API key — free at aistudio.google.com
  githubToken: "ghp_...",   // Fine-grained PAT: contents read+write on the site repo
  repo:        "user/repo", // e.g. "jane/jane-osteopathy"
  branch:      "main"       // Deployment branch
};
```

### Initialization

`init()` runs once at DOMContentLoaded:

1. `loadGoogleFontsManifest()` — install cached manifest synchronously; background-fetch fresh
2. `injectToolbar()` → `migrateLegacyWebbyMarkers()` → `activateZones()` → `activateNav()`
3. Bind: mutation observer, link handlers, selection toolbar, undo/redo
4. `initFileAccess()` — re-link the site folder if a handle is in IndexedDB; otherwise show the folder-picker banner
5. `lastSyncedSharedSnapshot = getSharedSnapshot()` — baseline so the first auto-save doesn't spuriously sync

### Key Constants

```js
const CURRENT_FILENAME = location.pathname.split('/').pop() || 'index.html';
const HANDLE_KEY = 'dir:' + location.href.substring(0, location.href.lastIndexOf('/') + 1);
// Keyed by site directory (not page path) so all pages in the same folder share one handle
```

---

## Core Modules

### 1. Zone Manager

Identifies and activates editable regions.

**Data attributes:**

| Attribute | Purpose |
|---|---|
| `data-zone` | Marks a top-level editable section (e.g. `"hero"`, `"about"`). Also set as the element `id` for anchor links. |
| `data-zone-label` | Human-readable label shown in the delete confirmation |
| `data-editable` | Text node is directly editable via `contenteditable` |
| `data-editable-image` | Image can be replaced by clicking |
| `data-editable-video` | `<div>` wrapper around a YouTube `<iframe>` — clicking opens a URL popover that swaps the video |

`activateZones()` queries `[data-zone]`, calls `activateZone(section)` for each, then injects "+ Add Section" buttons between zones. `activateZone` makes `[data-editable]` children contenteditable, binds image and video handlers, sets the section's `id` from its `data-zone` slug, and injects the section controls (see below).

**Section controls** — hover-revealed buttons added by `activateZone`:

- Right side, in a single right-aligned flex container (`getOrCreateRightControls(section)` for consistent spacing): **⧉ Duplicate**, **⟳ Reformat**, **✕ Delete**.
- Left side, in their own flex container: **↑ / ↓** move arrows (with a 1px `T.accent4` border so they stand out on dark backgrounds).
- The footer (whatever `getFooterElement()` matches) is suppressed from Duplicate and the move arrows — it's pinned at the bottom and is replicated across pages by the shared sync, so duplicating or moving it would produce broken state. Reformat and Delete still apply.

**Duplicate** (`duplicateSection`): clones the section, generates a unique zone slug via `generateUniqueZoneSlug` (suffix `-2`, `-3`, … starting from the base or incrementing if already suffixed), drops descendant `id` attributes to avoid collisions, clears runtime markers (`data-editor-ui`, `data-gitqi-bound`, `data-gitqi-video-bound`, `contenteditable`, `spellcheck`), and clones the per-section style block under the new id. CSS is rewritten textually via `rewriteSectionCssSlug` for `[data-zone="…"]` and `#…` references — fragile by design (regex-on-CSS doesn't understand `:where()`, attribute-substring matchers, or class names that happen to embed the slug). When something subtle breaks, a Reformat on the new section fixes it.

**Move** (`moveSection`): reorders within sibling `[data-zone]` elements, with the footer pinned in place. Captures undo, scrolls the moved section into view (`block: 'nearest'`), and calls `refreshAddButtons()` to keep "+ Add Section" markers consistent.

### 2. Toolbar

Fixed-position bar prepended to the page in edit mode. Marked `data-editor-ui` so it's stripped on export/publish.

Left → right: site title with `●` dirty indicator, status message area, **↩ Undo**, **↪ Redo**, **Pages**, **Theme**, **Export** (download clean HTML for the current page), **Publish** (commit all pages + `gitqi-pages.json` to GitHub).

`injectToolbar()` shifts `body { padding-top }` and any fixed `<nav>`'s `top` down by 44px to make room. `setDirty(bool)` toggles the indicator and schedules a debounced auto-save (1500ms).

### 3. File Persistence

Keeps HTML files on disk in sync with the live DOM via the File System Access API. Chrome / Edge only — other browsers see a blocking modal.

- `initFileAccess()`: load `FileSystemDirectoryHandle` from IndexedDB (with v1.0.x per-page → per-directory key migration), verify permission, silently re-link or show the folder banner.
- `saveChanges()` (auto-save): `writeCurrentPageToLocalFile()` then `syncSharedToOtherPagesIfChanged()`.
- `serialize({ local: true })` keeps the `secrets.js` and `gitqi.js` script tags so edit mode activates on next open. `local: false` strips them for published output.
- Image upload: `writeImageToLocalDir(file)` writes to `assets/` and the serializer resolves any `data-gitqi-src` blob-URL placeholders back to relative paths on publish.

### 4. Pages Inventory

`gitqi-pages.json` alongside the HTML files:

```json
{ "pages": [{ "file": "index.html", "title": "Home", "navLabel": "Home" }, ...] }
```

Auto-created on first use. `loadPagesInventory()` reads it (seeding from the current page if missing) and ensures `CURRENT_FILENAME` is registered.

### 5. Shared Head + Nav Sync

On every auto-save, compares a JSON snapshot of the current page's shared head + nav against the last-synced snapshot. If anything changed, the updated elements are written into every other page file on disk. Triggered immediately (not via the auto-save timer) after Reformat Nav, Add Page, and Delete Page (those callers reset `lastSyncedSharedSnapshot = ''` and call the sync directly).

**Synced** (page-to-page, whole-site):
- `<nav>`
- `<footer>` (falling back to `[data-zone="footer"]`) — copied verbatim; no active-marker retargeting since footers don't typically have per-page "current" state. **A bare `<footer>` (no `data-zone`, no `data-editable`) gets synced too, but doesn't get the section controls** because those bind through `activateZone()` which only runs on `[data-zone]` elements.
- Main `<style>` (CSS variables + base styles, edited via the Theme panel)
- `<style id="__gitqi-nav-styles">` (nav-specific CSS)
- `<style id="__gitqi-section-{footerSlug}-styles">` — the footer's per-section style block, when the footer has `data-zone`
- `<link rel="icon">` and `<link rel="apple-touch-icon">` (favicon)
- Google Fonts `<link>`s matching `fonts.googleapis.com` or `fonts.gstatic.com` (including preconnects)

**NOT synced** (intentionally page-specific): `<title>`, `<meta name="description">`, `<meta name="keywords">`.

**Active-link retargeting** — the sync copies the source nav verbatim but rewrites the "current page" marker for each destination. Recognised markers (`ACTIVE_CLASS_CANDIDATES`): CSS classes `active`, `current`, `is-active`, `is-current`, `selected`, plus the `aria-current` attribute. `extractActiveMarker()` reads whichever are present on the source's anchor matching `CURRENT_FILENAME`; `retargetActiveMarker()` strips them all from the cloned nav and re-applies them to anchors whose `href` matches the destination page.

### 6. Mutation Observer

Subtree observer on `<body>` for `characterData` + `childList`. Mutations originating from `[data-editor-ui]` are ignored. Anything else triggers `setDirty(true)` → debounced auto-save. Disconnected and re-bound on undo/redo (and any other mass DOM replacement) to avoid spurious snapshots.

### 7. Image Manager

`bindImageHandler(img)` paints a translucent white haze sized to the image's bounding box (re-measured on `mouseenter` so it stays correct as responsive layouts flow) plus a "Click to replace image" hint pill. Clicking opens a hidden file input.

`handleImageUpload(file, imgEl)`:
- Read as ArrayBuffer → base64 → `github.uploadFile('assets/' + file.name)`
- If `dirHandle`: also `writeImageToLocalDir(file)`; set `imgEl.src = './assets/' + file.name`
- If no folder access: display via `URL.createObjectURL(file)`; store `'./assets/' + file.name` in `data-gitqi-src` for the serializer to resolve at publish time

### 7a. Video Manager

YouTube embedding. No upload path — videos are external URLs. Users paste any common YouTube URL (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, or bare 11-char id) and `extractYouTubeId` normalises it to `/embed/ID`.

**Canonical markup** (what AI produces, what the editor binds to, what ships in published output) — a 16:9 responsive container (`padding-bottom:56.25%`) wrapping an `<iframe src="https://www.youtube.com/embed/{ID}">`. The wrapper `<div data-editable-video>` owns the click interaction because iframes swallow pointer events. The placeholder ID (`M7lc1UVf-VE`) is the YouTube Developers talk Google uses in the official IFrame Player API docs — guaranteed embeddable. The embed domain is `youtube.com` rather than `youtube-nocookie.com` because the latter shows an unfamiliar domain in the edit popover; in testing it didn't resolve YouTube's intermittent Error 153 anyway (which is usually environmental: ad/content blockers or network filtering).

**Flow:**
1. `activateZone` finds every `[data-editable-video]` wrapper and calls `bindVideoHandler(wrapper)` (idempotent via `data-gitqi-video-bound='1'`).
2. `bindVideoHandler` injects a transparent overlay (`data-editor-ui`, `inset:0`, `z-index:10`) over the iframe. Hover fades in a "Click to change video" pill. On `file://` it also shows a persistent "Preview only — video plays once published" pill, since YouTube blocks playback on `file://` origins with Error 153.
3. Overlay click → `openVideoPopover(wrapper, { x, y })`. The popover anchors at the click coordinates (via `positionPopoverAtPoint`) so it stays under the cursor regardless of how big the video is — anchoring to the wrapper itself would push the popover off-screen for fullscreen-width videos.
4. Apply parses the input via `extractYouTubeId`; valid URLs update `iframe.src` and mark dirty. Remove video calls `snapshotForUndo()` then deletes the wrapper.

**State markers:** `data-gitqi-video-bound='1'` (stripped by serializer + `captureSnapshot`); the overlay carries `data-editor-ui` (stripped the same way).

**AI prompts:** `buildSectionPrompt`, `buildReformatPrompt`, and `buildPagePrompt` all include the canonical wrapper as an explicit rule. `buildReformatPrompt` additionally instructs the model to preserve existing `[data-editable-video]` wrappers verbatim so reformatting doesn't corrupt the marker structure.

### 8. Selection Toolbar

Floating toolbar shown when there's a non-empty selection inside any `[data-editable]` element.

| Button | Action |
|---|---|
| **B** | `execCommand('bold')` → normalizes `<b>` → `<strong>` |
| *I* | `execCommand('italic')` → normalizes `<i>` → `<em>` |
| 🪣 | Color flyout — theme swatches + custom picker + "Remove color" (paint bucket SVG) |
| Aa | Font flyout — theme font vars + Google Fonts picker + "Clear font styling" |
| A↕ | Font-size flyout — em-based presets (Smaller 0.75 / Small 0.875 / **Normal** / Large 1.25 / Larger 1.5 / Huge 2). Relative `em` units so a bump inside a heading stays heading-scaled and a bump in body stays body-scaled. "Normal" strips the property instead of writing a redundant `font-size: 1em`. |
| `</>` | Wrap/unwrap selection in `<code>` |
| 🔗 | Wrap selection in `<a>` → open link popover |

**Sticky positioning** — once the toolbar is up, opening a flyout grows it downward. It does **not** re-pin to the selection (an earlier "smart" reposition yanked the row up and out from under the user's cursor mid-click). `clampSelectionToolbarInViewport()` only nudges the toolbar if growing it pushed it off-screen.

**Inline-style spans (color / font / font-size)** — every span the toolbar creates carries `data-gitqi-style`. `wrapSelectionInStyledSpan(prop, val)` calls `clearInlineStyleFromSelection(prop, { onlyIfFullyCovered: true })` first so repeated changes to the same property replace rather than nest. Scope is any inline-styled `<span>`, gitqi-owned or hand-authored — the **full-coverage guard** keeps it safe: a property is only stripped from a span if the selection covers ALL of that span's contents, so hand-authored markup that extends beyond the selection is never mutated. Explicit "Remove color" / "Clear font" / "Normal" drop the guard since the user is being explicit.

The `data-gitqi-style` marker is stripped in publish output (`serialize({local: false})`) but preserved in local saves and snapshots so it survives re-opens and undo/redo.

### 9. Link Editor

Intercepts clicks on `<a>` elements inside `[data-zone]` or `<nav>` in the capture phase and shows a popover.

**Popover fields:**
- **Display text** — updates `textContent` live
- **URL** — updates `href` live
- **Go to link →** — opens the URL in the same tab. Relabelled **Test email →** when the URL is `mailto:`.
- **Subject** + **Body** (mailto only) — collapsible block that appears whenever the URL starts with `mailto:`. `parseMailto(url)` reads existing `?subject=` / `?body=` into the inputs on open; editing either input rebuilds the URL via `buildMailto({address, subject, body})`. A `suppressUrlSync` flag breaks the URL→inputs→URL feedback loop.
- **Page/section picker** — dropdown grouped by page. Current page's zones from the DOM; other pages' zones loaded async from disk via `dirHandle`.
- **Open in new tab** — toggles `target="_blank"` + `rel="noopener noreferrer"`. Auto-checks for external `https?://` URLs unless the user has explicitly toggled it in the same session.
- **Remove link** — unwraps `<a>`, leaving plain text.

**Positioning** (`positionPopover` and `reclampPopoverAfterResize`) — measures the actual rendered popover size (the old guess-then-flip approach mis-flipped tall popovers when the guess was wrong), prefers the side with more room, and re-clamps when the popover resizes (e.g. mailto fields appearing/disappearing) without yanking it to a new anchor.

### 10. Section Reformat

`promptReformatSection(section)` — modal → on submit → `snapshotForUndo()` → `reformatSection()`:

- `buildReformatPrompt()` sends: main style block, section-specific CSS, clean section HTML, plus rules to preserve content + existing `[data-editable-video]` wrappers verbatim
- `callGeminiWithFallback(prompt, { model })` (see §13a)
- `parseSectionResponse()` expects `<section-css>…</section-css>` followed by `<section-html>…</section-html>`
- Upsert `<style id="__gitqi-section-{slug}-styles">` and replace the section, then `activateZone(newSection)`

### 11. Nav Editor

`activateNav()` injects the **⟳ Reformat Nav** hover button and marks the nav with `data-gitqi-nav-bound`.

`reformatNav(nav, description, { model })`:
- `buildReformatNavPrompt()` sends: style block, nav-specific CSS, nav HTML
- `parseNavResponse()` expects `<nav-html>…</nav-html>` and optionally `<nav-css>…</nav-css>` (AI omits the CSS for content-only changes like adding/removing a link)
- Replace the nav, `rerunInlineScripts(newNav)` to rebind hamburger toggles, `activateNav()`, then force-sync (`lastSyncedSharedSnapshot = ''` → `syncSharedToOtherPagesIfChanged()`)

`addLinkToNav(navEl, label, href)` — programmatic link insertion (used by the page generator). Strategy 1: find every `<ul>`/`<ol>` containing `<li><a>`, clone the last item per list, update text/href, append. Strategy 2 (fallback): bare `<a>` elements, clone the last and insert after.

**Hamburger script pattern** — nav inline scripts should bind to the `<nav>` element (not `document` or `window`) so listeners are cleaned up when the nav is replaced and re-bound when `rerunInlineScripts` re-executes them:

```js
(function() {
  const nav = document.currentScript.closest('nav');
  nav.addEventListener('click', function(e) {
    if (e.target.closest('.hamburger-class')) toggleNav();
  });
})();
```

### 12. Pages Manager

Multi-page management. Requires folder access (`dirHandle`).

- `openPagesPanel()` — toggled by the Pages toolbar button. Lists all pages from `pagesInventory`, with Open and ✕ Delete per page.
- `promptAddPage` / `generatePage(description, navLabel, filename, { model })`: snapshot, build prompt (style block, nav-specific CSS, nav HTML verbatim, example section), call AI, write to disk, register in inventory, `addLinkToNav` programmatically, `activateNav()`, force-sync to distribute the new link + shared head to all pages including the new file.
- `deletePageFromSite(page)`: `removePageFromNav` strips nav links pointing to the file, remove from inventory, `dirHandle.removeEntry(filename)`, force-sync to clean nav across all pages.

### 13. AI Section Generator

`promptAddSection(insertAfterZone)` → modal → snapshot → `generateSection`:
- `buildSectionPrompt()` sends: style block + example zone HTML
- `callGeminiWithFallback`, `parseSectionResponse`, upsert `<style id="__gitqi-section-{slug}-styles">`, inject the new section, `activateZone()`

### 13a. Gemini Model Fallback

All four AI flows (Add Section, Reformat Section, Reformat Nav, Add Page) route through `callGeminiWithFallback(prompt, opts)` which retries on a different Gemini model when the primary is overloaded (503) or rate-limited (429). Real users hit `gemini-2.5-flash` overload for extended periods and had no recourse without refreshing or switching keys.

**Model chain** (ordered, first is default):

```
gemini-2.5-flash    // default
gemini-2.5-pro      // slower but often available when Flash is saturated
gemini-2.0-flash
gemini-flash-latest
gemini-2.5-flash-lite
```

Each AI Studio model has its own RPM/RPD quota, so falling back on 429 also works — different model, different bucket.

**Retryable statuses** (`RETRYABLE_GEMINI_STATUS`): 429, 500, 503, 504. 4xx auth / bad-request errors break the loop early.

**Session stickiness** — `sessionPreferredModel` is set when a fallback succeeds, so subsequent calls start from the working model instead of re-hitting the known-busy primary.

**UX:**
- If `opts.model` is set, only that model is used (no fallback) — for explicit user override from the error UI.
- `onFallback(model, priorError)` fires the first time we move past the primary so callers can show a status message.
- On total failure, the error has `.tried = [{ model, status, message }]` and a summary distinguishing all-busy (503) vs. all-quota (429).
- `makeAIErrorArea()` returns a shared error block (`{ el, getModel, render, renderSimple, reset }`) used by all four AI dialogs. `render(err)` shows the message plus a model `<select>` (Auto + each model id); `getModel()` is read on retry; `renderSimple(text)` is used for non-AI errors with the picker hidden.

### 14. Serializer / Exporter

`serialize({ local })` clones `document.documentElement` and produces clean HTML. Idempotent.

Both modes:
- Remove all `[data-editor-ui]` (toolbar, modals, hover buttons, hint pills)
- Remove `contenteditable` and `spellcheck`
- Remove `data-gitqi-bound`, `data-gitqi-nav-bound`, `data-gitqi-video-bound`
- Resolve `img[data-gitqi-src]` (blob URL → stored relative path)
- Strip any inline `style` attribute on `<html>` (older versions wrote CSS vars there for live preview; would shadow `:root` updates)
- Restore the original `body { padding-top }` and any fixed-nav `top` offset that was shifted for the toolbar

`local: false` only:
- Strip `<script src="…secrets.js">` and `<script src="…gitqi.js">` (also legacy `webby.js`)
- Strip the `data-gitqi-style` marker from styled spans (the spans keep their inline styles)
- `obfuscateMailtoLinks(clone)` — see §14a

`exportToFile()` runs `serialize({ local: false })` and triggers a download.

### 14a. Email obfuscation (publish-time only)

Plain `mailto:` addresses in published HTML are easy targets for spam scrapers. `obfuscateMailtoLinks(root)` runs in the publish path only — edits stay readable in the editor.

For each `<a href="mailto:…">`:
- Encode the full mailto URL via `gqEncode` (`btoa(unescape(encodeURIComponent(reversed-string)))`) — base64 of the UTF-8 reversed string. Store in `data-gqe`. Set `href="javascript:void(0)"`.
- If any text node descendant of the link contains the address (case-insensitive substring), `obfuscateEmailInTextNodes` replaces the matching slice with an empty `<span data-gqt="…">` placeholder. Casing is preserved (the matched slice, not the lower-cased one, is what gets encoded) so `Foo@Bar.com` round-trips intact. Surrounding text in the same node is preserved as siblings.

A single inline decoder script is appended once per page (idempotent via `[data-gqe-decoder]`) at the end of `<body>`. It walks `[data-gqe]` to fix hrefs and `[data-gqt]` to fill in text, then removes both attributes so the page DOM ends up clean.

**No `<noscript>` fallback** — emitting the email there would defeat the protection. No-JS visitors don't get the email; that's the trade-off.

**Cross-document safety** — `obfuscateMailtoLinks` is also called on parsed-from-disk pages in `publishSite()`. Helpers use `node.ownerDocument.create…` (not the main `document`) so nodes are created in the correct doc.

### 15. GitHub Publisher

`publishSite()`:

1. Current page: `serialize({ local: false })` → `github.putFile(CURRENT_FILENAME, html, sha)`
2. All other pages (if `dirHandle` + `pagesInventory`): read each page from disk → `DOMParser` → `migrateLegacyWebbyMarkersInDoc(doc)` → strip editor scripts → strip `data-gitqi-style` markers → `obfuscateMailtoLinks(doc)` → `github.putFile`
3. `gitqi-pages.json`: `github.putFile`

The disk-loaded pages were last saved with `local: true`, so they still have plain mailto links and `data-gitqi-style` markers — both have to be cleaned per-page on the publish path because they didn't go through `serialize({ local: false })`.

`github.getFileSHA(path)` → GET `/repos/{repo}/contents/{path}?ref={branch}` → return `.sha` (null on 404). `github.putFile(path, content, sha)` → PUT same endpoint, body `{ message, content: btoa(unescape(encodeURIComponent(content))), sha, branch }`. SHA conflicts (HTTP 409) on the current page are silently swallowed; other pages with errors are surfaced in the status message.

### 16. Undo / Redo

Snapshot-based, capped at 20 entries. Text edits use the browser's native undo (handled inside `contenteditable`); structural changes capture a snapshot.

`snapshotForUndo()` is called before: section delete, section reformat, nav reformat, generate section, generate page, delete page, **duplicate section**, **move section**, remove video, and a few smaller edge cases.

`captureSnapshot()` clones `<body>`, strips `[data-editor-ui]` and binding markers, and stores `bodyHTML` plus the main style content, all `<style id="__gitqi-section-*">`, and `<style id="__gitqi-nav-styles">`.

`restoreSnapshot(snapshot)`: disconnect mutation observer → close popovers → save then re-attach `[data-editor-ui]` children → replace `body.innerHTML` → restore style blocks → `activateZones() + activateNav()` → `rerunInlineScripts(nav)` (rebinds hamburger toggles) → re-bind mutation observer → reset `lastSyncedSharedSnapshot`.

Keyboard: Ctrl+Z → undo; Ctrl+Shift+Z / Ctrl+Y → redo. Skipped when `e.target.isContentEditable`.

### 17. Theme Editor

Toggled by the **Theme** toolbar button, mutually exclusive with the Pages panel.

- **Site Identity** — favicon (PNG-converted, uploaded + written locally + favicon links upserted), page title, meta description, keywords. Title/description/keywords are page-specific (not synced); favicon syncs.
- **CSS Variables** — grouped Colors / Typography / Spacing / Layout. Live preview via `documentElement.style.setProperty()` plus patching the main `<style>` textContent (which then propagates to every page on the next sync).
- Color vars get a color picker + hex input. Font-family vars get a text input plus the **Aa** Google Fonts picker (`makeGoogleFontPicker`). The Typography group has an inline "Add font variable" form whose font picker fills the value only — the var name describes the role (e.g. `--font-display`), not the family — and the `<link>` is injected on Add, not on preview.

### 18. Google Fonts

Full Google Fonts catalog, sorted by popularity. A small curated list is compiled into `gitqi.js` as a fallback; at runtime `loadGoogleFontsManifest()` fetches the complete catalog from `google-fonts.json` (sibling of `gitqi.js`, generated via `make fonts`) and replaces the in-memory `GOOGLE_FONTS`. Entries: `{ name, cat, weights }`; array order is popularity rank.

Fast path reads a cached manifest from `localStorage` (`gitqi:fonts-manifest:v1`) and installs it synchronously; background fetch refreshes the cache. Failures are silent — the curated fallback remains.

`ensureGoogleFontLink(font)` upserts the two preconnect links and appends a `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={name}:wght@{weights}&display=swap">`. Idempotent — skips insertion if the family is already present.

**Font previewer** (`openFontPreviewer(onPick)`) — modal with sample-text input (persisted in `localStorage`), category pills, name search, and popularity / A–Z sort. Rows render immediately with a "…" placeholder; an `IntersectionObserver` (rootMargin 240px, 500ms debounce) collects visible fonts and feeds them into a rate-limited loader that registers FontFaces directly into `document.fonts` (no DOM `<style>` or `<link>` injection during preview). Loader runs `PREVIEW_LOAD_BATCH` (4) at `PREVIEW_LOAD_INTERVAL_MS` (250ms) ≈ 16 fonts/sec. The previewer never injects `<link>` tags itself — only the row click does (via `onPick` → caller → `ensureGoogleFontLink`), so cancelled previews don't leak.

`prewarmFontPreview()` (called by `openThemeEditor`) enqueues every family in popularity order so the picker opens with most popular families already rendered.

`pruneUnusedGoogleFontLinks()` runs at the top of every `saveChanges()`. It scans the main `<style>`, nav style, and per-section styles for `font-family:` and `--font-*` declarations; any `<link href*="fonts.googleapis.com/css">` whose family isn't referenced is removed (preconnects too when the last stylesheet goes). The shared-head sync then propagates the cleanup to every other page.

### 19. DOM Helpers

`rerunInlineScripts(el)` — replaces every inline `<script>` with a fresh element to force execution. Scripts parsed via `innerHTML`/`replaceWith` are inert; the browser does not run them. Used after nav replacement (`reformatNav`, `restoreSnapshot`) to rebind hamburger listeners.

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

**GitQi-managed style blocks:**
- `<style id="__gitqi-nav-styles">` — nav-specific CSS written by Reformat Nav
- `<style id="__gitqi-section-{slug}-styles">` — per-section CSS written by section Reformat / Add Section. Duplicate clones the block under the new slug with regex slug rewrites.

---

## Secrets & Security Notes

- `secrets.js` lives only on the local machine — the site folder is not a git repo and `secrets.js` is never committed or transmitted anywhere except directly to the GitHub and Google APIs
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read+write` only
- The Gemini API key is used **client-side** — acceptable for personal/single-owner use; for shared or public use, proxy through a serverless function
- The exported/published HTML contains **no credentials** and **no editor code**
- `mailto:` links are obfuscated in published output (see §14a). Plain emails authored as ordinary text outside `<a href="mailto:…">` are not protected — that's the user's call.

---

## Browser Compatibility

GitQi requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API).

| Browser | Edit mode | Public site |
|---|---|---|
| Chrome 86+ | ✓ | ✓ |
| Edge 86+ | ✓ | ✓ |
| Safari | ✗ | ✓ |
| Firefox | ✗ | ✓ |

Opening a page in an unsupported browser shows a blocking modal and prevents the editor from loading entirely. The published site is plain HTML and works everywhere.

---

## Non-Goals (explicitly out of scope)

- Multi-user editing or auth
- Version history UI (git history serves this purpose)
- Any server-side component
