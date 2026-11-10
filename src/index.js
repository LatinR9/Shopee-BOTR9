/**
 * Shopee Flash Sale bot entrypoint.
 *
 *   npm start
 *   npm run dry-run
 *   node src/index.js --headed
 */
import { loadConfig, assertReady } from "./config.js";
import { launchBrowser } from "./browser.js";
import { runFlashSale } from "./bot.js";

function printHelp() {
  console.log(`
Shopee Flash Sale bot (Playwright)

Usage:
  npm start              Run with .env settings
  npm run dry-run        Open product page only (no Buy Now)
  npm run login          Save a browser login session
  node src/index.js --headed

Config: copy .env.example → .env
Required: SHOPEE_PRODUCT_URL
Optional: SHOPEE_SALE_START, SHOPEE_VARIANTS, SHOPEE_QUANTITY, …

Limitations: CAPTCHA, OTP, stock races, and ToS may block automation.
`.trim());
}

async function main() {
  const config = loadConfig();
  if (config.help) {
    printHelp();
    return;
  }

  assertReady(config);

  console.log("=== Shopee Flash Sale Bot ===");
  console.log(`Product : ${config.productUrl}`);
  console.log(`Sale at : ${config.saleStart ? config.saleStart.toISOString() : "(now)"}`);
  console.log(`Qty     : ${config.quantity}`);
  console.log(`Variants: ${config.variants.join(", ") || "(none)"}`);
  console.log(`Headless: ${config.headless}`);
  console.log(`Dry run : ${config.dryRun}`);
  console.log(`Auto PO : ${config.autoPlaceOrder}`);
  console.log("=============================");

  const { context, page } = await launchBrowser(config);

  try {
    const result = await runFlashSale(page, config);
    if (!result.ok) {
      console.error("Bot finished without a successful Buy Now.", result);
      process.exitCode = 2;
    } else {
      console.log("Done.", result);
      if (!config.dryRun && !config.autoPlaceOrder) {
        console.log(
          "Complete payment / OTP in the browser if needed, then close the window."
        );
        // Keep browser open briefly so the user can finish checkout manually
        if (!config.headless) {
          await page.waitForTimeout(60_000).catch(() => {});
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
