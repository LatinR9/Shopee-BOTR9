/**
 * CLI login helper. Prefer the GUI "เข้าสู่ระบบ" button.
 */
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { runBotJob } from "./runtime.js";
import { loadSettings, defaultSettingsPath } from "./settings.js";

async function main() {
  const fileSettings = loadSettings(defaultSettingsPath());
  const envConfig = loadConfig();
  const settings = {
    ...fileSettings,
    username: envConfig.username || fileSettings.username,
    password: envConfig.password || fileSettings.password,
    baseUrl: envConfig.baseUrl || fileSettings.baseUrl,
  };

  const profileDir =
    process.env.SHOPEE_USER_DATA_DIR ||
    path.join(os.homedir(), ".shopee-botr9", "browser-profile");

  const result = await runBotJob({
    settings,
    mode: "login",
    profileDir,
    headless: false,
  });

  if (!result.ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error("[login] Fatal:", err.message);
  process.exit(1);
});
