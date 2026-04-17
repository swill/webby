# Bootstrap Prompt — New Site Generator

Use this prompt with Claude Code (or Claude.ai) to generate the initial HTML files for a new site. Fill in all `[BRACKETED]` sections before running.

Two modes are supported:
- **Single-page** — everything on one `index.html` (original behaviour)
- **Multi-page** — separate HTML file per page, shared nav and theme, plus a `webby-pages.json` manifest

---

## Instructions for Use

1. Gather the following before running:
   - 2–5 inspiration images (photos, screenshots, color palettes)
   - A short description of the practice / business
   - The pages and sections you want on the site
   - A "vibe" description (tone, feel, aesthetic)

2. Paste the appropriate prompt below into Claude Code or Claude.ai, attach your images, and fill in the variables.

3. **Single-page:** output is one `index.html`.  
   **Multi-page:** output is one HTML file per page plus `webby-pages.json`.

---

## Single-Page Prompt

```
You are generating the initial downloadable index.html for a professional website.

I am attaching a selection of inspiration images. Analyze them for:
- Dominant and accent colors → translate to a CSS variable palette
- Typography mood (serif/sans-serif, weight, spacing)
- Overall aesthetic tone (minimalist, warm, clinical, natural, bold, etc.)

Use those signals to define a cohesive CSS variable system and base styles.

---

BUSINESS DETAILS:
Name:         [Full name or practice name]
Profession:   [e.g. Osteopath, Naturopath, Coach, Photographer]
Tagline:      [One sentence — what they do and for whom]
Location:     [City, Country]
Contact:      [Email and/or phone to appear on site]
Social:       [Instagram, LinkedIn, etc. — or leave blank]

---

TONE & AESTHETIC:
[Describe the feeling the site should evoke. Examples:
- "Calm, trustworthy, professional. Like a high-end wellness clinic."
- "Warm and approachable. Earthy tones, clean layout, not too corporate."
- "Minimal and modern. Lots of whitespace, strong typography."
Use your own words — be as specific or loose as you like.]

---

SECTIONS TO INCLUDE:
[List each section and what it should contain. Examples:

1. Hero — Full-width header with name, tagline, and a call-to-action button ("Book a Session")
2. About — Photo + 2–3 paragraphs about background, philosophy, approach
3. Services — 3 service cards: Osteopathy, Sports Therapy, Online Consultations
4. Testimonials — 3 short quotes from clients
5. FAQ — 4 common questions with answers
6. Contact — Email, phone, location, contact form (static mailto: is fine)
7. Footer — Name, copyright, social links

Adjust this list to match the actual site.]

---

TECHNICAL REQUIREMENTS:
Generate a single index.html file with the following:

1. DOCTYPE html5, semantic HTML, mobile-first responsive layout
2. No external CSS frameworks — all styles inline in a <style> block
3. A CSS custom property system using the variables defined from the images:
   --color-primary, --color-secondary, --color-accent,
   --color-bg, --color-bg-alt, --color-text, --color-text-muted,
   --font-heading, --font-body,
   --space-xs through --space-xl,
   --container-width, --radius, --shadow
4. Google Fonts import for the chosen typefaces (2 max)
5. Each section must have:
   - data-zone="{slug}" on the <section> element
   - data-zone-label="{Human Label}" on the <section> element
   - data-editable on every user-editable text element (headings, paragraphs, spans)
   - data-editable-image on every <img> element
6. A single <nav> with smooth-scroll links to each section
7. Responsive mobile navigation (hamburger toggle using only CSS or minimal inline JS)
   Mobile nav requirements — these are mandatory, not optional:
   - The expanded mobile menu must be fully visible on screen and never clipped
   - Use position: fixed or position: absolute (not static/relative) for the expanded menu so it
     escapes any parent overflow constraints
   - Set a z-index high enough (e.g. 9000) that the menu appears above all page content
   - Never rely on a parent container with overflow: hidden to contain the menu
   - Do not use the CSS property of "backdrop-filter" in the nav as it often breaks compatibility
   - The menu must be scrollable (overflow-y: auto) if it could exceed viewport height
   - Test the toggle logic: the menu must open AND close correctly on repeated hamburger clicks
8. No JavaScript frameworks — vanilla JS only, and only where necessary
9. Include this script tag in the <head>, immediately after the <style> block:
   <script src="./secrets.js"></script>
   <script src="https://swill.github.io/webby/webby.js"></script>
   (These will be stripped on export — they enable edit mode locally)
10. All placeholder text should be realistic and relevant to the profession
11. Placeholder images should use: <img src="./assets/placeholder.jpg" data-editable-image alt="..." />
12. The overall visual result should be polished, professional, and production-ready

---

OUTPUT:
Return ONLY the complete index.html file contents.
No explanation, no markdown fences, no preamble.
Start your response with: <!DOCTYPE html>
```

