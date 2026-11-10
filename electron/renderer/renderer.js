const $ = (id) => document.getElementById(id);

function newProductId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyProduct(overrides = {}) {
  return {
    id: newProductId(),
    productUrl: "",
    quantity: 1,
    variants: "",
    selectedVariants: [],
    variantScan: null,
    ...overrides,
  };
}

const state = {
  products: [emptyProduct({ id: "p1" })],
  /** productId -> Map(key -> {key, labels, quantity}) */
  selected: new Map(),
  running: false,
  expandedId: null,
};

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(true), 400);
}

function formatPrice(price) {
  if (price == null) return "";
  return `฿${Number(price).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
}

function defaultQuantity() {
  return Math.max(1, Number($("quantity").value) || 1);
}

function selectedMap(productId) {
  if (!state.selected.has(productId)) state.selected.set(productId, new Map());
  return state.selected.get(productId);
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

function productTitle(product, index) {
  const name = product.variantScan?.itemName;
  if (name) return name;
  if (product.productUrl) {
    try {
      const last = new URL(product.productUrl).pathname.split("/").filter(Boolean).pop();
      return decodeURIComponent(last || "").slice(0, 48) || `สินค้า #${index + 1}`;
    } catch {
      /* ignore */
    }
  }
  return `สินค้า #${index + 1}`;
}

function renderVariantSection(product, container) {
  const scan = product.variantScan;
  const selected = selectedMap(product.id);

  const status = document.createElement("p");
  status.className = "hint";
  if (!scan) {
    status.textContent = product.productUrl
      ? 'กด "สแกนตัวเลือก" เพื่อดูสี / ขนาด'
      : "วางลิงก์ก่อน แล้วสแกนตัวเลือก";
    container.appendChild(status);
    return;
  }

  const models = scan.models || [];
  if (models.length === 0) {
    status.textContent = `${scan.itemName || "สินค้านี้"} — ไม่มีตัวเลือก ซื้อได้เลย`;
    container.appendChild(status);
    return;
  }

  const tierNames = (scan.tiers || []).map((t) => t.name).join(" × ");
  status.textContent = `${models.length} แบบ${tierNames ? ` (${tierNames})` : ""} — ติ๊กแบบที่ต้องการ`;
  container.appendChild(status);

  const tools = document.createElement("div");
  tools.className = "variant-tools";
  const filter = document.createElement("input");
  filter.type = "text";
  filter.placeholder = "ค้นหา เช่น ดำ หรือ XL";
  filter.dataset.role = "filter";
  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.className = "btn ghost tiny";
  btnAll.textContent = "เลือกทั้งหมด";
  const btnNone = document.createElement("button");
  btnNone.type = "button";
  btnNone.className = "btn ghost tiny";
  btnNone.textContent = "ไม่เลือก";
  tools.append(filter, btnAll, btnNone);
  container.appendChild(tools);

  const list = document.createElement("ul");
  list.className = "variant-list";

  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    list.textContent = "";
    for (const model of models) {
      if (q && !model.key.toLowerCase().includes(q)) continue;
      const chosen = selected.get(model.key);
      const soldOut = model.stock === 0;
      const li = document.createElement("li");
      li.className = `variant-row${chosen ? " chosen" : ""}${soldOut ? " soldout" : ""}`;

      const label = document.createElement("label");
      label.className = "variant-pick";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(chosen);
      box.disabled = state.running;
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
      qty.value = String(chosen?.quantity ?? product.quantity ?? defaultQuantity());
      qty.disabled = !chosen || state.running;

      box.addEventListener("change", () => {
        if (box.checked) {
          selected.set(model.key, {
            key: model.key,
            labels: model.labels,
            quantity: Math.max(1, Number(qty.value) || 1),
          });
        } else {
          selected.delete(model.key);
        }
        renderProducts();
        saveSoon();
      });
      qty.addEventListener("change", () => {
        const entry = selected.get(model.key);
        if (!entry) return;
        entry.quantity = Math.max(1, Math.min(99, Number(qty.value) || 1));
        qty.value = String(entry.quantity);
        updateSummary(product, summary);
        saveSoon();
      });

      li.append(label, meta, qty);
      list.appendChild(li);
    }
  };

  const summary = document.createElement("p");
  summary.className = "variant-summary";
  updateSummary(product, summary);

  filter.addEventListener("input", paint);
  btnAll.addEventListener("click", () => {
    const q = filter.value.trim().toLowerCase();
    for (const m of models) {
      if (q && !m.key.toLowerCase().includes(q)) continue;
      if (m.stock === 0 || selected.has(m.key)) continue;
      selected.set(m.key, {
        key: m.key,
        labels: m.labels,
        quantity: product.quantity || defaultQuantity(),
      });
    }
    renderProducts();
    saveSoon();
  });
  btnNone.addEventListener("click", () => {
    selected.clear();
    renderProducts();
    saveSoon();
  });

  paint();
  container.append(list, summary);

  const manual = document.createElement("details");
  manual.className = "manual";
  const sum = document.createElement("summary");
  sum.textContent = "พิมพ์ตัวเลือกเอง (ถ้าสแกนไม่ได้)";
  const manualLabel = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = "ตัวเลือก (คั่นด้วยจุลภาค)";
  const input = document.createElement("input");
  input.type = "text";
  input.value = product.variants || "";
  input.placeholder = "เช่น สีดำ,XL";
  input.disabled = state.running;
  input.addEventListener("change", () => {
    product.variants = input.value.trim();
    saveSoon();
  });
  manualLabel.append(span, input);
  manual.append(sum, manualLabel);
  container.appendChild(manual);
}

