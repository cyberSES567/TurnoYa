// Capa de datos: Firebase (tiempo real, multi-dispositivo) o modo demo local.
import { CONFIG, DEFAULT_MENU } from "./config.js";

export const isCloud = Boolean(CONFIG.firebase && CONFIG.firebase.apiKey);
let impl;

if (isCloud) {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [appM, authM, fs] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js"),
  ]);
  const app = appM.initializeApp(CONFIG.firebase);
  const auth = authM.getAuth(app);
  const db = fs.getFirestore(app);

  const toUser = (u) =>
    u && {
      uid: u.uid,
      email: (u.email || "").toLowerCase(),
      name: u.displayName || u.email,
      photo: u.photoURL || "",
    };
  const conv = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);
  const clean = (d) => {
    const o = {};
    for (const k in d) o[k] = conv(d[k]);
    if (o.review && typeof o.review === "object") o.review = { ...o.review, at: conv(o.review.at) };
    return o;
  };
  const read = (s) => ({ id: s.id, ...clean(s.data({ serverTimestamps: "estimate" })) });

  impl = {
    onAuth: (cb) => authM.onAuthStateChanged(auth, (u) => cb(toUser(u))),
    login: () => authM.signInWithPopup(auth, new authM.GoogleAuthProvider()),
    logout: () => authM.signOut(auth),

    // ── NUEVO: Autenticación con Email/Password ──
    register: async (email, password, name) => {
      const cred = await authM.createUserWithEmailAndPassword(auth, email, password);
      if (name) await authM.updateProfile(cred.user, { displayName: name });
      return cred.user;
    },
    loginEmail: (email, password) =>
      authM.signInWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => authM.sendPasswordResetEmail(auth, email),

    watch(col, cb, where) {
      let q = fs.collection(db, col);
      if (where) q = fs.query(q, fs.where(where[0], "==", where[1]));
      return fs.onSnapshot(q, (s) => cb(s.docs.map(read)), (e) => console.error("watch", col, e));
    },
    watchDoc(col, id, cb) {
      return fs.onSnapshot(
        fs.doc(db, col, id),
        (s) => cb(s.exists() ? read(s) : null, { pending: s.metadata.hasPendingWrites }),
        (e) => {
          console.error("watchDoc", col, id, e);
          cb(null, {});
        }
      );
    },
    set: (col, id, d) => fs.setDoc(fs.doc(db, col, id), d, { merge: true }),
    remove: (col, id) => fs.deleteDoc(fs.doc(db, col, id)),
    newId: () => fs.doc(fs.collection(db, "orders")).id,
    stamp: () => fs.serverTimestamp(),
  };
} else {
  // ---------- MODO DEMO ----------
  const KEY = "turnoya_demo_db";
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const subs = new Set();
  const ping = () => subs.forEach((f) => f());
  window.addEventListener("storage", (e) => e.key === KEY && ping());

  const seed = load();
  if (!seed.menu) {
    seed.menu = {};
    DEFAULT_MENU.forEach((m, i) => (seed.menu["m" + i] = { ...m, available: true }));
    seed.staff = {
      "receptor1@demo.com": { email: "receptor1@demo.com", role: "receptor", active: true },
      "receptor2@demo.com": { email: "receptor2@demo.com", role: "receptor", active: true },
    };
    save(seed);
  }

  const authSubs = new Set();
  let current = null;
  try { current = JSON.parse(sessionStorage.getItem("turnoya_demo_user")); } catch {}
  const emit = () => authSubs.forEach((f) => f(current));

  impl = {
    onAuth(cb) {
      authSubs.add(cb);
      setTimeout(() => cb(current), 0);
      return () => authSubs.delete(cb);
    },
    login(p) {
      const email = p.email.trim().toLowerCase();
      current = { uid: "u_" + email.replace(/[^a-z0-9]/g, "_"), email, name: p.name || email, photo: "" };
      sessionStorage.setItem("turnoya_demo_user", JSON.stringify(current));
      emit();
    },
    logout() {
      current = null;
      sessionStorage.removeItem("turnoya_demo_user");
      emit();
    },
    register: async (email, password, name) => {
      current = { uid: "u_" + email, email: email.toLowerCase(), name: name || email, photo: "" };
      sessionStorage.setItem("turnoya_demo_user", JSON.stringify(current));
      emit();
      return current;
    },
    loginEmail: async (email, password) => {
      const u = { uid: "u_" + email, email: email.toLowerCase(), name: email, photo: "" };
      sessionStorage.setItem("turnoya_demo_user", JSON.stringify(u));
      current = u;
      emit();
      return u;
    },
    resetPassword: async () => { throw new Error("No disponible en modo demo"); },
    watch(col, cb, where) {
      const run = () => {
        let rows = Object.entries(load()[col] || {}).map(([id, v]) => ({ id, ...v }));
        if (where) rows = rows.filter((r) => r[where[0]] === where[1]);
        cb(rows);
      };
      subs.add(run);
      setTimeout(run, 0);
      return () => subs.delete(run);
    },
    watchDoc(col, id, cb) {
      const run = () => {
        const v = (load()[col] || {})[id];
        cb(v ? { id, ...v } : null, {});
      };
      subs.add(run);
      setTimeout(run, 0);
      return () => subs.delete(run);
    },
    set(col, id, d) {
      const all = load();
      all[col] = all[col] || {};
      all[col][id] = { ...(all[col][id] || {}), ...d };
      save(all);
      ping();
      return Promise.resolve();
    },
    remove(col, id) {
      const all = load();
      if (all[col]) delete all[col][id];
      save(all);
      ping();
      return Promise.resolve();
    },
    newId: () => "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    stamp: () => Date.now(),
  };
}

export const data = impl;