---

## Multi-Page Prompt

```
You are generating a complete multi-page website as a set of HTML files.

I am attaching a selection of inspiration images. Analyze them for:
- Dominant and accent colors → translate to a CSS variable palette
- Typography mood (serif/sans-serif, weight, spacing)
- Overall aesthetic tone (minimalist, warm, clinical, natural, bold, etc.)

Use those signals to define a cohesive CSS variable system and base styles shared across all pages.

---

BUSINESS DETAILS:
Name:         [Full name or practice name]
Profession:   [e.g. Osteopath, Naturopath, Coach, Photographer]
Tagline:      [One sentence — what they do and for whom]
Location:     [City, Country]
Contact:      [Email and/or phone to appear on site]
Social:       [Instagram, LinkedIn, etc. — or leave blank]

---

TONE & AESTHETIC:
[Describe the feeling the site should evoke.]

---

PAGES TO GENERATE:
[List each page, its filename, its nav label, and the sections it should contain. Example:

1. index.html — "Home" (nav label)
   - Hero: full-width header with name, tagline, CTA button
   - About preview: one paragraph + photo, linking to the About page
   - Services preview: 3 cards linking to the Services page
   - Testimonials: 3 short client quotes
   - Contact CTA: short call to action linking to Contact page
   - Footer: name, copyright, social links

2. about.html — "About"
   - Hero: page title banner
   - Story: full bio with photo, 3–4 paragraphs
   - Values: 3 cards (e.g. Holistic, Evidence-based, Compassionate)
   - Footer: same as home

3. services.html — "Services"
   - Hero: page title banner
   - Services: detailed cards for each service with pricing
   - Booking CTA: prominent button
   - Footer: same as home

4. contact.html — "Contact"
   - Hero: page title banner
   - Contact details: email, phone, address
   - Contact form (static mailto:)
   - Map embed or location description
   - Footer: same as home

Adjust pages, filenames, and sections to match the actual site.]

---

TECHNICAL REQUIREMENTS:
Generate one HTML file per page, plus a webby-pages.json manifest. Requirements for each file:

1. DOCTYPE html5, semantic HTML, mobile-first responsive layout
2. No external CSS frameworks — all styles inline in a <style> block
3. IDENTICAL <style> block in every page — the same CSS custom property system and base styles:
   --color-primary, --color-secondary, --color-accent,
   --color-bg, --color-bg-alt, --color-text, --color-text-muted,
   --font-heading, --font-body,
   --space-xs through --space-xl,
   --container-width, --radius, --shadow
4. Google Fonts import for the chosen typefaces (2 max) — same import in every page
5. Each section must have:
   - data-zone="{slug}" on the <section> element (slug must be unique within the page)
   - data-zone-label="{Human Label}" on the <section> element
   - data-editable on every user-editable text element (headings, paragraphs, spans)
   - data-editable-image on every <img> element
6. IDENTICAL <nav> in every page — links between pages use relative paths (e.g. ./about.html).
   For single-page anchor links (e.g. on index.html) use ./index.html#section-id
7. Responsive mobile navigation (hamburger toggle using only CSS or minimal inline JS)
   Mobile nav requirements — these are mandatory, not optional:
   - The expanded mobile menu must be fully visible on screen and never clipped
   - Use position: fixed or position: absolute for the expanded menu
   - Set a z-index high enough (e.g. 9000) that the menu appears above all page content
   - Do not use the CSS property of "backdrop-filter" in the nav
   - The menu must be scrollable (overflow-y: auto) if it could exceed viewport height
   - The menu must open AND close correctly on repeated hamburger clicks
8. No JavaScript frameworks — vanilla JS only, and only where necessary
9. Include in the <head> of EVERY page, immediately after the <style> block:
   <script src="./secrets.js"></script>
   <script src="https://swill.github.io/webby/webby.js"></script>
   (These will be stripped on export — they enable edit mode locally)
10. Set a unique, descriptive <title> and <meta name="description"> for each page
11. All placeholder text should be realistic and relevant to the profession
12. Placeholder images: <img src="./assets/placeholder.jpg" data-editable-image alt="..." />
13. The overall visual result should be polished, professional, and production-ready

---

webby-pages.json FORMAT:
Also output a webby-pages.json file with this exact structure:
{
  "pages": [
    { "file": "index.html",    "title": "Home — [Business Name]",    "navLabel": "Home" },
    { "file": "about.html",    "title": "About — [Business Name]",   "navLabel": "About" },
    { "file": "services.html", "title": "Services — [Business Name]","navLabel": "Services" },
    { "file": "contact.html",  "title": "Contact — [Business Name]", "navLabel": "Contact" }
  ]
}
(Adjust entries to match the pages you generate.)

---

OUTPUT FORMAT:
Return each file separated by a marker in this exact format:

=== FILE: index.html ===
<!DOCTYPE html>
...

=== FILE: about.html ===
<!DOCTYPE html>
...

=== FILE: webby-pages.json ===
{
  "pages": [...]
}

No explanation, no markdown fences around file contents, no preamble.
```