function updateSummary(product, summaryEl) {
  const picks = Array.from(selectedMap(product.id).values());
  if (!product.variantScan) {
    summaryEl.hidden = true;
    return;
  }
  if (picks.length === 0) {
    summaryEl.hidden = false;
    summaryEl.textContent = "ยังไม่ได้เลือก — ติ๊กแบบที่ต้องการ (เลือกได้หลายแบบ)";
    return;
  }
  const pieces = picks.reduce((n, p) => n + p.quantity, 0);
  summaryEl.hidden = false;
  summaryEl.textContent =
    picks.length === 1
      ? `เลือก 1 แบบ รวม ${pieces} ชิ้น — กด "ซื้อสินค้า" ในหน้าต่างนี้`
      : `เลือก ${picks.length} แบบ รวม ${pieces} ชิ้น — ใส่รถเข็นในหน้าต่างนี้แล้วชำระเงิน`;
}

function renderProducts() {
  const root = $("productList");
  const scrollTop = root.scrollTop;
  root.textContent = "";

  state.products.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "product-card";
    card.dataset.id = product.id;

    const head = document.createElement("div");
    head.className = "product-card-head";

    const titleWrap = document.createElement("div");
    const badge = document.createElement("span");
    badge.className = "product-badge";
    badge.textContent = `หน้าต่าง ${index + 1}`;
    const title = document.createElement("h3");
    title.textContent = productTitle(product, index);
    titleWrap.append(badge, title);

    const actions = document.createElement("div");
    actions.className = "product-card-actions";
    const btnScan = document.createElement("button");
    btnScan.type = "button";
    btnScan.className = "btn secondary tiny";
    btnScan.textContent = "สแกนตัวเลือก";
    btnScan.disabled = state.running || !product.productUrl.trim();
    btnScan.addEventListener("click", () => scanProduct(product.id));

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "btn ghost tiny";
    btnRemove.textContent = "ลบ";
    btnRemove.disabled = state.running || state.products.length <= 1;
    btnRemove.addEventListener("click", () => {
      if (state.products.length <= 1) return;
      state.products = state.products.filter((p) => p.id !== product.id);
      state.selected.delete(product.id);
      renderProducts();
      saveSoon();
    });
    actions.append(btnScan, btnRemove);
    head.append(titleWrap, actions);

    const urlLabel = document.createElement("label");
    const urlSpan = document.createElement("span");
    urlSpan.textContent = "ลิงก์สินค้า Shopee";
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = "https://shopee.co.th/...";
    urlInput.value = product.productUrl || "";
    urlInput.disabled = state.running;
    urlInput.addEventListener("input", () => {
      product.productUrl = urlInput.value.trim();
      btnScan.disabled = state.running || !product.productUrl;
      saveSoon();
    });
    urlInput.addEventListener("paste", () => {
      setTimeout(() => {
        product.productUrl = urlInput.value.trim();
        if (
          !state.running &&
          looksLikeShopeeProduct(product.productUrl) &&
          !product.variantScan
        ) {
          scanProduct(product.id);
        }
      }, 50);
    });
    urlLabel.append(urlSpan, urlInput);

    const qtyRow = document.createElement("div");
    qtyRow.className = "row product-qty-row";
    const qtyLabel = document.createElement("label");
    qtyLabel.className = "narrow";
    const qtySpan = document.createElement("span");
    qtySpan.textContent = "จำนวน (ต่อแบบ)";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = "99";
    qtyInput.value = String(product.quantity || 1);
    qtyInput.disabled = state.running;
    qtyInput.addEventListener("change", () => {
      product.quantity = Math.max(1, Math.min(99, Number(qtyInput.value) || 1));
      qtyInput.value = String(product.quantity);
      saveSoon();
    });
    qtyLabel.append(qtySpan, qtyInput);
    qtyRow.appendChild(qtyLabel);

    const variantsBox = document.createElement("div");
    variantsBox.className = "variants-box nested";
    renderVariantSection(product, variantsBox);

    card.append(head, urlLabel, qtyRow, variantsBox);
    root.appendChild(card);
  });

  root.scrollTop = scrollTop;
}

