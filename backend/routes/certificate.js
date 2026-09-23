// routes/certificate.js
// Issues a tamper-evident disposal certificate once a wipe session
// reports complete, chains it cryptographically to every certificate
// issued before it (an append-only ledger), and exposes:
//   - a public verify endpoint (does THIS certificate's data match its hash?)
//   - a chain-verify endpoint (does the WHOLE ledger still link up?)
//   - two demo-only endpoints that let the UI stage a live tamper +
//     detection + restore loop for judges, without touching the DB by hand.
const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const router = express.Router();
const db = require("../db");

function buildHash({ sessionId, deviceLabel, method, riskScoreBefore, issuedAt, prevHash }) {
  const payload = `${sessionId}|${deviceLabel}|${method}|${riskScoreBefore}|${issuedAt}|${prevHash}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// POST /api/certificate/generate  { sessionId, riskScoreBefore }
router.post("/certificate/generate", async (req, res) => {
  const { sessionId, riskScoreBefore } = req.body;
  const session = db.getWipeSession(sessionId);

  if (!session) return res.status(404).json({ error: "Wipe session not found" });
  if (session.status !== "complete") {
    return res.status(400).json({ error: "Wipe session has not completed yet" });
  }

  const id = crypto.randomUUID();
  const issuedAt = new Date().toISOString();

  const previous = db.getLastCertificate();
  const prevHash = previous ? previous.hash : "GENESIS";
  const chainIndex = previous ? previous.chain_index + 1 : 0;

  const hash = buildHash({
    sessionId,
    deviceLabel: session.device_label,
    method: session.method,
    riskScoreBefore: riskScoreBefore ?? 0,
    issuedAt,
    prevHash,
  });

  const simulatedFlag = session.real_wipe ? 0 : 1;
  db.insertCertificate({
    id,
    session_id: sessionId,
    device_label: session.device_label,
    method: session.method,
    risk_score_before: riskScoreBefore ?? 0,
    hash,
    prev_hash: prevHash,
    chain_index: chainIndex,
    issued_at: issuedAt,
    simulated: simulatedFlag,
  });

  // The QR points at a human-readable verification PAGE (verify.html),
  // not the raw JSON API — so a phone camera opens something a judge
  // can actually read, not a wall of raw data. The page itself still
  // calls the JSON API underneath.
  const verifyUrl = `${req.protocol}://${req.get("host")}/verify.html?id=${id}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });

  res.json({
    certificateId: id,
    deviceLabel: session.device_label,
    method: session.method,
    issuedAt,
    hash,
    prevHash,
    chainIndex,
    simulated: !!simulatedFlag,
    verifyUrl,
    qrDataUrl,
  });
});

// GET /api/certificate/verify/:id  — public, no auth: anyone can check a certificate
router.get("/certificate/verify/:id", (req, res) => {
  const cert = db.getCertificate(req.params.id);
  if (!cert) {
    return res.status(404).json({ valid: false, error: "No certificate with this ID" });
  }

  // Recompute the hash from stored fields — if it doesn't match, the row was tampered with.
  const expectedHash = buildHash({
    sessionId: cert.session_id,
    deviceLabel: cert.device_label,
    method: cert.method,
    riskScoreBefore: cert.risk_score_before,
    issuedAt: cert.issued_at,
    prevHash: cert.prev_hash,
  });

  const intact = expectedHash === cert.hash;

  res.json({
    valid: intact,
    certificateId: cert.id,
    deviceLabel: cert.device_label,
    method: cert.method,
    issuedAt: cert.issued_at,
    riskScoreBefore: cert.risk_score_before,
    prevHash: cert.prev_hash,
    chainIndex: cert.chain_index,
    simulated: !!cert.simulated,
  });
});

