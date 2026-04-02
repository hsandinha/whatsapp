#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${PUPPETEER_CACHE_DIR:-$ROOT_DIR/.cache/puppeteer}"

export PUPPETEER_CACHE_DIR="$CACHE_DIR"

echo "[render-build] PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR"

npm install
npx puppeteer browsers install chrome

node <<'EOF'
const fs = require("fs");
const path = require("path");

function findChromeExecutable(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name === "chrome" ||
          entry.name === "chrome.exe" ||
          entry.name === "Chromium")
      ) {
        return entryPath;
      }
    }
  }

  return null;
}

const cacheDir = process.env.PUPPETEER_CACHE_DIR;
const chromePath = findChromeExecutable(cacheDir);

console.log(`[render-build] Chrome: ${chromePath || "nao encontrado"}`);

if (!chromePath) {
  process.exit(1);
}
EOF
