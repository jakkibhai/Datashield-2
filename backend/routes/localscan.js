// routes/localscan.js
// Reads a REAL folder on disk — but only one the user explicitly points at,
// and only ever the folder they created for testing. See util/localfs.js
// for the safety checks (blocked root/home/system paths, file-count cap).
const express = require("express");
const router = express.Router();
const { isPathSafe, walk, categorize, MAX_FILES } = require("../util/localfs");
const { scoreCategories } = require("../util/risk");

// POST /api/local/scan  { folderPath }
router.post("/local/scan", async (req, res) => {
  const { folderPath } = req.body;
  const safety = isPathSafe(folderPath);
  if (!safety.ok) return res.status(400).json({ error: safety.reason });

  const files = await walk(safety.resolved);
  if (files.length === 0) {
    return res.status(400).json({ error: "No files found in that folder." });
  }

  const counts = {};
  for (const f of files) {
    const { category, sensitivity } = categorize(f);
    if (!counts[category]) counts[category] = { items: 0, sensitivity };
    counts[category].items++;
  }
  const categories = Object.entries(counts).map(([name, v]) => ({ name, items: v.items, sensitivity: v.sensitivity }));
  const { score, level } = scoreCategories(categories);

  res.json({
    folderPath: safety.resolved,
    totalFiles: files.length,
    cappedAtLimit: files.length >= MAX_FILES,
    simulated: false,
    riskScore: score,
    riskLevel: level,
    categories,
  });
});

module.exports = router;
