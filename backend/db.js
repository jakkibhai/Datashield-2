// db.js — tiny JSON-file backed store. No native compilation required
// (unlike better-sqlite3), so `npm install` never needs Visual Studio
// Build Tools / Python on Windows — it's plain JS reading/writing a
// JSON file on disk. Fine for a hackathon-scale demo (single user,
// low write volume); not meant for concurrent production traffic.
//
// Certificates are stored as a hash-chain: each new certificate's hash
// is computed over its own fields PLUS the previous certificate's hash
// (or the literal string "GENESIS" for the first one ever issued). That
// turns the certificate log into an append-only ledger — tampering with
// any past entry breaks the link to everything issued after it, which
// is exactly what /api/certificate/chain/verify checks.
//
// Nothing here ever touches a real device — every row is created from
// sandbox/mock data, from the user's own confirmed local-folder actions,
// or from values typed into the demo UI.

const fs = require("fs");
const path = require("path");

function createStore(filePath) {
  let data = { wipe_sessions: {}, certificates: {}, certificateOrder: [] };

  function load() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      data = {
        wipe_sessions: parsed.wipe_sessions || {},
        certificates: parsed.certificates || {},
        certificateOrder: parsed.certificateOrder || [],
      };
    } catch (err) {
      // File missing or unreadable/corrupt — start fresh rather than crash.
      data = { wipe_sessions: {}, certificates: {}, certificateOrder: [] };
    }
  }

  function save() {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  load();

  return {
    insertWipeSession(session) {
      data.wipe_sessions[session.id] = {
        finished_at: null,
        real_wipe: 0,
        total_files: null,
        ...session,
      };
      save();
    },

    getWipeSession(id) {
      return data.wipe_sessions[id] || null;
    },

    updateWipeSession(id, patch) {
      const existing = data.wipe_sessions[id];
      if (!existing) return;
      Object.assign(existing, patch);
      save();
    },

    insertCertificate(cert) {
      data.certificates[cert.id] = cert;
      data.certificateOrder.push(cert.id);
      save();
    },

    getCertificate(id) {
      return data.certificates[id] || null;
    },

    // The most recently issued certificate, or null if the ledger is empty.
    getLastCertificate() {
      const n = data.certificateOrder.length;
      if (n === 0) return null;
      return data.certificates[data.certificateOrder[n - 1]] || null;
    },

    // Every certificate ever issued, oldest first — the full ledger.
    listCertificatesOrdered() {
      return data.certificateOrder.map((id) => data.certificates[id]).filter(Boolean);
    },

    // Demo-only helpers used by the "attacker console" in the UI, so
    // judges can watch tamper-detection happen live instead of taking
    // it on faith. Stashes the pre-tamper value so it can be restored.
    demoTamperCertificate(id) {
      const cert = data.certificates[id];
      if (!cert) return null;
      if (cert._demoOriginalRiskScore === undefined) {
        cert._demoOriginalRiskScore = cert.risk_score_before;
      }
      cert.risk_score_before = 0;
      save();
      return cert;
    },

    demoRestoreCertificate(id) {
      const cert = data.certificates[id];
      if (!cert) return null;
      if (cert._demoOriginalRiskScore !== undefined) {
        cert.risk_score_before = cert._demoOriginalRiskScore;
        delete cert._demoOriginalRiskScore;
        save();
      }
      return cert;
    },

    // Exposed for the test suite / debugging only.
    _dump() {
      return data;
    },
  };
}

const DEFAULT_PATH = path.join(__dirname, "safewipe-store.json");
const defaultStore = createStore(DEFAULT_PATH);

// module.exports IS the default singleton store (so existing
// `const db = require("../db")` call sites keep working unchanged),
// with the factory attached so tests can spin up an isolated store
// backed by their own throwaway file.
module.exports = defaultStore;
module.exports.createStore = createStore;
