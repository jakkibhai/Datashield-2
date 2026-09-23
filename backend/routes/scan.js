// routes/scan.js
// Reads only from the local sandbox dataset — never a real device.
const express = require("express");
const router = express.Router();
const devices = require("../data/sandbox-devices.json");
const { scoreCategories } = require("../util/risk");

function scoreDevice(device) {
  const categories = device.mockCategories.map((c) => ({ items: c.items, sensitivity: c.sensitivity }));
  return scoreCategories(categories);
}

// GET /api/sandbox/devices  -> list mock devices for the test environment
router.get("/sandbox/devices", (req, res) => {
  res.json(devices.map(({ id, label, type }) => ({ id, label, type })));
});

// POST /api/scan  { deviceId }  -> risk report built from sandbox data only
router.post("/scan", (req, res) => {
  const { deviceId } = req.body;
  const device = devices.find((d) => d.id === deviceId);
  if (!device) {
    return res.status(404).json({ error: "Unknown sandbox device id. This demo only reads mock devices." });
  }
  const { score, level } = scoreDevice(device);
  res.json({
    deviceId: device.id,
    deviceLabel: device.label,
    simulated: true,
    riskScore: score,
    riskLevel: level,
    categories: device.mockCategories,
  });
});

module.exports = router;
