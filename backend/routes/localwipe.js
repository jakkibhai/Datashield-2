// routes/localwipe.js
// REAL secure delete. This actually overwrites and removes files —
// only inside a folder the user explicitly named and only after they
// tick the on-screen confirmation. util/localfs.js refuses root/home/
// system paths before this ever runs.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const router = express.Router();
const db = require("../db");
const { isPathSafe, walk, MAX_FILES } = require("../util/localfs");

const PASSES = { "single-pass": 1, "dod-3pass": 3, "gutmann": 7 }; // gutmann capped for a live demo

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runLocalWipe(sessionId, files, passes) {
  let done = 0;
  const pace = files.length <= 200 ? 50 : 0; // small delay only for small demo folders, so the progress bar is visible

  for (const filePath of files) {
    try {
      const stat = await fsp.stat(filePath);
      for (let p = 0; p < passes; p++) {
        await fsp.writeFile(filePath, crypto.randomBytes(stat.size));
      }
      await fsp.unlink(filePath);
    } catch (err) {
      console.error(`SafeWipe: could not fully wipe ${filePath}: ${err.message}`);
    }
    done++;
    const progress = Math.round((done / files.length) * 100);
    db.updateWipeSession(sessionId, { progress });
    if (pace) await sleep(pace);
  }

  db.updateWipeSession(sessionId, { status: "complete", progress: 100, finished_at: new Date().toISOString() });
}

// POST /api/local/wipe/start  { folderPath, method, confirm: true }
router.post("/local/wipe/start", async (req, res) => {
  const { folderPath, method, confirm } = req.body;
  const passes = PASSES[method];

  if (!passes) return res.status(400).json({ error: "method must be one of: " + Object.keys(PASSES).join(", ") });
  if (confirm !== true) {
    return res.status(400).json({ error: "You must confirm you want to permanently delete files in this folder." });
  }

  const safety = isPathSafe(folderPath);
  if (!safety.ok) return res.status(400).json({ error: safety.reason });

  const files = await walk(safety.resolved);
  if (files.length === 0) return res.status(400).json({ error: "No files found in that folder." });
  if (files.length >= MAX_FILES) {
    return res.status(400).json({ error: `Folder has too many files for this demo (limit ${MAX_FILES}).` });
  }

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.insertWipeSession({
    id,
    device_label: safety.resolved,
    method,
    status: "running",
    progress: 0,
    started_at: startedAt,
    real_wipe: 1,
    total_files: files.length,
  });

  // Fire and forget — the frontend polls /api/wipe/status/:id for progress.
  runLocalWipe(id, files, passes).catch((err) => {
    console.error("SafeWipe: local wipe worker crashed:", err);
    db.updateWipeSession(id, { status: "error" });
  });

  res.json({ sessionId: id, totalFiles: files.length, passes, real: true });
});

module.exports = router;
