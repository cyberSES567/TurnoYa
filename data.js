// data.js
// Capa de datos: Firebase (tiempo real) + Cloudinary (imágenes) o modo demo local.
import { CONFIG, DEFAULT_MENU } from "./config.js";

const CLOUDINARY_CLOUD_NAME = "p6szlpdy";
const CLOUDINARY_UPLOAD_PRESET = "turnoya_menu";

export const isCloud = Boolean(CONFIG.firebase && CONFIG.firebase.apiKey);

// ==========================================
// IMPLEMENTACIÓN LOCAL (MODO DEMO)
// ==========================================
const localImpl = {
  _listeners: {},
  _docListeners: {},
  _authCb: null,
  _user: JSON.parse(localStorage.getItem('yata_user')) || null,

  onAuth(cb) {
    this._authCb = cb;
    setTimeout(() => cb(this._user), 0);
    return () => { this._authCb = null; };
  },
  async login() { this._setUser({ uid: 'demo-google', email: 'demo@gmail.com', name: 'Demo Google', verified: true, google: true }); },
  async loginGuest() { this._setUser({ uid: 'demo-guest-' + Date.now(), email: '', name: 'Invitado', verified: true, google: false }); },
  async logout() { this._setUser(null); },
  async loginEmail(email, pass) { this._setUser({ uid: 'demo-email-' + email, email, name: 'Demo User', verified: true, google: false }); },
  async register(email, pass, name) { this._setUser({ uid: 'demo-email-' + email, email, name, verified: true, google: false }); },
  async resetPassword() { return true; },
  async resendVerification() { return true; },
  async recheck() { return true; },
  async call() { return true; },
  async refreshToken() { return true; },
  async claims() { return {}; },
  _setUser(u) {
    this._user = u;
    if (u) localStorage.setItem('yata_user', JSON.stringify(u));
    else localStorage.removeItem('yata_user');
    if (this._authCb) this._authCb(u);
  },
  _getStore(col) { return JSON.parse(localStorage.getItem('yata_' + col) || '[]'); },
  _setStore(col, rows) {
    localStorage.setItem('yata_' + col, JSON.stringify(rows));
    if (this._listeners[col]) this._listeners[col].forEach(cb => cb([...rows]));
    rows.forEach(r => {
      const docKey = `${col}/${r.id}`;
      if (this._docListeners[docKey]) this._docListeners[docKey].forEach(cb => cb(r, { pending: false }));
    });
  },
  watch(col, cb, where) {
    if (!this._listeners[col]) this._listeners[col] = [];
    this._listeners[col].push(cb);
    let rows = this._getStore(col);
    if (where) rows = rows.filter(r => r[where[0]] === where[1]);
    setTimeout(() => cb(rows), 0);
    return () => { this._listeners[col] = this._listeners[col].filter(f => f !== cb); };
  },
  watchDoc(col, id, cb) {
    const docKey = `${col}/${id}`;
    if (!this._docListeners[docKey]) this._docListeners[docKey] = [];
    this._docListeners[docKey].push(cb);
    const rows = this._getStore(col);
    const doc = rows.find(r => r.id === id);
    setTimeout(() => cb(doc || null, { pending: false }), 0);
    return () => { this._docListeners[docKey] = this._docListeners[docKey].filter(f => f !== cb); };
  },
  async set(col, id, data) {
    let rows = this._getStore(col);
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...data, id };
    else rows.push({ ...data, id });
    this._setStore(col, rows);
  },
  async remove(col, id) {
    let rows = this._getStore(col);
    rows = rows.filter(r => r.id !== id);
    this._setStore(col, rows);
  },
  newId() { return 'id-' + Math.random().toString(36).substring(2, 9); },
  stamp() { return Date.now(); },
  async uploadImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
};

// ==========================================
// IMPLEMENTACIÓN FIREBASE (NUBE)
// ==========================================
let cloudImpl = null;

