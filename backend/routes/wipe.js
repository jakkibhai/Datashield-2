// routes/wipe.js
// SIMULATION ONLY. This never touches a real filesystem or device.
// Progress is computed from elapsed time against a fixed fake duration,
// so it's deterministic and safe to demo live.
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const db = require("../db");

const METHODS = {
  "single-pass": { label: "Single-pass zero overwrite", durationMs: 6000 },
  "dod-3pass": { label: "DoD 5220.22-M (3-pass)", durationMs: 12000 },
  "gutmann": { label: "Gutmann 35-pass (demo-capped)", durationMs: 18000 },
};

// POST /api/wipe/start  { deviceLabel, method }
router.post("/wipe/start", (req, res) => {
  const { deviceLabel, method } = req.body;
  const cfg = METHODS[method];
  if (!deviceLabel || !cfg) {
    return res.status(400).json({ error: "deviceLabel and a valid method are required", validMethods: Object.keys(METHODS) });
  }
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.insertWipeSession({
    id,
    device_label: deviceLabel,
    method,
    status: "running",
    progress: 0,
    started_at: startedAt,
  });

  res.json({ sessionId: id, method: cfg.label, durationMs: cfg.durationMs, simulated: true });
});

// GET /api/wipe/status/:sessionId
router.get("/wipe/status/:sessionId", (req, res) => {
  const row = db.getWipeSession(req.params.sessionId);
  if (!row) return res.status(404).json({ error: "Session not found" });

  // Real local-folder wipes update their own progress/status columns as
  // they actually delete files — just report those directly, no time math.
  if (row.real_wipe) {
    return res.json({
      sessionId: row.id,
      deviceLabel: row.device_label,
      method: row.method,
      status: row.status,
      progress: row.progress,
      totalFiles: row.total_files,
      simulated: false,
    });
  }

  const cfg = METHODS[row.method];
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  let progress = Math.min(100, Math.round((elapsed / cfg.durationMs) * 100));
  let status = row.status;

  if (progress >= 100 && status !== "complete") {
    status = "complete";
    progress = 100;
    db.updateWipeSession(row.id, { status: "complete", progress: 100, finished_at: new Date().toISOString() });
  } else if (status === "running") {
    db.updateWipeSession(row.id, { progress });
  }

  res.json({
    sessionId: row.id,
    deviceLabel: row.device_label,
    method: cfg.label,
    status,
    progress,
    simulated: true,
  });
});

module.exports = router;
