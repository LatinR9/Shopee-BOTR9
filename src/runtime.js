/**
 * Shared runner for CLI + Electron GUI.
 */
import path from "node:path";
import { launchBrowser, screenshot, configurePlaywrightBrowsersPath } from "./browser.js";
import { runFlashSale, dismissLanguageGate } from "./bot.js";
import { SELECTORS, anyVisible } from "./selectors.js";
import { settingsToConfig } from "./settings.js";
import { createLogger } from "./logger.js";

/** How long to keep the login browser open for manual login. */
const LOGIN_WAIT_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_STATUS_EVERY_MS = 30_000;

/** Shopee session cookies that indicate a real logged-in buyer. */
const LOGIN_COOKIE_NAMES = ["SPC_EC", "SPC_ST", "SPC_U_ID", "SPC_SI"];

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
      result = await runLogin(context, page, config, logger, signal);
    } else {
      result = await runFlashSale(page, config, { logger, signal });
    }
  } finally {
    // Keep headed browser open briefly after purchase so user can finish OTP/payment
    const keepOpen =
      !headless &&
      mode === "start" &&
      result?.ok &&
      !config.autoPlaceOrder;

    if (keepOpen) {
      logger.info("เปิดเบราว์เซอร์ค้างไว้ 60 วินาที ให้คุณชำระเงิน/OTP ได้ — หรือกดหยุด");
      try {
        await waitAbortable(60_000, signal);
      } catch {
        // stopped
      }
    }

    // Login mode already waited until success / timeout / user closed the window.
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

function sleep(ms, signal) {
  return waitAbortable(ms, signal);
}

function isLoginUrl(url) {
  try {
    const u = String(url || "");
    return u.includes("/buyer/login") || u.includes("/buyer/signup");
  } catch {
    return false;
  }
}

function isTransientAuthUrl(url) {
  const u = String(url || "");
  return (
    u.includes("/verify/") ||
    u.includes("captcha") ||
    u.includes("/buyer/login") ||
    u.includes("/buyer/signup")
  );
}

/**
 * Positive login evidence — not merely "left /buyer/login"
 * (language-gate / home redirects caused false positives before).
 */
async function detectLoggedIn(context, page) {
  // 1) Session cookies
  try {
    const cookies = await context.cookies();
    const hit = cookies.find(
      (c) =>
        LOGIN_COOKIE_NAMES.includes(c.name) &&
        c.value &&
        c.value.length > 5
    );
    if (hit) return { ok: true, via: `cookie:${hit.name}` };
  } catch {
    // context may be closing
  }

  // 2) Account UI while not on login/verify
  const url = page.url();
  if (!isTransientAuthUrl(url)) {
    const avatar = await anyVisible(
      page,
      [
        'a[href*="/user/account"]',
        'a[href*="/user/"]',
        ".navbar-username",
        '[class*="navbar__username"]',
        'img[alt*="avatar" i]',
      ],
      600
    );
    if (avatar) return { ok: true, via: "account_ui" };
  }

  return { ok: false };
}

async function browserWasClosed(context, page) {
  try {
    if (!context || context.browser()?.isConnected() === false) return true;
  } catch {
    // launchPersistentContext has no browser() sometimes — check pages
  }
  try {
    if (page.isClosed()) return true;
    if (context.pages().length === 0) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Manual login only (no credential auto-fill / auto-submit).
 * Keeps the browser open until real login, user closes window, Stop, or long timeout.
 */
async function runLogin(context, page, config, logger, signal) {
  const base = config.baseUrl || "https://shopee.co.th";
  logger.info(`เปิด ${base}/buyer/login`);
  await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });

  await dismissLanguageGate(page, {
    log: (...a) => logger.info(...a),
  }).catch((err) => {
    logger.warn(`ข้ามหน้าเลือกภาษา: ${err.message || err}`);
  });

  // Language gate often navigates to the homepage — return to login and settle.
  if (!isLoginUrl(page.url())) {
    await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(800);

  // Second chance on the gate if it still covers the form — never autofill.
  if (!(await anyVisible(page, SELECTORS.loginUsername, 800))) {
    await dismissLanguageGate(page, {
      log: (...a) => logger.info(...a),
    }).catch(() => {});
    if (!isLoginUrl(page.url())) {
      await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });
    }
  }

  logger.info("กรุณาเข้าสู่ระบบด้วยมือในหน้าต่างเบราว์เซอร์ (โปรแกรมจะไม่กรอกให้)");
  logger.info(
    `รอจนล็อกอินสำเร็จหรือคุณปิดหน้าต่าง — สูงสุด ${Math.round(LOGIN_WAIT_MS / 60000)} นาที (กดหยุดได้)`
  );

  const deadline = Date.now() + LOGIN_WAIT_MS;
  let nextStatusAt = Date.now() + LOGIN_STATUS_EVERY_MS;
  let consecutiveOk = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (await browserWasClosed(context, page)) {
      logger.warn("ปิดหน้าต่างเบราว์เซอร์แล้ว — ยังไม่บันทึกเซสชัน");
      return { ok: false, reason: "browser_closed" };
    }

    // Ignore brief navigations away from login (language gate / redirects).
    // Require stable positive evidence across a couple of checks.
    const detected = await detectLoggedIn(context, page);
    if (detected.ok && !isLoginUrl(page.url())) {
      consecutiveOk += 1;
    } else {
      consecutiveOk = 0;
    }

    if (consecutiveOk >= 2) {
      // Persistent profile already stores cookies; screenshot for confirmation.
      logger.info("ล็อกอินสำเร็จ");
      logger.info("บันทึกเซสชันในโปรไฟล์เบราว์เซอร์แล้ว — พร้อมใช้กด Flash Sale");
      await screenshot(page, "login-ok");
      return { ok: true, via: detected.via };
    }

    if (Date.now() >= nextStatusAt) {
      const leftMin = Math.max(1, Math.ceil((deadline - Date.now()) / 60000));
      logger.info(
        `ยังรอให้คุณล็อกอินอยู่… (เหลือประมาณ ${leftMin} นาที) URL: ${page.url()}`
      );
      nextStatusAt = Date.now() + LOGIN_STATUS_EVERY_MS;
    }

    try {
      await sleep(1000, signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
  }

  logger.warn("หมดเวลารอล็อกอิน — ลองกดเข้าสู่ระบบอีกครั้ง");
  await screenshot(page, "login-timeout");
  return { ok: false, reason: "login_timeout" };
}
