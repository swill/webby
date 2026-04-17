# Webby — development and release tooling
# Requires: git, node (for syntax check), python3 (for local server)

CURRENT_VERSION := $(shell cat VERSION)

.DEFAULT_GOAL := help

.PHONY: help serve check release

# ── Help ──────────────────────────────────────────────────────────────────────

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "  Current version: \033[33mv$(CURRENT_VERSION)\033[0m"

# ── Development ───────────────────────────────────────────────────────────────

serve: ## Start a local HTTP server on port 8080
	@echo "Serving at http://localhost:8080"
	python3 -m http.server 8080

check: ## Validate JavaScript syntax
	@node --check webby.js && echo "webby.js — syntax OK"

# ── Release ───────────────────────────────────────────────────────────────────
#
# Usage: make release VERSION=1.2.0
#
# What it does:
#   1. Updates the version string in webby.js (comment + constant)
#   2. Writes the new version to the VERSION file
#   3. Creates a pinned copy: webby-<version>.js
#   4. Commits all three files
#   5. Tags the commit as v<version>
#   6. Pushes commits and tags (triggers GitHub Pages deploy)
#
# After pushing, sites can reference either:
#   Latest:  https://<user>.github.io/<repo>/webby.js
#   Pinned:  https://<user>.github.io/<repo>/webby-<version>.js

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
	@sed -i "s|^/\* webby\.js — v.*|/* webby.js — v$(VERSION)|" webby.js; \
	 sed -i "s|^\( \* webby\.js — \)v[0-9][^ ]*|\1v$(VERSION)|" webby.js
	@# Stamp the VERSION constant inside the IIFE
	@sed -i "s|const VERSION = '[^']*'|const VERSION = '$(VERSION)'|" webby.js
	@# Write the VERSION file
	@echo "$(VERSION)" > VERSION
	@# Create the pinned versioned copy
	@cp webby.js webby-$(VERSION).js
	@echo "  Created webby-$(VERSION).js"
	@# Commit
	@git add webby.js webby-$(VERSION).js VERSION
	@git commit -m "Release v$(VERSION)"
	@# Tag
	@git tag v$(VERSION)
	@echo "  Tagged v$(VERSION)"
	@# Push
	@git push
	@git push --tags
	@echo ""
	@echo "Done. GitHub Pages will deploy shortly."
	@echo "Latest URL:  https://\$$(git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$$||' | awk -F/ '{print $$1\".github.io/\"$$2}')/webby.js"
	@echo "Pinned URL:  https://\$$(git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$$||' | awk -F/ '{print $$1\".github.io/\"$$2}')/webby-$(VERSION).js"
