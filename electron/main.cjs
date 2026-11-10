const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { setupAutoUpdater } = require("./updater.cjs");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {AbortController | null} */
let activeAbort = null;
let jobRunning = false;
/** @type {{ enabled: boolean, check?: Function, download?: Function, install?: Function, reason?: string }} */
let updaterApi = { enabled: false };

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function profileDir() {
  return path.join(app.getPath("userData"), "browser-profile");
}

function screenshotDir() {
  return path.join(app.getPath("userData"), "screenshots");
}

function resourcesPath() {
  // Packaged: extraResources/ms-playwright
  // Dev: project ./ms-playwright or default Playwright cache
  if (app.isPackaged) return process.resourcesPath;
  return path.join(__dirname, "..");
}

function sendLog(level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("job:log", {
      level,
      message: String(message),
      at: Date.now(),
    });
  }
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("job:status", status);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 760,
    minHeight: 640,
    title: "Shopee Flash Sale Bot",
    backgroundColor: "#fff7f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function readSettings() {
  const file = settingsPath();
  const defaults = {
    productUrl: "",
    saleStart: "",
    quantity: 1,
    variants: "",
    selectedVariants: [],
    variantScan: null,
    preAddToCart: true,
    preclickMs: 500,
    clickTimeoutMs: 15000,
    autoPlaceOrder: false,
    baseUrl: "https://shopee.co.th",
    username: "",
    password: "",
  };
  try {
    if (!fs.existsSync(file)) return defaults;
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return defaults;
  }
}

function writeSettings(settings) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readSettings();
  const next = { ...current, ...settings };
  // Keep previous password if UI sent blank
  if (!next.password && current.password) next.password = current.password;
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return { ...next, password: next.password ? "********" : "" };
}

ipcMain.handle("settings:get", () => {
  const s = readSettings();
  return { ...s, password: s.password ? "********" : "" };
});

ipcMain.handle("settings:save", (_event, settings) => {
  const incoming = { ...settings };
  if (incoming.password === "********") delete incoming.password;
  return writeSettings(incoming);
});

ipcMain.handle("job:stop", () => {
  if (activeAbort) {
    activeAbort.abort();
    sendLog("warn", "กำลังหยุด…");
    return { ok: true };
  }
  return { ok: false, reason: "idle" };
});

ipcMain.handle("app:info", () => {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    updaterEnabled: Boolean(updaterApi.enabled),
    reason: updaterApi.reason || null,
    portable: Boolean(updaterApi.portable),
    releasesUrl:
      updaterApi.releasesUrl || "https://github.com/LatinR9/Shopee-BOTR9/releases",
  };
});

ipcMain.handle("update:open-releases", async () => {
  const url =
    updaterApi.releasesUrl || "https://github.com/LatinR9/Shopee-BOTR9/releases";
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle("update:check", async () => {
  if (!updaterApi.enabled || !updaterApi.check) {
    const releasesUrl =
      updaterApi.releasesUrl || "https://github.com/LatinR9/Shopee-BOTR9/releases";
    if (updaterApi.reason === "portable") {
      const message =
        "เวอร์ชันพกพา (portable) อัปเดตในเครื่องไม่ได้ — ดาวน์โหลด Setup จากหน้า Releases";
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:status", {
          state: "portable",
          message,
          releasesUrl,
        });
      }
      return { ok: false, reason: "portable", message, releasesUrl };
    }
    if (updaterApi.reason === "dev") {
      const message = "โหมดพัฒนา — ตรวจอัปเดตได้เฉพาะตัวติดตั้งที่แพ็กแล้ว";
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:status", {
          state: "skipped",
          message,
        });
      }
      return { ok: false, reason: "dev", message };
    }
    return { ok: false, reason: updaterApi.reason || "disabled" };
  }
  return updaterApi.check();
});

ipcMain.handle("update:download", async () => {
  if (!updaterApi.enabled || !updaterApi.download) {
    if (updaterApi.reason === "portable") {
      const releasesUrl =
        updaterApi.releasesUrl || "https://github.com/LatinR9/Shopee-BOTR9/releases";
      await shell.openExternal(releasesUrl);
      return {
        ok: false,
        reason: "portable",
        message: "เปิดหน้าดาวน์โหลดแล้ว — เลือกไฟล์ Setup เพื่ออัปเดต",
        releasesUrl,
      };
    }
    return { ok: false, reason: updaterApi.reason || "disabled" };
  }
  return updaterApi.download();
});

