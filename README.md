# GitQi

A zero-dependency, browser-based inline editing system for static websites.

The site owner opens their HTML files locally, edits content in-place, and publishes directly to GitHub Pages — no terminal, no CMS, no backend required.

Check it out at: [gitqi.swill.io](https://gitqi.swill.io)

---

## How it works

GitQi has two modes:

- **Edit mode** — activated automatically when `secrets.js` is present alongside the HTML files. The editor toolbar, editable zones, and AI tools all activate.
- **Public mode** — the deployed site. No editor code, no credentials, no overhead. `gitqi.js` and `secrets.js` are stripped from the published output.

The content "database" is the HTML file itself. The site owner edits text by clicking and typing directly on the page, replaces images by clicking them, and uses the AI assistant to generate new sections or entire new pages — all without touching code.

---

## Quick start (for site owners)

### 1. Generate your initial HTML

Use the [Bootstrap Prompt](./BOOTSTRAP_PROMPT.md) with Claude.ai (attach 2–5 inspiration images and fill in the bracketed fields). Choose **Single-page** for a simple one-page site or **Multi-page** for a site with separate pages per topic.

Save the output HTML file(s) to a folder on your computer. Create an `assets/` subfolder in the same location for images.

### 2. Create a GitHub repository and enable GitHub Pages

1. Create a new **public** repository on GitHub (e.g. `jane/jane-osteopathy`)
2. Make an initial commit to establish a `main` branch
3. Go to **Settings → Pages**
4. Under *Source*, select **Deploy from a branch**
5. Set branch to `main`, folder to `/ (root)`, and click **Save**

GitHub Pages will serve files directly from the root of your `main` branch. Every time GitQi publishes, the live site updates automatically. No workflow files or GitHub Actions needed.

### 3. Add `secrets.js` to the same folder as your HTML files

```js
window.SITE_SECRETS = {
  geminiKey:   "AIza...",              // Google AI Studio API key (for AI features)
  githubToken: "ghp_...",             // GitHub fine-grained PAT (contents: read + write)
  repo:        "jane/jane-osteopathy",
  branch:      "main"
};
```

Get your free Gemini API key at [aistudio.google.com](https://aistudio.google.com) — no billing required.

> **This file stays on your computer only.** GitQi publishes by pushing files directly to GitHub via the API — `secrets.js` is never sent anywhere except directly to the GitHub and Google APIs.

### 4. Open your HTML file in your browser

> **Use Chrome or Edge.** These are the only browsers that fully support the File System Access API, which lets GitQi save your edits directly back to your files on disk. Safari and Firefox are not supported.

The editor activates automatically. You'll see a dark toolbar at the top of the page.

### 5. Link your site folder

A banner will appear below the toolbar on first open. Click **Select Folder** and choose the folder containing your HTML files. The path is shown in the banner as a hint.

Once linked, every edit auto-saves to your local files within 1.5 seconds — so changes are never lost on reload or restart. For multi-page sites, changes to shared elements (nav, theme styles, fonts, favicon) are automatically synced across all pages. The folder stays linked across sessions (one browser permission prompt per session).

### 6. Edit your content

**Text**
Click any text and type directly on the page.

**Text formatting**
Select any text inside an editable element to reveal a floating toolbar with **Bold**, *Italic*, `Code`, and Link buttons.

**Links**
Click any link (including nav links) to open the link editor popover. Fields: display text, URL, open-in-new-tab. Use the page/section picker dropdown to jump to any page or anchor on your site. A **Go to link →** button lets you preview the destination.

**Images**
Click any image to replace it. The new image saves to your local `assets/` folder and uploads to GitHub automatically.

**Sections**
- Hover between sections and click **+ Add Section** to generate a new themed section with AI
- Hover any section and click **⟳ Reformat** to change its layout or structure with AI, preserving existing content
- Hover any section and click **✕ Delete Section** to remove it

**Navigation**
Hover the nav bar and click **⟳ Reformat Nav** to restructure it with AI. The updated nav syncs to all other pages automatically.

**Pages** *(multi-page sites)*
Click **Pages** in the toolbar to open the pages panel. From there you can navigate between pages, add new AI-generated pages, or delete pages. New page links are automatically added to the nav and synced across all pages.

**Theme**
Click **Theme** to adjust colours, fonts, spacing, favicon, page title, and meta description. All changes are live. For multi-page sites, colours/fonts/spacing/favicon are synced to every page automatically; page title, description, and keywords stay page-specific.

**Google Fonts**
In the Typography group, click **＋ Add font variable** and then **Browse Google Fonts…** to open a modal previewer covering the full Google Fonts catalog (~1,900 families). Existing font-family variables show an **Aa** button that opens the same previewer. Each row renders your sample text in-font; filter by category, search by name, and sort by popularity or A–Z. Fonts in the previewer load lazily as rows scroll into view and never touch your page's `<head>`. Picking a font applies it to the theme and injects the `<link>` for that family only (which then syncs to all other pages). When you swap a variable to a different font, the `<link>` for the previous font is removed on the next auto-save so abandoned fonts never accumulate.

**Undo / Redo**
The **↩** and **↪** buttons in the toolbar undo and redo structural changes (AI actions, section/page deletions). Keyboard shortcuts: `Ctrl+Z` / `Ctrl+Shift+Z`. Text edits use the browser's native undo.

### 7. Publish

Click **Publish** in the toolbar. GitQi uses the GitHub API to push all pages and the `gitqi-pages.json` inventory directly to your repository — no git, no terminal. GitHub Pages serves the updated site within ~60 seconds.

> **How it works:** GitQi serializes each page (stripping all editor UI and credentials), then calls the GitHub Contents API to write the files. Images are committed to `assets/` in your repo. The `gitqi-pages.json` manifest is pushed alongside the HTML files.

---

## Custom domain (optional)

By default your site is served at `https://username.github.io/repo-name`. To use your own domain (e.g. `www.janeosteopathy.com`), follow the steps below.

### Option A — Subdomain (www or any prefix) — CNAME record

1. In your DNS provider, add a **CNAME** record:
   | Name | Type | Value |
   |---|---|---|
   | `www` | CNAME | `username.github.io` |
2. In your GitHub repo, go to **Settings → Pages → Custom domain**, enter `www.example.com`, and click **Save**. GitHub will create a `CNAME` file automatically.
3. Check **Enforce HTTPS** once the certificate is provisioned (usually a few minutes).

> **Important:** GitQi publishes by overwriting HTML files only — it does not touch the `CNAME` file. Your custom domain stays configured across all publishes.

### Option B — Apex domain (no www) — A records

1. In your DNS provider, add four **A** records:
   | Name | Type | Value |
   |---|---|---|
   | `@` | A | `185.199.108.153` |
   | `@` | A | `185.199.109.153` |
   | `@` | A | `185.199.110.153` |
   | `@` | A | `185.199.111.153` |
2. Optionally add a CNAME for `www` → `username.github.io` so both work.
3. In your GitHub repo, go to **Settings → Pages → Custom domain**, enter `example.com`, and click **Save**.
4. Check **Enforce HTTPS** once the certificate is provisioned.

> DNS changes can take up to 48 hours to propagate. GitHub will warn you if the domain isn't verified yet — wait a few minutes and refresh.

---

## HTML data attributes

GitQi uses data attributes to identify editable regions. These must be present in the generated HTML.

| Attribute | Applied to | Purpose |
|---|---|---|
| `data-zone` | `<section>` | Marks a top-level editable section. Value is a slug, e.g. `"hero"`. Also used as the element `id` for anchor links. |
| `data-zone-label` | `<section>` | Human-readable label shown in the delete confirmation, e.g. `"Hero"`. |
| `data-editable` | Any text element | Makes the element directly editable via `contenteditable`. |
| `data-editable-image` | `<img>` | Makes the image replaceable by clicking. |

**Minimal example:**

```html
<section data-zone="about" data-zone-label="About">
  <h2 data-editable>About Me</h2>
  <p data-editable>Replace this with your own text.</p>
  <img src="./assets/placeholder.jpg" data-editable-image alt="Profile photo" />
</section>
```

---

## Script tags

Two script tags must appear in `<head>` (after the `<style>` block) for edit mode to work locally. They are stripped automatically on export/publish — the deployed site contains neither.

```html
<script src="./secrets.js"></script>
<script src="https://swill.github.io/gitqi/gitqi.js"></script>
```

---

## Multi-page sites

Multi-page sites use a `gitqi-pages.json` manifest in the site folder alongside the HTML files:

```json
{
  "pages": [
    { "file": "index.html",    "title": "Home — My Site",    "navLabel": "Home" },
    { "file": "about.html",    "title": "About — My Site",   "navLabel": "About" },
    { "file": "services.html", "title": "Services — My Site","navLabel": "Services" }
  ]
}
```

GitQi creates and maintains this file automatically. It is pushed to GitHub on every publish. If you add GitQi to an existing single-page site, the manifest is created automatically the first time you link your folder.

**Shared head + nav sync** — on every auto-save, GitQi compares the current page's shared elements against a snapshot from the last sync. If anything changed, the updated elements are written to every other page file on disk automatically.

Synced site-wide:
- `<nav>` (including nav-specific CSS in `<style id="__gitqi-nav-styles">`)
- Main `<style>` block (CSS variables + base styles edited via the Theme panel)
- `<link rel="icon">` and `<link rel="apple-touch-icon">` (favicon)
- Google Fonts `<link>`s (plus their preconnect links)

When the nav is synced, the "current page" highlight is re-targeted for each destination: the link matching that page gets the active marker, and every other link is cleared. Recognised markers are the `aria-current` attribute and the CSS classes `active`, `current`, `is-active`, `is-current`, and `selected`.

Left page-specific: `<title>`, `<meta name="description">`, `<meta name="keywords">`.

---

## Hosting gitqi.js

`gitqi.js` is served from its own GitHub Pages repo (this one) so that multiple sites can share a single hosted copy.

**Latest version** (always up to date):
```
https://swill.github.io/gitqi/gitqi.js
```

**Pinned version** (recommended for production — immune to breaking changes):
```
https://swill.github.io/gitqi/gitqi-1.2.0.js
```

Pinned versioned files are committed alongside `gitqi.js` on each release and are never modified after publishing.

> **One-time setup:** Go to **Settings → Pages → Source → Deploy from a branch**, set branch to `main`, folder to `/ (root)`, and save. After that, `make release` keeps the live files up to date automatically.

---

## Versioning

Versions follow [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.x) — bug fixes, safe to update
- **Minor** (1.x.0) — new features, backwards compatible
- **Major** (x.0.0) — breaking changes; pinned sites are unaffected

The version is accessible at runtime:

```js
console.log(window.GitQi.version);
```

---

## Development

```bash
# Local development server (http://localhost:8080)
make serve

# Check JavaScript syntax
make check

# Release a new version and publish to GitHub Pages
make release VERSION=1.2.0

# Regenerate the Google Fonts manifest (google-fonts.json)
make fonts
```

See the [Makefile](./Makefile) for full details on what each target does.

### Google Fonts manifest

GitQi ships a full Google Fonts catalog (`google-fonts.json`, served alongside `gitqi.js`) so the font picker covers the entire library, not just a curated subset. The manifest is regenerated manually via `make fonts`. At runtime `gitqi.js` fetches it, caches it in `localStorage`, and falls back to a small built-in list if the fetch fails.

**One-time setup** — needed only if you want to regenerate the manifest yourself:

1. Get a free Google Fonts Developer API key:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/)
   - Create (or pick) a project
   - Enable the **Web Fonts Developer API** under *APIs & Services → Library*
   - Create a key under *APIs & Services → Credentials → Create Credentials → API key*
   - Restrict it (recommended): under *API restrictions* pick *Web Fonts Developer API* only
2. Copy the example file and drop your key in:
   ```bash
   cp .env.example .env
   # then edit .env and set GOOGLE_FONTS_API_KEY=<your-key>
   ```
   `.env` is gitignored — the key never lands in the repo.
3. Generate the manifest:
   ```bash
   make fonts
   ```
   This fetches the catalog from the Developer API, sorted by popularity, and writes `google-fonts.json` at the repo root — each entry is `{ name, cat, weights }`. Array order is the popularity ranking. Commit the file and it deploys alongside `gitqi.js` on the next release.

---

## Security notes

- `secrets.js` lives only on your computer and is never published — your local folder is not a git repository
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read + write` only
- The Gemini API key is used client-side — acceptable for personal/single-owner use; for shared use, proxy through a serverless function
- The exported and published HTML contains **no credentials** and **no editor code**
