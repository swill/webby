# Webby - Site Editor — Project Architecture

## Overview

A zero-dependency, browser-based inline editing system for static websites. The site owner opens `index.html` locally, edits content in-place, and publishes directly to GitHub Pages — no terminal, no CMS, no backend.

The system has two distinct modes:
- **Edit mode** — activated when `secrets.js` is present alongside `index.html`
- **Public mode** — the deployed site with no editor code, no credentials, no overhead

---

## Repository Structure

```
site/
├── index.html              ← Source of truth: content + CSS vars + structure
├── secrets.js              ← Gitignored. Sets window.SITE_SECRETS (keys, repo)
├── assets/
│   └── *.jpg / *.png       ← Images committed alongside HTML
├── .github/
│   └── workflows/
│       └── deploy.yml      ← On push to main → deploy to GitHub Pages
└── .gitignore              ← Must include secrets.js
```

---

## The Editor Script (`webby.js`)

Hosted externally (e.g. your own GitHub Pages or CDN). Included in `index.html` only during local editing — stripped from the exported/published output.

### Initialization

```
Webby.init()
  ├── Check for window.SITE_SECRETS
  ├── If absent → exit silently (public mode)
  └── If present → activate edit mode
        ├── injectToolbar()
        ├── activateZones()
        └── bindMutationObserver()
```

### Required Globals (set by `secrets.js`)

```js
window.SITE_SECRETS = {
  anthropicKey: "sk-ant-...",   // For AI section generation
  githubToken:  "ghp_...",      // Fine-grained PAT: contents read+write
  repo:         "user/repo",    // e.g. "jane/jane-osteopathy"
  branch:       "main"          // Deployment branch
};
```

---

## Core Modules

### 1. Zone Manager

Responsible for identifying and activating editable regions.

**Data attributes used in HTML:**

| Attribute | Purpose |
|---|---|
| `data-zone` | Marks a top-level editable section (e.g. `"hero"`, `"about"`) |
| `data-editable` | Text node is directly editable via `contenteditable` |
| `data-editable-image` | Image can be replaced by clicking |
| `data-zone-label` | Human-readable label shown in editor UI |

**Functions:**

```
activateZones()
  ├── Query all [data-zone] elements
  ├── For each: add contenteditable to [data-editable] children
  ├── For each: bind image click handlers on [data-editable-image]
  ├── Inject "Add Section" button between each zone
  └── Inject "Delete Section" button on each zone (with confirm guard)

deactivateZones()
  ├── Remove all contenteditable attributes
  ├── Remove all editor UI injections
  └── Used before serialization
```

### 2. Toolbar

Floating, fixed-position UI injected into the page in edit mode. Does not appear in exported HTML.

**Elements:**

- Site title / status indicator (clean / unsaved changes)
- **Add Section** button → triggers AI section generation flow
- **Export** button → download clean `index.html`
- **Publish** button → commit to GitHub and trigger deploy
- **Theme** button → open CSS variable editor panel

**Functions:**

```
injectToolbar()         ← Create and append toolbar DOM
removeToolbar()         ← Remove before serialization
showStatus(msg)         ← "Saved", "Publishing...", "Error: ..."
setDirty(bool)          ← Toggle unsaved indicator
```

### 3. Mutation Observer

Tracks changes to editable content for dirty-state management.

```
bindMutationObserver()
  ├── Observe subtree of <body> for characterData + childList
  ├── On change → setDirty(true)
  └── On export/publish → setDirty(false)
```

### 4. Image Manager

Handles image replacement without leaving the browser.

**Flow:**

1. User clicks an `[data-editable-image]` element
2. Hidden `<input type="file">` triggers file picker
3. On file select:
   - Read as ArrayBuffer
   - Upload to `assets/` folder in GitHub repo via API
   - Update `src` attribute of the `<img>` to `./assets/filename.ext`
4. Image is committed to the repo and referenced by relative path (no base64)

**Functions:**

```
bindImageHandlers()
  └── Attach click → openFilePicker() on all [data-editable-image]

handleImageUpload(file, imgElement)
  ├── Read file as ArrayBuffer
  ├── base64Encode(buffer)
  ├── github.uploadFile(`assets/${file.name}`, encoded)
  └── imgElement.src = `./assets/${file.name}`
```

### 5. AI Section Generator

Calls Anthropic API to generate a new themed section based on user description.

**Flow:**

1. User clicks "Add Section" between two zones
2. Modal prompts: *"Describe the section you want to add"*
3. On submit:
   - Extract current `<style>` block from document
   - Extract one existing `<section>` as a markup pattern example
   - Construct prompt (see Prompt Template below)
   - Stream response from Anthropic API
   - Inject returned HTML into the DOM at the correct position
   - Activate editing on the new zone

