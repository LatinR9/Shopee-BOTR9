/**
 * Minimal auto-update UI hook (separate from renderer.js to reduce merge conflicts).
 */
(function () {
  const root = document.getElementById("updateBanner");
  if (!root || !window.shopeeBot?.onUpdateStatus) return;

  const text = document.getElementById("updateBannerText");
  const btn = document.getElementById("updateBannerAction");

  function show(message, actionLabel, onAction) {
    root.hidden = false;
    text.textContent = message;
    if (actionLabel && onAction) {
      btn.hidden = false;
      btn.textContent = actionLabel;
      btn.onclick = onAction;
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
  }

  function hideSoon() {
    setTimeout(() => {
      root.hidden = true;
    }, 4000);
  }

  window.shopeeBot.onUpdateStatus((status) => {
    if (!status) return;
    if (status.state === "checking") {
      show(status.message || "กำลังตรวจหาอัปเดต…");
    } else if (status.state === "available") {
      show(status.message || "พบเวอร์ชันใหม่", "ดาวน์โหลด", async () => {
        btn.disabled = true;
        btn.textContent = "กำลังเริ่ม…";
        const res = await window.shopeeBot.downloadUpdate();
        btn.disabled = false;
        if (!res?.ok) {
          show(res?.message || "ดาวน์โหลดไม่สำเร็จ");
        }
      });
    } else if (status.state === "downloading") {
      show(status.message || `กำลังดาวน์โหลด… ${status.percent || 0}%`);
    } else if (status.state === "ready") {
      show(status.message || "พร้อมติดตั้ง", "รีสตาร์ทเลย", () => {
        window.shopeeBot.installUpdate();
      });
    } else if (status.state === "none") {
      show(status.message || "เป็นเวอร์ชันล่าสุดแล้ว");
      hideSoon();
    } else if (status.state === "error") {
      show(status.message || "ตรวจอัปเดตไม่สำเร็จ");
    } else if (status.state === "skipped") {
      show(status.message || "");
      hideSoon();
    }
  });
})();