function readForm() {
  const products = state.products.map((p) => ({
    id: p.id,
    productUrl: String(p.productUrl || "").trim(),
    quantity: Math.max(1, Number(p.quantity) || 1),
    variants: String(p.variants || "").trim(),
    selectedVariants: Array.from(selectedMap(p.id).values()),
    variantScan: p.variantScan || null,
  }));
  const first = products[0] || emptyProduct();
  return {
    products,
    // Legacy mirrors (first product) for older code paths
    productUrl: first.productUrl,
    quantity: first.quantity,
    variants: first.variants,
    selectedVariants: first.selectedVariants,
    variantScan: first.variantScan,
    saleStart: toIsoLocal($("saleStart").value),
    preclickMs: Number($("preclickMs").value) || 500,
    clickTimeoutMs: Number($("clickTimeoutMs").value) || 15000,
    autoPlaceOrder: $("autoPlaceOrder").checked,
    autoPromptPay: $("autoPromptPay").checked,
    preAddToCart: $("preAddToCart").checked,
    username: $("username").value.trim(),
    password: $("password").value,
    baseUrl: "https://shopee.co.th",
  };
}

function fillForm(settings) {
  $("saleStart").value = toDatetimeLocalValue(settings.saleStart);
  $("quantity").value = settings.quantity ?? 1;
  $("preclickMs").value = settings.preclickMs ?? 500;
  $("clickTimeoutMs").value = settings.clickTimeoutMs ?? 15000;
  $("autoPlaceOrder").checked = Boolean(settings.autoPlaceOrder);
  $("autoPromptPay").checked = settings.autoPromptPay !== false;
  $("preAddToCart").checked = settings.preAddToCart !== false;
  $("username").value = settings.username || "";
  $("password").value = settings.password || "";

  let products = Array.isArray(settings.products) ? settings.products.filter(Boolean) : [];
  if (products.length === 0 && (settings.productUrl || settings.variantScan)) {
    products = [
      emptyProduct({
        id: "p1",
        productUrl: settings.productUrl || "",
        quantity: settings.quantity || 1,
        variants: settings.variants || "",
        selectedVariants: settings.selectedVariants || [],
        variantScan: settings.variantScan || null,
      }),
    ];
  }
  if (products.length === 0) products = [emptyProduct({ id: "p1" })];

  state.products = products.map((p, i) =>
    emptyProduct({
      id: p.id || `p${i + 1}`,
      productUrl: p.productUrl || "",
      quantity: p.quantity || 1,
      variants: p.variants || "",
      selectedVariants: p.selectedVariants || [],
      variantScan: p.variantScan || null,
    })
  );
  state.selected = new Map();
  for (const p of state.products) {
    const map = new Map();
    for (const v of p.selectedVariants || []) {
      if (v?.key && Array.isArray(v.labels)) {
        map.set(v.key, {
          key: v.key,
          labels: v.labels,
          quantity: Math.max(1, Number(v.quantity) || 1),
        });
      }
    }
    state.selected.set(p.id, map);
  }
  renderProducts();
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
  state.running = running;
  $("btnLogin").disabled = running;
  $("btnDryRun").disabled = running;
  $("btnStart").disabled = running;
  $("btnSave").disabled = running;
  $("btnAddProduct").disabled = running;
  $("btnStop").disabled = !running;
  ["saleStart", "quantity", "preclickMs", "clickTimeoutMs", "autoPlaceOrder", "autoPromptPay", "preAddToCart", "username", "password"].forEach(
    (id) => {
      const el = $(id);
      if (el) el.disabled = running;
    }
  );
  renderProducts();
}

