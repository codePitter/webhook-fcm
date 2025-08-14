// api/orders.js
const admin = require("firebase-admin");

let adminReady = false;
function ensureAdmin() {
  if (adminReady) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("MISSING_ENV_FIREBASE_SERVICE_ACCOUNT_JSON");
  let svc;
  try {
    svc = JSON.parse(raw);
  } catch (e) {
    throw new Error("BAD_ENV_FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  adminReady = true;
}

async function readJSONBody(req) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) {
    // Si quieres permitir x-www-form-urlencoded, aquí podrías parsearlo.
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("INVALID_JSON_BODY");
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).send("Only POST");

  // Init Admin con mensajes claros
  try {
    ensureAdmin();
  } catch (e) {
    console.error("Admin init error:", e.message);
    const map = {
      MISSING_ENV_FIREBASE_SERVICE_ACCOUNT_JSON:
        "Falta la env FIREBASE_SERVICE_ACCOUNT_JSON en Vercel.",
      BAD_ENV_FIREBASE_SERVICE_ACCOUNT_JSON:
        "FIREBASE_SERVICE_ACCOUNT_JSON no es JSON válido.",
    };
    return res.status(500).json({ ok: false, error: map[e.message] || e.message });
  }

  // Leer y validar body
  let b;
  try {
    b = await readJSONBody(req);
  } catch (e) {
    console.error("Body parse error:", e.message);
    const code =
      e.message === "UNSUPPORTED_CONTENT_TYPE" ? 415 :
      e.message === "INVALID_JSON_BODY" ? 400 : 400;
    return res.status(code).json({ ok: false, error: e.message });
  }

  for (const k of ["id", "customerName", "total"]) {
    if (!b[k]) return res.status(400).json({ ok: false, error: `Missing ${k}` });
  }

  // Armar data (todo string)
  const data = {
    id: String(b.id),
    customerName: String(b.customerName),
    total: String(b.total),
    status: String(b.status || "PENDING"),
  };
  if (b.slotStart != null) data.slotStart = String(b.slotStart);
  if (b.slotEnd   != null) data.slotEnd   = String(b.slotEnd);
  if (b.courier   != null) data.courier   = String(b.courier);

  try {
    const messageId = await admin.messaging().send({
      topic: "orders",
      data,
      android: { priority: "high" },
    });
    return res.json({ ok: true, messageId });
  } catch (e) {
    console.error("FCM send error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "send failed" });
  }
};

// Fuerza runtime moderno en Vercel
module.exports.config = { runtime: "nodejs18.x" };
