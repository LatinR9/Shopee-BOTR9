/**
 * Best-effort Shopee UI selectors.
 * Shopee DOM changes often — keep several fallbacks and prefer visible text.
 */

export const SELECTORS = {
  // First-visit language gate (shopee.co.th)
  languageThai: [
    'button:has-text("ไทย")',
    'button:has-text("Thai")',
    '[class*="language"] button:has-text("ไทย")',
  ],
  languageEnglish: [
    'button:has-text("English")',
    'button:has-text("EN")',
  ],

  // Login
  loginUsername: [
    'input[name="loginKey"]',
    'input[type="text"][placeholder*="Phone"]',
    'input[type="text"][placeholder*="Email"]',
    'input[type="text"][placeholder*="เบอร์"]',
    'input[autocomplete="username"]',
  ],
  loginPassword: [
    'input[name="password"]',
    'input[type="password"]',
  ],
  loginSubmit: [
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("เข้าสู่ระบบ")',
    'button.password-login',
  ],

  // Product page — Buy Now / Add to cart
  buyNow: [
    'button:has-text("Buy Now")',
    'button:has-text("ซื้อสินค้า")',
    'button:has-text("ซื้อเลย")',
    'button.btn-solid-primary:has-text("Buy")',
    '[class*="buy-now"]',
  ],
  addToCart: [
    'button:has-text("Add to Cart")',
    'button:has-text("เพิ่มไปยังรถเข็น")',
    'button:has-text("ใส่รถเข็น")',
  ],

  // Checkout / place order
  checkout: [
    'button:has-text("Check Out")',
    'button:has-text("Checkout")',
    'button:has-text("ไปชำระเงิน")',
    'button:has-text("ชำระเงิน")',
  ],
  placeOrder: [
    'button:has-text("Place Order")',
    'button:has-text("สั่งสินค้า")',
    'button:has-text("สั่งซื้อ")',
  ],

  // Quantity
  qtyIncrease: [
    'button[aria-label="Increase"]',
    'button:has-text("+")',
    ".shopee-input-quantity__button--increase",
  ],
};

/** Click the first matching visible locator among a list of selectors. */
export async function clickFirst(page, selectorList, { timeout = 3000, force = false } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    for (const sel of selectorList) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
          await loc.click({ timeout: 1000, force });
          return sel;
        }
      } catch (err) {
        lastError = err;
      }
    }
    await page.waitForTimeout(50);
  }

  const msg = `No clickable match for: ${selectorList.join(" | ")}`;
  throw lastError ? new Error(`${msg} (${lastError.message})`) : new Error(msg);
}

/** Return true if any selector is visible. */
export async function anyVisible(page, selectorList, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectorList) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible({ timeout: 150 })
        .catch(() => false);
      if (visible) return true;
    }
    await page.waitForTimeout(50);
  }
  return false;
}
