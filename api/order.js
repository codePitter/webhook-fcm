// api/order.js
const admin = require("firebase-admin");

let adminReady = false;
function ensureAdmin() {
  if (adminReady) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("MISSING_ENV_FIREBASE_SERVICE_ACCOUNT_JSON");
  let svc;
  try {
    svc = JSON.parse(raw);
  } catch {
    throw new Error("BAD_ENV_FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  adminReady = true;
}

async function readJSONBody(req) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
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

  // Firebase Admin
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

  // Body
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

  // Requisitos mínimos
  for (const k of ["id", "customerName", "total"]) {
    if (!b[k]) return res.status(400).json({ ok: false, error: `Missing ${k}` });
  }

  // Construye data FCM (TODO string)
  const passThrough = [
    "id",
    "customerName",
    "total",
    "status",
    "courier",
    "phone",
    "scheduledTime",
    "address",
    "email",
    "slotStart",
    "slotEnd",
  ];

  const data = {};
  for (const k of passThrough) {
    if (b[k] != null) data[k] = String(b[k]);
  }
  // Por defecto status=PENDING si no vino
  if (!data.status) data.status = "PENDING";

  // items: FCM data requiere string; si viene array/obj → stringify
  if (b.items != null) {
    data.items = typeof b.items === "string" ? b.items : JSON.stringify(b.items);
  }

  // Enviar a token si viene; si no, al topic "orders"
  const target = b.token ? { token: String(b.token) } : { topic: "orders" };

  try {
    const messageId = await admin.messaging().send({
      ...target,
      data,
      android: { priority: "high" },
    });
    return res.json({ ok: true, messageId });
  } catch (e) {
    console.error("FCM send error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "send failed" });
  }
};

// Vercel runtime
module.exports.config = { runtime: "nodejs18.x" };
