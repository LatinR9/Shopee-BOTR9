import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULTS = {
  productUrl: "",
  saleStart: "",
  quantity: 1,
  variants: "",
  preclickMs: 500,
  clickTimeoutMs: 15000,
  autoPlaceOrder: false,
  baseUrl: "https://shopee.co.th",
  username: "",
  password: "",
};

/**
 * Resolve a writable settings path.
 * Electron passes userData; CLI falls back to ~/.shopee-botr9/settings.json
 */
export function defaultSettingsPath(userDataDir) {
  const base =
    userDataDir ||
    process.env.SHOPEE_SETTINGS_DIR ||
    path.join(os.homedir(), ".shopee-botr9");
  return path.join(base, "settings.json");
}

export function loadSettings(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(filePath, settings) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...DEFAULTS, ...settings };
  // Never write password unless user typed one this session — blank keeps previous
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function settingsToConfig(settings, overrides = {}) {
  const variants = String(settings.variants || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let saleStart = null;
  if (settings.saleStart) {
    const d = new Date(settings.saleStart);
    if (!Number.isNaN(d.getTime())) saleStart = d;
  }

  return {
    productUrl: String(settings.productUrl || "").trim(),
    saleStart,
    preclickMs: Number(settings.preclickMs) || 500,
    quantity: Math.max(1, Number(settings.quantity) || 1),
    variants,
    username: String(settings.username || "").trim(),
    password: String(settings.password || "").trim(),
    headless: false,
    userDataDir: overrides.userDataDir,
    autoPlaceOrder: Boolean(settings.autoPlaceOrder),
    clickTimeoutMs: Number(settings.clickTimeoutMs) || 15000,
    baseUrl: String(settings.baseUrl || "https://shopee.co.th").replace(/\/$/, ""),
    dryRun: Boolean(overrides.dryRun),
    ...overrides,
  };
}

export { DEFAULTS };
