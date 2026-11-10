import { SELECTORS, clickFirst, anyVisible } from "./selectors.js";
import { screenshot } from "./browser.js";

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function makeLog(logger) {
  if (!logger) {
    return (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
  }
  return (...args) => logger.info(...args);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/** Wait until sale start minus preclickMs, logging countdown. */
export async function waitForSaleStart(config, { logger, signal } = {}) {
  const log = makeLog(logger);
  if (!config.saleStart) {
    log("ไม่ได้ตั้งเวลาเริ่มขาย — เริ่มทันที");
    return;
  }

  const target = config.saleStart.getTime() - config.preclickMs;
  let remaining = target - Date.now();

  if (remaining <= 0) {
    log("ถึงเวลาขายแล้ว — เริ่มเลย");
    return;
  }

  log(
    `รอถึง ${config.saleStart.toLocaleString("th-TH")} (กดล่วงหน้า ${config.preclickMs} ms)…`
  );

  while (remaining > 0) {
    throwIfAborted(signal);
    const chunk = Math.min(remaining, remaining > 10_000 ? 5_000 : 200);
    await sleep(chunk, signal);
    remaining = target - Date.now();
    if (remaining > 2000) {
      log(`อีก ${Math.ceil(remaining / 1000)} วินาที`);
    }
  }
  log("เริ่มกด!");
}

async function selectVariants(page, variants, log) {
  for (const label of variants) {
    const patterns = [
      `button:has-text("${label}")`,
      `[role="button"]:has-text("${label}")`,
      `div:has-text("${label}")`,
    ];
    try {
      const used = await clickFirst(page, patterns, { timeout: 2500 });
      log(`เลือกตัวเลือก "${label}" แล้ว (${used})`);
    } catch {
      log(`คำเตือน: กดตัวเลือก "${label}" ไม่ได้ — ตรวจช่องตัวเลือกสินค้า`);
    }
  }
}

async function setQuantity(page, quantity, log) {
  if (quantity <= 1) return;
  for (let i = 1; i < quantity; i++) {
    try {
      await clickFirst(page, SELECTORS.qtyIncrease, { timeout: 1500 });
    } catch {
      log("เพิ่มจำนวนไม่ได้ — ใช้ค่าเริ่มต้น");
      break;
    }
  }
}

/**
 * Rapidly try Buy Now until success or timeout.
 * Shopee often disables the button until the flash sale unlocks.
 */
async function spamBuyNow(page, timeoutMs, { log, signal }) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    attempts += 1;
    for (const sel of SELECTORS.buyNow) {
      try {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (!visible) continue;
        const disabled = await loc.isDisabled().catch(() => false);
        if (disabled) continue;
        await loc.click({ timeout: 250, force: true });
        log(`กดซื้อสินค้าแล้ว (${sel}) หลังลอง ${attempts} ครั้ง`);
        return true;
      } catch {
        // keep spamming
      }
    }
    if (attempts % 80 === 0) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await dismissLanguageGate(page, { log }).catch(() => {});
    }
    await sleep(25, signal);
  }

  log(`กดซื้อไม่สำเร็จหลังลอง ${attempts} ครั้ง`);
  return false;
}

async function tryCheckout(page, autoPlaceOrder, log) {
  const onCheckout =
    page.url().includes("/checkout") ||
    (await anyVisible(page, SELECTORS.checkout, 4000));

  if (await anyVisible(page, SELECTORS.checkout, 3000)) {
    try {
      await clickFirst(page, SELECTORS.checkout, { timeout: 5000 });
      log("กดไปหน้าชำระเงินแล้ว");
    } catch (err) {
      log(`กด Checkout ไม่ได้: ${err.message}`);
    }
  } else if (!onCheckout) {
    log("ไม่พบปุ่ม Checkout — อาจอยู่หน้าชำระเงินแล้ว หรือต้องทำต่อเอง");
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});

  if (autoPlaceOrder) {
    try {
      await clickFirst(page, SELECTORS.placeOrder, { timeout: 8000 });
      log("กดสั่งซื้อแล้ว (เปิดยืนยันอัตโนมัติไว้)");
    } catch (err) {
      log(`ยังไม่ได้กดสั่งซื้อ: ${err.message}`);
    }
  } else {
    log("หยุดก่อนกดสั่งซื้อ — กรุณายืนยันการชำระเงินเองในหน้าต่างเบราว์เซอร์");
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

/** True if login form fields are already on screen (gate can be ignored). */
async function loginFormReady(page) {
  return anyVisible(page, SELECTORS.loginUsername, 400);
}

/**
 * Click a language button even when an SVG/overlay intercepts pointer events.
 * Never throws — returns true on success.
 */
async function clickLanguageOption(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 400 }).catch(() => false);
    if (!visible) continue;

    // 1) Playwright force click (ignores actionability / overlays)
    try {
      await loc.click({ timeout: 800, force: true });
      return true;
    } catch {
      // continue
    }

    // 2) DOM click via JS (bypasses hit-testing / SVG intercept)
    try {
      await loc.evaluate((el) => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        if (typeof el.click === "function") el.click();
      });
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Dismiss Shopee's first-visit language picker if present.
 * Prefer ไทย on .co.th. Never throws — login/buy flows must continue.
 */
