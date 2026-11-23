// ============================================================
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const OWNER = "adminnegocio1923@gmail.com"; // igual que en config.js
const SESSION_HOURS = 12;
const CODE_MINUTES = 10;
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_PASS = defineSecret("GMAIL_APP_PASSWORD");

const hash = (code, uid) => crypto.createHash("sha256").update(`${code}:${uid}`).digest("hex");

function assertOwner(req) {
  const t = req.auth && req.auth.token;
  if (!t || (t.email || "").toLowerCase() !== OWNER || t.email_verified !== true || t.firebase.sign_in_provider !== "google.com") {
    throw new HttpsError("permission-denied", "No autorizado");
  }
  return req.auth.uid;
}

exports.sendOwnerCode = onCall({ secrets: [GMAIL_USER, GMAIL_PASS] }, async (req) => {
  const uid = assertOwner(req);
  const ref = db.collection("owner_codes").doc(uid); // sin reglas de cliente: solo el servidor lo toca
  const snap = await ref.get();
  if (snap.exists && Date.now() - snap.data().sentAt < 30000) {
    throw new HttpsError("resource-exhausted", "Espera 30 segundos para pedir otro código");
  }
  const code = String(crypto.randomInt(100000, 1000000));
  await ref.set({ h: hash(code, uid), exp: Date.now() + CODE_MINUTES * 60000, sentAt: Date.now(), tries: 0 });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER.value(), pass: GMAIL_PASS.value() },
  });
  await transporter.sendMail({
    from: `"yaTA! Seguridad" <${GMAIL_USER.value()}>`,
    to: OWNER,
    subject: "Tu código de acceso yaTA!",
    text: `Tu código es ${code}. Vence en ${CODE_MINUTES} minutos. Si no fuiste tú, cambia tu contraseña de Google.`,
  });
  return { ok: true };
});

exports.verifyOwnerCode = onCall(async (req) => {
  const uid = assertOwner(req);
  const code = String((req.data && req.data.code) || "").trim();
  const ref = db.collection("owner_codes").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Pide un código primero");
  const d = snap.data();
  if (Date.now() > d.exp) { await ref.delete(); throw new HttpsError("deadline-exceeded", "El código venció"); }
  if (d.tries >= 5) { await ref.delete(); throw new HttpsError("resource-exhausted", "Demasiados intentos. Pide otro código"); }

  const a = Buffer.from(hash(code, uid));
  const b = Buffer.from(d.h);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await ref.update({ tries: d.tries + 1 });
    throw new HttpsError("invalid-argument", "Código incorrecto");
  }
  await ref.delete();
  const user = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    o2: Date.now() + SESSION_HOURS * 3600 * 1000, // expira solo; las reglas lo comparan con la hora del servidor
  });
  return { ok: true };
});
