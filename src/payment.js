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
    'div[class*="checkout-payment"] button',
  ],
  promptPay: [
    'button:has-text("QR พร้อมเพย์")',
    'div:has-text("QR พร้อมเพย์")',
    '[class*="payment"]:has-text("พร้อมเพย์")',
    'button:has-text("PromptPay")',
    'div:has-text("PromptPay QR")',
    'label:has-text("พร้อมเพย์")',
  ],
  promptPaySelected: [
    '*:has-text("QR พร้อมเพย์")',
    '*:has-text("พร้อมเพย์")',
  ],
  confirmPayment: [
    'button:has-text("ยืนยัน")',
    'button:has-text("Confirm")',
    'button:has-text("ตกลง")',
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
 * Select PromptPay QR on the checkout page and optionally place the order.
 * Dry-run / disabled callers must pass placeOrder=false.
 */
export async function selectPromptPayAndPlaceOrder(
  page,
  { placeOrder = true, log = () => {}, timeoutMs = 8000 } = {}
) {
  const deadline = Date.now() + timeoutMs;

  // Buy Now often lands on /checkout already.
  if (!page.url().includes("/checkout")) {
    await clickAny(page, SELECTORS.checkout, { timeout: 2500 });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  // Open payment method picker if PromptPay isn't already visible/selected.
  const promptVisible = await anyVisible(page, PAYMENT_SELECTORS.promptPay, 800);
  if (!promptVisible) {
    await clickAny(page, PAYMENT_SELECTORS.openPaymentPicker, { timeout: 1500 });
  }

  const picked = await clickAny(page, PAYMENT_SELECTORS.promptPay, { timeout: 2500 });
  if (picked) {
    log("เลือกชำระเงิน: QR พร้อมเพย์");
    // Some UIs need an extra confirm inside the drawer.
    await clickAny(page, PAYMENT_SELECTORS.confirmPayment, { timeout: 800 });
  } else {
    log("ไม่พบปุ่ม QR พร้อมเพย์ — จะสั่งซื้อด้วยวิธีที่เลือกอยู่ (ถ้ามี)");
  }

  // Brief verify that PromptPay text is on the page.
  const selected = await anyVisible(page, PAYMENT_SELECTORS.promptPaySelected, 600);
  if (selected) log("ยืนยันว่าเลือกพร้อมเพย์แล้ว");

  if (!placeOrder) {
    log("โหมดทดสอบ — ไม่กดสั่งสินค้า");
    return { ok: true, placed: false, promptPay: Boolean(picked || selected) };
  }

  while (Date.now() < deadline) {
    try {
      await clickFirst(page, SELECTORS.placeOrder, { timeout: 1200, force: true });
      log("กดสั่งสินค้าแล้ว — รอหน้า QR ให้สแกนจ่าย");
      await page.waitForTimeout(800);
      return { ok: true, placed: true, promptPay: Boolean(picked || selected) };
    } catch {
      await page.waitForTimeout(120);
    }
  }

  log("กดสั่งสินค้าไม่สำเร็จภายในเวลา");
  return { ok: false, placed: false, promptPay: Boolean(picked || selected) };
}
