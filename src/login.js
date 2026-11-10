/**
 * Interactive / credential login helper.
 * Saves session into SHOPEE_USER_DATA_DIR (default .auth/user-data).
 *
 * Usage:
 *   cp .env.example .env   # set SHOPEE_USERNAME / SHOPEE_PASSWORD if desired
 *   npm run login
 *
 * If CAPTCHA or OTP appears, complete it manually in the opened browser window.
 */
import { loadConfig } from "./config.js";
import { launchBrowser, screenshot } from "./browser.js";
import { SELECTORS, clickFirst, anyVisible } from "./selectors.js";
import { dismissLanguageGate } from "./bot.js";

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.fill(value);
      return sel;
    }
  }
  throw new Error(`Could not find input for: ${selectors.join(" | ")}`);
}

async function main() {
  const config = loadConfig();
  const { context, page } = await launchBrowser({ ...config, headless: false });

  console.log(`[login] Opening ${config.baseUrl}/buyer/login`);
  await page.goto(`${config.baseUrl}/buyer/login`, { waitUntil: "domcontentloaded" });
  await dismissLanguageGate(page);
  if (!page.url().includes("/buyer/login")) {
    await page.goto(`${config.baseUrl}/buyer/login`, { waitUntil: "domcontentloaded" });
  }

  if (config.username && config.password) {
    try {
      await fillFirst(page, SELECTORS.loginUsername, config.username);
      await fillFirst(page, SELECTORS.loginPassword, config.password);
      await clickFirst(page, SELECTORS.loginSubmit, { timeout: 5000 });
      console.log("[login] Submitted credentials — complete CAPTCHA/OTP in the browser if asked.");
    } catch (err) {
      console.warn(`[login] Auto-fill failed (${err.message}). Log in manually in the window.`);
    }
  } else {
    console.log("[login] No SHOPEE_USERNAME/PASSWORD in .env — please log in manually in the browser.");
  }

  console.log("[login] Waiting up to 3 minutes for a logged-in session…");
  const ok = await page
    .waitForFunction(
      () => {
        const href = location.href;
        return !href.includes("/buyer/login") && !href.includes("/buyer/signup");
      },
      { timeout: 180_000 }
    )
    .then(() => true)
    .catch(() => false);

  if (ok || (await anyVisible(page, ['a[href*="/user"]', ".navbar-username"], 3000))) {
    console.log("[login] Session looks ready. Profile saved under:", config.userDataDir);
    await screenshot(page, "login-ok");
  } else {
    console.warn("[login] Timed out. Run again after logging in, or keep the browser open longer.");
    await screenshot(page, "login-timeout");
  }

  await context.close();
}

main().catch((err) => {
  console.error("[login] Fatal:", err.message);
  process.exit(1);
});
