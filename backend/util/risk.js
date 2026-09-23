// util/risk.js — shared between the sandbox (mock) scan and the real
// local-folder scan, so both produce risk scores the same way.
const WEIGHT = { low: 1, medium: 3, high: 6, critical: 10 };

function scoreCategories(categories) {
  if (!categories.length) return { score: 0, level: "low" };
  const raw = categories.reduce((sum, c) => sum + WEIGHT[c.sensitivity] * Math.log2(c.items + 1), 0);
  const score = Math.min(100, Math.round((raw / (categories.length * 40)) * 100));
  const level = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  return { score, level };
}

module.exports = { WEIGHT, scoreCategories };
