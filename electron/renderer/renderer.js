const $ = (id) => document.getElementById(id);

const fields = [
  "productUrl",
  "saleStart",
  "quantity",
  "variants",
  "preclickMs",
  "clickTimeoutMs",
  "autoPlaceOrder",
  "username",
  "password",
];

function appendLog(entry) {
  const el = $("log");
  const line = document.createElement("div");
  line.className = entry.level || "info";
  const time = new Date(entry.at || Date.now()).toLocaleTimeString("th-TH", {
    hour12: false,
  });
  line.textContent = `[${time}] ${entry.message}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, kind = "idle") {
  const pill = $("statusPill");
  pill.textContent = text;
  pill.className = `status ${kind}`;
}

function readForm() {
  return {
    productUrl: $("productUrl").value.trim(),
    saleStart: toIsoLocal($("saleStart").value),
    quantity: Number($("quantity").value) || 1,
    variants: $("variants").value.trim(),
    preclickMs: Number($("preclickMs").value) || 500,
    clickTimeoutMs: Number($("clickTimeoutMs").value) || 15000,
    autoPlaceOrder: $("autoPlaceOrder").checked,
    username: $("username").value.trim(),
    password: $("password").value,
    baseUrl: "https://shopee.co.th",
  };
}

function fillForm(settings) {
  $("productUrl").value = settings.productUrl || "";
  $("saleStart").value = toDatetimeLocalValue(settings.saleStart);
  $("quantity").value = settings.quantity ?? 1;
  $("variants").value = settings.variants || "";
  $("preclickMs").value = settings.preclickMs ?? 500;
  $("clickTimeoutMs").value = settings.clickTimeoutMs ?? 15000;
  $("autoPlaceOrder").checked = Boolean(settings.autoPlaceOrder);
  $("username").value = settings.username || "";
  $("password").value = settings.password || "";
}

function toDatetimeLocalValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoLocal(datetimeLocal) {
  if (!datetimeLocal) return "";
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function setRunning(running) {
  $("btnLogin").disabled = running;
  $("btnDryRun").disabled = running;
  $("btnStart").disabled = running;
  $("btnSave").disabled = running;
  $("btnStop").disabled = !running;
  fields.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = running;
  });
}

async function saveSettings(silent = false) {
  const saved = await window.shopeeBot.saveSettings(readForm());
  if (!silent) appendLog({ level: "info", message: "บันทึกค่าในเครื่องแล้ว" });
  return saved;
}

async function run(mode) {
  await saveSettings(true);
  setRunning(true);
  setStatus(
    mode === "login"
      ? "กำลังเข้าสู่ระบบ…"
      : mode === "dry-run"
        ? "กำลังทดสอบ…"
        : "กำลังรัน Flash Sale…",
    "running"
  );
  appendLog({
    level: "info",
    message:
      mode === "login"
        ? "เปิดเบราว์เซอร์สำหรับเข้าสู่ระบบ"
        : mode === "dry-run"
          ? "เริ่มโหมดทดสอบ"
          : "เริ่มกด Flash Sale",
  });

  const result = await window.shopeeBot.startJob({
    mode,
    settings: readForm(),
  });

  setRunning(false);
  if (result?.reason === "busy") {
    setStatus("กำลังทำงานอยู่", "warn");
    return;
  }
  if (result?.ok) {
    setStatus("สำเร็จ", "ok");
  } else if (result?.reason === "stopped") {
    setStatus("หยุดแล้ว", "idle");
  } else {
    setStatus("ไม่สำเร็จ — ดูบันทึกด้านล่าง", "err");
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  window.shopeeBot.onLog(appendLog);
  window.shopeeBot.onStatus((status) => {
    if (status.running) setRunning(true);
    else setRunning(false);
  });

  try {
    const settings = await window.shopeeBot.getSettings();
    fillForm(settings);
    appendLog({ level: "info", message: "โหลดค่าที่บันทึกไว้แล้ว — พร้อมใช้งาน" });
  } catch (err) {
    appendLog({ level: "error", message: `โหลดค่าไม่สำเร็จ: ${err.message || err}` });
  }

  $("btnSave").addEventListener("click", () => saveSettings(false));
  $("btnLogin").addEventListener("click", () => run("login"));
  $("btnDryRun").addEventListener("click", () => run("dry-run"));
  $("btnStart").addEventListener("click", () => run("start"));
  $("btnStop").addEventListener("click", async () => {
    await window.shopeeBot.stopJob();
  });
  $("btnClearLog").addEventListener("click", () => {
    $("log").textContent = "";
  });
});