**Functions:**

```
promptAddSection(insertAfterElement)
  └── Show modal → on submit → generateSection(description, insertAfterElement)

generateSection(description, insertAfterElement)
  ├── buildSectionPrompt(description)
  ├── callAnthropicAPI(prompt)          ← streams response
  ├── parseHTMLFromResponse(text)
  ├── injectSection(html, insertAfterElement)
  └── activateZone(newSection)

buildSectionPrompt(description)
  ├── Read current <style> block
  ├── Read first [data-zone] section as example
  └── Return assembled prompt string
```

**Anthropic API call:**

```js
fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": window.SITE_SECRETS.anthropicKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }]
  })
})
```

**Section prompt template:**

```
You are generating a new HTML section for a website.

STYLE CONTEXT (CSS variables and base styles in use):
<style>
{currentStyleBlock}
</style>

EXISTING SECTION EXAMPLE (match this markup style and class patterns):
{exampleSection}

TASK:
Generate a single <section> element for the following description:
"{userDescription}"

RULES:
- Use only the CSS variables already defined above
- Match the class naming conventions in the example
- Include data-zone="{slug}" and data-zone-label="{label}" on the section
- Add data-editable on all user-editable text elements
- Add data-editable-image on any img elements
- Return ONLY the raw HTML section element, no explanation, no markdown fences
```

### 6. Serializer / Exporter

Produces clean, deployment-ready HTML from the current DOM state.

**Export process:**

```
serialize()
  ├── Clone document.documentElement
  ├── Remove all [data-editor-ui] elements (toolbar, modals, buttons)
  ├── Remove all contenteditable attributes
  ├── Remove <script src="./secrets.js"> tag
  ├── Remove <script src="{editor-script-url}"> tag
  ├── Normalize whitespace in text nodes
  ├── Serialize to HTML string via XMLSerializer or innerHTML
  └── Return clean HTML string

exportToFile()
  ├── html = serialize()
  ├── blob = new Blob([html], { type: "text/html" })
  └── Trigger download as "index.html"
```

**Important:** The serializer must be idempotent — running it multiple times on the same DOM produces the same output.

### 7. GitHub Publisher

Commits `index.html` and any newly uploaded images to the GitHub repo via REST API. Triggers GitHub Actions deployment automatically on push.

**Functions:**

```
publish()
  ├── html = serialize()
  ├── sha = await github.getFileSHA("index.html")
  ├── await github.putFile("index.html", html, sha)
  └── showStatus("Published ✓ — deploying...")

github.getFileSHA(path)
  └── GET /repos/{repo}/contents/{path}
        └── return .sha

github.putFile(path, content, sha)
  └── PUT /repos/{repo}/contents/{path}
        body: {
          message: "Update site content",
          content: btoa(unescape(encodeURIComponent(content))),
          sha: sha,       ← omit for new files
          branch: branch
        }

github.uploadFile(path, base64Content)
  └── Calls putFile with pre-encoded binary content (images)
```

---

## CSS Variable System

The base style block in `index.html` must define CSS custom properties so AI-generated sections can use them consistently.

**Required variables (minimum set):**

```css
:root {
  /* Palette */
  --color-primary:    #...;
  --color-secondary:  #...;
  --color-accent:     #...;
  --color-bg:         #...;
  --color-bg-alt:     #...;
  --color-text:       #...;
  --color-text-muted: #...;

  /* Typography */
  --font-heading: 'Font Name', sans-serif;
  --font-body:    'Font Name', sans-serif;
  --font-size-base: 1rem;
  --line-height-base: 1.6;

  /* Spacing */
  --space-xs:  0.25rem;
  --space-sm:  0.5rem;
  --space-md:  1rem;
  --space-lg:  2rem;
  --space-xl:  4rem;

  /* Layout */
  --container-width: 1100px;
  --radius:          0.375rem;
  --shadow:          0 2px 12px rgba(0,0,0,0.08);
}
```

---

## GitHub Actions Deploy Workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
```

---

## Secrets & Security Notes

- `secrets.js` is **gitignored** — never committed
- The GitHub PAT should be a **fine-grained token** scoped to the single repo with `contents: read+write` only
- The Anthropic key is used **client-side** — acceptable for personal use; for shared use, proxy through a serverless function
- The exported/published HTML contains **no credentials** and **no editor code**

---

## Non-Goals (explicitly out of scope)

- Multi-user editing or auth
- Rich text formatting toolbar (bold, italic, etc.) — plain `contenteditable` only
- Version history UI (git history serves this purpose)
- Offline support
- Any server-side component