export async function dismissLanguageGate(page, { log } = {}) {
  const write = log || ((...a) => console.log(...a));

  try {
    // Already past the gate (e.g. login form visible)
    if (await loginFormReady(page)) {
      return false;
    }

    const gateVisible = await anyVisible(
      page,
      [...SELECTORS.languageThai, ...SELECTORS.languageEnglish],
      1500
    );
    if (!gateVisible) return false;

    // Prefer Thai for shopee.co.th
    if (await clickLanguageOption(page, SELECTORS.languageThai)) {
      write("เลือกภาษา: ไทย");
      await page.waitForTimeout(300);
      return true;
    }

    if (await clickLanguageOption(page, SELECTORS.languageEnglish)) {
      write("เลือกภาษา: English");
      await page.waitForTimeout(300);
      return true;
    }

    write("ข้ามหน้าเลือกภาษา — กดปุ่มไม่ได้ แต่จะไปต่อ");
    return false;
  } catch (err) {
    write(`ข้ามหน้าเลือกภาษา (${err.message || err}) — ไปต่อ`);
    return false;
  }
}

/**
 * Main flash-sale purchase attempt.
 * Goes as far as the platform allows without storing secrets in code.
 */
export async function runFlashSale(page, config, { logger, signal } = {}) {
  const log = makeLog(logger);
  throwIfAborted(signal);

  log(`เปิดสินค้า: ${config.productUrl}`);
  await page.goto(config.productUrl, { waitUntil: "domcontentloaded" });
  await dismissLanguageGate(page, { log });

  if (!page.url().includes("/product/") && !page.url().includes("-i.")) {
    await page.goto(config.productUrl, { waitUntil: "domcontentloaded" });
  }

  const blocked = await detectTrafficBlock(page);
  if (blocked) {
    const shot = await screenshot(page, "traffic-block");
    log(`เจอหน้ากันบอทของ Shopee: ${blocked}`);
    log(`สกรีนช็อต: ${shot}`);
    log("แนะนำ: กดปุ่ม \"เข้าสู่ระบบ\" ให้ผ่าน CAPTCHA ก่อน แล้วลองใหม่");
    return { ok: false, reason: "traffic_block", url: blocked };
  }

  if (config.dryRun) {
    log("โหมดทดสอบ — เปิดหน้าสินค้าอย่างเดียว ไม่กดซื้อ");
    await selectVariants(page, config.variants, log);
    await setQuantity(page, config.quantity, log);
    const shot = await screenshot(page, "dry-run");
    log(`สกรีนช็อต: ${shot}`);
    return { ok: true, dryRun: true };
  }

  await selectVariants(page, config.variants, log);
  await setQuantity(page, config.quantity, log);

  await waitForSaleStart(config, { logger, signal });
  throwIfAborted(signal);

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await selectVariants(page, config.variants, log);
  await setQuantity(page, config.quantity, log);

  const bought = await spamBuyNow(page, config.clickTimeoutMs, { log, signal });
  const shot = await screenshot(page, bought ? "buy-clicked" : "buy-failed");
  log(`สกรีนช็อต: ${shot}`);

  if (!bought) {
    return { ok: false, reason: "buy_now_timeout" };
  }

  await tryCheckout(page, config.autoPlaceOrder, log);
  const finalShot = await screenshot(page, "checkout");
  log(`สกรีนช็อตสุดท้าย: ${finalShot}`);

  return { ok: true };
}
