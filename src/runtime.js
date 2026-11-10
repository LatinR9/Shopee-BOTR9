/**
 * Shared runner for CLI + Electron GUI.
 */
import path from "node:path";
import { launchBrowser, screenshot, configurePlaywrightBrowsersPath } from "./browser.js";
import { runFlashSale, dismissLanguageGate } from "./bot.js";
import { SELECTORS, clickFirst, anyVisible } from "./selectors.js";
import { settingsToConfig } from "./settings.js";
import { createLogger } from "./logger.js";

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.fill(value);
      return sel;
    }
  }
  throw new Error(`ไม่พบช่องกรอก: ${selectors.join(" | ")}`);
}

/**
 * @param {object} options
 * @param {object} options.settings - UI/settings.json fields
 * @param {'login'|'dry-run'|'start'} options.mode
 * @param {(level:string, message:string)=>void} [options.onLog]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.profileDir] - persistent Chromium profile
 * @param {string} [options.resourcesPath] - Electron resources (bundled browsers)
 * @param {boolean} [options.headless]
 */
export async function runBotJob(options) {
  const {
    settings,
    mode,
    onLog,
    signal,
    profileDir,
    resourcesPath,
    headless = false,
  } = options;

  configurePlaywrightBrowsersPath(resourcesPath);

  const logger = createLogger((level, message) => {
    if (onLog) onLog(level, message);
    else console.log(`[${level}] ${message}`);
  });

  const config = settingsToConfig(settings, {
    dryRun: mode === "dry-run",
    headless,
    userDataDir: profileDir || path.join(process.cwd(), ".auth", "user-data"),
  });

  if (mode !== "login") {
    if (!config.productUrl) {
      throw new Error("กรุณาวางลิงก์สินค้า Shopee ก่อน");
    }
    try {
      // eslint-disable-next-line no-new
      new URL(config.productUrl);
    } catch {
      throw new Error("ลิงก์สินค้าไม่ถูกต้อง");
    }
  }

  logger.info(
    mode === "login"
      ? "เปิดหน้าเข้าสู่ระบบ Shopee…"
      : mode === "dry-run"
        ? "เริ่มโหมดทดสอบ…"
        : "เริ่ม Flash Sale…"
  );

  const { context, page } = await launchBrowser(config);
  let result = { ok: false };

  try {
    if (mode === "login") {
      result = await runLogin(page, config, logger, signal);
    } else {
      result = await runFlashSale(page, config, { logger, signal });
    }
  } finally {
    // Keep headed browser open briefly after success so user can finish OTP/payment
    const keepOpen =
      !headless &&
      mode !== "dry-run" &&
      result?.ok &&
      mode === "start" &&
      !config.autoPlaceOrder;

    if (keepOpen) {
      logger.info("เปิดเบราว์เซอร์ค้างไว้ 60 วินาที ให้คุณชำระเงิน/OTP ได้ — หรือกดหยุด");
      try {
        await waitAbortable(60_000, signal);
      } catch {
        // stopped
      }
    }

    await context.close().catch(() => {});
  }

  return result;
}

async function waitAbortable(ms, signal) {
  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

async function runLogin(page, config, logger, signal) {
  const base = config.baseUrl || "https://shopee.co.th";
  logger.info(`เปิด ${base}/buyer/login`);
  await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });

  // Language gate must never block login — errors are swallowed inside.
  await dismissLanguageGate(page, {
    log: (...a) => logger.info(...a),
  }).catch((err) => {
    logger.warn(`ข้ามหน้าเลือกภาษา: ${err.message || err}`);
  });

  // Return to login if the gate navigated away or left us elsewhere.
  if (!page.url().includes("/buyer/login")) {
    await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });
  }

  // If the gate is still covering the form, try once more then continue anyway.
  const formVisible = await anyVisible(page, SELECTORS.loginUsername, 800);
  if (!formVisible) {
    await dismissLanguageGate(page, {
      log: (...a) => logger.info(...a),
    }).catch(() => {});
  }

  if (config.username && config.password) {
    try {
      await fillFirst(page, SELECTORS.loginUsername, config.username);
      await fillFirst(page, SELECTORS.loginPassword, config.password);
      await clickFirst(page, SELECTORS.loginSubmit, { timeout: 5000 });
      logger.info("ส่งข้อมูลเข้าสู่ระบบแล้ว — ถ้ามี CAPTCHA/OTP ให้ทำในหน้าต่างเบราว์เซอร์");
    } catch (err) {
      logger.warn(`กรอกอัตโนมัติไม่สำเร็จ (${err.message}) — กรุณาล็อกอินเอง`);
    }
  } else {
    logger.info("กรุณาเข้าสู่ระบบด้วยมือในหน้าต่างเบราว์เซอร์ที่เปิดขึ้น");
  }

  logger.info("รอเข้าสู่ระบบสำเร็จสูงสุด 3 นาที… (กดหยุดได้)");
  const ok = await Promise.race([
    page
      .waitForFunction(
        () => {
          const href = location.href;
          return !href.includes("/buyer/login") && !href.includes("/buyer/signup");
        },
        { timeout: 180_000 }
      )
      .then(() => true)
      .catch(() => false),
    waitAbortable(180_000, signal).then(() => false).catch(() => {
      throw new DOMException("Aborted", "AbortError");
    }),
  ]);

  if (ok || (await anyVisible(page, ['a[href*="/user"]', ".navbar-username"], 3000))) {
    logger.info("เข้าสู่ระบบสำเร็จ — บันทึกเซสชันไว้แล้ว");
    await screenshot(page, "login-ok");
    return { ok: true };
  }

  logger.warn("หมดเวลา — ลองใหม่หลังล็อกอินสำเร็จ");
  await screenshot(page, "login-timeout");
  return { ok: false, reason: "login_timeout" };
}
