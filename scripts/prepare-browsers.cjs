/**
 * Install Playwright Chromium into ./ms-playwright so electron-builder
 * can ship it inside the Windows app (no separate install for users).
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", "ms-playwright");
fs.mkdirSync(target, { recursive: true });

console.log("[prepare-browsers] Installing Chromium into", target);
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "install", "chromium"],
  {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target },
    shell: process.platform === "win32",
  }
);

if (result.status !== 0) {
  console.error("[prepare-browsers] Failed");
  process.exit(result.status || 1);
}

console.log("[prepare-browsers] Done");
