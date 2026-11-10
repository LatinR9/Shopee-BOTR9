/** Simple pluggable logger used by CLI and Electron UI. */

export function createLogger(sink = console.log) {
  return {
    info(...args) {
      sink("info", format(args));
    },
    warn(...args) {
      sink("warn", format(args));
    },
    error(...args) {
      sink("error", format(args));
    },
  };
}

function format(args) {
  return args
    .map((a) => (typeof a === "string" ? a : safeJson(a)))
    .join(" ");
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function stamp(message) {
  return `[${new Date().toLocaleTimeString("th-TH", { hour12: false })}] ${message}`;
}
