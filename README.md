# Client Extension Extractor

A CLI tool to extract all CSS and/or JS resources from a web page and generate a Liferay Client Extension (CSS or JS).

---

## 📦 What It Does

-   Parses `<link rel="stylesheet">` and `<style>` tags (for CSS).
-   Parses `<script src="...">` and inline `<script>` tags (for JS).
-   Preserves the order of resources as they appear in the page.
-   Lets you interactively select which resources to include.
-   Generates:
    -   `global.css` or `global.js` inside `assets/`
    -   A `client-extension.yaml` with proper metadata
    -   A ZIP file with everything ready for Liferay

---

## 🚀 Usage

First, install dependencies:

```bash
npm install
```

## CLI Commands

| Command                                                   | Description                                       |
| --------------------------------------------------------- | ------------------------------------------------- |
| `npm run extract:css -- <url>`                            | Extract CSS resources                             |
| `npm run extract:js -- <url>`                             | Extract JS resources                              |
| `npm run extract:all -- <url>`                            | Extract both CSS and JS                           |
| `npm run extract:all:auto -- <url> --name "My Extension"` | Extract both modes automatically with shared name |
| `npm run clean`                                           | Delete the `output/temp` folder                   |

ℹ️ Arguments after -- are passed to the CLI script (cx.js).
For example: npm run extract:css -- https://example.com --all

---

## 🧠 Options

--mode=css|js: Explicitly set mode (optional; default runs both).
--all: Automatically include all resources (skip selection prompts).
--name "Your Extension Name": Sets the visible name for both CSS and JS extensions.

Output ZIPs are named based on the extension name (your-extension-css.zip, etc.).

---

### 📁 Output Example

```pgsql
output/
├── my-extension-css.zip
│   ├── assets/
│   │   └── global.css
│   └── client-extension.yaml
├── my-extension-js.zip
│   ├── assets/
│   │   └── global.js
│   └── client-extension.yaml
```
