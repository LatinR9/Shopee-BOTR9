/**
 * Scan a Shopee product's options (tier variations / models).
 *
 * 1) Shopee public item JSON over plain HTTP (fast, often refused by anti-bot)
 * 2) Playwright: open the product page with the user's profile and capture the
 *    page's own item API response
 * 3) Playwright DOM fallback: read the option buttons on the page
 */
import { launchBrowser, configurePlaywrightBrowsersPath } from "./browser.js";
import { dismissLanguageGate, detectTrafficBlock } from "./bot.js";

const PRICE_DIVISOR = 100000;
const ITEM_API_RE = /\/api\/v4\/(pdp\/get_pc|pdp\/get|item\/get)\b/;

/** Extract { shopId, itemId } from common Shopee product URL shapes. */
export function parseShopeeIds(url) {
  const text = String(url || "");
  const patterns = [
    /-i\.(\d+)\.(\d+)/,
    /\/product\/(\d+)\/(\d+)/,
    /[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i,
    /shopee\.[^/]+\/[^/?#]+\/(\d+)\/(\d+)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { shopId: m[1], itemId: m[2] };
  }
  return null;
}

function toPrice(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= PRICE_DIVISOR ? n / PRICE_DIVISOR : n;
}

function cartesian(tiers) {
  return tiers.reduce(
    (acc, tier, ti) =>
      acc.flatMap((prefix) => tier.options.map((_, oi) => [...prefix, oi])),
    [[]]
  );
}

function modelKey(labels) {
  return labels.join(" / ");
}

/**
 * Normalize Shopee item JSON (pdp/get_pc or legacy item/get) into
 * { itemName, tiers: [{name, options}], models: [{key, modelId, labels, price, stock}] }.
 * Returns null when the payload has no usable item.
 */
export function normalizeItemData(json) {
  const data = json?.data ?? json?.item ?? json;
  const item = data?.item ?? data;
  if (!item || typeof item !== "object") return null;

  const rawTiers = item.tier_variations ?? item.tierVariations ?? [];
  const tiers = rawTiers
    .map((t) => ({
      name: String(t?.name ?? "").trim() || "ตัวเลือก",
      options: (t?.options ?? []).map((o) => String(o).trim()).filter(Boolean),
    }))
    .filter((t) => t.options.length > 0);

  const rawModels = Array.isArray(item.models) ? item.models : [];
  const itemName = String(item.title ?? item.name ?? "").trim();
  if (!itemName && tiers.length === 0 && rawModels.length === 0) return null;

  let models = rawModels.map((m) => {
    const tierIndex = m?.extinfo?.tier_index ?? m?.tier_index ?? null;
    let labels;
    if (Array.isArray(tierIndex) && tiers.length) {
      labels = tierIndex.map((oi, ti) => tiers[ti]?.options[oi]).filter(Boolean);
    } else {
      labels = String(m?.name ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const stock = m?.stock ?? m?.normal_stock ?? m?.stock_info?.stock ?? null;
    return {
      key: modelKey(labels),
      modelId: String(m?.model_id ?? m?.modelid ?? m?.modelId ?? ""),
      labels,
      price: toPrice(m?.price ?? m?.price_before_discount),
      stock: Number.isFinite(Number(stock)) ? Number(stock) : null,
    };
  });

  models = models.filter((m) => m.labels.length > 0);
  if (models.length === 0 && tiers.length > 0) {
    models = cartesian(tiers).map((idx) => {
      const labels = idx.map((oi, ti) => tiers[ti].options[oi]);
      return { key: modelKey(labels), modelId: "", labels, price: null, stock: null };
    });
  }

  return { itemName, tiers, models };
}

/** Fast path: plain HTTP to Shopee item APIs. Returns normalized data or null. */
export async function fetchVariantsHttp(productUrl, { baseUrl = "https://shopee.co.th", timeoutMs = 6000 } = {}) {
  const ids = parseShopeeIds(productUrl);
  if (!ids) return null;
  const base = baseUrl.replace(/\/$/, "");
  const endpoints = [
    `${base}/api/v4/pdp/get_pc?item_id=${ids.itemId}&shop_id=${ids.shopId}&tz_offset_minutes=420&detail_level=0`,
    `${base}/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-api-source": "pc",
          "x-shopee-language": "th",
          // Thai slugs are not valid header bytes; URL#href percent-encodes them.
          referer: new URL(productUrl).href,
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const parsed = normalizeItemData(await res.json());
      if (parsed && (parsed.models.length || parsed.tiers.length)) return parsed;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

/** Read option buttons from the rendered product page. */
async function scanDom(page) {
  return page.evaluate(() => {
    const SKIP = /ซื้อ|รถเข็น|buy|cart|chat|แชท|ติดตาม|follow/i;
    const buttons = Array.from(
      document.querySelectorAll('button.product-variation, button[class*="product-variation"], [role="radiogroup"] button')
    ).filter((b) => b.offsetParent !== null && !SKIP.test(b.textContent || ""));

    const groups = new Map();
    for (const btn of buttons) {
      const label = (btn.getAttribute("aria-label") || btn.textContent || "").trim();
      if (!label) continue;
      // Climb to the widest ancestor that still holds only this group's buttons.
      const groupButtons = btn.parentElement?.querySelectorAll("button").length || 1;
      let section = btn.parentElement;
      while (section?.parentElement && section.parentElement.querySelectorAll("button").length === groupButtons) {
        section = section.parentElement;
      }
      if (!groups.has(section)) {
        const headingEl =
          section?.querySelector("h2, h3, label") ||
          Array.from(section?.children || []).find((c) => !c.querySelector("button") && c.tagName !== "BUTTON");
        const heading = headingEl?.textContent?.trim() || "ตัวเลือก";
        groups.set(section, { name: heading.slice(0, 40), options: [] });
      }
      const g = groups.get(section);
      if (!g.options.includes(label)) g.options.push(label);
    }

    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.title.replace(/\s*\|\s*Shopee.*$/i, "").trim();
    return { title, tiers: Array.from(groups.values()).filter((g) => g.options.length) };
  });
}

/** Open the product page and capture its item JSON, falling back to the DOM. */
export async function scanVariantsWithPage(page, productUrl, { log = () => {}, timeoutMs = 20000 } = {}) {
  let captured = null;
  const onResponse = async (res) => {
    if (captured || !ITEM_API_RE.test(res.url())) return;
    try {
      const parsed = normalizeItemData(await res.json());
      if (parsed && (parsed.models.length || parsed.tiers.length)) captured = parsed;
    } catch {
      // not JSON / blocked
    }
  };
  page.on("response", onResponse);

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await dismissLanguageGate(page, { log });
    if (!page.url().includes("/product/") && !page.url().includes("-i.")) {
      await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    }

    const deadline = Date.now() + timeoutMs;
    while (!captured && Date.now() < deadline) {
      if (await detectTrafficBlock(page)) {
        return { ok: false, reason: "traffic_block" };
      }
      await page.waitForTimeout(300);
      if (Date.now() > deadline - timeoutMs / 2) {
        const dom = await scanDom(page).catch(() => null);
        if (dom?.tiers?.length) {
          const tiers = dom.tiers;
          const models = cartesian(tiers).map((idx) => {
            const labels = idx.map((oi, ti) => tiers[ti].options[oi]);
            return { key: modelKey(labels), modelId: "", labels, price: null, stock: null };
          });
          // Give the API response one last chance — it carries price/stock.
          await page.waitForTimeout(1000);
          if (captured) break;
          log("อ่านตัวเลือกจากหน้าเว็บ (ไม่มีราคา/สต็อก)");
          return { ok: true, source: "dom", itemName: dom.title, tiers, models };
        }
      }
    }

    if (captured) return { ok: true, source: "page-api", ...captured };

    const dom = await scanDom(page).catch(() => null);
    if (dom) {
      return { ok: true, source: "dom", itemName: dom.title, tiers: [], models: [] };
    }
    return { ok: false, reason: "not_found" };
  } finally {
    page.off("response", onResponse);
  }
}

/**
 * Full scan job used by the GUI.
 * @returns {Promise<{ok:boolean, reason?:string, source?:string, url?:string, itemName?:string, tiers?:Array, models?:Array, scannedAt?:string}>}
 */
export async function scanVariants({ productUrl, baseUrl, profileDir, resourcesPath, onLog }) {
  const log = (msg) => (onLog ? onLog("info", msg) : console.log(msg));
  const stampResult = (r) => ({ ...r, url: productUrl, scannedAt: new Date().toISOString() });

  if (!parseShopeeIds(productUrl)) {
    log("อ่านรหัสสินค้าจากลิงก์ไม่ได้ — จะลองเปิดหน้าเว็บแทน");
  } else {
    log("กำลังสแกนตัวเลือกสินค้า…");
    const fast = await fetchVariantsHttp(productUrl, { baseUrl });
    if (fast) return stampResult({ ok: true, source: "http", ...fast });
    log("Shopee ไม่ตอบแบบเร็ว — เปิดเบราว์เซอร์เพื่ออ่านตัวเลือก (ปิดเองเมื่อเสร็จ)");
  }

  configurePlaywrightBrowsersPath(resourcesPath);
  const { context, page } = await launchBrowser({ userDataDir: profileDir, headless: false });
  try {
    return stampResult(await scanVariantsWithPage(page, productUrl, { log }));
  } finally {
    await context.close().catch(() => {});
  }
}
