/**
 * Parallel multi-product flash sale:
 * one OS Chrome window per product, shared login, simultaneous Buy Now.
 * Prefer Buy Now per window over cart-merge (faster + independent across shops).
 */
import { settingsToConfig } from "./settings.js";
import { runFlashSale, waitForSaleStart, dismissLanguageGate } from "./bot.js";
import {
  getSharedBrowser,
  openProductWindow,
  tileProductWindows,
  waitOutTrafficBlock,
  persistSharedSession,
} from "./shared-browser.js";
import { normalizeProducts, productShortLabel } from "./products.js";
import { createLogger } from "./logger.js";

function productConfig(settings, product, overrides = {}) {
  return settingsToConfig(
    {
      ...settings,
      productUrl: product.productUrl,
      quantity: product.quantity,
      variants: product.variants,
      selectedVariants: product.selectedVariants,
      variantScan: product.variantScan,
    },
    overrides
  );
}

/**
 * Open / reuse one window per product and warm the product pages.
 * @returns {{ pages: import('playwright').Page[], labels: string[], configs: object[] }}
 */
export async function prepareProductWindows({
  settings,
  profileDir,
  resourcesPath,
  headless = false,
  onLog,
  signal,
} = {}) {
  const logger = createLogger((level, message) => {
    if (onLog) onLog(level, message);
    else console.log(`[${level}] ${message}`);
  });

  const products = normalizeProducts(settings).filter((p) => p.productUrl);
  if (products.length === 0) {
    throw new Error("กรุณาเพิ่มลิงก์สินค้าอย่างน้อย 1 รายการ");
  }

  const shared = await getSharedBrowser({
    profileDir,
    resourcesPath,
    headless,
    onLog,
  });

  const pages = [];
  const labels = [];
  const configs = [];

  for (let i = 0; i < products.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const product = products[i];
    const label = productShortLabel(product, i);
    labels.push(label);
    const cfg = productConfig(settings, product, {
      dryRun: Boolean(settings.__dryRun),
      headless,
      userDataDir: profileDir,
    });
    configs.push(cfg);

    let page;
    if (i === 0) {
      page = shared.page;
      logger.info(`[${label}] ใช้หน้าต่างหลัก`);
    } else {
      const opened = await openProductWindow({
        url: "about:blank",
        onLog,
        width: 1100,
        height: 820,
      });
      page = opened.page;
      logger.info(`[${label}] เปิดหน้าต่างใหม่`);
    }
    pages.push(page);
  }

  await tileProductWindows(pages, { onLog });

  // Warm all product pages in parallel (shared cookies / login).
  await Promise.all(
    pages.map(async (page, i) => {
      const label = labels[i];
      const cfg = configs[i];
      const log = (msg) => logger.info(`[${label}] ${msg}`);
      try {
        log(`เปิดสินค้า: ${cfg.productUrl}`);
        await page.goto(cfg.productUrl, { waitUntil: "domcontentloaded" });
        await dismissLanguageGate(page, { log }).catch(() => {});
        await waitOutTrafficBlock(page, {
          onLog: (level, message) =>
            logger[level]?.(`[${label}] ${message}`) || log(message),
          timeoutMs: 5 * 60 * 1000,
          signal,
        });
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        log(`อุ่นหน้าไม่สำเร็จ: ${err.message || err}`);
      }
    })
  );

  await persistSharedSession(onLog).catch(() => {});
  return { pages, labels, configs, products };
}

/**
 * Run flash sale across all product windows in parallel.
 */
export async function runMultiProductJob({
  settings,
  mode,
  onLog,
  signal,
  profileDir,
  resourcesPath,
  headless = false,
} = {}) {
  const dryRun = mode === "dry-run";
  const logger = createLogger((level, message) => {
    if (onLog) onLog(level, message);
    else console.log(`[${level}] ${message}`);
  });

  const settingsForRun = { ...settings, __dryRun: dryRun };
  const { pages, labels, configs } = await prepareProductWindows({
    settings: settingsForRun,
    profileDir,
    resourcesPath,
    headless,
    onLog,
    signal,
  });

  logger.info(
    dryRun
      ? `โหมดทดสอบ — เปิด ${pages.length} หน้าต่างสินค้า (จะไม่กดซื้อ/ไม่สั่งสินค้า)`
      : `พร้อมกด Flash Sale แบบขนานใน ${pages.length} หน้าต่าง`
  );

  // Shared countdown once, then fire all windows together.
  if (!dryRun) {
    await waitForSaleStart(configs[0], { logger, signal });
  }

  const results = await Promise.all(
    pages.map(async (page, i) => {
      const label = labels[i];
      const cfg = {
        ...configs[i],
        dryRun,
        // Dry-run must never place orders. PromptPay toggle default ON.
        autoPromptPay: dryRun ? false : configs[i].autoPromptPay !== false,
        autoPlaceOrder: dryRun ? false : Boolean(configs[i].autoPlaceOrder),
      };
      const childLogger = {
        info: (msg) => logger.info(`[${label}] ${msg}`),
        warn: (msg) => logger.warn(`[${label}] ${msg}`),
        error: (msg) => logger.error(`[${label}] ${msg}`),
      };
      try {
        const result = await runFlashSale(page, cfg, {
          logger: childLogger,
          signal,
          skipSaleWait: true,
        });
        childLogger.info(
          result.ok
            ? dryRun
              ? "ทดสอบเสร็จ — หน้าต่างยังเปิดอยู่"
              : "เสร็จแล้ว — หน้า QR/ชำระเงินยังเปิดอยู่ให้สแกนจ่าย"
            : `ไม่สำเร็จ: ${result.reason || ""}`
        );
        return { ok: Boolean(result.ok), label, result };
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        childLogger.error(err?.message || String(err));
        return { ok: false, label, reason: "error", message: err?.message };
      }
    })
  );

  const okCount = results.filter((r) => r.ok).length;
  logger.info(`สรุป: สำเร็จ ${okCount}/${results.length} สินค้า`);
  return {
    ok: okCount > 0,
    results,
    reason: okCount === 0 ? "all_failed" : undefined,
  };
}
