const $ = (id) => document.getElementById(id);

const fields = [
  "productUrl",
  "saleStart",
  "quantity",
  "variants",
  "preclickMs",
  "clickTimeoutMs",
  "autoPlaceOrder",
  "preAddToCart",
  "username",
  "password",
  "btnScan",
  "variantFilter",
  "btnSelectAll",
  "btnSelectNone",
];

const variantState = {
  /** Last scan result for the current link */
  scan: null,
  /** key -> { key, labels, quantity } */
  selected: new Map(),
  running: false,
};

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(true), 400);
}

function currentScan() {
  const url = $("productUrl").value.trim();
  const scan = variantState.scan;
  return scan && scan.url === url ? scan : null;
}

function formatPrice(price) {
  if (price == null) return "";
  return `฿${Number(price).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
}

function defaultQuantity() {
  return Math.max(1, Number($("quantity").value) || 1);
}

function renderVariants() {
  const list = $("variantList");
  const status = $("variantStatus");
  const tools = $("variantTools");
  const summary = $("variantSummary");
  const scrollTop = list.scrollTop;
  list.textContent = "";

  const scan = currentScan();
  if (!scan) {
    tools.hidden = true;
    summary.hidden = true;
    status.textContent = $("productUrl").value.trim()
      ? 'กด "สแกนตัวเลือก" เพื่อดูสี / ขนาดของลิงก์นี้'
      : 'วางลิงก์แล้วกด "สแกนตัวเลือก" เพื่อดูสี / ขนาด';
    return;
  }

  const models = scan.models || [];
  if (models.length === 0) {
    tools.hidden = true;
    summary.hidden = true;
    status.textContent = `${scan.itemName || "สินค้านี้"} — ไม่มีตัวเลือก ซื้อได้เลย`;
    return;
  }

  const tierNames = (scan.tiers || []).map((t) => t.name).join(" × ");
  status.textContent = `${scan.itemName || "สินค้า"} — ${models.length} แบบ${tierNames ? ` (${tierNames})` : ""}`;
  tools.hidden = false;

  const filter = $("variantFilter").value.trim().toLowerCase();
  for (const model of models) {
    if (filter && !model.key.toLowerCase().includes(filter)) continue;
    const chosen = variantState.selected.get(model.key);
    const soldOut = model.stock === 0;

    const li = document.createElement("li");
    li.className = `variant-row${chosen ? " chosen" : ""}${soldOut ? " soldout" : ""}`;

    const label = document.createElement("label");
    label.className = "variant-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(chosen);
    box.disabled = variantState.running;
    const name = document.createElement("span");
    name.className = "variant-name";
    name.textContent = model.labels.join(" / ");
    label.append(box, name);

    const meta = document.createElement("span");
    meta.className = "variant-meta";
    const price = formatPrice(model.price);
    const stock =
      model.stock == null ? "" : soldOut ? "หมด (อาจมีตอน Flash Sale)" : `เหลือ ${model.stock}`;
    meta.textContent = [price, stock].filter(Boolean).join(" · ");

    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.max = "99";
    qty.className = "variant-qty";
    qty.title = "จำนวน";
    qty.value = String(chosen?.quantity ?? defaultQuantity());
    qty.disabled = !chosen || variantState.running;

    box.addEventListener("change", () => {
      if (box.checked) {
        variantState.selected.set(model.key, {
          key: model.key,
          labels: model.labels,
          quantity: Math.max(1, Number(qty.value) || 1),
        });
      } else {
        variantState.selected.delete(model.key);
      }
      renderVariants();
      saveSoon();
    });
    qty.addEventListener("change", () => {
      const entry = variantState.selected.get(model.key);
      if (!entry) return;
      entry.quantity = Math.max(1, Math.min(99, Number(qty.value) || 1));
      qty.value = String(entry.quantity);
      renderSummary();
      saveSoon();
    });

    li.append(label, meta, qty);
    list.appendChild(li);
  }
  list.scrollTop = scrollTop;
  renderSummary();
}

function renderSummary() {
  const summary = $("variantSummary");
  const picks = Array.from(variantState.selected.values());
  if (!currentScan() || picks.length === 0) {
    summary.hidden = !currentScan();
    summary.textContent = "ยังไม่ได้เลือก — ติ๊กแบบที่ต้องการ (เลือกได้หลายแบบ)";
    return;
  }
  const pieces = picks.reduce((n, p) => n + p.quantity, 0);
  summary.hidden = false;
  summary.textContent =
    picks.length === 1
      ? `เลือก 1 แบบ รวม ${pieces} ชิ้น — บอทจะกด "ซื้อสินค้า" ทันที (เร็วที่สุด)`
      : `เลือก ${picks.length} แบบ รวม ${pieces} ชิ้น — ใส่รถเข็นทั้งหมดแล้วชำระเงินครั้งเดียว`;
}

function applyScanResult(result) {
  const sameLink = variantState.scan?.url === result.url;
  variantState.scan = result;
  const validKeys = new Set((result.models || []).map((m) => m.key));
  for (const key of Array.from(variantState.selected.keys())) {
    if (!sameLink || !validKeys.has(key)) variantState.selected.delete(key);
  }
  renderVariants();
}

async function scanVariants() {
  const url = $("productUrl").value.trim();
  if (!url) {
    appendLog({ level: "warn", message: "กรุณาวางลิงก์สินค้าก่อนสแกน" });
    return;
  }
  setRunning(true);
  setStatus("กำลังสแกนตัวเลือก…", "running");
  $("variantStatus").textContent = "กำลังสแกน… อาจมีหน้าต่างเบราว์เซอร์เปิดขึ้นชั่วครู่";
  try {
    const result = await window.shopeeBot.scanVariants(url);
    if (result?.ok) {
      applyScanResult(result);
      const n = result.models?.length || 0;
      appendLog({
        level: "info",
        message: n ? `สแกนเจอ ${n} ตัวเลือก — ติ๊กแบบที่ต้องการได้เลย` : "สินค้านี้ไม่มีตัวเลือก",
      });
      setStatus("สแกนเสร็จ", "ok");
      await saveSettings(true);
    } else if (result?.reason === "busy") {
      setStatus("กำลังทำงานอยู่", "warn");
    } else {
      const why =
        result?.reason === "traffic_block"
          ? 'Shopee ขอยืนยันตัวตน — กด "เข้าสู่ระบบ" ก่อนแล้วสแกนใหม่'
          : result?.message || "สแกนไม่สำเร็จ — ลองใหม่ หรือพิมพ์ตัวเลือกเอง";
      appendLog({ level: "warn", message: why });
      setStatus("สแกนไม่สำเร็จ", "err");
      renderVariants();
    }
  } finally {
    setRunning(false);
  }
}

function looksLikeShopeeProduct(url) {
  return /shopee\.[a-z.]+\/.+(-i\.\d+\.\d+|\/product\/\d+\/\d+|\/\d+\/\d+)/i.test(url);
}

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
    preAddToCart: $("preAddToCart").checked,
    selectedVariants: currentScan() ? Array.from(variantState.selected.values()) : [],
    variantScan: variantState.scan,
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
  $("preAddToCart").checked = settings.preAddToCart !== false;
  $("username").value = settings.username || "";
  $("password").value = settings.password || "";

  variantState.scan = settings.variantScan || null;
  variantState.selected = new Map(
    (settings.selectedVariants || [])
      .filter((v) => v && v.key && Array.isArray(v.labels))
      .map((v) => [v.key, { key: v.key, labels: v.labels, quantity: Math.max(1, Number(v.quantity) || 1) }])
  );
  renderVariants();
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
  variantState.running = running;
  $("variantList")
    .querySelectorAll("input")
    .forEach((el) => {
      el.disabled = running || (el.classList.contains("variant-qty") && !el.closest(".chosen"));
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
  $("btnScan").addEventListener("click", scanVariants);
  $("productUrl").addEventListener("input", renderVariants);
  $("productUrl").addEventListener("paste", () => {
    setTimeout(() => {
      const url = $("productUrl").value.trim();
      renderVariants();
      if (!variantState.running && looksLikeShopeeProduct(url) && !currentScan()) {
        scanVariants();
      }
    }, 50);
  });
  $("variantFilter").addEventListener("input", renderVariants);
  $("btnSelectAll").addEventListener("click", () => {
    const scan = currentScan();
    if (!scan) return;
    const filter = $("variantFilter").value.trim().toLowerCase();
    for (const m of scan.models || []) {
      if (filter && !m.key.toLowerCase().includes(filter)) continue;
      if (m.stock === 0 || variantState.selected.has(m.key)) continue;
      variantState.selected.set(m.key, { key: m.key, labels: m.labels, quantity: defaultQuantity() });
    }
    renderVariants();
    saveSoon();
  });
  $("btnSelectNone").addEventListener("click", () => {
    variantState.selected.clear();
    renderVariants();
    saveSoon();
  });
  $("btnClearLog").addEventListener("click", () => {
    $("log").textContent = "";
  });
});
