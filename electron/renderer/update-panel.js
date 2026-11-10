/**
 * Version + update controls (separate from renderer.js).
 */
(function () {
  const versionLabel = document.getElementById("appVersionLabel");
  const statusText = document.getElementById("updateStatusText");
  const btnCheck = document.getElementById("btnCheckUpdate");
  const btnUpdate = document.getElementById("btnUpdateNow");
  const progressWrap = document.getElementById("updateProgressWrap");
  const progressBar = document.getElementById("updateProgressBar");

  if (!window.shopeeBot || !btnCheck || !btnUpdate) return;

  let appInfo = {
    version: "…",
    portable: false,
    updaterEnabled: false,
    releasesUrl: "https://github.com/LatinR9/Shopee-BOTR9/releases",
  };
  let latestRemote = null;
  let downloadReady = false;

  function setStatus(message) {
    statusText.textContent = message || "";
  }

  function setProgress(percent) {
    if (percent == null) {
      progressWrap.hidden = true;
      progressBar.style.width = "0%";
      return;
    }
    progressWrap.hidden = false;
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function refreshUpdateButton() {
    if (appInfo.portable || !appInfo.updaterEnabled) {
      btnUpdate.disabled = false;
      btnUpdate.textContent = "เปิดหน้าดาวน์โหลด";
      return;
    }
    if (downloadReady) {
      btnUpdate.disabled = false;
      btnUpdate.textContent = "รีสตาร์ทเพื่อติดตั้ง";
      return;
    }
    if (latestRemote) {
      btnUpdate.disabled = false;
      btnUpdate.textContent = "อัปเดตตอนนี้";
      return;
    }
    btnUpdate.disabled = true;
    btnUpdate.textContent = "อัปเดตตอนนี้";
  }

  function applyStatus(status) {
    if (!status) return;
    if (status.state === "checking") {
      setStatus(status.message || "กำลังตรวจหาอัปเดต…");
      setProgress(null);
    } else if (status.state === "available") {
      latestRemote = status.version || latestRemote;
      downloadReady = false;
      setStatus(
        status.message ||
          (latestRemote
            ? `มีเวอร์ชันใหม่ ${latestRemote} ให้ดาวน์โหลด`
            : "มีเวอร์ชันใหม่")
      );
      setProgress(null);
      refreshUpdateButton();
    } else if (status.state === "none") {
      latestRemote = null;
      downloadReady = false;
      setStatus(status.message || "เป็นเวอร์ชันล่าสุดแล้ว");
      setProgress(null);
      refreshUpdateButton();
    } else if (status.state === "downloading") {
      setStatus(status.message || `กำลังดาวน์โหลด… ${status.percent || 0}%`);
      setProgress(status.percent || 0);
    } else if (status.state === "ready") {
      downloadReady = true;
      latestRemote = status.version || latestRemote;
      setStatus(status.message || "ดาวน์โหลดเสร็จแล้ว — พร้อมติดตั้ง");
      setProgress(100);
      refreshUpdateButton();
    } else if (status.state === "portable") {
      setStatus(status.message || "เวอร์ชันพกพาอัปเดตเองไม่ได้");
      setProgress(null);
      refreshUpdateButton();
    } else if (status.state === "error" || status.state === "skipped") {
      setStatus(status.message || "ตรวจอัปเดตไม่สำเร็จ");
      setProgress(null);
    }
  }

  async function init() {
    try {
      appInfo = (await window.shopeeBot.getAppInfo()) || appInfo;
    } catch {
      // keep defaults
    }
    versionLabel.textContent = `v${appInfo.version || "?"}`;
    if (appInfo.portable) {
      setStatus(
        "เวอร์ชันพกพา (portable) — กดเปิดหน้าดาวน์โหลดเพื่อเอา Setup ล่าสุด"
      );
    } else if (!appInfo.updaterEnabled) {
      setStatus("โหมดพัฒนา — ปุ่มอัปเดตใช้ได้เต็มที่หลังติดตั้ง Setup");
    }
    refreshUpdateButton();
  }

  btnCheck.addEventListener("click", async () => {
    btnCheck.disabled = true;
    setStatus("กำลังเช็กอัปเดตจาก GitHub Releases…");
    try {
      const result = await window.shopeeBot.checkForUpdates();
      if (result?.state === "available") {
        latestRemote = result.version;
        downloadReady = false;
        setStatus(result.message || `มีเวอร์ชันใหม่ ${result.version}`);
      } else if (result?.state === "none") {
        latestRemote = null;
        setStatus(result.message || "เป็นเวอร์ชันล่าสุดแล้ว");
      } else if (result?.reason === "portable") {
        setStatus(
          result.message ||
            "เวอร์ชันพกพาอัปเดตเองไม่ได้ — กดเปิดหน้าดาวน์โหลด"
        );
      } else if (result?.message) {
        setStatus(result.message);
      }
      refreshUpdateButton();
    } catch (err) {
      setStatus(`เช็กอัปเดตไม่สำเร็จ: ${err.message || err}`);
    } finally {
      btnCheck.disabled = false;
    }
  });

  btnUpdate.addEventListener("click", async () => {
    if (appInfo.portable || !appInfo.updaterEnabled) {
      await window.shopeeBot.openReleasesPage();
      setStatus("เปิดหน้า Releases แล้ว — ดาวน์โหลดไฟล์ Setup");
      return;
    }

    btnUpdate.disabled = true;
    try {
      if (downloadReady) {
        setStatus("กำลังรีสตาร์ทเพื่อติดตั้ง…");
        await window.shopeeBot.installUpdate();
        return;
      }

      setStatus(
        latestRemote
          ? `กำลังดาวน์โหลดเวอร์ชัน ${latestRemote}…`
          : "กำลังเช็กแล้วดาวน์โหลดอัปเดต…"
      );
      const result = await window.shopeeBot.downloadUpdate();
      if (result?.reason === "portable") {
        setStatus(result.message || "เปิดหน้าดาวน์โหลดแล้ว");
      } else if (result?.state === "none") {
        setStatus(result.message || "เป็นเวอร์ชันล่าสุดแล้ว");
      } else if (result?.ok === false && result?.message) {
        setStatus(result.message);
      }
    } catch (err) {
      setStatus(`อัปเดตไม่สำเร็จ: ${err.message || err}`);
    } finally {
      refreshUpdateButton();
    }
  });

  window.shopeeBot.onUpdateStatus?.(applyStatus);
  init();
})();
