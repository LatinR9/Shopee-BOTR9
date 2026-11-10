/**
 * Fast checkout helpers — select PromptPay QR and place order.
 */
import { SELECTORS, clickFirst, anyVisible } from "./selectors.js";

export const PAYMENT_SELECTORS = {
  openPaymentPicker: [
    'button:has-text("เลือกวิธีการชำระเงิน")',
    'button:has-text("Change Payment")',
    'button:has-text("เปลี่ยนวิธีการชำระ")',
    '[class*="payment"] button:has-text("เปลี่ยน")',
  ],
  // Prefer specific PromptPay chip buttons (avoid huge container divs).
  promptPay: [
    'button:has-text("QR พร้อมเพย์")',
    'button:has-text("QR PromptPay")',
    'button:has-text("PromptPay")',
    '[class*="checkout-payment"] button:has-text("พร้อมเพย์")',
    '[class*="checkout-payment"] button:has-text("PromptPay")',
    'label:has-text("QR พร้อมเพย์")',
    'label:has-text("QR PromptPay")',
  ],
  promptPaySelected: [
    'button:has-text("QR PromptPay")',
    'button:has-text("QR พร้อมเพย์")',
    '*:has-text("QR PromptPay")',
    '*:has-text("QR พร้อมเพย์")',
  ],
  confirmPayment: [
    '[class*="drawer"] button:has-text("ยืนยัน")',
    '[class*="modal"] button:has-text("ยืนยัน")',
    '[class*="drawer"] button:has-text("Confirm")',
    '[class*="modal"] button:has-text("Confirm")',
    '[role="dialog"] button:has-text("ยืนยัน")',
    '[role="dialog"] button:has-text("Confirm")',
    '[role="dialog"] button:has-text("ตกลง")',
  ],
  placeOrder: [
    'button:has-text("Place Order")',
    'button:has-text("สั่งสินค้า")',
    'button:has-text("สั่งซื้อ")',
    'button.shopee-button-solid--primary:has-text("Place Order")',
    'button.shopee-button-solid--primary:has-text("สั่งสินค้า")',
    'button.stardust-button--primary:has-text("Place Order")',
    'button.stardust-button--primary:has-text("สั่งสินค้า")',
  ],
};

async function clickAny(page, selectors, { timeout = 2000, force = true } = {}) {
  try {
    return await clickFirst(page, selectors, { timeout, force });
  } catch {
    return null;
  }
}

/**
 * Click Place Order / สั่งสินค้า — wait until enabled, then force + JS fallback.
 * Returns true only when a click was dispatched on an enabled-looking button,
 * or when the page leaves checkout / shows QR payment UI.
 */
async function clickPlaceOrder(page, { log = () => {}, timeoutMs = 12000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const orderRe = /place\s*order|สั่งสินค้า|สั่งซื้อ/i;

  while (Date.now() < deadline) {
    // Prefer role-based match (EN + TH).
    const byRole = page.getByRole("button", { name: orderRe });
    const count = await byRole.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = byRole.nth(i);
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) continue;
      try {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 800, force: true });
        log("กดสั่งสินค้าแล้ว — รอหน้า QR ให้สแกนจ่าย");
        return true;
      } catch {
        // try JS
        const ok = await btn
          .evaluate((el) => {
            if (el.disabled) return false;
            el.scrollIntoView({ block: "center" });
            el.click();
            return true;
          })
          .catch(() => false);
        if (ok) {
          log("กดสั่งสินค้าแล้ว (JS) — รอหน้า QR ให้สแกนจ่าย");
          return true;
        }
      }
    }

    // CSS selector fallbacks.
    for (const sel of [...PAYMENT_SELECTORS.placeOrder, ...SELECTORS.placeOrder]) {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible({ timeout: 120 }).catch(() => false))) continue;
      if (await loc.isDisabled().catch(() => false)) continue;
      try {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 800, force: true });
        log("กดสั่งสินค้าแล้ว — รอหน้า QR ให้สแกนจ่าย");
        return true;
      } catch {
        // continue
      }
    }

    // Last resort: DOM scan for the orange primary checkout button.
    const jsClicked = await page
      .evaluate(() => {
        const re = /place\s*order|สั่งสินค้า|สั่งซื้อ/i;
        const buttons = Array.from(document.querySelectorAll("button"));
        const match = buttons.find((b) => {
          if (b.disabled) return false;
          const t = (b.innerText || b.textContent || "").trim();
          if (!re.test(t)) return false;
          const r = b.getBoundingClientRect();
          return r.width > 40 && r.height > 20;
        });
        if (!match) return false;
        match.scrollIntoView({ block: "center" });
        match.click();
        return true;
      })
      .catch(() => false);
    if (jsClicked) {
      log("กดสั่งสินค้าแล้ว (DOM) — รอหน้า QR ให้สแกนจ่าย");
      return true;
    }

    await page.waitForTimeout(150);
  }
  return false;
}