---

## After Running the Prompt

### Single-page site

1. Save the output as `index.html` in your site folder.

### Multi-page site

1. Copy each `=== FILE: xxx ===` section into its own file in your site folder.
   You'll have `index.html`, `about.html`, etc. and `webby-pages.json`.

### Both

2. **Add `secrets.js`** to the same folder:
   ```js
   window.SITE_SECRETS = {
     geminiKey:   "AIza...",       // Free at aistudio.google.com
     githubToken: "ghp_...",
     repo:        "username/repo-name",
     branch:      "main"
   };
   ```

3. **Open any page in Chrome, Edge, or Safari 15.2+** — edit mode activates automatically. Firefox is not supported.

4. **Link your site folder** — a banner will appear below the toolbar. Click **Select Folder** and choose the folder containing your HTML files. Once linked, every edit saves automatically, and nav changes sync across all pages.

5. Replace placeholder text by clicking and typing directly on the page.

6. Replace placeholder images by clicking on any image.

7. Use the **Pages** toolbar button to see all pages, navigate between them, or add new pages with AI.

8. Click **Publish** when ready — all pages are published together.

---

## Tips for Better Results

**Images:** The more specific your inspiration images, the more accurate the palette and typography. A screenshot of a site you love works better than a vague description.

**Vibe description:** Don't overthink it. "Calm, clean, like a spa" is enough. The images do most of the work.

**Sections:** It's easier to delete a section you don't need than to add a new one. Start with more than less.

**Multi-page nav links:** The generated nav uses `./page.html` relative paths. Smooth-scroll anchor links within a page use `./index.html#section-id` so they work correctly whether you're on the home page or another page.

**Placeholder content:** Ask Claude to write realistic placeholder copy for your specific profession. Generic lorem ipsum leads to a generic layout.

---

## Re-running for Iterations

If the first output isn't quite right, follow up with targeted adjustments:

```
The overall structure is good. Please adjust:
- The primary color is too cool/blue — shift it warmer toward [describe]
- The hero section feels too sparse — add a subtle background element
- The services cards need more visual separation
Return only the updated files in the same === FILE: xxx === format.
```