if (isCloud) {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [appM, authM, fs, fnM] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js"),
    import(base + "firebase-functions.js"),
  ]);

  const app = appM.initializeApp(CONFIG.firebase);
  const auth = authM.getAuth(app);
  const db = fs.getFirestore(app);
  const functions = fnM.getFunctions(app);

  const toUser = (u) => u && {
    uid: u.uid,
    email: u.email || "",
    name: u.displayName || u.email || "Usuario",
    photo: u.photoURL || "",
    verified: u.emailVerified,
    google: u.providerData.some(p => p.providerId === 'google.com')
  };

  cloudImpl = {
    onAuth(cb) {
      return authM.onAuthStateChanged(auth, (u) => cb(toUser(u)));
    },
    async login() {
      const provider = new authM.GoogleAuthProvider();
      await authM.signInWithPopup(auth, provider);
    },
    async loginGuest() { await authM.signInAnonymously(auth); },
    async logout() { await authM.signOut(auth); },
    async loginEmail(email, pass) { await authM.signInWithEmailAndPassword(auth, email, pass); },
    async register(email, pass, name) {
      const cred = await authM.createUserWithEmailAndPassword(auth, email, pass);
      if (name) await authM.updateProfile(cred.user, { displayName: name });
      await authM.sendEmailVerification(cred.user);
    },
    async resetPassword(email) { await authM.sendPasswordResetEmail(auth, email); },
    async resendVerification() {
      if (auth.currentUser) await authM.sendEmailVerification(auth.currentUser);
    },
    async recheck() { if (auth.currentUser) await auth.currentUser.reload(); },
    // Llama a una Cloud Function "callable" (sendOwnerCode, verifyOwnerCode...).
    async call(fn, payload) {
      const res = await fnM.httpsCallable(functions, fn)(payload || {});
      return res.data;
    },
    async refreshToken() { if (auth.currentUser) await auth.currentUser.getIdToken(true); },
    async claims() {
      if (!auth.currentUser) return {};
      const token = await auth.currentUser.getIdTokenResult();
      return token.claims;
    },
    watch(col, cb, where) {
      let q = fs.collection(db, col);
      if (where) q = fs.query(q, fs.where(where[0], "==", where[1]));
      return fs.onSnapshot(q, (snap) => {
        const rows = [];
        snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        cb(rows);
      }, (err) => console.error("Watch error:", err));
    },
    watchDoc(col, id, cb) {
      return fs.onSnapshot(fs.doc(db, col, id), (doc) => {
        cb(doc.exists() ? { id: doc.id, ...doc.data() } : null, { pending: doc.metadata.hasPendingWrites });
      }, (err) => console.error("WatchDoc error:", err));
    },
    async set(col, id, data) { await fs.setDoc(fs.doc(db, col, id), data, { merge: true }); },
    async remove(col, id) { await fs.deleteDoc(fs.doc(db, col, id)); },
    newId() { return fs.doc(fs.collection(db, 'temp')).id; },
    stamp() { return Date.now(); },
    async uploadImage(file) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) throw new Error("Error al subir imagen a Cloudinary");
      const data = await res.json();
      return data.secure_url;
    }
  };
}

// Seleccionar la implementación según el entorno
const impl = isCloud ? cloudImpl : localImpl;

export const data = {
  onAuth: impl.onAuth.bind(impl),
  login: impl.login.bind(impl),
  loginGuest: impl.loginGuest.bind(impl),
  logout: impl.logout.bind(impl),
  loginEmail: impl.loginEmail.bind(impl),
  register: impl.register.bind(impl),
  resetPassword: impl.resetPassword.bind(impl),
  resendVerification: impl.resendVerification.bind(impl),
  recheck: impl.recheck.bind(impl),
  call: impl.call.bind(impl),
  refreshToken: impl.refreshToken.bind(impl),
  claims: impl.claims.bind(impl),
  watch: impl.watch.bind(impl),
  watchDoc: impl.watchDoc.bind(impl),
  set: impl.set.bind(impl),
  remove: impl.remove.bind(impl),
  newId: impl.newId.bind(impl),
  stamp: impl.stamp.bind(impl),
  uploadImage: impl.uploadImage.bind(impl),
};
