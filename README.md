# GitQi 气

**Get the key to your own website.**

A zero-dependency, browser-based inline editor for static HTML. Click any text, swap any image, reformat a section with AI, and publish straight to GitHub Pages — no terminal, no CMS, no subscription.

- Site: [gitqi.com](https://gitqi.com)
- License: MIT — free, forever

---

## Why

Most website tools rent you an experience. GitQi gives you back the page.

- **Your HTML is the database.** The file you see in the browser is the file on disk, is the file on GitHub. There is no backing store, no CMS schema, no headless API — you can grep it, diff it, or walk away with it at any time.
- **Local-first, by design.** Your credentials live in one file on your machine and never leave it. No servers, no accounts, no "forgot your password" flow because there is no password.
- **Right to Repair your website.** Open the source, read every line, fork it, self-host it. MIT licensed, no closed core, no paid tier.

GitQi has two modes:

- **Edit mode** — activated when `secrets.js` is present beside your HTML. The toolbar, editable zones, link popover, and AI tools all light up.
- **Public mode** — the deployed site. `gitqi.js` and `secrets.js` are stripped from the published HTML automatically. Visitors see static HTML; no editor code, no credentials, no runtime overhead.

---

## Two paths

- **🔑 Get Key** — first-time setup for site owners. About 30 minutes the first time, one click forever after. Summarised below; walked through with screenshots at [gitqi.com/get-key.html](https://gitqi.com/get-key.html).
- **气 Git Qi** — the advanced path. How GitQi works under the hood, how to pin or self-host `gitqi.js`, how to fork and release. Covered in [Advanced](#气-the-git-qi-path--advanced) and at [gitqi.com/git-qi.html](https://gitqi.com/git-qi.html).

---

## 🔑 The Get Key path

Seven steps. No installs, no terminal. Works on any machine with Chrome or Edge.

### 1. Design your site prompt

Open the [Bootstrap Prompt](./BOOTSTRAP_PROMPT.md). Fill in the bracketed fields (name, tagline, sections, vibe) and gather 2–5 inspiration images. Paste the prompt into [Claude.ai](https://claude.ai) (a free account works), attach your images, and save the output as `index.html` in a new folder on your computer (e.g. `my-site/`).

> The AI-generated HTML is a starting point, not a final product. You'll edit every word of it directly on the page once GitQi is running. Focus the prompt on establishing a theme and structure you like — don't try to get the copy perfect.

### 2. Create a GitHub repository

Create a new **public** repository on GitHub (e.g. `jane/jane-osteopathy`). Leave it empty — don't add a README, `.gitignore`, or license. GitQi will populate it on first publish.

> You do not need to enable GitHub Pages yet. That step comes last (Step 7), after your first publish creates the `main` branch. Trying to enable Pages on an empty repo with no branch to serve from will just fail.

### 3. Create a GitHub access token

Profile photo → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

- Name: `gitqi-my-site` (or similar)
- Expiration: no expiry, or one year
- Repository access: **Only select repositories** → pick the repo you just created
- Permissions → Repository permissions → **Contents: Read and write**

Generate, then **copy the token immediately** (GitHub only shows it once). It starts with `ghp_`.

> This token can only read and write files in your one repository. It cannot access your GitHub account or any other repo. If it's ever exposed, revoke it and generate a new one in seconds.

### 4. Get a free Gemini API key

Go to [aistudio.google.com](https://aistudio.google.com), sign in with any Google account, and click **Get API key → Create API key**. Copy the key (starts with `AIza`). No billing, no credit card, no Cloud Console configuration.

> If you get prompted to enable billing, you're in the wrong place — step back from Google Cloud Console to AI Studio itself.

> **If AI actions fail with "model is busy" or "quota exceeded":** GitQi auto-fallbacks across Gemini models (2.5 Flash → 2.5 Pro → 2.0 Flash → Flash latest → 2.5 Flash Lite) on retryable errors. Each model has its own independent quota on AI Studio, so a daily-limit hit on one doesn't block the others. You'll see a status message when a fallback kicks in. If _all_ models fail in one request, the error dialog exposes a **Retry with model** dropdown so you can pin a specific one.

### 5. Create `secrets.js`

In the same folder as your `index.html`, create a plain-text file named `secrets.js`:

```js
// secrets.js — lives beside your HTML, never published
window.SITE_SECRETS = {
  geminiKey: "AIza...", // your Google AI key (Step 4)
  githubToken: "ghp_...", // your GitHub token (Step 3)
  repo: "username/my-site", // your GitHub user / repo name
  branch: "main",
};
```

Your folder now looks like:

```
my-site/
├── index.html
└── secrets.js          ← stays on your machine, forever
```

> **`secrets.js` is never pushed to GitHub.** GitQi strips it (and `gitqi.js`) from the published output on every publish. Credentials never leave your computer.

### 6. Edit and publish

Open `index.html` in **Chrome** or **Edge** (drag it into a browser window, or right-click → Open With). The GitQi toolbar appears automatically.

A banner appears prompting you to **Select Folder** — pick the folder containing your HTML. This links GitQi to your files so every edit auto-saves within ~1.5 seconds. The link persists across sessions (one permission prompt per session).

Edit anything:

- Click any text and type
- Select text for the formatting toolbar (bold, italic, color, font, size, code, link)
- Click any image or video to replace it
- Hover sections for **⟳ Reformat**, **✕ Delete**, or **+ Add Section** between them
- Click **Theme** in the toolbar for colors, fonts, spacing, favicon, page title, meta description
- Click **Pages** (multi-page only) to add AI-generated pages or navigate between them

When you're ready, click **Publish** in the toolbar. GitQi strips all editor code + `secrets.js`, serializes the clean HTML, and pushes it to GitHub via the Contents API. That first publish also creates the `main` branch — which is what Step 7 needs.

> Safari and Firefox are not supported. Editing requires the File System Access API, which only Chromium browsers ship today. The published site itself works in every browser.

### 7. Turn on GitHub Pages

In your repo on GitHub: **Settings → Pages → Source → Deploy from a branch**. Set branch to `main`, folder to `/ (root)`, click **Save**.

GitHub shows a banner: _"Your site is live at https://your-username.github.io/your-repo-name/"_. The first deploy takes about a minute.

🎉 **You're in.** From here on, the loop is: open `index.html`, edit, click **Publish**. No terminal, no git, no CMS, no monthly bill.

---

## Editing reference

**Text** — click any `data-editable` element and type directly.

**Text formatting** — select text to reveal a floating toolbar. Buttons: **B** (bold), _I_ (italic), 🎨 (color — theme swatches, custom picker, or remove), **Aa** (font — theme font vars or clear), **A↕** (font size — em-relative presets from Smaller to Huge), `</>` (inline code), 🔗 (link).

**Links** — click any link (body or nav) to open the popover. Fields: display text, URL, **Go to link →** (preview), page/section picker (jumps to any page or `#anchor` across your site), open-in-new-tab toggle, remove-link. Type a `mailto:` URL and Subject + Body fields appear; the Go-to-link button becomes **Test email →** so you can verify the message opens correctly in your default mail client.

**Email protection** — `mailto:` links and any visible email address inside them are obfuscated at publish time only. The published HTML never contains a plain `mailto:` href or email address — a tiny inline decoder script reveals them at load time, so spam crawlers that scrape pages for `@`-shaped strings see scrambled gibberish but real visitors get a working link. The editor itself stays fully readable.

**Images** — click any `data-editable-image` element to replace it. The file is written to your local `assets/` folder and queued for GitHub upload on the next publish.

**Videos** — click any `data-editable-video` element to replace the target YouTube video.

**Sections** — hover any section to reveal its controls.

- Hover between sections → **+ Add Section** (AI-generate a themed new section)
- Right side of the section: **⧉ Duplicate** · **⟳ Reformat** · **✕ Delete**
  - Duplicate clones the section in place with a unique slug (e.g. `hero` → `hero-2`) — handy when building a series of similar blocks before editing each one. No AI involved; instant.
  - Reformat asks the AI to restructure the layout while preserving content (text, images, videos).
- Left side of the section: **↑ / ↓** arrows — move the section up or down the page (bounded between nav and footer).
- Footer sections are pinned: Duplicate and the move arrows are suppressed for whatever element matches `<footer>` (or `[data-zone="footer"]`).

**Navigation** — hover the nav → **⟳ Reformat Nav** (AI restructure). Changes sync to every other page automatically.

**Pages** _(multi-page sites)_ — click **Pages** in the toolbar. Navigate between pages, generate a new AI page, or delete a page. New page links are added to the nav and propagated to every page.

**AI model fallback** — all four AI actions (Add Section, Reformat, Reformat Nav, Add Page) route through a fallback chain of Gemini models. If the primary is overloaded or rate-limited, GitQi automatically retries on the next one and shows a status like _"Using Gemini 2.5 Pro — primary model was busy"_. On total failure the error dialog offers a **Retry with model** dropdown so you can force a specific model.

**Theme** — click **Theme** for live controls over:

- Site identity: favicon, page title, meta description, keywords (title/description/keywords are per-page; everything else is site-wide)
- CSS variables, grouped as Colors / Typography / Spacing / Layout
- Google Fonts: **Browse Google Fonts…** opens a modal covering the full catalog (~1,900 families), lazy-loaded as rows scroll in, with category filter, name search, and popularity / A–Z sort. Picking a font injects only the `<link>` for that family. Abandoned fonts are pruned from `<head>` on the next auto-save.

**Undo / Redo** — toolbar **↩** / **↪** buttons, or `Ctrl+Z` / `Ctrl+Shift+Z`. Covers structural changes (AI actions, section/page deletes). Text edits use the browser's native undo.

---

## HTML data attributes

GitQi uses data attributes to identify editable regions. The AI-generated HTML includes them automatically; if you're hand-authoring, here's the reference.

| Attribute             | Applied to                            | Purpose                                                                                                             |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `data-zone`           | `<section>`                           | Marks a top-level editable section. Value is a slug, e.g. `"hero"`. Also used as the element `id` for anchor links. |
| `data-zone-label`     | `<section>`                           | Human-readable label shown in the delete confirmation, e.g. `"Hero"`.                                               |
| `data-editable`       | Any text element                      | Makes the element directly editable via `contenteditable`.                                                          |
| `data-editable-image` | `<img>`                               | Makes the image replaceable by clicking.                                                                            |
| `data-editable-video` | `<div>` wrapping a YouTube `<iframe>` | Makes the video replaceable. Click the wrapper → paste any YouTube URL (watch / `youtu.be` / embed / shorts).       |

**Minimal example:**

```html
<section data-zone="about" data-zone-label="About">
  <h2 data-editable>About Me</h2>
  <p data-editable>Replace this with your own text.</p>
  <img src="./assets/placeholder.jpg" data-editable-image alt="Profile photo" />
  <div 
    data-editable-video
    style="position: relative; padding-bottom: 56.25%; height: 0;">
    <iframe
      src="https://www.youtube.com/embed/M7lc1UVf-VE"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen>
    </iframe>
  </div>
</section>
```

---

## Script tags

Two script tags must appear in `<head>` (after the `<style>` block) for edit mode to work locally. Both are stripped automatically on export and publish — the deployed site contains neither.

```html
<script src="./secrets.js"></script>
<script src="https://swill.github.io/gitqi/gitqi.js"></script>
```

---

## Multi-page sites

Multi-page sites use a GitQi managed `gitqi-pages.json` manifest in the site folder alongside the HTML files:

```json
{
  "pages": [
    { "file": "index.html", "title": "Home — My Site", "navLabel": "Home" },
    { "file": "about.html", "title": "About — My Site", "navLabel": "About" },
    {
      "file": "services.html",
      "title": "Services — My Site",
      "navLabel": "Services"
    }
  ]
}
```

GitQi creates and maintains this file automatically — it's machine-managed. The bootstrap prompt produces the initial version for multi-page sites; from then on the editor rewrites it whenever pages are added, renamed, or deleted, and pushes it to GitHub on every publish. Don't hand-edit it: your changes will be overwritten on the next save. Adding GitQi to an existing single-page site creates the manifest automatically the first time you link your folder.

**Shared head + nav sync** — on every auto-save, GitQi compares the current page's shared elements against a snapshot from the last sync. If anything changed, the updated elements are written to every other page file on disk automatically.

Synced site-wide:

- `<nav>` (including nav-specific CSS in `<style id="__gitqi-nav-styles">`)
- `<footer>` (falling back to `[data-zone="footer"]`, including its per-section style block when present)
- Main `<style>` block (CSS variables + base styles edited via the Theme panel)
- `<link rel="icon">` and `<link rel="apple-touch-icon">` (favicon)
- Google Fonts `<link>`s (plus their preconnect links)

When the nav is synced, the "current page" highlight is re-targeted for each destination: the link matching that page gets the active marker; every other link is cleared. Recognised markers are the `aria-current` attribute and the CSS classes `active`, `current`, `is-active`, `is-current`, and `selected`.

The footer is copied verbatim — no active-link retargeting, since footers don't typically carry per-page "current" state. Because the footer is replicated across every page, it's pinned at the bottom in the editor: the **⧉ Duplicate** and **↑ / ↓** move controls are suppressed for whatever element matches `<footer>` (or `[data-zone="footer"]`). Reformat and Delete still apply, and changes propagate to every page on the next auto-save.

Left page-specific: `<title>`, `<meta name="description">`, `<meta name="keywords">`.

---

## Custom domain (optional)

By default your site is served at `https://username.github.io/repo-name`. To use your own domain (e.g. `www.janeosteopathy.com`):

### Option A — Subdomain (www or any prefix) — CNAME record

1. In your DNS provider, add a **CNAME** record:
   | Name | Type | Value |
   |---|---|---|
   | `www` | CNAME | `username.github.io` |
2. In your GitHub repo, **Settings → Pages → Custom domain**, enter `www.example.com`, click **Save**. GitHub creates a `CNAME` file automatically.
3. Check **Enforce HTTPS** once the certificate is provisioned (usually a few minutes).

> GitQi publishes by overwriting HTML files only — it doesn't touch the `CNAME` file. Your custom domain stays configured across all publishes.

### Option B — Apex domain (no www) — A records

1. In your DNS provider, add four **A** records:
   | Name | Type | Value |
   |---|---|---|
   | `@` | A | `185.199.108.153` |
   | `@` | A | `185.199.109.153` |
   | `@` | A | `185.199.110.153` |
   | `@` | A | `185.199.111.153` |
2. Optionally add a CNAME for `www` → `username.github.io` so both work.
3. In your GitHub repo, **Settings → Pages → Custom domain**, enter `example.com`, click **Save**.
4. Check **Enforce HTTPS** once the certificate is provisioned.

> DNS changes can take up to 48 hours to propagate. GitHub will warn you if the domain isn't verified yet — wait a few minutes and refresh.

---

## 气 The Git Qi path — advanced

You have the key. Now the Qi: how GitQi actually works, how to pin or self-host `gitqi.js`, and how to cut your own releases.

### How it works

GitQi is a single JavaScript file that activates only when `window.SITE_SECRETS` is set (i.e. when `secrets.js` has loaded). In public mode the script tag is stripped entirely, so there's nothing to load and nothing to run.

The publish pipeline is:

1. **Serialize** the live DOM (clone, strip editor UI, resolve local image paths).
2. **Strip** the editor and `secrets.js` script tags.
3. **Push** each page via the GitHub Contents API (`PUT /repos/{repo}/contents/{path}`).
4. GitHub Pages serves the updated file within ~60 seconds.

No git on your machine, no CI, no build step. The HTML is the artifact.

### Hosting gitqi.js

`gitqi.js` is served from its own GitHub Pages repo so multiple sites can share a single hosted copy.

**Latest version** (always current):

```
https://swill.github.io/gitqi/gitqi.js
```

**Pinned version** (recommended for production — immune to upstream changes):

```
https://swill.github.io/gitqi/gitqi-<VERSION>.js
```

Pinned versioned files are committed alongside `gitqi.js` on each release and are never modified after publishing.

### Fork and self-host

Want to own the whole stack?

1. Fork [`swill/gitqi`](https://github.com/swill/gitqi) on GitHub.
2. Enable GitHub Pages on your fork (**Settings → Pages → Deploy from a branch → `main` / `(root)`**).
3. Change the script tag in your site's HTML from `swill.github.io/gitqi/gitqi.js` to `your-user.github.io/gitqi/gitqi.js`.

You now run your own copy. Pin it, patch it, release on your own schedule.

### Versioning

Versions follow [Semantic Versioning](https://semver.org/):

- **Patch** (`1.0.x`) — bug fixes, safe to update
- **Minor** (`1.x.0`) — new features, backwards compatible
- **Major** (`x.0.0`) — breaking changes; pinned sites are unaffected

The version is accessible at runtime:

```js
console.log(window.GitQi.version);
```

### Development

```bash
# Local development server (http://localhost:8080, CORS enabled)
make serve

# Check JavaScript syntax
make check

# Release a new version — writes gitqi-<VERSION>.js, bumps VERSION, tags, pushes
make release VERSION=1.3.0

# Regenerate the Google Fonts manifest (google-fonts.json)
make fonts
```

See the [Makefile](./Makefile) for the full details of what each target does.

### Google Fonts manifest

GitQi ships a full Google Fonts catalog (`google-fonts.json`, served alongside `gitqi.js`) so the font picker covers the entire library, not just a curated subset. The manifest is regenerated manually via `make fonts`. At runtime `gitqi.js` fetches it, caches it in `localStorage`, and falls back to a small built-in list if the fetch fails.

**One-time setup** — needed only if you want to regenerate the manifest yourself:

1. Get a free Google Fonts Developer API key:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/)
   - Create (or pick) a project
   - Enable the **Web Fonts Developer API** under _APIs & Services → Library_
   - Create a key under _APIs & Services → Credentials → Create Credentials → API key_
   - Restrict it (recommended): under _API restrictions_ pick _Web Fonts Developer API_ only
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

### Contributing

The source is yours to read, fork, and improve. Issues and pull requests welcome at [github.com/swill/gitqi](https://github.com/swill/gitqi).

---

## Security notes

- `secrets.js` lives only on your computer and is never published — your local folder is not a git repository
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read + write` only
- The Gemini API key is used client-side — acceptable for personal / single-owner use; for shared use, proxy through a serverless function
- Exported and published HTML contains **no credentials** and **no editor code**

---

## Compatibility

| Browser    | Edit mode | Public site |
| ---------- | --------- | ----------- |
| Chrome 86+ | ✓         | ✓           |
| Edge 86+   | ✓         | ✓           |
| Safari     | ✗         | ✓           |
| Firefox    | ✗         | ✓           |

Edit mode requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). The published site is plain HTML and works everywhere.

---

## License

MIT. Free, forever.