// GET /api/certificate/:id/pdf — a printable, downloadable version of the
// certificate. Same data as the on-screen card + the public verify page,
// just rendered to a PDF a buyer/recycler can save or hand over on paper.
router.get("/certificate/:id/pdf", async (req, res) => {
  const cert = db.getCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: "No certificate with this ID" });

  const verifyUrl = `${req.protocol}://${req.get("host")}/verify.html?id=${cert.id}`;
  const qrBuffer = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 240 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="safewipe-certificate-${cert.id}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);

  const ink = "#14120E";
  const seal = "#8A6B2E";
  const muted = "#6B5F4B";
  const line = "#D8CCA8";

  // Outer certificate border — the "printed document" motif carried over
  // from the on-screen card.
  doc.rect(28, 28, doc.page.width - 56, doc.page.height - 56).lineWidth(1.4).stroke(seal);
  doc.rect(36, 36, doc.page.width - 72, doc.page.height - 72).lineWidth(0.6).stroke(line);

  doc.fillColor(seal).fontSize(10).font("Helvetica-Bold")
    .text("PS-009 · PERSONAL DATA & DEVICE DISPOSAL", 0, 70, { align: "center", characterSpacing: 1.5 });

  doc.fillColor(ink).fontSize(30).font("Helvetica-Bold")
    .text("SafeWipe Disposal Certificate", 0, 96, { align: "center" });

  doc.moveTo(150, 145).lineTo(doc.page.width - 150, 145).lineWidth(0.7).stroke(line);

  const rows = [
    ["Certificate ID", cert.id],
    ["Ledger position", `#${cert.chain_index}`],
    ["Device / folder", cert.device_label],
    ["Wipe method", cert.method],
    ["Issued", new Date(cert.issued_at).toLocaleString()],
    ["Mode", cert.simulated ? "SIMULATED WIPE — demo purposes" : "REAL WIPE — files actually overwritten and deleted"],
  ];

  let y = 175;
  rows.forEach(([label, value]) => {
    doc.fillColor(muted).fontSize(10).font("Helvetica-Bold").text(label.toUpperCase(), 90, y, { characterSpacing: 0.5 });
    doc.fillColor(ink).fontSize(12).font("Helvetica").text(String(value), 90, y + 14, { width: doc.page.width - 260 });
    y += 46;
  });

  doc.fillColor(muted).fontSize(10).font("Helvetica-Bold").text("PREVIOUS HASH (CHAIN LINK)", 90, y, { characterSpacing: 0.5 });
  doc.fillColor(ink).fontSize(9).font("Courier").text(cert.prev_hash, 90, y + 14, { width: doc.page.width - 260 });
  y += 46;

  doc.fillColor(muted).fontSize(10).font("Helvetica-Bold").text("THIS CERTIFICATE'S HASH (SHA-256)", 90, y, { characterSpacing: 0.5 });
  doc.fillColor(ink).fontSize(9).font("Courier").text(cert.hash, 90, y + 14, { width: doc.page.width - 260 });

  doc.image(qrBuffer, doc.page.width - 190, 175, { width: 120 });
  doc.fillColor(muted).fontSize(8).font("Helvetica").text("Scan to verify independently", doc.page.width - 200, 300, { width: 140, align: "center" });

  doc.fillColor(muted).fontSize(9).font("Helvetica")
    .text(
      "This certificate is cryptographically chained to every certificate issued before it. " +
      "Tampering with any stored field invalidates its hash — re-verify at any time via the QR code above.",
      90, doc.page.height - 140, { width: doc.page.width - 180, align: "left" }
    );

  doc.end();
});

// GET /api/certificate/chain  — the full ledger, oldest first, for the
// UI's chain-of-custody visualization.
router.get("/certificate/chain", (req, res) => {
  const chain = db.listCertificatesOrdered().map((c) => ({
    certificateId: c.id,
    chainIndex: c.chain_index,
    deviceLabel: c.device_label,
    method: c.method,
    hash: c.hash,
    prevHash: c.prev_hash,
    issuedAt: c.issued_at,
    simulated: !!c.simulated,
  }));
  res.json({ length: chain.length, chain });
});

// GET /api/certificate/chain/verify — walks the whole ledger and checks
// every link: each certificate's own hash must recompute correctly, AND
// its prev_hash must equal the previous certificate's actual hash. This
// is what proves nobody quietly edited an older record after the fact.
router.get("/certificate/chain/verify", (req, res) => {
  const chain = db.listCertificatesOrdered();
  let expectedPrevHash = "GENESIS";

  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];

    const recomputed = buildHash({
      sessionId: cert.session_id,
      deviceLabel: cert.device_label,
      method: cert.method,
      riskScoreBefore: cert.risk_score_before,
      issuedAt: cert.issued_at,
      prevHash: cert.prev_hash,
    });

    if (recomputed !== cert.hash) {
      return res.json({
        valid: false,
        length: chain.length,
        brokenAtIndex: i,
        brokenCertificateId: cert.id,
        reason: "This certificate's stored fields no longer match its own hash.",
      });
    }
    if (cert.prev_hash !== expectedPrevHash) {
      return res.json({
        valid: false,
        length: chain.length,
        brokenAtIndex: i,
        brokenCertificateId: cert.id,
        reason: "This certificate is not correctly linked to the one before it in the ledger.",
      });
    }
    expectedPrevHash = cert.hash;
  }

  res.json({ valid: true, length: chain.length });
});

// ---- Demo-only endpoints: let the UI stage a live tamper/restore loop ----
// These exist purely so judges can watch detection happen in real time.
// They are not something a real buyer/attacker could do to someone else's
// certificate over the public verify flow — they mutate the local demo
// store directly, the same way a hand-edit of the JSON file would.

// POST /api/certificate/:id/demo-tamper
router.post("/certificate/:id/demo-tamper", (req, res) => {
  const cert = db.demoTamperCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: "No certificate with this ID" });
  res.json({ tampered: true, certificateId: cert.id, riskScoreBefore: cert.risk_score_before });
});

// POST /api/certificate/:id/demo-restore
router.post("/certificate/:id/demo-restore", (req, res) => {
  const cert = db.demoRestoreCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: "No certificate with this ID" });
  res.json({ restored: true, certificateId: cert.id, riskScoreBefore: cert.risk_score_before });
});

module.exports = router;
