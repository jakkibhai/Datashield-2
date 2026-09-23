// util/localfs.js
// This is the only file that touches the real filesystem. Everything in
// here is deliberately conservative: it refuses to operate on root, home,
// or system directories, and caps how much it will walk in one go.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const MAX_FILES = 20000;
const MAX_DEPTH = 12;

// Folders this demo will never scan or wipe directly, even if asked.
// The user has to point it at a specific subfolder instead.
function blockedPaths() {
  const home = os.homedir();
  const candidates = [
    home,
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    "/", "/System", "/usr", "/etc", "/bin", "/sbin", "/Library", "/Applications",
    "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\Users",
  ];
  return new Set(candidates.map((p) => { try { return path.resolve(p); } catch { return p; } }));
}

function isPathSafe(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return { ok: false, reason: "No folder path was given." };
  }
  const resolved = path.resolve(inputPath.trim());

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: `That path does not exist: ${resolved}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "That path is not a folder." };
  }

  const root = path.parse(resolved).root;
  const blocked = blockedPaths();
  if (blocked.has(resolved) || resolved === path.resolve(root)) {
    return {
      ok: false,
      reason:
        "For safety this demo refuses to scan or wipe a root, home, or system folder directly. " +
        "Point it at a specific test subfolder instead, e.g. a folder you made just for this demo.",
    };
  }
  return { ok: true, resolved };
}

async function walk(dir, depth = 0, acc = []) {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES) return acc;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return acc; // unreadable subfolder (permissions etc) — skip it, don't crash the scan
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

const SECRET_HINTS = ["password", "secret", "credential", "token", "wallet", "seed", "private"];
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".gif", ".heic", ".webp", ".mp4", ".mov", ".avi"];
const DOC_EXT = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".pptx", ".odt"];
const APPDATA_EXT = [".db", ".sqlite", ".sqlite3", ".plist"];
const KEY_EXT = [".pem", ".key", ".pfx", ".crt", ".p12", ".asc"];
const CACHE_EXT = [".log", ".tmp", ".cache", ".bak"];

function categorize(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);

  if (SECRET_HINTS.some((h) => base.includes(h))) return { category: "Credentials & secrets", sensitivity: "critical" };
  if (KEY_EXT.includes(ext)) return { category: "Encryption keys / certs", sensitivity: "critical" };
  if (APPDATA_EXT.includes(ext)) return { category: "App / database data", sensitivity: "high" };
  if (DOC_EXT.includes(ext)) return { category: "Documents", sensitivity: "high" };
  if (PHOTO_EXT.includes(ext)) return { category: "Photos & videos", sensitivity: "medium" };
  if (CACHE_EXT.includes(ext)) return { category: "Cache & logs", sensitivity: "low" };
  return { category: "Other files", sensitivity: "medium" };
}

module.exports = { isPathSafe, walk, categorize, MAX_FILES };
