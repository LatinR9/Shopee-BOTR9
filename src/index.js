/**
 * CLI entry (optional). Beginners should use the desktop app instead.
 *
 *   npm start
 *   npm run dry-run
 */
import path from "node:path";
import os from "node:os";
import { loadConfig, assertReady } from "./config.js";
import { runBotJob } from "./runtime.js";
import { loadSettings, defaultSettingsPath } from "./settings.js";

function printHelp() {
  console.log(`
Shopee Flash Sale bot

ผู้ใช้ทั่วไป: ดาวน์โหลดโปรแกรม Windows แล้วดับเบิลคลิก (ดู README)

นักพัฒนา:
  npm run app          เปิดหน้าต่าง GUI
  npm start            รัน CLI จาก .env / settings
  npm run dry-run
  npm run login
`.trim());
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const dryRun = argv.includes("--dry-run");
  const settingsFile = defaultSettingsPath();
  const fileSettings = loadSettings(settingsFile);

  // Prefer .env/CLI when product URL present; else local settings.json
  let settings = fileSettings;
  try {
    const envConfig = loadConfig(argv);
    if (envConfig.help) {
      printHelp();
      return;
    }
    if (envConfig.productUrl) {
      assertReady(envConfig);
      settings = {
        ...fileSettings,
        productUrl: envConfig.productUrl,
        saleStart: envConfig.saleStart ? envConfig.saleStart.toISOString() : "",
        quantity: envConfig.quantity,
        variants: envConfig.variants.join(","),
        preclickMs: envConfig.preclickMs,
        clickTimeoutMs: envConfig.clickTimeoutMs,
        autoPlaceOrder: envConfig.autoPlaceOrder,
        baseUrl: envConfig.baseUrl,
        username: envConfig.username,
        password: envConfig.password,
      };
    }
  } catch (err) {
    if (!fileSettings.productUrl) throw err;
  }

  const profileDir =
    process.env.SHOPEE_USER_DATA_DIR ||
    path.join(os.homedir(), ".shopee-botr9", "browser-profile");

  const result = await runBotJob({
    settings,
    mode: dryRun ? "dry-run" : "start",
    profileDir,
    headless: process.env.SHOPEE_HEADLESS === "true" && !argv.includes("--headed"),
  });

  if (!result.ok) {
    console.error("จบงานโดยไม่สำเร็จ", result);
    process.exitCode = 2;
  } else {
    console.log("เสร็จแล้ว", result);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
