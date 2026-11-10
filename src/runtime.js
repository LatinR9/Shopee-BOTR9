/**
 * Shared runner for CLI + Electron GUI.
 * Uses one shared browser window for login / dry-run / start.
 */
import path from "node:path";
import { screenshot } from "./browser.js";
import { runFlashSale, dismissLanguageGate } from "./bot.js";
import { SELECTORS, anyVisible } from "./selectors.js";
import { settingsToConfig } from "./settings.js";
import { createLogger } from "./logger.js";
import {
  getSharedBrowser,
  persistSharedSession,
  waitOutTrafficBlock,
  hasStrongSessionCookies,
  SESSION_COOKIE_NAMES,
} from "./shared-browser.js";
import { findSessionCookie } from "./session.js";

/** How long to keep waiting for manual login. */
const LOGIN_WAIT_MS = 15 * 60 * 1000;
const LOGIN_STATUS_EVERY_MS = 30_000;

/**
 * @param {object} options
 * @param {object} options.settings
 * @param {'login'|'dry-run'|'start'} options.mode
 * @param {(level:string, message:string)=>void} [options.onLog]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.profileDir]
 * @param {string} [options.resourcesPath]
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

  const { context, page } = await getSharedBrowser({
    profileDir: config.userDataDir,
    resourcesPath,
    headless,
    onLog,
  });

  if (mode === "login") {
    return runLogin(context, page, config, logger, signal);
  }

  // Keep the shared window open after dry-run / start (warm page for the sale).
  return runFlashSale(page, config, { logger, signal });
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
  const u = String(url || "");
  return u.includes("/buyer/login") || u.includes("/buyer/signup");
}

async function detectLoggedIn(context, page) {
  // Prefer strong session cookies (QR login can briefly show UI without them).
  try {
    const cookies = await context.cookies();
    if (hasStrongSessionCookies(cookies) && !isLoginUrl(page.url())) {
      const hit = findSessionCookie(cookies, ["SPC_EC", "SPC_ST"]);
      return { ok: true, via: `cookie:${hit?.name || "session"}` };
    }
    // Weaker cookies alone are not enough while still on login/qr.
    const weak = findSessionCookie(cookies, SESSION_COOKIE_NAMES);
    if (weak && !isLoginUrl(page.url())) {
      // Allow after leaving login URL, but require a second consecutive hit.
      return { ok: true, via: `cookie:${weak.name}`, weak: true };
    }
  } catch {
    // ignore
  }

  const url = page.url();
  if (!isLoginUrl(url) && !String(url).includes("/verify/")) {
    const avatar = await anyVisible(
      page,
      [
        'a[href*="/user/account"]',
        'a[href*="/user/"]',
        ".navbar-username",
        '[class*="navbar__username"]',
      ],
      600
    );
    if (avatar) return { ok: true, via: "account_ui", weak: true };
  }
  return { ok: false };
}

async function browserWasClosed(page) {
  try {
    return page.isClosed();
  } catch {
    return true;
  }
}

/**
 * Manual login only. Leaves the shared browser open on success.
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

  if (!isLoginUrl(page.url())) {
    await page.goto(`${base}/buyer/login`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(800);

  if (!(await anyVisible(page, SELECTORS.loginUsername, 800))) {
    // QR tab may hide the password fields — that's OK for manual login.
    await dismissLanguageGate(page, {
      log: (...a) => logger.info(...a),
    }).catch(() => {});
  }

  logger.info("กรุณาเข้าสู่ระบบด้วยมือในหน้าต่างเบราว์เซอร์ (โปรแกรมจะไม่กรอกให้)");
  logger.info(
    `รอจนล็อกอินสำเร็จ — สูงสุด ${Math.round(LOGIN_WAIT_MS / 60000)} นาที (กดหยุดได้) · หน้าต่างจะยังเปิดอยู่หลังล็อกอิน`
  );

  const deadline = Date.now() + LOGIN_WAIT_MS;
  let nextStatusAt = Date.now() + LOGIN_STATUS_EVERY_MS;
  let consecutiveOk = 0;
  let needStrong = false;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    if (await browserWasClosed(page)) {
      logger.warn("ปิดหน้าต่างเบราว์เซอร์แล้ว — ยังไม่บันทึกเซสชัน");
      return { ok: false, reason: "browser_closed" };
    }

    // CAPTCHA / verify during login — wait in-window
    const traffic = await waitOutTrafficBlock(page, {
      onLog: (level, message) => logger[level]?.(message) || logger.info(message),
      timeoutMs: 5 * 60 * 1000,
      signal,
    });
    if (!traffic.ok && traffic.reason === "traffic_timeout") {
      // keep waiting in the outer loop
    }

    const detected = await detectLoggedIn(context, page);
    if (detected.ok && !isLoginUrl(page.url())) {
      consecutiveOk += 1;
      if (detected.weak) needStrong = true;
    } else {
      consecutiveOk = 0;
    }

    // Require 3 stable hits; if only weak evidence, wait for strong cookies too.
    if (consecutiveOk >= 3) {
      const cookies = await context.cookies().catch(() => []);
      if (needStrong && !hasStrongSessionCookies(cookies) && consecutiveOk < 6) {
        if (Date.now() >= nextStatusAt) {
          logger.info("เห็นว่าล็อกอินแล้ว — รอคุกกี้เซสชันให้ครบ (เช่น หลังสแกน QR)…");
          nextStatusAt = Date.now() + LOGIN_STATUS_EVERY_MS;
        }
      } else {
        await page.waitForTimeout(800);
        const saved = await persistSharedSession((level, message) =>
          logger[level]?.(message) || logger.info(message)
        );
        logger.info("ล็อกอินสำเร็จ");
        if (saved?.ok) {
          logger.info("บันทึกเซสชันแล้ว — หน้าต่างเบราว์เซอร์ยังเปิดอยู่ พร้อมสแกน/กด Flash Sale");
        } else {
          logger.warn("ล็อกอินสำเร็จแต่บันทึกไฟล์เซสชันไม่สมบูรณ์ — โปรไฟล์ Chromium ยังถูกใช้ต่อ");
        }
        await screenshot(page, "login-ok");
        return { ok: true, via: detected.via, browserKeptOpen: true };
      }
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
  return { ok: false, reason: "login_timeout", browserKeptOpen: true };
}
