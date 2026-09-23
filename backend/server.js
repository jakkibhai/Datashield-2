// server.js — SafeWipe backend entry point.
// Run with: npm install && npm start   (from inside backend/)
const express = require("express");
const cors = require("cors");
const path = require("path");

const scanRoutes = require("./routes/scan");
const wipeRoutes = require("./routes/wipe");
const certificateRoutes = require("./routes/certificate");
const localScanRoutes = require("./routes/localscan");
const localWipeRoutes = require("./routes/localwipe");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve the frontend directly so the whole app runs from one server
// (handy for a hackathon demo — no separate static server needed).
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use("/api", scanRoutes);
app.use("/api", wipeRoutes);
app.use("/api", certificateRoutes);
app.use("/api", localScanRoutes);
app.use("/api", localWipeRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "safewipe-backend", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`SafeWipe backend running at http://localhost:${PORT}`);
  console.log(`Frontend served from the same URL — open it in your browser.`);
});
