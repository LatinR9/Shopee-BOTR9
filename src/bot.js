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

/**
 * Click a product option button, skipping it when already selected
 * (Shopee toggles a selected option off on a second click).
 */
async function selectOption(page, label) {
  const quoted = JSON.stringify(label);
  const patterns = [
    `button.product-variation[aria-label=${quoted}]`,
    `button[class*="product-variation"][aria-label=${quoted}]`,
    `button[aria-label=${quoted}]`,
    `button.product-variation:text-is(${quoted})`,
    `button:text-is(${quoted})`,
  ];
  for (const sel of patterns) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible({ timeout: 150 }).catch(() => false))) continue;
    const selected = await loc
      .evaluate((el) => {
        const cls = String(el.className || "");
        return (
          /selected|active/i.test(cls) ||
          el.getAttribute("aria-checked") === "true" ||
          el.getAttribute("aria-pressed") === "true" ||
          Boolean(el.querySelector('[class*="tick"]'))
        );
      })
      .catch(() => false);
    if (selected) return true;
    await loc.click({ timeout: 1000 });
    return true;
  }
  return false;
}

async function selectVariantLabels(page, labels, log) {
  let ok = true;
  for (const label of labels) {
    if (!(await selectOption(page, label).catch(() => false))) {
      log(`คำเตือน: หาตัวเลือก "${label}" ไม่เจอ`);
      ok = false;
    }
  }
  return ok;
}

/** Type the quantity directly; falls back to clicking "+". */
async function setQuantityExact(page, quantity, log) {
  for (const sel of SELECTORS.qtyInput) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible({ timeout: 200 }).catch(() => false))) continue;
    try {
      await loc.fill(String(quantity));
      await loc.press("Tab").catch(() => {});
      return;
    } catch {
      // try next
    }
  }
  await setQuantity(page, quantity, log);
}

/**
 * Select one variant and click Add to Cart, retrying until the button
 * unlocks or timeoutMs passes.
 */
async function addVariantToCart(page, variant, timeoutMs, { log, signal }) {
  const deadline = Date.now() + timeoutMs;
  const name = variant.labels.join(" / ");
  let attempts = 0;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    attempts += 1;
    await selectVariantLabels(page, variant.labels, attempts === 1 ? log : () => {});
    if (attempts === 1) await setQuantityExact(page, variant.quantity, log);

    for (const sel of SELECTORS.addToCart) {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      if (await loc.isDisabled().catch(() => false)) continue;
      try {
        await loc.click({ timeout: 500 });
      } catch {
        continue;
      }
      const outcome = await Promise.race([
        page.getByText(SELECTORS.addedToCartToast).first().waitFor({ timeout: 2500 }).then(() => "ok"),
        page.getByText(SELECTORS.variantRequiredMsg).first().waitFor({ timeout: 2500 }).then(() => "need_variant"),
      ]).catch(() => "unknown");

      if (outcome === "ok") {
        log(`ใส่รถเข็นแล้ว: ${name} × ${variant.quantity}`);
        return true;
      }
      if (outcome === "unknown") {
        log(`กดใส่รถเข็นแล้ว (ไม่เห็นข้อความยืนยัน): ${name} × ${variant.quantity}`);
        return true;
      }
      break;
    }
    if (attempts % 80 === 0) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
    await sleep(40, signal);
  }
  log(`ใส่รถเข็นไม่สำเร็จ: ${name}`);
  return false;
}

/**
 * On /cart: tick exactly the rows for this product + chosen variants and
 * untick everything else. Returns how many target rows are ticked.
 */
async function syncCartSelection(page, itemName, variants) {
  const targets = variants.map((v) => v.labels);
  const namePrefix = String(itemName || "").slice(0, 25);
  let lastTicked = 0;

  // Phase "untick" clears other items (shop / select-all boxes cascade, so one
  // click per pass). Phase "tick" then never re-checks aggregates, which
  // Shopee auto-ticks once all their items are ticked.
  const phases = [...Array(8).fill("untick"), "tick", "tick"];
  let untickDone = false;
  for (const phase of phases) {
    if (phase === "untick" && untickDone) continue;
    const { clicks, ticked } = await page.evaluate(
      ({ targets, namePrefix, phase }) => {
        const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matchers = targets.map(
          (labels) => new RegExp(`(^|[\\s:,])${escape(labels.join(","))}($|[\\s,])`)
        );
        const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const rows = boxes.map((input) => {
          let row = input.parentElement;
          while (row?.parentElement && row.parentElement.querySelectorAll('input[type="checkbox"]').length === 1) {
            row = row.parentElement;
          }
          const text = (row?.innerText || "").replace(/\s+/g, " ");
          const label = input.closest("label") || input;
          const checked = input.checked || /checked/.test(String(label.className || ""));
          const isTarget =
            (!namePrefix || text.includes(namePrefix)) && matchers.some((re) => re.test(text));
          return { input, label, checked, isTarget };
        });

        const ticked = rows.filter((r) => r.isTarget && r.checked).length;
        if (phase === "untick") {
          const wrong = rows.find((r) => r.checked && !r.isTarget);
          if (!wrong) return { clicks: 0, ticked };
          wrong.label.click();
          return { clicks: 1, ticked };
        }
        let clicks = 0;
        for (const r of rows) {
          if (r.isTarget && !r.checked) {
            r.label.click();
            clicks += 1;
          }
        }
        return { clicks, ticked: ticked + clicks };
      },
      { targets, namePrefix, phase }
    );
    lastTicked = ticked;
    if (clicks > 0) await page.waitForTimeout(250);
    else if (phase === "tick") break;
    else untickDone = true;
  }
  return lastTicked;
}