async function saveSettings(silent = false) {
  const saved = await window.shopeeBot.saveSettings(readForm());
  if (!silent) appendLog({ level: "info", message: "บันทึกค่าในเครื่องแล้ว" });
  return saved;
}

async function scanProduct(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const url = String(product.productUrl || "").trim();
  if (!url) {
    appendLog({ level: "warn", message: "กรุณาวางลิงก์สินค้าก่อนสแกน" });
    return;
  }
  setRunning(true);
  setStatus("กำลังสแกนตัวเลือก…", "running");
  appendLog({ level: "info", message: `สแกน: ${productTitle(product, state.products.indexOf(product))}` });
  try {
    const result = await window.shopeeBot.scanVariants(url, productId);
    if (result?.ok) {
      product.variantScan = result;
      product.productUrl = result.url || url;
      const validKeys = new Set((result.models || []).map((m) => m.key));
      const selected = selectedMap(productId);
      for (const key of Array.from(selected.keys())) {
        if (!validKeys.has(key)) selected.delete(key);
      }
      const n = result.models?.length || 0;
      appendLog({
        level: "info",
        message: n ? `สแกนเจอ ${n} ตัวเลือก — ติ๊กแบบที่ต้องการได้เลย` : "สินค้านี้ไม่มีตัวเลือก",
      });
      setStatus("สแกนเสร็จ", "ok");
      await saveSettings(true);
      renderProducts();
    } else if (result?.reason === "busy") {
      setStatus("กำลังทำงานอยู่", "warn");
    } else {
      const why =
        result?.reason === "traffic_block" || result?.reason === "traffic_timeout"
          ? "Shopee ขอ CAPTCHA/verify — ทำให้ผ่านในหน้าต่างเบราว์เซอร์แล้วสแกนใหม่"
          : result?.message || "สแกนไม่สำเร็จ — ลองใหม่ หรือพิมพ์ตัวเลือกเอง";
      appendLog({ level: "warn", message: why });
      setStatus("สแกนไม่สำเร็จ", "err");
    }
  } finally {
    setRunning(false);
  }
}

async function run(mode) {
  const form = readForm();
  const withUrl = (form.products || []).filter((p) => p.productUrl);
  if (mode !== "login" && withUrl.length === 0) {
    appendLog({ level: "warn", message: "กรุณาเพิ่มลิงก์สินค้าอย่างน้อย 1 รายการ" });
    setStatus("ยังไม่มีลิงก์สินค้า", "warn");
    return;
  }

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
          ? `เริ่มโหมดทดสอบ (${withUrl.length} สินค้า) — จะไม่สั่งสินค้า`
          : `เริ่มกด Flash Sale (${withUrl.length} หน้าต่าง)`,
  });

  const result = await window.shopeeBot.startJob({
    mode,
    settings: form,
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
    renderProducts();
  }

  $("btnAddProduct").addEventListener("click", () => {
    state.products.push(emptyProduct({ quantity: defaultQuantity() }));
    renderProducts();
    saveSoon();
  });
  $("btnSave").addEventListener("click", () => saveSettings(false));
  $("btnLogin").addEventListener("click", () => run("login"));
  $("btnDryRun").addEventListener("click", () => run("dry-run"));
  $("btnStart").addEventListener("click", () => run("start"));
  $("btnStop").addEventListener("click", async () => {
    await window.shopeeBot.stopJob();
  });
  $("btnCloseBrowser").addEventListener("click", async () => {
    appendLog({ level: "info", message: "กำลังปิดเบราว์เซอร์…" });
    const result = await window.shopeeBot.closeBrowser();
    if (result?.ok) {
      appendLog({
        level: "info",
        message: result.closed
          ? "ปิดเบราว์เซอร์แล้ว — เซสชันถูกบันทึกไว้ กดเข้าสู่ระบบ/สแกนเพื่อเปิดใหม่"
          : "ไม่มีเบราว์เซอร์เปิดอยู่",
      });
    } else {
      appendLog({ level: "warn", message: result?.message || "ปิดเบราว์เซอร์ไม่สำเร็จ" });
    }
  });
  $("autoPromptPay").addEventListener("change", saveSoon);
  $("btnClearLog").addEventListener("click", () => {
    $("log").textContent = "";
  });
});
