// Capa de datos: Firebase (tiempo real) + Cloudinary (imágenes) o modo demo local.
import { CONFIG, DEFAULT_MENU } from "./config.js";

const CLOUDINARY_CLOUD_NAME = "p6szlpdy";
const CLOUDINARY_UPLOAD_PRESET = "turnoya_menu";

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
      name: u.displayName || u.email || "Invitado",
      photo: u.photoURL || "",
      verified: !!u.emailVerified,
      google: u.providerData.some((p) => p.providerId === "google.com"),
    };
  const conv = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);
  const clean = (d) => {
    const o = {};
    for (const k in d) o[k] = conv(d[k]);
    if (o.review && typeof o.review === "object") o.review = { ...o.review, at: conv(o.review.at) };
    return o;
  };
  const read = (s) => ({ id: s.id, ...clean(s.data({ serverTimestamps: "estimate" })) });
  // Admite subcolecciones: "chats/UID/messages"
  const colRef = (col) => fs.collection(db, ...col.split("/"));
  const docRef = (col, id) => fs.doc(db, ...col.split("/"), id);

  impl = {
    onAuth: (cb) => authM.onAuthStateChanged(auth, (u) => cb(toUser(u))),
    login: () => authM.signInWithPopup(auth, new authM.GoogleAuthProvider()),
    loginGuest: () => authM.signInAnonymously(auth),
    logout: () => authM.signOut(auth),

    register: async (email, password, name) => {
      const cred = await authM.createUserWithEmailAndPassword(auth, email, password);
      if (name) await authM.updateProfile(cred.user, { displayName: name });
      authM.sendEmailVerification(cred.user).catch(() => {});
      return cred.user;
    },
    loginEmail: (email, password) => authM.signInWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => authM.sendPasswordResetEmail(auth, email),
    resendVerification: () => authM.sendEmailVerification(auth.currentUser),
    recheck: async () => {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
    },
    claims: async () => (await auth.currentUser.getIdTokenResult(true)).claims,
    refreshToken: () => auth.currentUser.getIdToken(true),
    call: async (name, payload) => {
      const f = await import(base + "firebase-functions.js");
      const res = await f.httpsCallable(f.getFunctions(app), name)(payload || {});
      return res.data;
    },

    uploadImage: async (file) => {
      if (file.size > 5 * 1024 * 1024) throw new Error("La imagen supera los 5 MB");
      const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      const response = await fetch(url, { method: "POST", body: formData });
      const out = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("Cloudinary error:", response.status, out);
        throw new Error(out?.error?.message || `HTTP ${response.status} al subir imagen`);
      }
      return out.secure_url;
    },

    watch(col, cb, where) {
      let q = colRef(col);
      if (where) q = fs.query(q, fs.where(where[0], "==", where[1]));
      return fs.onSnapshot(q, (s) => cb(s.docs.map(read)), (e) => console.error("watch", col, e));
    },
    watchDoc(col, id, cb) {
      return fs.onSnapshot(
        docRef(col, id),
        (s) => cb(s.exists() ? read(s) : null, { pending: s.metadata.hasPendingWrites }),
        (e) => {
          console.error("watchDoc", col, id, e);
          cb(null, {});
        }
      );
    },
    set: (col, id, d) => fs.setDoc(docRef(col, id), d, { merge: true }),
    remove: (col, id) => fs.deleteDoc(docRef(col, id)),
    newId: () => fs.doc(fs.collection(db, "orders")).id,
    stamp: () => fs.serverTimestamp(),
  };
} else {
  // ---------- MODO DEMO (localStorage) ----------
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
      "mesero1@demo.com": { email: "mesero1@demo.com", role: "mesero", active: true },
      "cocinero1@demo.com": { email: "cocinero1@demo.com", role: "cocinero", active: true },
      "mod1@demo.com": { email: "mod1@demo.com", role: "moderador", active: true },
    };
    save(seed);
  }

  const authSubs = new Set();
  let current = null;
  try { current = JSON.parse(sessionStorage.getItem("turnoya_demo_user")); } catch {}
  const emit = () => authSubs.forEach((f) => f(current));
  const setUser = (u) => {
    current = { ...u, verified: true, google: true };
    sessionStorage.setItem("turnoya_demo_user", JSON.stringify(current));
    emit();
    return current;
  };

  impl = {
    onAuth(cb) {
      authSubs.add(cb);
      setTimeout(() => cb(current), 0);
      return () => authSubs.delete(cb);
    },
    login: async () => setUser({ uid: "u_demo", email: "demo@demo.com", name: "Demo", photo: "" }),
    loginGuest: async () => setUser({ uid: "u_guest_" + Date.now(), email: "", name: "Invitado", photo: "" }),
    logout() {
      current = null;
      sessionStorage.removeItem("turnoya_demo_user");
      emit();
    },
    register: async (email, password, name) =>
      setUser({ uid: "u_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_"), email: email.toLowerCase(), name: name || email, photo: "" }),
    loginEmail: async (email) =>
      setUser({ uid: "u_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_"), email: email.toLowerCase(), name: email, photo: "" }),
    resetPassword: async () => { throw new Error("No disponible en modo demo"); },
    resendVerification: async () => {},
    recheck: async () => {},
    claims: async () => ({}),
    refreshToken: async () => {},
    call: async () => { throw new Error("No disponible en modo demo"); },

    uploadImage: (file) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      }),

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
