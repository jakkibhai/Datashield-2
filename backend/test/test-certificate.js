// test/test-certificate.js
// Lightweight test suite (no framework needed — run with `npm test`).
// Verifies: wipe sessions are created/updated correctly, certificate
// hashes are chained and deterministic, a tampered record fails
// verification, and the demo tamper/restore round-trip works. This is
// the project's OWN test environment — separate from the "sandbox mode"
// the UI uses for demo device data.
//
// Uses its own throwaway JSON store file so it never touches the real
// backend/db.js data used by the running app.

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { createStore } = require("../db");

const TEST_STORE_PATH = path.join(__dirname, "test-store.json");
if (fs.existsSync(TEST_STORE_PATH)) fs.unlinkSync(TEST_STORE_PATH);
const db = createStore(TEST_STORE_PATH);

function buildHash({ sessionId, deviceLabel, method, riskScoreBefore, issuedAt, prevHash }) {
  const payload = `${sessionId}|${deviceLabel}|${method}|${riskScoreBefore}|${issuedAt}|${prevHash}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function issueCertificate({ sessionId, deviceLabel, method, riskScoreBefore }) {
  const previous = db.getLastCertificate();
  const prevHash = previous ? previous.hash : "GENESIS";
  const chainIndex = previous ? previous.chain_index + 1 : 0;
  const issuedAt = new Date().toISOString();
  const hash = buildHash({ sessionId, deviceLabel, method, riskScoreBefore, issuedAt, prevHash });
  const cert = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    device_label: deviceLabel,
    method,
    risk_score_before: riskScoreBefore,
    hash,
    prev_hash: prevHash,
    chain_index: chainIndex,
    issued_at: issuedAt,
    simulated: 1,
  };
  db.insertCertificate(cert);
  return cert;
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("SafeWipe test suite\n--------------------");

check("wipe session inserts as running with 0 progress", () => {
  db.insertWipeSession({
    id: "sess-1",
    device_label: "Test Phone",
    method: "single-pass",
    status: "running",
    progress: 0,
    started_at: new Date().toISOString(),
  });
  const row = db.getWipeSession("sess-1");
  assert.strictEqual(row.status, "running");
  assert.strictEqual(row.progress, 0);
});

check("updateWipeSession merges fields without clobbering the rest", () => {
  db.updateWipeSession("sess-1", { progress: 42 });
  const row = db.getWipeSession("sess-1");
  assert.strictEqual(row.progress, 42);
  assert.strictEqual(row.device_label, "Test Phone"); // untouched
});

check("the first certificate ever issued chains to GENESIS", () => {
  const cert = issueCertificate({ sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 82 });
  assert.strictEqual(cert.prev_hash, "GENESIS");
  assert.strictEqual(cert.chain_index, 0);
});

check("a second certificate chains to the first one's hash", () => {
  const first = db.getLastCertificate();
  const second = issueCertificate({ sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 10 });
  assert.strictEqual(second.prev_hash, first.hash);
  assert.strictEqual(second.chain_index, first.chain_index + 1);
});

check("certificate hash is deterministic for identical input", () => {
  const fields = { sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 82, issuedAt: "2026-01-01T00:00:00.000Z", prevHash: "GENESIS" };
  assert.strictEqual(buildHash(fields), buildHash(fields));
});

check("certificate hash changes if any field is tampered", () => {
  const fields = { sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 82, issuedAt: "2026-01-01T00:00:00.000Z", prevHash: "GENESIS" };
  const original = buildHash(fields);
  const tampered = buildHash({ ...fields, riskScoreBefore: 5 }); // someone lowers the risk score after issuance
  assert.notStrictEqual(original, tampered);
});

check("verification detects a tampered stored record", () => {
  const cert = issueCertificate({ sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 82 });

  // Simulate someone editing the stored record directly (attack scenario)
  const stored = db.getCertificate(cert.id);
  stored.risk_score_before = 5;

  const expected = buildHash({
    sessionId: stored.session_id,
    deviceLabel: stored.device_label,
    method: stored.method,
    riskScoreBefore: stored.risk_score_before,
    issuedAt: stored.issued_at,
    prevHash: stored.prev_hash,
  });
  assert.notStrictEqual(expected, stored.hash, "tampering must invalidate the hash");
});

check("demo tamper corrupts risk score, demo restore reverts it exactly", () => {
  const cert = issueCertificate({ sessionId: "sess-1", deviceLabel: "Test Phone", method: "single-pass", riskScoreBefore: 91 });
  const originalScore = cert.risk_score_before;

  const tampered = db.demoTamperCertificate(cert.id);
  assert.strictEqual(tampered.risk_score_before, 0);

  const restored = db.demoRestoreCertificate(cert.id);
  assert.strictEqual(restored.risk_score_before, originalScore);
});

check("listCertificatesOrdered returns certificates oldest-first", () => {
  const ordered = db.listCertificatesOrdered();
  for (let i = 1; i < ordered.length; i++) {
    assert.strictEqual(ordered[i].chain_index, ordered[i - 1].chain_index + 1, "chain_index must increase by exactly 1 each step");
  }
});

console.log(`\n${passed} passed`);
if (fs.existsSync(TEST_STORE_PATH)) fs.unlinkSync(TEST_STORE_PATH);
