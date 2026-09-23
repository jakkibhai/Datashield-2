// routes/history.js
// Every risk scan run this session (sandbox or real folder), so the UI
// can show a small "risk score over time" trend during a demo — lets
// judges see the score actually drop after a wipe, not just a single
// before/after screenshot.
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/scan/history
router.get("/scan/history", (req, res) => {
  res.json({ history: db.listScanHistory() });
});

module.exports = router;
