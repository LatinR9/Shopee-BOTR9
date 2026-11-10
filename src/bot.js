import { SELECTORS, clickFirst, anyVisible } from "./selectors.js";
import { screenshot } from "./browser.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

/** Wait until sale start minus preclickMs, logging countdown. */
export async function waitForSaleStart(config) {
  if (!config.saleStart) {
    log("No SHOPEE_SALE_START set — running immediately.");
    return;
  }

  const target = config.saleStart.getTime() - config.preclickMs;
  let remaining = target - Date.now();

  if (remaining <= 0) {
    log("Sale start already reached — starting now.");
    return;
  }

  log(
    `Waiting until ${config.saleStart.toISOString()} (preclick ${config.preclickMs}ms)…`
  );

  while (remaining > 0) {
    const chunk = Math.min(remaining, remaining > 10_000 ? 5_000 : 200);
    await sleep(chunk);
    remaining = target - Date.now();
    if (remaining > 2000) {
      log(`T-${Math.ceil(remaining / 1000)}s`);
    }
  }
  log("Go!");
}

async function selectVariants(page, variants) {
  for (const label of variants) {
    const patterns = [
      `button:has-text("${label}")`,
      `[role="button"]:has-text("${label}")`,
      `div:has-text("${label}")`,
    ];
    try {
      const used = await clickFirst(page, patterns, { timeout: 2500 });
      log(`Selected variant "${label}" via ${used}`);
    } catch {
      log(`Warning: could not click variant "${label}" — check SHOPEE_VARIANTS`);
    }
  }
}

async function setQuantity(page, quantity) {
  if (quantity <= 1) return;
  for (let i = 1; i < quantity; i++) {
    try {
      await clickFirst(page, SELECTORS.qtyIncrease, { timeout: 1500 });
    } catch {
      log("Could not increase quantity — leaving default.");
      break;
    }
  }
}

/**
 * Rapidly try Buy Now until success or timeout.
 * Shopee often disables the button until the flash sale unlocks.
 */
async function spamBuyNow(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    for (const sel of SELECTORS.buyNow) {
      try {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (!visible) continue;
        const disabled = await loc.isDisabled().catch(() => false);
        if (disabled) continue;
        await loc.click({ timeout: 250, force: true });
        log(`Buy Now clicked (${sel}) after ${attempts} attempt(s)`);
        return true;
      } catch {
        // keep spamming
      }
    }
    // Soft reload occasionally if button never appears
    if (attempts % 80 === 0) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await dismissLanguageGate(page).catch(() => {});
    }
    await sleep(25);
  }

  log(`Buy Now failed after ${attempts} attempt(s)`);
  return false;
}

async function tryCheckout(page, autoPlaceOrder) {
  // Cart popup / checkout page
  const onCheckout =
    page.url().includes("/checkout") ||
    (await anyVisible(page, SELECTORS.checkout, 4000));

  if (await anyVisible(page, SELECTORS.checkout, 3000)) {
    try {
      await clickFirst(page, SELECTORS.checkout, { timeout: 5000 });
      log("Checkout clicked.");
    } catch (err) {
      log(`Checkout click failed: ${err.message}`);
    }
  } else if (!onCheckout) {
    log("Checkout button not found — may already be on checkout or need manual step.");
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});

  if (autoPlaceOrder) {
    try {
      await clickFirst(page, SELECTORS.placeOrder, { timeout: 8000 });
      log("Place Order clicked (SHOPEE_AUTO_PLACE_ORDER=true).");
    } catch (err) {
      log(`Place Order not clicked: ${err.message}`);
    }
  } else {
    log("Stopped before Place Order (set SHOPEE_AUTO_PLACE_ORDER=true to auto-confirm).");
  }
}

/** Detect Shopee anti-bot / traffic verify interstitial. */
export async function detectTrafficBlock(page) {
  const url = page.url();
  if (url.includes("/verify/traffic") || url.includes("verify/captcha")) {
    return url;
  }
  const blocked = await page
    .getByText(/เข้าสู่หน้าที่ต้องการไม่สำเร็จ|unusual traffic|Too many requests/i)
    .first()
    .isVisible()
    .catch(() => false);
  return blocked ? url : null;
}

/** Dismiss Shopee's first-visit language picker if present. */
export async function dismissLanguageGate(page) {
  const visible = await anyVisible(
    page,
    [...SELECTORS.languageThai, ...SELECTORS.languageEnglish],
    2500
  );
  if (!visible) return false;

  try {
    await clickFirst(page, SELECTORS.languageThai, { timeout: 2000 });
    log('Selected language: ไทย');
  } catch {
    await clickFirst(page, SELECTORS.languageEnglish, { timeout: 2000 });
    log("Selected language: English");
  }
  await page.waitForTimeout(500);
  return true;
}

/**
 * Main flash-sale purchase attempt.
 * Goes as far as the platform allows without storing secrets in code.
 */
export async function runFlashSale(page, config) {
  log(`Opening product: ${config.productUrl}`);
  await page.goto(config.productUrl, { waitUntil: "domcontentloaded" });
  await dismissLanguageGate(page);

  // Language gate sometimes navigates away — return to product.
  if (!page.url().includes("/product/") && !page.url().includes("-i.")) {
    await page.goto(config.productUrl, { waitUntil: "domcontentloaded" });
  }

  const blocked = await detectTrafficBlock(page);
  if (blocked) {
    const shot = await screenshot(page, "traffic-block");
    log(`Shopee anti-bot / traffic check hit: ${blocked}`);
    log(`Screenshot: ${shot}`);
    log(
      "Tip: run headed (`SHOPEE_HEADLESS=false` or `--headed`), complete any CAPTCHA, then `npm run login` to reuse the session."
    );
    return { ok: false, reason: "traffic_block", url: blocked };
  }

  if (config.dryRun) {
    log("DRY RUN — warming page only, no Buy Now.");
    await selectVariants(page, config.variants);
    await setQuantity(page, config.quantity);
    const shot = await screenshot(page, "dry-run");
    log(`Screenshot: ${shot}`);
    return { ok: true, dryRun: true };
  }

  // Warm the page + variants before the clock hits
  await selectVariants(page, config.variants);
  await setQuantity(page, config.quantity);

  await waitForSaleStart(config);

  // Refresh right at go-time for freshest stock state
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await selectVariants(page, config.variants);
  await setQuantity(page, config.quantity);

  const bought = await spamBuyNow(page, config.clickTimeoutMs);
  const shot = await screenshot(page, bought ? "buy-clicked" : "buy-failed");
  log(`Screenshot: ${shot}`);

  if (!bought) {
    return { ok: false, reason: "buy_now_timeout" };
  }

  await tryCheckout(page, config.autoPlaceOrder);
  const finalShot = await screenshot(page, "checkout");
  log(`Final screenshot: ${finalShot}`);

  return { ok: true };
}
