import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Point Playwright at bundled Chromium when running inside Electron / packaged app.
 * Call once at process start (Electron main does this).
 */
export function configurePlaywrightBrowsersPath(resourcesPath) {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;

  const candidates = [];
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, "ms-playwright"));
  }
  // Dev / CI fallback: browsers already installed by `npx playwright install`
  candidates.push(path.join(process.cwd(), "ms-playwright"));

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
      return dir;
    }
  }
  return null;
}

/**
 * Launch Chromium with a persistent profile so login/session survives restarts.
 * Profile dir is local-only and never committed.
 */
export async function launchBrowser(config) {
  const userDataDir = path.resolve(config.userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: Boolean(config.headless),
    viewport: { width: 1280, height: 900 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      // Keep background product windows firing at sale time
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20_000);
  return { context, page };
}

export async function screenshot(page, name) {
  const dir = path.resolve(
    process.env.SHOPEE_SCREENSHOT_DIR || path.join(process.cwd(), "screenshots")
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}