/**
 * Select PromptPay QR on the checkout page and optionally place the order.
 * Dry-run / disabled callers must pass placeOrder=false.
 */
export async function selectPromptPayAndPlaceOrder(
  page,
  { placeOrder = true, log = () => {}, timeoutMs = 15000 } = {}
) {
  // Buy Now often lands on /checkout already.
  if (!page.url().includes("/checkout")) {
    await clickAny(page, SELECTORS.checkout, { timeout: 2500 });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  // If PromptPay chip isn't visible, try opening the payment picker.
  const promptVisible = await anyVisible(page, PAYMENT_SELECTORS.promptPay, 600);
  if (!promptVisible) {
    await clickAny(page, PAYMENT_SELECTORS.openPaymentPicker, { timeout: 1200 });
  }

  // Skip re-click if already selected (orange border / tick).
  const already =
    (await page
      .locator(
        'button:has-text("QR PromptPay"), button:has-text("QR พร้อมเพย์")'
      )
      .first()
      .evaluate((el) => {
        const cls = String(el.className || "");
        return /selected|active|checked/i.test(cls) || Boolean(el.querySelector('[class*="tick"]'));
      })
      .catch(() => false)) || false;

  let picked = null;
  if (!already) {
    picked = await clickAny(page, PAYMENT_SELECTORS.promptPay, { timeout: 2500 });
    if (picked) {
      log("เลือกชำระเงิน: QR พร้อมเพย์");
      // Only confirm inside a drawer/modal — never click a random Confirm on the page.
      await clickAny(page, PAYMENT_SELECTORS.confirmPayment, { timeout: 600 });
    } else {
      log("ไม่พบปุ่ม QR พร้อมเพย์ — จะสั่งซื้อด้วยวิธีที่เลือกอยู่ (ถ้ามี)");
    }
  } else {
    log("QR พร้อมเพย์ถูกเลือกอยู่แล้ว");
    picked = "already";
  }

  const selected = await anyVisible(page, PAYMENT_SELECTORS.promptPaySelected, 500);
  if (selected || already) log("ยืนยันว่าเลือกพร้อมเพย์แล้ว");

  if (!placeOrder) {
    log("โหมดทดสอบ — ไม่กดสั่งสินค้า");
    return { ok: true, placed: false, promptPay: Boolean(picked || selected || already) };
  }

  // Fresh budget just for Place Order (don't share with payment selection).
  const placed = await clickPlaceOrder(page, {
    log,
    timeoutMs: Math.max(10000, timeoutMs),
  });
  if (!placed) {
    log("กดสั่งสินค้าไม่สำเร็จภายในเวลา");
    return { ok: false, placed: false, promptPay: Boolean(picked || selected || already) };
  }

  // Brief settle — QR page may load in-place.
  await page.waitForTimeout(600);
  return { ok: true, placed: true, promptPay: Boolean(picked || selected || already) };
}
