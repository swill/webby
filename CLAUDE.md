# Webby - Site Editor — Project Architecture

## Overview

A zero-dependency, browser-based inline editing system for static websites. The site owner opens `index.html` locally, edits content in-place, and publishes directly to GitHub Pages — no terminal, no CMS, no backend.

The system has two distinct modes:
- **Edit mode** — activated when `secrets.js` is present alongside `index.html`
- **Public mode** — the deployed site with no editor code, no credentials, no overhead

---

## Structure

### Local folder (on the site owner's computer)

```
my-site/
├── index.html       ← Source of truth: content + CSS vars + structure
├── secrets.js       ← Never published. Sets window.SITE_SECRETS (keys, repo)
└── assets/
    └── *.jpg / *.png
```

This folder is **not** a git repository. Webby publishes `index.html` and uploads images directly to GitHub via the REST API. `secrets.js` never leaves the local machine.

### Remote GitHub repository

```
username/repo-name  (GitHub)
├── index.html
└── assets/
    └── *.jpg / *.png
```

GitHub Pages is configured to serve files directly from the root of the `main` branch ("Deploy from branch → main → / (root)"). Any push to `main` — including Webby's API commits — updates the live site automatically. No GitHub Actions workflow is required.

---

## The Editor Script (`webby.js`)

Hosted externally (e.g. your own GitHub Pages). Included in `index.html` only during local editing — stripped from the published output.

### Initialization

```
init()  [async]
  ├── If !FS_SUPPORTED (Firefox): restoreFromCache() → restore from localStorage
  ├── injectToolbar()
  ├── activateZones()
  ├── bindMutationObserver()
  ├── bindLinkHandlers()
  └── initFileAccess()  [async]
        ├── Load FileSystemDirectoryHandle from IndexedDB
        ├── If found + permission granted → dirHandle = stored (silent)
        └── Else → showAccessBanner()
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

---

## Core Modules

### 1. Zone Manager

Responsible for identifying and activating editable regions.

**Data attributes used in HTML:**

| Attribute | Purpose |
|---|---|
| `data-zone` | Marks a top-level editable section (e.g. `"hero"`, `"about"`) |
| `data-zone-label` | Human-readable label shown in the delete confirmation |
| `data-editable` | Text node is directly editable via `contenteditable` |
| `data-editable-image` | Image can be replaced by clicking |

**Functions:**

```
activateZones()
  ├── Query all [data-zone] elements
  ├── For each: activateZone(section)
  │     ├── Add contenteditable + spellcheck to [data-editable] children
  │     ├── Bind image click handlers on [data-editable-image]
  │     └── Inject "Delete Section" button (visible on hover, with confirm guard)
  └── injectAddSectionButtons()
        └── Insert "Add Section" button before first zone and after each zone
            (buttons are visible on hover of neighboring zones)

deactivateZones()
  ├── Remove all contenteditable + spellcheck attributes
  └── Remove all [data-editor-ui] injections
```

### 2. Toolbar

Fixed-position bar injected at the top of the page in edit mode. Marked `data-editor-ui` so it is stripped on export/publish.

**Elements:**

- Site title with `●` dirty indicator (unsaved changes)
- Status message area (right of title)
- **Theme** button → open/close CSS variable editor panel
- **Export** button → download clean `index.html`
- **Publish** button → commit to GitHub and trigger deploy

**Functions:**

```
injectToolbar()     ← Create and prepend toolbar; adjust body padding-top
showStatus(msg)     ← Display temporary status text ("Published ✓", "Error: ...")
setDirty(bool)      ← Toggle ● indicator; schedules auto-save when true
```

### 3. File Persistence

Keeps `index.html` on disk in sync with the current DOM state. Two paths:

**Primary — File System Access API (Chrome, Edge, Safari):**

```
initFileAccess()
  ├── Load FileSystemDirectoryHandle from IndexedDB
  ├── If found: verifyPermission() → if granted, silently re-link
  └── If not found or denied: showAccessBanner()

showAccessBanner()
  └── Banner below toolbar: shows local path hint + "Select Folder" button
        └── On click: showDirectoryPicker() → store handle → writeIndexToLocalFile()

