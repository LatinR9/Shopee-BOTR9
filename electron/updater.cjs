/**
 * Auto-update via electron-updater + GitHub Releases (NSIS installer).
 * Portable builds cannot self-update — UI should link to the download page.
 */
const { dialog, app } = require("electron");

const RELEASES_URL = "https://github.com/LatinR9/Shopee-BOTR9/releases";

function detectPortable() {
  const execPath = String(process.execPath || "").toLowerCase();
  return Boolean(
    process.env.PORTABLE_EXECUTABLE_DIR ||
      execPath.includes("portable") ||
      /\\temp\\/i.test(execPath) ||
      /\\appdata\\local\\temp\\/i.test(execPath)
  );
}

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function setupAutoUpdater(getMainWindow) {
  const portable = detectPortable();
  const version = app.getVersion();

  if (!app.isPackaged) {
    return {
      enabled: false,
      reason: "dev",
      version,
      releasesUrl: RELEASES_URL,
      portable: false,
    };
  }

  if (portable) {
    return {
      enabled: false,
      reason: "portable",
      version,
      releasesUrl: RELEASES_URL,
      portable: true,
    };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.warn("[updater] electron-updater missing:", err.message);
    return {
      enabled: false,
      reason: "missing_module",
      version,
      releasesUrl: RELEASES_URL,
      portable: false,
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  try {
    autoUpdater.verifyUpdateCodeSignature = false;
  } catch {
    // older electron-updater
  }

  /** @type {{ version?: string } | null} */
  let pendingUpdate = null;

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
    pendingUpdate = { version: info.version };
    send("update:status", {
      state: "available",
      message: `มีเวอร์ชันใหม่ ${info.version} ให้ดาวน์โหลด`,
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    pendingUpdate = null;
    send("update:status", {
      state: "none",
      message: "เป็นเวอร์ชันล่าสุดแล้ว",
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
    pendingUpdate = { version: info.version };
    send("update:status", {
      state: "ready",
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เสร็จแล้ว — พร้อมติดตั้ง`,
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
      const result = await autoUpdater.checkForUpdates();
      const remote = result?.updateInfo?.version;
      const hasUpdate = Boolean(
        remote && remote !== version && (result?.downloadPromise !== undefined || pendingUpdate)
      );
      // Prefer event-driven state; also return a summary for IPC callers.
      if (remote && remote !== app.getVersion()) {
        pendingUpdate = { version: remote };
        return {
          ok: true,
          state: "available",
          version: remote,
          message: `มีเวอร์ชันใหม่ ${remote} ให้ดาวน์โหลด`,
        };
      }
      pendingUpdate = null;
      return {
        ok: true,
        state: "none",
        version: app.getVersion(),
        message: "เป็นเวอร์ชันล่าสุดแล้ว",
      };
    } catch (err) {
      const message = `ตรวจอัปเดตไม่สำเร็จ: ${err?.message || err}`;
      send("update:status", { state: "error", message });
      return { ok: false, state: "error", message };
    }
  };

  const download = async () => {
    try {
      if (!pendingUpdate) {
        const checked = await check();
        if (checked.state !== "available") {
          return checked;
        }
      }
      await autoUpdater.downloadUpdate();
      return { ok: true, state: "downloading" };
    } catch (err) {
      return { ok: false, state: "error", message: err?.message || String(err) };
    }
  };

  const install = () => {
    autoUpdater.quitAndInstall(false, true);
  };

  // Quiet startup check
  setTimeout(() => {
    check().catch(() => {});
  }, 2500);

  return {
    enabled: true,
    reason: null,
    version,
    releasesUrl: RELEASES_URL,
    portable: false,
    check,
    download,
    install,
    getPending: () => pendingUpdate,
  };
}

module.exports = { setupAutoUpdater, RELEASES_URL };
