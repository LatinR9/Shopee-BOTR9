/**
 * Auto-update via electron-updater + GitHub Releases (NSIS installer).
 * Portable builds cannot self-update — skip quietly there.
 */
const { dialog, app } = require("electron");

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function setupAutoUpdater(getMainWindow) {
  // Dev / unpackaged: no update feed
  if (!app.isPackaged) {
    return { enabled: false, reason: "dev" };
  }

  // Portable Electron apps usually run from a temp/extract path and cannot
  // replace themselves via NSIS. Detect common portable markers.
  const execPath = process.execPath.toLowerCase();
  const isPortable =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    execPath.includes("portable") ||
    /\\temp\\/i.test(execPath) ||
    /\\appdata\\local\\temp\\/i.test(execPath);

  if (isPortable) {
    return { enabled: false, reason: "portable" };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.warn("[updater] electron-updater missing:", err.message);
    return { enabled: false, reason: "missing_module" };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Unsigned Windows builds — do not require a code signature to apply updates
  try {
    autoUpdater.verifyUpdateCodeSignature = false;
  } catch {
    // older electron-updater may not expose this
  }

  const send = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  autoUpdater.on("checking-for-update", () => {
    send("update:status", { state: "checking", message: "กำลังตรวจหาอัปเดต…" });
  });

  autoUpdater.on("update-available", (info) => {
    send("update:status", {
      state: "available",
      message: `พบเวอร์ชันใหม่ ${info.version}`,
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    send("update:status", {
      state: "none",
      message: "คุณใช้เวอร์ชันล่าสุดแล้ว",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent || 0);
    send("update:status", {
      state: "downloading",
      message: `กำลังดาวน์โหลดอัปเดต… ${pct}%`,
      percent: pct,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    send("update:status", {
      state: "ready",
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เสร็จแล้ว`,
      version: info.version,
    });

    const win = getMainWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: "info",
      buttons: ["รีสตาร์ทเพื่ออัปเดต", "ไว้ทีหลัง"],
      defaultId: 0,
      cancelId: 1,
      title: "อัปเดตพร้อมติดตั้ง",
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เสร็จแล้ว`,
      detail:
        "กดรีสตาร์ทเพื่อติดตั้งอัปเดตทันที\n(โปรแกรมยังไม่ได้เซ็นชื่อดิจิทัล — Windows อาจเตือน SmartScreen อีกครั้ง)",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on("error", (err) => {
    send("update:status", {
      state: "error",
      message: `ตรวจอัปเดตไม่สำเร็จ: ${err?.message || err}`,
    });
  });

  const check = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      send("update:status", {
        state: "error",
        message: `ตรวจอัปเดตไม่สำเร็จ: ${err?.message || err}`,
      });
    }
  };

  const download = async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  };

  const install = () => {
    autoUpdater.quitAndInstall(false, true);
  };

  // Startup check (slight delay so the window can load)
  setTimeout(() => {
    check();
  }, 2500);

  return { enabled: true, check, download, install };
}

module.exports = { setupAutoUpdater };