scheduleAutoSave()  ← Debounced 1.5s; triggered by setDirty(true)
  └── writeIndexToLocalFile()
        └── serialize({ local: true }) → write to index.html on disk

writeImageToLocalDir(file)
  └── Write to assets/ in the linked folder (called alongside GitHub upload)
```

**Fallback — localStorage (Firefox):**

```
writeDraftToCache()   ← serialize({ local: true }) → localStorage
restoreFromCache()    ← Parse saved HTML → restore <style> + body.innerHTML
clearDraftCache()     ← Called after successful publish or export
```

The `local: true` flag on `serialize()` preserves the `secrets.js` and `webby.js` script tags so edit mode activates correctly on the next open. The default `local: false` strips them for the deployed public site.

### 4. Mutation Observer

Tracks content changes for dirty-state management and auto-save triggering.

```
bindMutationObserver()
  ├── Observe subtree of <body> for characterData + childList
  ├── Ignore mutations originating from [data-editor-ui] elements
  └── On relevant change → setDirty(true) → scheduleAutoSave()
```

### 5. Image Manager

Handles image replacement without leaving the browser.

**Flow:**

1. User clicks a `[data-editable-image]` element (hover shows "Click to replace image" overlay)
2. Hidden `<input type="file">` triggers file picker
3. On file select:
   - Read as ArrayBuffer → base64 encode
   - Upload to `assets/` in GitHub repo via API
   - **If folder is linked:** write file to local `assets/` directory; set `src` to `./assets/filename`
   - **If no folder access:** display via blob URL locally; store `./assets/filename` in `data-webby-src`; serializer resolves on publish/export

**Functions:**

```
bindImageHandler(img)
  └── Attach hover overlay + click → file picker → handleImageUpload()

handleImageUpload(file, imgEl)
  ├── Read as ArrayBuffer
  ├── base64Encode → github.uploadFile(`assets/${file.name}`)
  ├── If dirHandle: writeImageToLocalDir(file) → imgEl.src = `./assets/${file.name}`
  └── Else: imgEl.src = blobURL; imgEl.dataset.webbySrc = `./assets/${file.name}`
```

### 6. Link Editor

Intercepts clicks on `<a>` elements inside `[data-zone]` and shows a popover editor.

**Flow:**

1. User clicks any link inside an editable zone
2. Navigation is prevented; a positioned popover appears near the link
3. Popover fields:
   - **Display text** — updates `textContent` live
   - **URL** — updates `href` live
   - **Open in new tab** — toggles `target="_blank"` + `rel="noopener noreferrer"`
   - **Remove link** — unwraps `<a>` leaving plain text
4. Popover closes on "Done", on click outside, or when a new link is clicked

```
bindLinkHandlers()
  └── document.addEventListener('click', handleLinkClick, true)  ← capture phase

openLinkPopover(link)
  └── Position near link → populate fields → bind live-update handlers
```

### 7. AI Section Generator

Calls the Google Gemini API to generate a new themed section based on a user description.

**Flow:**

1. User hovers between sections → clicks **+ Add Section**
2. Modal prompts for a description
3. On submit:
   - Extract current `<style>` block from document
   - Extract first `[data-zone]` section as a markup pattern example (editor UI stripped)
   - Construct prompt and call Gemini API
   - Parse returned HTML; inject into DOM at the correct position
   - Activate editing on the new zone

**Functions:**

```
promptAddSection(insertAfterZone)
  └── Show modal → on submit → generateSection(description, insertAfterZone)

generateSection(description, insertAfterZone)
  ├── buildSectionPrompt(description)
  ├── callGeminiAPI(prompt)
  ├── parseHTMLFromResponse(text)   ← strips markdown fences if present
  ├── injectNewSection(html, insertAfterZone)
  └── activateZone(newSection)

buildSectionPrompt(description)
  ├── Read current <style> block
  ├── Clone first [data-zone] section (strip editor UI attributes)
  └── Return assembled prompt string
```

**Gemini API call:**

```js
fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
  })
})
// Response: data.candidates[0].content.parts[0].text
```

**Section prompt template:**

```
You are generating a new HTML section for a website.

