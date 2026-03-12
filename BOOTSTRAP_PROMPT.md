# Bootstrap Prompt — New Site Generator

Use this prompt with Claude Code (or Claude.ai) to generate the initial `index.html` for a new site. Fill in all `[BRACKETED]` sections before running.

---

## Instructions for Use

1. Gather the following before running:
   - 2–5 inspiration images (photos, screenshots, color palettes)
   - A short description of the practice / business
   - The sections you want on the site
   - A "vibe" description (tone, feel, aesthetic)

2. Paste the prompt below into Claude Code or Claude.ai, attach your images, and fill in the variables.

3. The output will be a complete `index.html` ready to drop into your site repo.

---

## The Prompt

```
You are generating the initial downloadable index.html for a professional website.

I am attaching [N] inspiration images. Analyze them for:
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
8. No JavaScript frameworks — vanilla JS only, and only where necessary
9. Include this script tag in the <head>, immediately after the <style> block:
   <script src="./secrets.js"></script>
   <script src="https://[YOUR_CDN]/webby.js"></script>
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

## After Running the Prompt

Once you have `index.html`:

1. **Review the palette** — check the CSS variables at the top of the `<style>` block and adjust any colors that don't feel right.

2. **Add `secrets.js`** to the same folder:
   ```js
   window.SITE_SECRETS = {
     geminiKey:   "AIza...",       // Free at aistudio.google.com
     githubToken: "ghp_...",
     repo:        "username/repo-name",
     branch:      "main"
   };
   ```

3. **Open `index.html` in Chrome, Edge, or Safari** — edit mode activates automatically.

   > Firefox works but doesn't support saving back to the local file. Use Chrome or Edge for the best experience.

4. **Link your site folder** — a banner will appear below the toolbar. Click **Select Folder** and choose the folder containing `index.html`. The path is shown in the banner as a hint. Once linked, every edit saves automatically to your local file.

5. Replace placeholder text by clicking and typing directly on the page.

6. Replace placeholder images by clicking on any image.

7. Click **Publish** when ready.

---

## Tips for Better Results

**Images:** The more specific your inspiration images, the more accurate the palette and typography. A screenshot of a site you love works better than a vague description.

**Vibe description:** Don't overthink it. "Calm, clean, like a spa" is enough. The images do most of the work.

**Sections:** It's easier to delete a section you don't need than to add a new one. Start with more than less.

**Placeholder content:** Ask Claude to write realistic placeholder copy for your specific profession. Generic lorem ipsum leads to a generic layout.

---

## Re-running for Iterations

If the first output isn't quite right, follow up with targeted adjustments:

```
The overall structure is good. Please adjust:
- The primary color is too cool/blue — shift it warmer toward [describe]
- The hero section feels too sparse — add a subtle background element
- The services section cards need more visual separation
Return only the updated index.html.
```
