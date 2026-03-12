# Webby

A zero-dependency, browser-based inline editing system for static websites.

The site owner opens `index.html` locally, edits content in-place, and publishes directly to GitHub Pages — no terminal, no CMS, no backend required.

---

## How it works

Webby has two modes:

- **Edit mode** — activated automatically when `secrets.js` is present alongside `index.html`. The editor toolbar, editable zones, and AI tools all activate.
- **Public mode** — the deployed site. No editor code, no credentials, no overhead. `webby.js` and `secrets.js` are stripped from the published output.

The content "database" is the HTML file itself. The site owner edits text by clicking and typing directly on the page, replaces images by clicking them, and uses the AI assistant to generate new sections — all without touching code.

---

## Quick start (for site owners)

### 1. Generate your initial `index.html`

Use the [Bootstrap Prompt](./BOOTSTRAP_PROMPT.md) with Claude.ai (attach 2–5 inspiration images and fill in the bracketed fields). The output is a complete `index.html` ready to use.

Download the `index.html` file to a folder on your computer where you would like your website editing to live.  An `assets` folder will also be created in this location.

### 2. Create a GitHub repository and enable GitHub Pages

1. Create a new **public** repository on GitHub (e.g. `jane/jane-osteopathy`)
2. Make an initial commit to establish a `main` branch.
3. Go to **Settings → Pages**
4. Under *Source*, select **Deploy from a branch**
5. Set branch to `main`, folder to `/ (root)`, and click **Save**

That's it — GitHub Pages will serve files directly from the root of your `main` branch. Every time Webby pushes `index.html`, the live site updates automatically. No workflow files or GitHub Actions needed.

### 3. Add `secrets.js` to the same folder you saved `index.html`

```js
window.SITE_SECRETS = {
  geminiKey:   "AIza...",         // Google AI Studio API key (for AI section generation)
  githubToken: "ghp_...",         // GitHub fine-grained PAT (contents: read + write)
  repo:        "jane/jane-osteopathy",
  branch:      "main"
};
```

Get your free Gemini API key at [aistudio.google.com](https://aistudio.google.com) — no billing required.

> **This file stays on your computer only.** Webby publishes your site by pushing `index.html` directly to GitHub via the API — your local folder is never a git repository, and `secrets.js` is never sent anywhere except directly to the GitHub and Google APIs.

### 4. Open `index.html` in your browser

> **Use Chrome or Edge** since these browsers support the File System Access API, which lets Webby save your edits directly back to `index.html` on disk. Firefox and Safari works but requires you to manually export and replace the file after each session.

The editor activates automatically. You'll see a dark toolbar at the top of the page.

### 5. Link your site folder

A banner will appear below the toolbar on first open. Click **Select Folder** and choose the folder containing your `index.html`. The path is shown in the banner as a hint.

Once linked, every edit auto-saves to your local `index.html` within 1.5 seconds — so your changes are never lost on reload or restart. The folder stays linked across sessions (one browser permission prompt per session).

### 6. Edit your content

- **Text** — click any text and type directly on the page
- **Links** — click any link to edit its display text, URL, or open-in-new-tab setting
- **Images** — click any image to replace it; the new image saves to your local `assets/` folder and uploads to GitHub automatically
- **New sections** — hover between sections and click **+ Add Section**; describe what you want and the AI generates it
- **Reformat sections** — if you want to change the format with AI, while keeping the content you have developed
- **Delete sections** — that are no longer relevant
- **Theme** — click **Theme** to adjust colours, fonts, and spacing live

### 7. Publish

Click **Publish** in the toolbar. Webby uses the GitHub API to push `index.html` directly to your repository — no git, no terminal, no syncing. GitHub Pages serves the updated file within ~60 seconds.

> **How it works under the hood:** Webby serialises the current page (stripping all editor UI and credentials), then calls the GitHub Contents API to write the file. Images you replaced during editing are also committed to `assets/` in your repo.

---

## HTML data attributes

Webby uses data attributes to identify editable regions. These must be present in the generated HTML.

| Attribute | Applied to | Purpose |
|---|---|---|
| `data-zone` | `<section>` | Marks a top-level editable section. Value is a slug, e.g. `"hero"`. |
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
<script src="https://YOUR_GITHUB_PAGES_URL/webby.js"></script>
```

Replace `YOUR_GITHUB_PAGES_URL` with the URL where you host `webby.js` (see [Hosting webby.js](#hosting-webbyjs) below).

---


## Hosting webby.js

`webby.js` is served from its own GitHub Pages repo (this one) so that multiple sites can share a single hosted copy.

**Latest version** (always up to date):
```
https://<your-username>.github.io/<this-repo>/webby.js
```

**Pinned version** (recommended for production — immune to breaking changes):
```
https://<your-username>.github.io/<this-repo>/webby-1.0.0.js
```

Pinned versioned files (e.g. `webby-1.0.0.js`) are committed alongside `webby.js` on each release and are never modified after publishing.

> **One-time setup required:** Go to **Settings → Pages → Source → Deploy from a branch**, set branch to `main`, folder to `/ (root)`, and save. After that, `make release` keeps the live files up to date automatically — no further configuration needed.

---

## Reference my version

**Latest version** (the bleeding edge)
```
https://swill.github.io/webby/webby.js
```

**Pinned version** (recommended for production — immune to breaking changes):
```
https://swill.github.io/webby/webby-x.y.z.js
```

---

## Versioning

Check for the latest version in the root directory.

Versions follow [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.x) — bug fixes, safe to update
- **Minor** (1.x.0) — new features, backwards compatible
- **Major** (x.0.0) — breaking changes; pinned sites are unaffected

The version is accessible at runtime:

```js
console.log(window.Webby.version);
```

---

## Development

```bash
# Local development server (http://localhost:8080)
make serve

# Check JavaScript syntax
make check

# Release a new version and publish to GitHub Pages
make release VERSION=1.1.0
```

See the [Makefile](./Makefile) for full details on what `make release` does.

---

## Security notes

- `secrets.js` lives only on your computer and is never published — your local folder is not a git repository
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read + write` only
- The Gemini API key is used client-side — acceptable for personal/single-owner use; for shared use, proxy through a serverless function
- The exported and published HTML contains **no credentials** and **no editor code**