STYLE CONTEXT (CSS variables and base styles in use):
<style>
{currentStyleBlock}
</style>

EXISTING SECTION EXAMPLE (match this markup style and class patterns exactly):
{exampleSection}

TASK:
Generate a single <section> element for the following description:
"{userDescription}"

RULES:
- Use only the CSS variables already defined above
- Match the class naming conventions in the example
- Include data-zone="{slug}" and data-zone-label="{Human Label}" on the section
- Add data-editable on all user-editable text elements
- Add data-editable-image on any img elements; use src="./assets/placeholder.jpg"
- Return ONLY the raw <section> element, no explanation, no markdown fences
```

### 8. Serializer / Exporter

Produces clean HTML from the current DOM state. Two modes:

```
serialize({ local: false })   ← default; for publish/export
serialize({ local: true })    ← for local file save and localStorage cache

Both modes:
  ├── Clone document.documentElement
  ├── Remove all [data-editor-ui] elements (toolbar, modals, add/delete buttons, hints)
  ├── Remove contenteditable + spellcheck attributes
  ├── Resolve img[data-webby-src]: replace blob URL src with stored relative path
  └── Restore original body padding-top (remove toolbar offset)

local: false only:
  └── Remove <script src="./secrets.js"> and <script src="...webby.js"> tags

exportToFile()
  ├── serialize({ local: false })
  ├── Trigger download as "index.html"
  └── clearDraftCache()
```

**Important:** The serializer is idempotent — running it multiple times on the same DOM produces the same output.

### 9. GitHub Publisher

Pushes `index.html` and uploaded images to the GitHub repo via REST API. Triggers GitHub Actions deployment automatically on push.

```
publishSite()
  ├── serialize({ local: false })
  ├── sha = await github.getFileSHA("index.html")
  ├── await github.putFile("index.html", html, sha)
  ├── clearDraftCache()
  └── showStatus("Published ✓ — deploying…")

github.getFileSHA(path)
  └── GET /repos/{repo}/contents/{path}?ref={branch} → return .sha (null if 404)

github.putFile(path, content, sha)
  └── PUT /repos/{repo}/contents/{path}
        body: { message, content: btoa(unescape(encodeURIComponent(content))), sha, branch }

github.uploadFile(path, base64Content)
  └── getFileSHA(path) → putFile with pre-encoded binary (for images)
```

### 10. Theme Editor

Panel that parses CSS custom properties from the `<style>` block and exposes them as live inputs.

```
openThemeEditor()   ← toggled by "Theme" toolbar button
  ├── Parse --variable: value pairs from <style> via regex
  ├── Group into: Colors / Typography / Spacing / Layout
  ├── Render color pickers (for hex/rgb/hsl values) or text inputs
  └── On input: document.documentElement.style.setProperty() + patch <style> textContent
```

---

## CSS Variable System

The base `<style>` block in `index.html` must define CSS custom properties so AI-generated sections can use them consistently.

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

---

## Secrets & Security Notes

- `secrets.js` lives only on the local machine — the site folder is not a git repo and `secrets.js` is never committed or transmitted anywhere except directly to the GitHub and Google APIs
- The GitHub PAT should be a **fine-grained token** scoped to the single site repo with `contents: read+write` only
- The Gemini API key is used **client-side** — acceptable for personal/single-owner use; for shared or public use, proxy through a serverless function
- The exported/published HTML contains **no credentials** and **no editor code**

---

## Browser Compatibility

Webby requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write local files.

| Browser | Supported |
|---|---|
| Chrome 86+ | ✓ |
| Edge 86+ | ✓ |
| Safari 15.2+ | ✓ |
| Firefox | ✗ |

Opening a page in an unsupported browser shows a blocking message and prevents the editor from loading. Chrome or Edge are recommended for the most reliable experience.

---

## Non-Goals (explicitly out of scope)

- Multi-user editing or auth
- Rich text formatting toolbar (bold, italic, etc.) — plain `contenteditable` only
- Version history UI (git history serves this purpose)
- Any server-side component
