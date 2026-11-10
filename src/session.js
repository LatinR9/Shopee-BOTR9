/**
 * Shared Shopee browser-profile / storage-state helpers.
 * Login, scan, dry-run, and start must all use the same profile under app userData.
 */
import fs from "node:fs";
import path from "node:path";

/** Cookies that indicate a real buyer session (QR or password). */
export const STRONG_SESSION_COOKIES = ["SPC_EC", "SPC_ST"];
export const SESSION_COOKIE_NAMES = ["SPC_EC", "SPC_ST", "SPC_U_ID", "SPC_SI"];

export function storageStatePath(profileDir) {
  return path.join(path.resolve(profileDir), "shopee-storage-state.json");
}

export function ensureProfileDir(profileDir) {
  const dir = path.resolve(profileDir);
  if (!dir || dir.endsWith(`${path.sep}undefined`) || dir.endsWith("undefined")) {
    throw new Error(`โปรไฟล์เบราว์เซอร์ไม่ถูกต้อง: ${profileDir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** True if we previously saved a storage-state file with session cookies. */
export function hasSavedSessionFile(profileDir) {
  const file = storageStatePath(profileDir);
  try {
    if (!fs.existsSync(file)) return false;
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
    return cookies.some(
      (c) =>
        SESSION_COOKIE_NAMES.includes(c.name) &&
        c.value &&
        String(c.value).length > 5
    );
  } catch {
    return false;
  }
}

export async function readSessionCookies(context) {
  try {
    return await context.cookies();
  } catch {
    return [];
  }
}

export function findSessionCookie(cookies, names = SESSION_COOKIE_NAMES) {
  return (cookies || []).find(
    (c) => names.includes(c.name) && c.value && String(c.value).length > 5
  );
}

/**
 * Flush cookies/localStorage to disk so the next launch sees the same session.
 * Persistent Chromium profiles can lose in-memory cookies if closed too fast
 * (especially right after QR login).
 */
export async function saveSession(context, profileDir, log = () => {}) {
  const dir = ensureProfileDir(profileDir);
  const file = storageStatePath(dir);
  try {
    const state = await context.storageState();
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
    const hit = findSessionCookie(state.cookies || []);
    if (hit) {
      log(`บันทึกเซสชันลงดิสก์แล้ว (${hit.name}) → ${file}`);
      return { ok: true, file, cookie: hit.name };
    }
    log(`บันทึก storage state แล้ว แต่ยังไม่เห็นคุกกี้ล็อกอินที่ชัดเจน → ${file}`);
    return { ok: false, file, reason: "no_session_cookie" };
  } catch (err) {
    log(`บันทึกเซสชันไม่สำเร็จ: ${err.message || err}`);
    return { ok: false, reason: "save_failed", message: err.message || String(err) };
  }
}

/**
 * Launch persistent Chromium and re-apply cookies from storage-state backup.
 * Logs in Thai whether a saved session was found.
 */
export async function launchWithSession(config, { onLog } = {}) {
  const log = (msg) => (onLog ? onLog("info", msg) : console.log(msg));
  const profileDir = ensureProfileDir(config.userDataDir || config.profileDir);
  const stateFile = storageStatePath(profileDir);
  const hadFile = hasSavedSessionFile(profileDir);

  log(`โปรไฟล์เบราว์เซอร์: ${profileDir}`);
  if (hadFile) {
    log("พบเซสชันที่บันทึกไว้ — จะใช้คุกกี้เดิม");
  } else {
    log("ยังไม่พบเซสชันที่บันทึกไว้ — อาจต้องเข้าสู่ระบบ");
  }

  const { context, page } = await launchBrowser({
    ...config,
    userDataDir: profileDir,
  });

  // Re-apply cookies from backup (covers cases where the Chromium profile
  // did not flush in time after the previous close).
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const cookies = (state.cookies || []).map((c) => {
        const copy = { ...c };
        // Playwright rejects some leftover fields from storageState dumps.
        delete copy.sameSite;
        if (c.sameSite) copy.sameSite = c.sameSite;
        return copy;
      });
      if (cookies.length) {
        await context.addCookies(cookies);
      }
    } catch (err) {
      log(`โหลดคุกกี้จากไฟล์ไม่สำเร็จ: ${err.message || err}`);
    }
  }

  const live = findSessionCookie(await readSessionCookies(context));
  if (live) {
    log(`เซสชันพร้อมใช้งาน (${live.name})`);
  } else if (hadFile) {
    log("มีไฟล์เซสชันแต่คุกกี้ยังไม่โผล่ — อาจหมดอายุหรือโดนล้าง");
  }

  return { context, page, profileDir, hasSession: Boolean(live), hadFile };
}