async function placeOrderStep(page, autoPlaceOrder, log) {
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

async function checkoutFromCart(page, config, variants, itemName, log) {
  await page.goto(`${config.baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[type="checkbox"]')
    .first()
    .waitFor({ state: "attached", timeout: 10000 })
    .catch(() => {});

  const ticked = await syncCartSelection(page, itemName, variants);
  if (ticked < variants.length) {
    log(`คำเตือน: เลือกในรถเข็นได้ ${ticked}/${variants.length} รายการ — ตรวจในเบราว์เซอร์ก่อนจ่าย`);
  } else {
    log(`เลือกสินค้าในรถเข็นครบ ${ticked} รายการ`);
  }

  if (!page.url().includes("/cart")) {
    log("ไม่ได้อยู่หน้ารถเข็น — กรุณากดชำระเงินเอง");
    return false;
  }
  try {
    await clickFirst(page, SELECTORS.cartCheckout, { timeout: 5000 });
    await page.waitForURL(/\/checkout/, { timeout: 10000 });
    log("ไปหน้าชำระเงินแล้ว");
  } catch (err) {
    log(`ไปหน้าชำระเงินไม่ได้: ${err.message} — กดเองในเบราว์เซอร์`);
    return false;
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await placeOrderStep(page, config.autoPlaceOrder, log);
  return true;
}

async function readItemName(page) {
  return page
    .evaluate(
      () =>
        document.querySelector("h1")?.textContent?.trim() ||
        document.title.replace(/\s*\|\s*Shopee.*$/i, "").trim()
    )
    .catch(() => "");
}

/**
 * Several variants: put them all in the cart (before the sale if Shopee
 * allows, otherwise right when it opens), then one checkout from /cart.
 */
async function runMultiVariant(page, config, { log, logger, signal }) {
  const variants = config.variantPlan;
  const itemName = config.itemName || (await readItemName(page));
  log(`ซื้อหลายตัวเลือก (${variants.length}): ${variants.map((v) => `${v.labels.join("/")}×${v.quantity}`).join(", ")}`);

  if (config.dryRun) {
    for (const v of variants) {
      const ok = await selectVariantLabels(page, v.labels, log);
      log(`${ok ? "เจอ" : "ไม่เจอ"}ตัวเลือก: ${v.labels.join(" / ")}`);
    }
    const shot = await screenshot(page, "dry-run");
    log(`สกรีนช็อต: ${shot}`);
    return { ok: true, dryRun: true };
  }

  const pending = [];
  const saleOpen = !config.saleStart || config.saleStart.getTime() - config.preclickMs <= Date.now();
  if (!saleOpen && config.preAddToCart) {
    log("ใส่รถเข็นล่วงหน้าก่อนเริ่มขาย (ราคาจะเปลี่ยนเป็นราคา Flash Sale ตอนเริ่ม)");
    for (const v of variants) {
      if (!(await addVariantToCart(page, v, 4000, { log, signal }))) pending.push(v);
    }
  } else {
    pending.push(...variants);
  }

  await waitForSaleStart(config, { logger, signal });
  throwIfAborted(signal);

  if (pending.length) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const perVariant = Math.max(3000, Math.floor(config.clickTimeoutMs / pending.length));
    let added = 0;
    for (const v of pending) {
      if (await addVariantToCart(page, v, perVariant, { log, signal })) added += 1;
    }
    if (added === 0 && pending.length === variants.length) {
      const shot = await screenshot(page, "buy-failed");
      log(`สกรีนช็อต: ${shot}`);
      return { ok: false, reason: "add_to_cart_failed" };
    }
  }

  const checkedOut = await checkoutFromCart(page, config, variants, itemName, log);
  const finalShot = await screenshot(page, "checkout");
  log(`สกรีนช็อตสุดท้าย: ${finalShot}`);
  return checkedOut ? { ok: true } : { ok: false, reason: "cart_checkout_failed" };
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

  const plan = config.variantPlan || [];
  if (plan.length > 1) {
    if (config.dryRun) log("โหมดทดสอบ — เปิดหน้าสินค้าอย่างเดียว ไม่กดซื้อ");
    return runMultiVariant(page, config, { log, logger, signal });
  }

  const applyChoice =
    plan.length === 1
      ? async () => {
          await selectVariantLabels(page, plan[0].labels, log);
          await setQuantityExact(page, plan[0].quantity, log);
        }
      : async () => {
          await selectVariants(page, config.variants, log);
          await setQuantity(page, config.quantity, log);
        };

  if (config.dryRun) {
    log("โหมดทดสอบ — เปิดหน้าสินค้าอย่างเดียว ไม่กดซื้อ");
    await applyChoice();
    const shot = await screenshot(page, "dry-run");
    log(`สกรีนช็อต: ${shot}`);
    return { ok: true, dryRun: true };
  }

  await applyChoice();

  await waitForSaleStart(config, { logger, signal });
  throwIfAborted(signal);

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await applyChoice();

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
