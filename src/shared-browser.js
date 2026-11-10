/**
 * One shared Playwright browser for the whole app session.
 * Login / scan / dry-run / start all reuse the same window.
 * Only closed via closeSharedBrowser() (UI button or app quit).
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, configurePlaywrightBrowsersPath } from "./browser.js";
import { detectTrafficBlock } from "./bot.js";
import {
  ensureProfileDir,
  storageStatePath,
  hasSavedSessionFile,
  findSessionCookie,
  saveSession,
  SESSION_COOKIE_NAMES,
  STRONG_SESSION_COOKIES,
} from "./session.js";

/** @type {{ context: import('playwright').BrowserContext, page: import('playwright').Page, profileDir: string } | null} */
let shared = null;

function logFn(onLog) {
  return (level, message) => {
    if (onLog) onLog(level, message);
    else console.log(`[${level}] ${message}`);
  };
}

async function isAlive() {
  if (!shared) return false;
  try {
    if (shared.page.isClosed()) return false;
    if (shared.context.pages().length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

async function applyStorageBackup(context, profileDir, log) {
  const stateFile = storageStatePath(profileDir);
  if (!fs.existsSync(stateFile)) return;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const cookies = state.cookies || [];
    if (cookies.length) {
      await context.addCookies(cookies);
      log("info", `โหลดคุกกี้จากไฟล์สำรอง (${cookies.length} รายการ)`);
    }
  } catch (err) {
    log("warn", `โหลดคุกกี้สำรองไม่สำเร็จ: ${err.message || err}`);
  }
}

/**
 * Get or create the shared headed browser bound to app userData profile.
 */
export async function getSharedBrowser({
  profileDir,
  resourcesPath,
  headless = false,
  onLog,
} = {}) {
  const log = logFn(onLog);
  const dir = ensureProfileDir(
    profileDir || path.join(process.cwd(), ".auth", "user-data")
  );

  configurePlaywrightBrowsersPath(resourcesPath);

  if (await isAlive()) {
    if (shared.profileDir !== dir) {
      log(
        "warn",
        `ใช้เบราว์เซอร์เดิมที่เปิดอยู่แล้ว (โปรไฟล์: ${shared.profileDir})`
      );
    } else {
      log("info", "ใช้หน้าต่างเบราว์เซอร์เดิมที่เปิดอยู่");
    }
    const cookies = await shared.context.cookies().catch(() => []);
    const hit = findSessionCookie(cookies, SESSION_COOKIE_NAMES);
    if (hit) log("info", `พบเซสชันในเบราว์เซอร์ (${hit.name})`);
    else if (hasSavedSessionFile(dir)) {
      log("info", "มีไฟล์เซสชันสำรอง — ลองใส่คุกกี้ใหม่อีกครั้ง");
      await applyStorageBackup(shared.context, dir, log);
    } else {
      log("info", "ยังไม่พบเซสชันในเบราว์เซอร์นี้");
    }
    return shared;
  }

  // Stale handle
  shared = null;

  log("info", `เปิดเบราว์เซอร์ (โปรไฟล์: ${dir})`);
  if (hasSavedSessionFile(dir)) {
    log("info", "พบเซสชันที่บันทึกไว้ — จะใช้คุกกี้เดิม");
  } else {
    log("info", "ยังไม่พบเซสชันที่บันทึกไว้ — อาจต้องเข้าสู่ระบบ");
  }

  const { context, page } = await launchBrowser({
    userDataDir: dir,
    headless: Boolean(headless),
  });
  await applyStorageBackup(context, dir, log);

  const cookies = await context.cookies().catch(() => []);
  const hit = findSessionCookie(cookies, SESSION_COOKIE_NAMES);
  if (hit) log("info", `เซสชันพร้อมใช้งาน (${hit.name})`);

  // If user closes the window manually, drop the singleton.
  const forget = () => {
    if (shared?.context === context) shared = null;
  };
  context.on("close", forget);
  page.on("close", async () => {
    try {
      if (context.pages().length === 0) forget();
    } catch {
      forget();
    }
  });

  shared = { context, page, profileDir: dir };
  return shared;
}

export async function persistSharedSession(onLog) {
  const log = logFn(onLog);
  if (!(await isAlive())) {
    log("warn", "ไม่มีเบราว์เซอร์เปิดอยู่ — บันทึกเซสชันไม่ได้");
    return { ok: false };
  }
  return saveSession(shared.context, shared.profileDir, (msg) =>
    log("info", msg)
  );
}

export async function closeSharedBrowser(onLog) {
  const log = logFn(onLog);
  if (!shared) {
    log("info", "ไม่มีเบราว์เซอร์ให้ปิด");
    return { ok: true, closed: false };
  }
  const ref = shared;
  shared = null;
  try {
    await saveSession(ref.context, ref.profileDir, (msg) => log("info", msg));
  } catch {
    // ignore
  }
  await ref.context.close().catch(() => {});
  log("info", "ปิดเบราว์เซอร์แล้ว (เซสชันถูกบันทึกไว้)");
  return { ok: true, closed: true };
}

export function getSharedBrowserInfo() {
  return {
    open: Boolean(shared),
    profileDir: shared?.profileDir || null,
  };
}

/**
 * Wait while Shopee shows /verify/traffic or captcha — user solves it in-window.
 */
export async function waitOutTrafficBlock(
  page,
  { onLog, timeoutMs = 10 * 60 * 1000, signal } = {}
) {
  const log = logFn(onLog);
  let blocked = await detectTrafficBlock(page);
  if (!blocked) return { ok: true, waited: false };

  log(
    "warn",
    `เจอหน้าตรวจของ Shopee (CAPTCHA / verify) — กรุณาทำให้ผ่านในหน้าต่างเบราว์เซอร์ โปรแกรมจะรอ…`
  );
  const deadline = Date.now() + timeoutMs;
  let nextStatus = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    await page.waitForTimeout(1500);
    blocked = await detectTrafficBlock(page);
    if (!blocked) {
      log("info", "ผ่านการตรวจแล้ว — ทำต่อ");
      return { ok: true, waited: true };
    }
    if (Date.now() >= nextStatus) {
      const left = Math.ceil((deadline - Date.now()) / 60000);
      log("info", `ยังรอให้คุณผ่าน CAPTCHA/verify… (เหลือ ~${left} นาที)`);
      nextStatus = Date.now() + 15000;
    }
  }
  log("warn", "หมดเวลารอ CAPTCHA/verify");
  return { ok: false, reason: "traffic_timeout" };
}

export function hasStrongSessionCookies(cookies) {
  return Boolean(findSessionCookie(cookies, STRONG_SESSION_COOKIES));
}

/**
 * Open an additional OS window in the same persistent context (shared login).
 * Uses CDP Target.createTarget({ newWindow: true }) so each product gets its
 * own Chrome window, not a tab — required for simultaneous visible buys.
 */
export async function openProductWindow({
  url = "about:blank",
  onLog,
  width = 1100,
  height = 800,
} = {}) {
  const log = logFn(onLog);
  const browser = await getSharedBrowser({ onLog });
  const { context, page: seed } = browser;

  let newPage = null;
  const before = new Set(context.pages());
  try {
    const client = await context.newCDPSession(seed);
    await client.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
      width,
      height,
    });
    newPage = await Promise.race([
      context.waitForEvent("page", { timeout: 5000 }),
      (async () => {
        await seed.waitForTimeout(400);
        return context.pages().find((p) => !before.has(p) && !p.isClosed()) || null;
      })(),
    ]);
    if (!newPage) {
      newPage = context.pages().find((p) => !before.has(p) && !p.isClosed()) || null;
    }
  } catch (err) {
    log("warn", `เปิดหน้าต่างใหม่ผ่าน CDP ไม่ได้ (${err.message}) — ใช้ window.open`);
  }

  if (!newPage) {
    const popupPromise = context.waitForEvent("page");
    await seed.evaluate(
      ({ w, h }) => {
        window.open("about:blank", "_blank", `popup=yes,width=${w},height=${h}`);
      },
      { w: width, h: height }
    );
    newPage = await popupPromise;
  }

  if (url && url !== "about:blank") {
    await newPage.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }

  log("info", `เปิดหน้าต่างสินค้าใหม่แล้ว (${newPage.url() || "blank"})`);
  return { context, page: newPage, profileDir: browser.profileDir };
}

/** Tile product windows across the screen (best-effort via CDP). */
export async function tileProductWindows(pages, { onLog } = {}) {
  const log = logFn(onLog);
  const list = (pages || []).filter((p) => p && !p.isClosed());
  if (list.length === 0) return;

  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  const screenW = 1600;
  const screenH = 900;
  const w = Math.floor(screenW / cols);
  const h = Math.floor(screenH / rows);

  for (let i = 0; i < list.length; i++) {
    const page = list[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = col * w;
    const top = row * h;
    try {
      const session = await page.context().newCDPSession(page);
      const { windowId } = await session.send("Browser.getWindowForTarget");
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { left, top, width: w, height: h, windowState: "normal" },
      });
    } catch {
      // Window tiling is best-effort.
    }
  }
  log("info", `จัดเรียง ${list.length} หน้าต่างสินค้าแล้ว`);
}

export { SESSION_COOKIE_NAMES, STRONG_SESSION_COOKIES, hasSavedSessionFile };
