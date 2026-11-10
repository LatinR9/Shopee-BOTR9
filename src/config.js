import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  return {
    dryRun: flags.has("--dry-run"),
    headed: flags.has("--headed"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

/**
 * Load runtime config from env + CLI flags.
 * Secrets stay in .env only — never hardcode them.
 */
export function loadConfig(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);

  const productUrl = (process.env.SHOPEE_PRODUCT_URL || "").trim();
  const saleStartRaw = (process.env.SHOPEE_SALE_START || "").trim();
  let saleStart = null;
  if (saleStartRaw) {
    const d = new Date(saleStartRaw);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid SHOPEE_SALE_START: ${saleStartRaw}`);
    }
    saleStart = d;
  }

  const variants = (process.env.SHOPEE_VARIANTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const headless = flags.headed
    ? false
    : bool(process.env.SHOPEE_HEADLESS, false);

  return {
    productUrl,
    saleStart,
    preclickMs: int(process.env.SHOPEE_PRECLICK_MS, 500),
    quantity: int(process.env.SHOPEE_QUANTITY, 1),
    variants,
    username: (process.env.SHOPEE_USERNAME || "").trim(),
    password: (process.env.SHOPEE_PASSWORD || "").trim(),
    headless,
    userDataDir: (process.env.SHOPEE_USER_DATA_DIR || ".auth/user-data").trim(),
    autoPlaceOrder: bool(process.env.SHOPEE_AUTO_PLACE_ORDER, false),
    clickTimeoutMs: int(process.env.SHOPEE_CLICK_TIMEOUT_MS, 15_000),
    baseUrl: (process.env.SHOPEE_BASE_URL || "https://shopee.co.th").replace(/\/$/, ""),
    dryRun: flags.dryRun,
    help: flags.help,
  };
}

export function assertReady(config) {
  if (!config.productUrl) {
    throw new Error(
      "Missing SHOPEE_PRODUCT_URL. Copy .env.example → .env and set the product link."
    );
  }
  try {
    // eslint-disable-next-line no-new
    new URL(config.productUrl);
  } catch {
    throw new Error(`SHOPEE_PRODUCT_URL is not a valid URL: ${config.productUrl}`);
  }
}
