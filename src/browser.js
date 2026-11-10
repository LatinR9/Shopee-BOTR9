import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Launch Chromium with a persistent profile so login/session survives restarts.
 * Profile dir is local-only (.auth/) and gitignored.
 */
export async function launchBrowser(config) {
  const userDataDir = path.resolve(config.userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  // Soften obvious automation fingerprints (not a bypass guarantee).
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20_000);
  return { context, page };
}

export async function screenshot(page, name) {
  const dir = path.resolve("screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}
