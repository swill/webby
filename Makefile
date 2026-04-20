# GitQi — development and release tooling
# Requires: git, node (for syntax check), python3 (for local server), curl (for fonts)

CURRENT_VERSION := $(shell cat VERSION)

# Load local secrets (GOOGLE_FONTS_API_KEY, …) from .env if present.
# .env is gitignored; see .env.example for the template.
-include .env
export

.DEFAULT_GOAL := help

.PHONY: help serve check release fonts

# ── Help ──────────────────────────────────────────────────────────────────────

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "  Current version: \033[33mv$(CURRENT_VERSION)\033[0m"

# ── Development ───────────────────────────────────────────────────────────────

# ── Local dev server ──────────────────────────────────────────────────────────
#
# Mirrors GitHub Pages' `Access-Control-Allow-Origin: *` header so gitqi.js
# loaded from http://localhost:8080 can fetch google-fonts.json even when the
# test page is opened via file:// (origin `null`).

define CORS_HTTP_SERVER_PY
import http.server, socketserver, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT} (CORS: *)")
    httpd.serve_forever()
endef
export CORS_HTTP_SERVER_PY

serve: ## Start a local HTTP server on port 8080 (CORS enabled)
	@python3 -c "$$CORS_HTTP_SERVER_PY" 8080

check: ## Validate JavaScript syntax
	@node --check gitqi.js && echo "gitqi.js — syntax OK"

# ── Font manifest ─────────────────────────────────────────────────────────────
#
# Fetches the full Google Fonts catalog from the Developer API and writes a
# normalized manifest to google-fonts.json (sibling to gitqi.js, served via
# GitHub Pages at the same base URL).
#
# Requires GOOGLE_FONTS_API_KEY in .env (copy .env.example to .env).

define BUILD_FONTS_MANIFEST_PY
import sys, json
def weights(variants):
    ws = set()
    for v in variants:
        if v == "regular": ws.add("400")
        elif v.isdigit():  ws.add(v)
    return ";".join(sorted(ws, key=int)) or "400"
data = json.load(sys.stdin)
# API is called with sort=popularity, so array order IS the popularity ranking.
# Consumers that want "top N most popular" can just slice from the front.
out = [
    {"name": i["family"], "cat": i["category"], "weights": weights(i["variants"])}
    for i in data["items"]
]
json.dump(out, sys.stdout, separators=(",", ":"))
endef
export BUILD_FONTS_MANIFEST_PY

fonts: ## Fetch Google Fonts catalog and regenerate google-fonts.json
ifndef GOOGLE_FONTS_API_KEY
	$(error GOOGLE_FONTS_API_KEY not set — copy .env.example to .env and fill in your key)
endif
	@echo "Fetching Google Fonts catalog..."
	@curl -fsSL "https://www.googleapis.com/webfonts/v1/webfonts?key=$(GOOGLE_FONTS_API_KEY)&sort=popularity" \
		| python3 -c "$$BUILD_FONTS_MANIFEST_PY" > google-fonts.json
	@python3 -c 'import json, sys; print("Wrote google-fonts.json (%d families)" % len(json.load(sys.stdin)))' < google-fonts.json

# ── Release ───────────────────────────────────────────────────────────────────
#
# Usage: make release VERSION=1.2.0
#
# What it does:
#   1. Updates the version string in gitqi.js (comment + constant)
#   2. Writes the new version to the VERSION file
#   3. Creates a pinned copy: gitqi-<version>.js
#   4. Commits all three files
#   5. Tags the commit as v<version>
#   6. Pushes commits and tags (triggers GitHub Pages deploy)
#
# After pushing, sites can reference either:
#   Latest:  https://<user>.github.io/<repo>/gitqi.js
#   Pinned:  https://<user>.github.io/<repo>/gitqi-<version>.js

release: check ## Release a new version. Usage: make release VERSION=1.2.0
ifndef VERSION
	$(error VERSION is required — usage: make release VERSION=1.2.0)
endif
	@# Refuse if version is unchanged
	@if [ "$(VERSION)" = "$(CURRENT_VERSION)" ]; then \
		echo "Error: VERSION $(VERSION) is already the current version."; \
		exit 1; \
	fi
	@echo "Releasing v$(VERSION) (was v$(CURRENT_VERSION))..."
	@# Stamp the header comment
	@sed -i "s|^/\* gitqi\.js — v.*|/* gitqi.js — v$(VERSION)|" gitqi.js; \
	 sed -i "s|^\( \* gitqi\.js — \)v[0-9][^ ]*|\1v$(VERSION)|" gitqi.js
	@# Stamp the VERSION constant inside the IIFE
	@sed -i "s|const VERSION = '[^']*'|const VERSION = '$(VERSION)'|" gitqi.js
	@# Write the VERSION file
	@echo "$(VERSION)" > VERSION
	@# Create the pinned versioned copy
	@cp gitqi.js gitqi-$(VERSION).js
	@echo "  Created gitqi-$(VERSION).js"
	@# Commit
	@git add gitqi.js gitqi-$(VERSION).js VERSION
	@git commit -m "Release v$(VERSION)"
	@# Tag
	@git tag v$(VERSION)
	@echo "  Tagged v$(VERSION)"
	@# Push
	@git push
	@git push --tags
	@echo ""
	@echo "Done. GitHub Pages will deploy shortly."
	@echo "Latest URL:  https://\$$(git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$$||' | awk -F/ '{print $$1\".github.io/\"$$2}')/gitqi.js"
	@echo "Pinned URL:  https://\$$(git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$$||' | awk -F/ '{print $$1\".github.io/\"$$2}')/gitqi-$(VERSION).js"
