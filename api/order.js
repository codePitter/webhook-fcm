// Vercel Serverless Function: POST /api/orders
// Recibe el JSON del checkout y reenvía un FCM data-only al topic "orders"

const admin = require("firebase-admin");

// Carga el service account desde variable de entorno (NO subas el JSON al repo)
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}

module.exports = async (req, res) => {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).send("Only POST");

  const b = req.body || {};
  for (const k of ["id", "customerName", "total"]) {
    if (!b[k]) return res.status(400).json({ error: `Missing ${k}` });
  }

  // TODO(opcional): validar secreto compartido
  // if (process.env.WEBHOOK_SECRET && req.headers["x-webhook-secret"] !== process.env.WEBHOOK_SECRET) {
  //   return res.status(401).json({ error: "Invalid signature" });
  // }

  // En FCM data TODO debe ser string
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
    res.json({ ok: true, messageId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "send failed" });
  }
};