ipcMain.handle("update:install", () => {
  if (!updaterApi.enabled || !updaterApi.install) {
    return { ok: false, reason: updaterApi.reason || "disabled" };
  }
  updaterApi.install();
  return { ok: true };
});

ipcMain.handle("job:start", async (_event, payload) => {
  if (jobRunning) {
    return { ok: false, reason: "busy" };
  }

  const mode = payload?.mode || "start";
  if (payload?.settings) {
    const incoming = { ...payload.settings };
    if (incoming.password === "********") delete incoming.password;
    writeSettings(incoming);
  }

  const settings = readSettings();
  jobRunning = true;
  activeAbort = new AbortController();
  sendStatus({ running: true, mode });

  process.env.SHOPEE_SCREENSHOT_DIR = screenshotDir();
  fs.mkdirSync(screenshotDir(), { recursive: true });

  try {
    const runtimeUrl = pathToFileURL(
      path.join(__dirname, "..", "src", "runtime.js")
    ).href;
    const { runBotJob } = await import(runtimeUrl);
    const result = await runBotJob({
      settings,
      mode,
      signal: activeAbort.signal,
      profileDir: profileDir(),
      resourcesPath: resourcesPath(),
      headless: false,
      onLog: (level, message) => sendLog(level, message),
    });
    sendLog(result.ok ? "info" : "warn", result.ok ? "งานเสร็จแล้ว" : `จบแบบไม่สำเร็จ: ${result.reason || ""}`);
    return { ok: Boolean(result.ok), result };
  } catch (err) {
    if (err?.name === "AbortError") {
      sendLog("warn", "หยุดแล้ว");
      return { ok: false, reason: "stopped" };
    }
    sendLog("error", err?.message || String(err));
    return { ok: false, reason: "error", message: err?.message || String(err) };
  } finally {
    jobRunning = false;
    activeAbort = null;
    sendStatus({ running: false, mode: null });
  }
});

ipcMain.handle("variants:scan", async (_event, payload) => {
  // Shares the job lock: scanning opens the same browser profile.
  if (jobRunning) {
    return { ok: false, reason: "busy" };
  }
  const productUrl = String(payload?.productUrl || "").trim();
  if (!productUrl) {
    return { ok: false, reason: "no_url" };
  }

  jobRunning = true;
  sendStatus({ running: true, mode: "scan" });
  try {
    const variantsUrl = pathToFileURL(
      path.join(__dirname, "..", "src", "variants.js")
    ).href;
    const { scanVariants } = await import(variantsUrl);
    const result = await scanVariants({
      productUrl,
      baseUrl: readSettings().baseUrl,
      profileDir: profileDir(),
      resourcesPath: resourcesPath(),
      onLog: (level, message) => sendLog(level, message),
    });
    if (result.ok) {
      writeSettings({ variantScan: result });
    }
    return result;
  } catch (err) {
    sendLog("error", err?.message || String(err));
    return { ok: false, reason: "error", message: err?.message || String(err) };
  } finally {
    jobRunning = false;
    sendStatus({ running: false, mode: null });
  }
});

app.whenReady().then(() => {
  // Prefer bundled browsers if present
  const bundled = path.join(resourcesPath(), "ms-playwright");
  const local = path.join(__dirname, "..", "ms-playwright");
  if (fs.existsSync(bundled)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
  } else if (fs.existsSync(local)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = local;
  }

  createWindow();

  updaterApi = setupAutoUpdater(() => mainWindow);
  if (!updaterApi.enabled && updaterApi.reason === "portable") {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:status", {
          state: "portable",
          message:
            "เวอร์ชันพกพา (portable) อัปเดตในเครื่องไม่ได้ — กดเปิดหน้าดาวน์โหลดเพื่อเอา Setup",
          releasesUrl: updaterApi.releasesUrl,
        });
      }
    }, 1500);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (activeAbort) activeAbort.abort();
  if (process.platform !== "darwin") app.quit();
});
