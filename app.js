import { CONFIG } from "./config.js";
import { data, isCloud } from "./data.js";

/* ====================== utilidades ====================== */
const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $toasts = document.getElementById("toasts");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `${CONFIG.currency} ${Number(n || 0).toFixed(2)}`;
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const dash = (v, f = (x) => x) => (v == null ? "—" : f(v));
const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const first = (n) => String(n || "").split(" ")[0];
const short = (id) => String(id).slice(-4).toUpperCase();
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (n) => Math.round(n * 100) / 100;
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayStart = (s) => new Date(s + "T00:00:00").getTime();
const dayEnd = (s) => new Date(s + "T23:59:59.999").getTime();
const hm = (t) => new Date(t).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
const dmy = (t) => new Date(t).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
const SLA = CONFIG.acceptSlaSeconds * 1000;
const OWNER = CONFIG.ownerEmail.toLowerCase();
const wUid = (o) => o.waiterUid || o.receptorUid;
const wName = (o) => o.waiterName || o.receptorName || "";
const incl = (i) => (i.includes && i.includes.length ? `<div class="muted" style="font-size:.8rem">Incluye: ${i.includes.map((x) => `${x.qty}× ${esc(x.name)}`).join(", ")}</div>` : "");

const STAFF_ROLES = ["admin", "moderador", "mesero", "cocinero"];
const normRole = (r) => (r === "receptor" ? "mesero" : STAFF_ROLES.includes(r) ? r : "cliente");
const ROLE_LABEL = { admin: "Administrador", moderador: "Moderador", mesero: "Mesero", cocinero: "Cocinero", cliente: "Cliente", baneado: "Bloqueado" };

const ST = {
  espera: "Esperando al mesero",
  cocina: "En cola de cocina",
  estimado: "Cocina confirmó tu pedido",
  preparando: "Preparando tu pedido",
  listo: "Listo para entregar",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
const ACTIVE = ["espera", "cocina", "estimado", "preparando", "listo"];
const IN_KITCHEN = ["cocina", "estimado", "preparando"];

const NAV = {
  admin: [["resumen", "Resumen"], ["historial", "Historial"], ["equipo", "Equipo"], ["menu", "Menú"], ["ofertas", "Ofertas"], ["resenas", "Reseñas"], ["clientes", "Clientes"], ["soporte", "Soporte"], ["team", "Chat equipo"]],
  moderador: [["clientes", "Clientes"], ["soporte", "Soporte"], ["ofertas", "Ofertas"], ["resenas", "Reseñas"], ["team", "Chat equipo"]],
  mesero: [["espera", "Nuevos"], ["cocina", "En cocina"], ["listo", "Por entregar"], ["team", "Chat equipo"]],
  cocinero: [["cola", "Cola"], ["curso", "En curso"], ["team", "Chat equipo"]],
  cliente: [["menu", "Menú"], ["ofertas", "Ofertas"], ["resenas", "Reseñas"], ["pedidos", "Mis pedidos"], ["ayuda", "Ayuda"]],
};

/* ====================== estado ====================== */
const S = {
  user: null, role: null, isOwner: false, gate: null, loading: true, offset: 0,
  menu: [], orders: [], staff: [], banned: [], users: [], offers: [], reviews: [], chats: [], loyaltyAll: [], team: [], thread: [],
  myLoyalty: null, myChat: null, chatWith: null, biz: null,
  tab: null, cart: {}, mesa: new URLSearchParams(location.search).get("mesa") || "", rv: null, etaFor: null, rvFilter: "", selMsgs: new Set(),
};
let authUnsubs = [], roleUnsubs = [], threadUnsub = null;
let seen = null, prevStatus = {}, prevRobot = {}, lateAlerted = new Set(), seeded = false, seq = 0;
let chatSeen = null, prevChat = {}, teamSeen = null, threadSeen = null;
const now = () => Date.now() + S.offset;
const startOfDay = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Si el documento settings/business no existe, el negocio se considera abierto.
const isOpen = () => S.biz?.open !== false;
const isGuest = () => Boolean(S.user?.isGuest || (!S.user?.email && S.user?.uid?.startsWith("demo-guest-")));

/* ====================== sonido y avisos ====================== */
let ac;
function unlock() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
  } catch {}
}
addEventListener("pointerdown", unlock, { passive: true });
addEventListener("keydown", unlock);
function beep(kind) {
  navigator.vibrate?.(kind === "late" ? [250, 100, 250, 100, 250] : [120, 60, 120]);
  if (!ac) return;
  const seqs = { new: [[880, .14], [1175, .22]], ok: [[660, .12], [880, .12], [1320, .3]], late: [[330, .25], [330, .25], [330, .25]] };
  let t = ac.currentTime;
  for (const [f, d] of seqs[kind] || seqs.new) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = kind === "late" ? "sawtooth" : "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + d + 0.03);
    t += d + 0.05;
  }
}
function toast(msg, type = "", title = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  if (title) { const b = document.createElement("b"); b.textContent = title; el.appendChild(b); }
  el.appendChild(document.createTextNode(msg));
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
function alertUser(title, body, sound = "new", type = "ok") {
  toast(body, type, title);
  beep(sound);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification(title, { body }); } catch {}
  }
}

/* ====================== estadísticas y fidelidad ====================== */
function stats(orders) {
  const taken = orders.filter((o) => o.acceptedAt);
  const waits = taken.map((o) => o.acceptedAt - o.createdAt);
  const preps = orders.filter((o) => o.readyAt && o.cookAt).map((o) => o.readyAt - o.cookAt);
  const rts = orders.filter((o) => o.review).map((o) => o.review.rating);
  return {
    count: orders.length,
    taken: taken.length,
    avgWait: avg(waits),
    slaPct: waits.length ? Math.round((waits.filter((w) => w <= SLA).length / waits.length) * 100) : null,
    avgPrep: avg(preps),
    avgRating: avg(rts),
    nRatings: rts.length,
  };
}
const deliveredCount = (arr) => arr.filter((o) => o.status === "entregado").length;
const suggestedPct = (n) => Math.min(CONFIG.loyaltyMax, Math.floor(n / CONFIG.loyaltyEvery) * CONFIG.loyaltyStep);

/* ====================== precios y ofertas ====================== */
const activeOffers = () => S.offers.filter((o) => o.active !== false && (!o.endsAt || o.endsAt >= now()));
const offerFor = (id) => activeOffers().find((o) => o.type !== "combo" && o.menuId === id);
const comboItems = (o) => (o.items || []).map((it) => ({ ...it, m: S.menu.find((x) => x.id === it.id) })).filter((it) => it.m);
const comboNormal = (o) => r2(comboItems(o).reduce((s, it) => s + it.m.price * it.qty, 0));
const comboSave = (o) => Math.max(0, r2(comboNormal(o) - Number(o.offerPrice || 0)));
const comboOk = (o) => { const its = comboItems(o); return its.length > 0 && its.length === (o.items || []).length && its.every((it) => it.m.available !== false); };
const offerEnds = (o) => (o.endsAt ? "Hasta el " + dmy(o.endsAt) : "");
const offerUnit = (o, m) => (o.type === "pct" ? r2(m.price * (1 - (o.discountPct || 0) / 100)) : o.type === "2x1" ? m.price : Number(o.offerPrice ?? m.price));
const priceOf = (m) => {
  const o = offerFor(m.id);
  if (!o) return m.price;
  if (o.type === "pct") return r2(m.price * (1 - (o.discountPct || 0) / 100));
  if (o.type === "2x1") return m.price; // El precio unitario se mantiene, el descuento se hace en el carrito
  return Number(o.offerPrice ?? m.price);
};
const discPct = () => (S.role === "cliente" && S.user?.email ? Number(S.myLoyalty?.discount || 0) : 0);
function ratingMap() {
  const m = {};
  S.reviews.forEach((r) => (r.items || []).forEach((i) => { (m[i.id] ??= { s: 0, n: 0 }); m[i.id].s += r.rating; m[i.id].n++; }));
  return m;
}

/* ====================== sesión y roles ====================== */
async function ownerGate(user) {
  if (!isCloud) return null;
  if (!user.google) return "google";
  if (CONFIG.ownerTwoFactor) {
    const c = await data.claims();
    if (!((c.o2 || 0) > Date.now())) return "code";
  }
  return null;
}

function stopRole() {
  roleUnsubs.forEach((f) => f()); roleUnsubs = [];
  threadUnsub && threadUnsub(); threadUnsub = null;
}

data.onAuth((user) => {
  const my = ++seq;
  authUnsubs.forEach((f) => f()); authUnsubs = [];
  stopRole();
  Object.assign(S, {
    user, role: null, gate: null, loading: !!user, cart: {}, orders: [], menu: [], staff: [], banned: [], users: [], offers: [], reviews: [],
    chats: [], loyaltyAll: [], team: [], thread: [], myLoyalty: null, myChat: null, chatWith: null, biz: null, offset: 0, isOwner: false, selMsgs: new Set(),
  });
  seen = null; prevStatus = {}; prevRobot = {}; lateAlerted = new Set(); seeded = false;
  closeModal();
  if (!user) return render();

  const owner = user.email === OWNER;
  let banned = null, staffDoc = null;
  let gotB = owner || !user.email, gotS = owner || !user.email, gotG = !owner;
  const resolve = () => {
    if (my !== seq || !gotB || !gotS || !gotG) return;
    if (S.gate) { S.loading = false; return render(); }
    const staffOk = staffDoc && staffDoc.active && user.verified;
    const role = owner ? "admin" : banned ? "baneado" : staffOk ? normRole(staffDoc.role) : "cliente";
    S.isOwner = owner;
    if (role !== S.role) { S.role = role; startRole(); }
    S.loading = false;
    render();
  };
  if (owner) {
    ownerGate(user)
      .then((g) => { if (my !== seq) return; S.gate = g; gotG = true; resolve(); })
      .catch(() => { if (my !== seq) return; S.gate = "code"; gotG = true; resolve(); });
  }
  if (!owner && user.email) {
    authUnsubs.push(data.watchDoc("banned", user.email, (d) => { banned = d; gotB = true; resolve(); }));
    authUnsubs.push(data.watchDoc("staff", user.email, (d) => { staffDoc = d; gotS = true; resolve(); }));
  } else resolve();

  authUnsubs.push(data.watchDoc("users", user.uid, (u, meta) => {
    if (u && typeof u.seen === "number" && !(meta && meta.pending)) S.offset = u.seen - Date.now();
  }));
  data.set("users", user.uid, { email: user.email || "", name: user.name, seen: data.stamp() }).catch(() => {});
  render();
});

function startRole() {
  stopRole();
  Object.assign(S, { orders: [], menu: [], staff: [], banned: [], users: [], offers: [], reviews: [], chats: [], loyaltyAll: [], team: [], thread: [], myLoyalty: null, myChat: null, chatWith: null });
  seen = null; prevStatus = {}; prevRobot = {}; chatSeen = null; prevChat = {}; teamSeen = null; threadSeen = null;
  S.tab = { admin: "resumen", moderador: "clientes", mesero: "espera", cocinero: "cola", cliente: "menu" }[S.role] || null;
  if (!S.role || S.role === "baneado") return;
  const w = (col, key, where, after) =>
    roleUnsubs.push(data.watch(col, (rows) => { S[key] = rows; after && after(rows); render(); }, where));
  const R = S.role;
  roleUnsubs.push(data.watchDoc("settings", "business", (d) => { S.biz = d; render(); }));
  if (R === "admin") {
    w("menu", "menu", null, seedMenuIfEmpty); w("orders", "orders"); w("staff", "staff"); w("banned", "banned"); w("users", "users");
    w("offers", "offers"); w("reviews", "reviews"); w("chats", "chats", null, onChats); w("loyalty", "loyaltyAll"); w("teamchat", "team", null, onTeam);
  } else if (R === "moderador") {
    w("menu", "menu"); w("orders", "orders"); w("banned", "banned"); w("users", "users");
    w("offers", "offers"); w("reviews", "reviews"); w("chats", "chats", null, onChats); w("loyalty", "loyaltyAll"); w("teamchat", "team", null, onTeam);
  } else if (R === "mesero" || R === "cocinero") {
    w("orders", "orders", null, onOrders); w("teamchat", "team", null, onTeam);
  } else {
    const uid = S.user.uid;
    w("menu", "menu"); w("offers", "offers"); w("reviews", "reviews");
    w("orders", "orders", ["customerUid", uid], onOrders);
    roleUnsubs.push(data.watchDoc("loyalty", uid, (d) => { S.myLoyalty = d; render(); }));
    roleUnsubs.push(data.watchDoc("chats", uid, (d) => { S.myChat = d; render(); }));
    w(`chats/${uid}/messages`, "thread", null, onThread);
  }
}

async function seedMenuIfEmpty(rows) {
  if (rows.length || seeded || !S.isOwner) return;
  seeded = true;
  const { DEFAULT_MENU } = await import("./config.js");
  for (const [i, m] of DEFAULT_MENU.entries()) await data.set("menu", "m" + i, { ...m, available: true });
}

function onOrders(rows) {
  if (seen === null) {
    seen = new Set(rows.map((o) => o.id));
    prevStatus = Object.fromEntries(rows.map((o) => [o.id, o.status]));
    prevRobot = Object.fromEntries(rows.map((o) => [o.id, Boolean(o.robotAt)]));
    return;
  }
  for (const o of rows) {
    const p = prevStatus[o.id], isNew = !seen.has(o.id), hadRobot = prevRobot[o.id];
    if (S.role === "mesero") {
      if (isNew && o.status === "espera") alertUser("Nuevo pedido", `Mesa ${o.mesa} · ${o.items.length} producto(s)`, "new");
      if (!isNew && p !== o.status) {
        if (o.status === "estimado") alertUser("Cocina confirmó", `Mesa ${o.mesa}: ~${o.etaMin} min. Márcalo como "preparando".`, "ok");
        if (o.status === "listo") alertUser("Pedido listo", `Llévalo a la Mesa ${o.mesa}.`, "ok");
      }
    } else if (S.role === "cocinero") {
      if (o.status === "cocina" && p !== "cocina") alertUser("Nuevo pedido en cola", `Mesa ${o.mesa} · ${o.items.length} producto(s)`, "new");
    } else if (S.role === "cliente") {
      if (p && p !== o.status) {
        if (o.status === "cocina") alertUser("Pedido enviado a cocina", `${first(o.waiterName) || "Tu mesero"} ya envió tu pedido.`, "ok");
        if (o.status === "estimado") alertUser("Cocina lo confirmó", `Tiempo estimado: ~${o.etaMin} min.`, "ok");
        if (o.status === "preparando") alertUser("Preparando tu pedido", "Tu pedido ya está en preparación.", "ok");
        if (o.status === "listo") alertUser("¡Tu pedido está listo!", "Pronto llegará a tu mesa.", "ok");
      }
      if (!hadRobot && o.robotAt && o.status === "listo") {
        alertUser("🤖 ¡Robot en camino!", `Un robot lleva tu pedido a la Mesa ${o.mesa}.`, "ok");
      }
    }
    seen.add(o.id);
    prevStatus[o.id] = o.status;
    prevRobot[o.id] = Boolean(o.robotAt);
  }
}

function onChats(rows) {
  if (chatSeen === null) { chatSeen = true; prevChat = Object.fromEntries(rows.map((c) => [c.id, c.lastAt])); return; }
  for (const c of rows) {
    if (prevChat[c.id] !== c.lastAt && c.lastFrom === "cliente" && S.chatWith !== c.id)
      alertUser("Mensaje de cliente", `${first(c.customerName)}: ${c.lastText || ""}`, "new");
    prevChat[c.id] = c.lastAt;
  }
}
function onTeam(rows) {
  if (teamSeen === null) { teamSeen = new Set(rows.map((m) => m.id)); return; }
  for (const m of rows) {
    if (!teamSeen.has(m.id) && m.fromUid !== S.user.uid && S.tab !== "team")
      alertUser("Chat del equipo", `${first(m.fromName)}: ${m.text}`, "new");
    teamSeen.add(m.id);
  }
}
function onThread(rows) {
  if (threadSeen === null) { threadSeen = new Set(rows.map((m) => m.id)); return; }
  for (const m of rows) {
    if (!threadSeen.has(m.id) && m.fromUid !== S.user.uid) {
      if (S.tab !== "ayuda") alertUser("Mensaje de soporte", `${first(m.fromName)}: ${m.text}`, "ok");
      else data.set("chats", S.user.uid, { unreadClient: false }).catch(() => {});
    }
    threadSeen.add(m.id);
  }
}

function checkLate() {
  if (S.role !== "mesero" && S.role !== "admin") return;
  const t = now();
  for (const o of S.orders) {
    if (o.status === "espera" && t - o.createdAt >= SLA && !lateAlerted.has(o.id)) {
      lateAlerted.add(o.id);
      alertUser("Pedido retrasado", `Mesa ${o.mesa} lleva más de ${CONFIG.acceptSlaSeconds / 60} min sin ser tomado.`, "late", "bad");
      render();
    }
  }
}

/* ====================== render ====================== */
function render() {
  const act = document.activeElement;
  const keep = {}, files = {};
  $app.querySelectorAll("input[id],textarea[id],select[id]").forEach((el) => (keep[el.id] = el.type === "checkbox" ? el.checked : el.value));
  $app.querySelectorAll("input[type=file][name]").forEach((el) => { if (el.files && el.files.length) files[el.name] = el.files[0]; });
  const fid = act && $app.contains(act) ? act.id : null;
  const ss = act?.selectionStart, se = act?.selectionEnd;
  const ms = document.getElementById("msgs");
  const stick = !ms || ms.scrollHeight - ms.scrollTop - ms.clientHeight < 80;
  const st = ms ? ms.scrollTop : 0;

  $app.innerHTML = view();

  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el) { if (el.type === "checkbox") el.checked = v; else el.value = v; } }
  $app.querySelectorAll("input[type=file][name]").forEach((el) => {
    if (files[el.name]) { try { const dt = new DataTransfer(); dt.items.add(files[el.name]); el.files = dt.files; } catch {} }
  });
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(ss, se); } catch {} } }
  const m2 = document.getElementById("msgs");
  if (m2) m2.scrollTop = stick ? m2.scrollHeight : st;
  updateComboHint();
  tick();
}

function tick() {
  const t = now();
  document.querySelectorAll("[data-since]").forEach((el) => {
    const ms = t - Number(el.dataset.since);
    el.querySelector("b").textContent = fmtDur(ms);
    if (el.dataset.mode === "sla") {
      el.classList.toggle("late", ms >= SLA);
      el.classList.toggle("warn", ms >= SLA * 0.66 && ms < SLA);
    } else if (el.dataset.mode === "eta") {
      const eta = Number(el.dataset.eta);
      el.classList.toggle("late", eta > 0 && ms >= eta);
      el.classList.toggle("warn", eta > 0 && ms >= eta * 0.8 && ms < eta);
    }
  });
  document.querySelectorAll("[data-robot]").forEach((el) => {
    const p = Math.min(1, Math.max(0, (t - Number(el.dataset.robot)) / 20000)); // 20 s de recorrido
    el.style.left = `calc(${p * 100}% - ${p * 2}rem)`;
    const msg = el.parentElement?.nextElementSibling;
    if (msg?.dataset.robotMsg && p >= 1) {
      msg.textContent = "🍽️ ¡El robot llegó a tu mesa! Recoge tu pedido.";
      msg.style.color = "var(--ok)";
    }
  });
}
setInterval(() => { tick(); checkLate(); }, 1000);

function view() {
  if (!S.user) return loginView();
  if (S.gate) return gateView();
  if (S.loading || !S.role) return topbar() + `<div class="center"><div class="spin"></div></div>`;
  if (S.role === "baneado")
    return topbar() + `<main class="wrap"><div class="empty"><h2>Cuenta bloqueada</h2><p class="muted" style="margin-top:8px">El equipo bloqueó esta cuenta. Si crees que es un error, habla con el personal del local.</p></div></main>`;
  const body = { admin: adminView, moderador: modView, mesero: meseroView, cocinero: cocineroView, cliente: clienteView }[S.role]();
  return topbar() + nav() + `<main class="wrap">${verifyBanner()}${guestBanner()}${closedBanner()}${body}</main>` + (S.role === "cliente" ? cartBar() : "");
}

function guestBanner() {
  if (S.role !== "cliente" || !isGuest()) return "";
  return `<div class="alert soft" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><b>Modo invitado</b> · Las personas con cuenta reciben ofertas y descuentos exclusivos por fidelidad (hasta −${CONFIG.loyaltyMax}%).</div>
    <button class="btn sm" data-act="logout">Crear cuenta</button>
  </div>`;
}

function closedBanner() {
  if (isOpen()) return "";
  if (S.role === "cliente") return `<div class="alert"><b>Negocio cerrado.</b> Por ahora no se reciben pedidos nuevos; podrás pedir apenas abramos. Los pedidos que ya hiciste siguen su curso.</div>`;
  if (S.isOwner) return `<div class="alert soft"><b>El negocio está cerrado:</b> los clientes no pueden hacer pedidos nuevos. Usa «Abrir negocio» para habilitarlos.</div>`;
  return "";
}
function verifyBanner() {
  if (!isCloud || !S.user.email || S.user.verified) return "";
  return `<div class="alert soft">Verifica tu correo para activar tu cuenta por completo (los permisos del equipo requieren correo verificado).<br>
    <button class="btn sm ghost" data-act="resend">Reenviar correo</button><button class="btn sm ghost" data-act="recheck">Ya verifiqué</button></div>`;
}

function topbar() {
  const u = S.user;
  const label = S.isOwner ? "Dueño" : ROLE_LABEL[S.role] || "";
  const canNotif = "Notification" in window && Notification.permission === "default";
  return `<header class="top">
    <div class="brand">yaTA!<small>${esc(CONFIG.restaurantName)}</small></div><div class="sp"></div>
    ${S.role && S.role !== "baneado" && !S.isOwner ? `<span class="chip ${isOpen() ? "ok" : "bad"}">${isOpen() ? "Abierto" : "Cerrado"}</span>` : ""}
    ${S.isOwner ? `<button class="btn sm ${isOpen() ? "bad" : "ok"}" data-act="toggleBiz">${isOpen() ? "Cerrar negocio" : "Abrir negocio"}</button>` : ""}
    ${label ? `<span class="badge">${label}</span>` : ""}
    ${canNotif ? `<button class="icon-btn" data-act="notif" title="Activar avisos del sistema">🔔</button>` : ""}
    <div class="avatar" title="${esc(u.email || u.name)}">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc((u.name || "?")[0].toUpperCase())}</div>
    <button class="btn ghost sm" data-act="logout">Salir</button>
  </header>`;
}

function navCount(k) {
  const c = (...st) => S.orders.filter((o) => st.includes(o.status)).length;
  if (S.role === "mesero") return { espera: c("espera"), cocina: c("estimado"), listo: c("listo") }[k] || 0;
  if (S.role === "cocinero") return { cola: c("cocina"), curso: c("estimado", "preparando") }[k] || 0;
  if (S.role === "cliente" && k === "ayuda") return S.myChat?.unreadClient ? 1 : 0;
  if ((S.role === "admin" || S.role === "moderador") && k === "soporte") return S.chats.filter((x) => x.unreadStaff).length;
  return 0;
}
function nav() {
  const items = NAV[S.role];
  if (!items) return "";
  return `<nav class="tabs">${items.map(([k, l]) => { const n = navCount(k); return `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-t="${k}">${l}${n ? `<em class="n">${n}</em>` : ""}</button>`; }).join("")}</nav>`;
}

/* ====================== LOGIN y verificación del dueño ====================== */
function loginView() {
  return `<header class="top"><div class="brand">yaTA!<small>${esc(CONFIG.restaurantName)}</small></div></header>
  <section class="hero">
    <span class="pill">Experiencia gastronómica</span>
    <h1>El placer de un servicio impecable.</h1>
    <p>Pide desde tu mesa, sigue tu orden en cada etapa y disfruta de ofertas y beneficios exclusivos para clientes frecuentes.</p>
    ${isCloud ? `
      <button class="btn big gbtn" data-act="login" style="margin-bottom:12px;width:100%;max-width:420px"><i>G</i> Continuar con Google</button>
      <button class="btn big ghost" data-act="loginGuest" style="margin-bottom:22px;width:100%;max-width:420px">Entrar como invitado</button>` : ""}
    <div class="card" style="max-width:420px;margin:0 auto;text-align:left">
      <form data-form="emailAuth">
        <h3 style="margin-bottom:6px">Acceso con correo</h3>
        <label class="lbl">Correo<input name="email" type="email" required placeholder="tucorreo@gmail.com"></label>
        <label class="lbl">Contraseña<input name="password" type="password" required minlength="6" placeholder="Mínimo 6 caracteres"></label>
        <label class="lbl">Nombre (solo para registrarte)<input name="name" placeholder="Tu nombre"></label>
        <div class="row" style="margin-top:12px">
          <button class="btn full" type="submit" value="login" name="mode">Iniciar sesión</button>
          <button class="btn ghost full" type="submit" value="register" name="mode">Registrarme</button>
        </div>
      </form>
      <button class="btn ghost full sm" type="button" data-act="resetPass" style="margin-top:12px">¿Olvidaste tu contraseña?</button>
    </div>
  </section>`;
}

function gateView() {
  const body = S.gate === "google"
    ? `<h2>Acceso del dueño</h2><p class="muted">Por seguridad, esta cuenta solo puede ingresar con Google. Cierra sesión y vuelve a entrar con el botón «Continuar con Google».</p>
       <button class="btn ghost full" data-act="logout">Cerrar sesión</button>`
    : `<h2>Verificación en dos pasos</h2><p class="muted">Te enviaremos un código de 6 dígitos a ${esc(OWNER)}. Vence en 10 minutos.</p>
       <button class="btn ghost full" data-act="sendCode">Enviar código</button>
       <form data-form="verifyCode" style="margin-top:12px"><label class="lbl">Código<input name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="one-time-code" placeholder="000000"></label><button class="btn full">Verificar</button></form>`;
  return topbar() + `<main class="wrap"><div class="card gate">${body}</div></main>`;
}

/* ====================== CHAT (componentes) ====================== */
function chatBox(msgs, kind, placeholder) {
  const me = S.user.uid;
  const list = [...msgs].sort((a, b) => (a.at || 0) - (b.at || 0));
  const canDel = kind === "team" && S.isOwner; // solo el dueño borra mensajes del equipo
  const sel = new Set([...S.selMsgs].filter((id) => list.some((m) => m.id === id)));
  const bar = canDel && list.length
    ? `<div class="line" style="padding:6px 10px;gap:8px;flex-wrap:wrap"><span class="muted">Toca un mensaje para seleccionarlo</span><span style="display:flex;gap:6px"><button type="button" class="btn sm ghost" data-act="selAllMsgs">${sel.size === list.length ? "Quitar selección" : "Seleccionar todos"}</button><button type="button" class="btn sm bad" data-act="delSelMsgs" ${sel.size ? "" : "disabled"}>🗑️ Eliminar${sel.size ? ` (${sel.size})` : ""}</button></span></div>`
    : "";
  return `<div class="card chat">${bar}<div class="msgs" id="msgs">${list.map((m) => {
    const mine = m.fromUid === me, on = sel.has(m.id);
    const pick = canDel ? ` data-act="selMsg" data-id="${esc(m.id)}" style="cursor:pointer;${on ? "outline:2px solid var(--accent2);outline-offset:2px;" : ""}"` : "";
    return `<div class="msg ${mine ? "me" : "them"}"${pick}><small>${canDel ? (on ? "☑ " : "☐ ") : ""}${mine ? "Tú" : esc(first(m.fromName))}${!mine && m.fromRole ? " · " + esc(ROLE_LABEL[m.fromRole] || "") : ""} · ${hm(m.at || now())}</small><p>${esc(m.text)}</p></div>`;
  }).join("") || `<div class="empty">Aún no hay mensajes.</div>`}</div>
  <form class="chatform" data-form="chat" data-kind="${kind}"><input id="chatInput" name="text" maxlength="500" autocomplete="off" required placeholder="${esc(placeholder)}"><button class="btn">Enviar</button></form></div>`;
}
const teamView = () => `<h2 style="margin-bottom:12px">Chat del equipo</h2>${chatBox(S.team, "team", "Escribe al equipo…")}`;

/* ====================== CLIENTE ====================== */
const cartLines = () =>
  Object.entries(S.cart).map(([id, qty]) => {
    if (id.startsWith("combo:")) {
      const o = activeOffers().find((x) => x.type === "combo" && x.id === id.slice(6));
      if (!o || !comboOk(o)) return null;
      const price = Number(o.offerPrice);
      return { id, name: o.title, price, qty, lineTotal: r2(price * qty), combo: true, includes: comboItems(o).map((it) => ({ id: it.id, name: it.m.name, qty: it.qty })) };
    }
    const m = S.menu.find((x) => x.id === id);
    if (!m) return null;
    const o = offerFor(id);
    let lineTotal = priceOf(m) * qty;
    if (o && o.type === "2x1") {
      const free = Math.floor(qty / 2);
      lineTotal = (qty - free) * m.price; // Lleva 2, paga 1
    }
    return { id, name: m.name, price: priceOf(m), qty, lineTotal: r2(lineTotal) };
  }).filter(Boolean);
function clienteView() {
  return ({ menu: menuView, ofertas: ofertasView, resenas: resenasView, pedidos: misPedidos, ayuda: ayudaView }[S.tab] || menuView)();
}
function menuView() {
  const active = S.orders.find((o) => ACTIVE.includes(o.status));
  const cats = [...new Set(S.menu.map((m) => m.category || "Otros"))];
  const rm = ratingMap();
  const banner = active
    ? `<div class="banner" data-act="tab" data-t="pedidos"><div><b>Pedido #${short(active.id)} · ${ST[active.status]}</b><div class="muted">Toca para ver el seguimiento</div></div></div>`
    : "";
  const promos = activeOffers().filter((o) => o.type === "combo" || o.featured).slice(0, 3);
  const promo = promos.length
    ? `<div class="card" data-act="tab" data-t="ofertas" style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;cursor:pointer;border:1px solid var(--accent2)"><b>🔥 Ofertas de hoy</b>${promos.map((o) => `<span class="chip ok">${esc(o.title)}${o.type === "combo" ? " · " + money(o.offerPrice) : ""}</span>`).join("")}<span class="muted">Ver todas →</span></div>`
    : "";
  const d = discPct();
  const chips = `${S.mesa ? `<span class="chip ok">Mesa ${esc(S.mesa)}</span> ` : ""}${d ? `<span class="chip estimado">Tu descuento −${d}%</span>` : ""}`;
  const dishes = cats.map((c) => `<h2 class="sec">${esc(c)}</h2><div class="grid">${S.menu.filter((m) => (m.category || "Otros") === c).map((m) => dishCard(m, rm)).join("")}</div>`).join("");
  return `${banner}${promo}<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>¿Qué se te antoja?</h2><div>${chips}</div></div>${dishes || `<div class="empty" style="margin-top:16px">El menú aún no tiene platos.</div>`}<div style="height:70px"></div>`;
}
function dishCard(m, rm) {
  const q = S.cart[m.id] || 0;
  const off = m.available === false;
  const ctl = off
    ? `<span class="chip bad">Agotado</span>`
    : !isOpen()
    ? `<span class="chip">Cerrado</span>`
    : q
    ? `<div class="qty"><button data-act="sub" data-id="${esc(m.id)}">−</button><b>${q}</b><button class="p" data-act="add" data-id="${esc(m.id)}">+</button></div>`
    : `<button class="btn sm" data-act="add" data-id="${esc(m.id)}">Agregar</button>`;
  const visual = m.imageUrl ? `<img src="${esc(m.imageUrl)}" alt="${esc(m.name)}" class="dish-img">` : `<div class="emo">${esc(m.emoji || "🍽️")}</div>`;
  const offer = offerFor(m.id);
  let price = money(m.price);
  if (offer) {
    if (offer.type === "2x1") price = `${money(m.price)} <span class="chip ok">2x1</span>`;
    else if (offer.type === "pct") price = `<s>${money(m.price)}</s> ${money(priceOf(m))}`;
    else price = `<s>${money(m.price)}</s> ${money(offer.offerPrice)}`;
  }
  const r = rm[m.id];
  return `<div class="dish ${off ? "off" : ""}">${visual}<div class="dn">${esc(m.name)}</div><div class="dp">${price}</div>${r ? `<div class="rt"><span class="stars">★</span> ${(r.s / r.n).toFixed(1)} (${r.n})</div>` : ""}${ctl}</div>`;
}
function addCtl(key, ok) {
  const q = S.cart[key] || 0;
  if (!ok) return `<span class="chip bad">Agotado</span>`;
  if (!isOpen()) return `<span class="chip">Cerrado</span>`;
  return q
    ? `<div class="qty"><button data-act="sub" data-id="${esc(key)}">−</button><b>${q}</b><button class="p" data-act="add" data-id="${esc(key)}">+</button></div>`
    : `<button class="btn sm" data-act="add" data-id="${esc(key)}">Agregar</button>`;
}
function offerCard(o) {
  const acc = "color:var(--accent2)";
  let body = "";
  if (o.type === "combo") {
    const its = comboItems(o), normal = comboNormal(o), save = comboSave(o);
    body = `<ul class="items">${its.map((it) => `<li><b>${it.qty}×</b> ${esc(it.m.emoji || "")} ${esc(it.m.name)}</li>`).join("")}</ul>
      <div class="line"><span>${save > 0 ? `<s>${money(normal)}</s> ` : ""}<b style="font-size:1.25rem;${acc}">${money(o.offerPrice)}</b>${save > 0 ? ` <span class="chip ok">Ahorras ${money(save)}</span>` : ""}</span>${addCtl("combo:" + o.id, comboOk(o))}</div>`;
  } else {
    const m = o.menuId ? S.menu.find((x) => x.id === o.menuId) : null;
    if (m) {
      let price;
      if (o.type === "2x1") price = `<b style="font-size:1.1rem;${acc}">2x1</b> · ${money(m.price)} c/u · ${esc(m.name)}`;
      else {
        const p = offerUnit(o, m);
        price = `<s>${money(m.price)}</s> <b style="font-size:1.25rem;${acc}">${money(p)}</b> <span class="chip ok">Ahorras ${money(Math.max(0, m.price - p))}</span> · ${esc(m.name)}`;
      }
      body = `<div class="line"><span>${price}</span>${addCtl(m.id, m.available !== false)}</div>`;
    }
  }
  const ends = o.endsAt ? `<p class="muted" style="font-size:.8rem">⏳ ${offerEnds(o)}</p>` : "";
  const tag = o.badge || o.featured ? `<span class="tag">${o.featured ? "🔥 " : ""}${esc(o.badge || "Destacada")}</span>` : "";
  return `<article class="card offer"${o.featured ? ' style="border:1px solid var(--accent2)"' : ""}>${o.imageUrl ? `<img src="${esc(o.imageUrl)}" alt="${esc(o.title)}">` : ""}<div class="ob">
    ${tag}<h3>${esc(o.title)}</h3>${o.description ? `<p class="muted">${esc(o.description)}</p>` : ""}${body}${ends}</div></article>`;
}
function ofertasView() {
  const list = [...activeOffers()].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  if (!list.length) return `<h2>Ofertas</h2><div class="empty" style="margin-top:12px">Por ahora no hay ofertas activas. ¡Vuelve pronto!</div>`;
  return `<h2 style="margin-bottom:12px">Ofertas</h2><div class="offers">${list.map(offerCard).join("")}</div><div style="height:70px"></div>`;
}
const reviewCard = (r, del) => `<article class="review"><div class="rvh"><span class="stars">${stars(r.rating)}</span><span class="muted">${esc(first(r.customerName) || "Cliente")}${r.at ? " · " + dmy(r.at) : ""}</span></div>
  ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${r.photoUrl ? `<img class="rvimg" src="${esc(r.photoUrl)}" alt="Foto del pedido" loading="lazy">` : ""}
  <p class="muted">Pidió: ${(r.items || []).map((i) => esc(i.name)).join(", ")}</p>
  ${del ? `<div><button class="btn sm bad" data-act="delReview" data-id="${esc(r.id)}">Eliminar</button></div>` : ""}</article>`;
function reviewFilter() {
  return `<select id="rvFilter" data-change="rvFilter" style="max-width:280px"><option value="">Todos los platos</option>${[...S.menu].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${esc(m.id)}" ${S.rvFilter === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`;
}
const filteredReviews = () =>
  S.reviews.filter((r) => !S.rvFilter || (r.items || []).some((i) => i.id === S.rvFilter)).sort((a, b) => (b.at || 0) - (a.at || 0));
function resenasView() {
  const rs = filteredReviews();
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><h2>Lo que dicen otros clientes</h2>${reviewFilter()}</div>
  <div class="card">${rs.map((r) => reviewCard(r, false)).join("") || `<span class="muted">Aún no hay reseñas para este filtro.</span>`}</div>`;
}
function ayudaView() {
  return `<h2>Ayuda</h2><p class="muted" style="margin:4px 0 12px">¿Tuviste algún problema con tu pedido? Escríbenos y un moderador te responderá.</p>${chatBox(S.thread, "support", "Escribe tu mensaje…")}`;
}
function cartBar() {
  if ((S.tab !== "menu" && S.tab !== "ofertas") || !isOpen()) return "";
  const lines = cartLines();
  if (!lines.length) return "";
  const n = lines.reduce((s, l) => s + l.qty, 0), total = lines.reduce((s, l) => s + l.lineTotal, 0);
  return `<div class="cartbar" style="display:flex;gap:8px;align-items:stretch"><button class="btn" data-act="openCart" style="flex:1"><span>Ver pedido (${n})</span><span>${money(total)}</span></button><button class="btn bad" data-act="clearCart" title="Vaciar pedido" aria-label="Vaciar pedido" style="flex:0 0 auto;padding:0 16px">🗑️</button></div>`;
}
function loyaltyCard() {
  if (!S.user.email || isGuest()) return `<div class="card loyal"><b>Acumula descuentos por fidelidad</b><p class="muted">Crea tu cuenta con correo o Google: cada pedido entregado suma para obtener ofertas y descuentos exclusivos de hasta −${CONFIG.loyaltyMax}%.</p><button class="btn sm" style="justify-self:start" data-act="logout">Crear cuenta / Iniciar sesión</button></div>`;
  const n = deliveredCount(S.orders), sug = suggestedPct(n), ap = Number(S.myLoyalty?.discount || 0);
  const maxed = sug >= CONFIG.loyaltyMax;
  const need = (sug / CONFIG.loyaltyStep + 1) * CONFIG.loyaltyEvery - n;
  const prog = maxed ? 100 : Math.round(((n % CONFIG.loyaltyEvery) / CONFIG.loyaltyEvery) * 100);
  return `<div class="card loyal"><span class="muted">Cliente frecuente · ${n} pedido(s) entregado(s)</span>
    <b>${ap ? `Tu descuento: −${ap}%` : "Aún sin descuento activo"}</b>
    <div class="prog"><span style="width:${prog}%"></span></div>
    <p class="muted">${maxed ? "¡Alcanzaste el máximo de beneficios!" : `Te faltan ${need} pedido(s) para −${sug + CONFIG.loyaltyStep}%.`}${sug > ap ? ` Tienes −${sug}% por confirmar: el equipo lo activará pronto.` : ""}</p></div>`;
}
function misPedidos() {
  const list = [...S.orders].sort((a, b) => b.createdAt - a.createdAt);
  const head = loyaltyCard();
  if (!list.length) return `${head}<div class="empty">Aún no has hecho pedidos.<br><button class="btn" style="margin-top:12px" data-act="tab" data-t="menu">Ver menú</button></div>`;
  return `${head}<h2 style="margin-bottom:12px">Mis pedidos</h2><div class="stack">${list.map(myOrderCard).join("")}</div>`;
}
function myOrderCard(o) {
  const active = ACTIVE.includes(o.status);
  const idx = { espera: 0, cocina: 1, estimado: 1, preparando: 2, listo: 3 }[o.status];
  const steps = ["Enviado", "En cocina", "Preparando", "Listo"];
  const canReview = ["listo", "entregado"].includes(o.status) && !o.review;
  return `<article class="card order">
    <div class="oh"><b>Pedido #${short(o.id)}</b><span class="chip ${o.status}">${ST[o.status]}</span></div>
    ${active ? `<div class="steps">${steps.map((s, i) => `<div class="step ${i < idx ? "done" : i === idx ? "cur" : ""}"><i>${i < idx ? "✓" : i + 1}</i>${s}</div>`).join("")}</div>
    <p class="muted">Tiempo transcurrido · <span class="timer" data-since="${o.createdAt}"><b>0:00</b></span></p>` : ""}
    ${o.etaMin && ["estimado", "preparando"].includes(o.status) ? `<p class="muted">Tiempo estimado de cocina: ~${o.etaMin} min</p>` : ""}
    ${wName(o) && active ? `<p class="muted">Te atiende ${esc(first(wName(o)))}</p>` : ""}
    ${o.status === "listo" && o.robotAt ? `<div class="robot"><span data-robot="${o.robotAt}">🤖</span><i>🍽️</i></div><p class="muted" data-robot-msg="${o.robotAt}">¡Un robot lleva tu pedido a la mesa ${esc(o.mesa)}!</p>` : ""}
    <ul class="items">${o.items.map((i) => `<li>${i.qty}× ${esc(i.name)}${incl(i)}</li>`).join("")}</ul>
    ${o.discount ? `<div class="line dsc"><span>Descuento −${o.discount}%</span><span>−${money(r2((o.subtotal || o.total) - o.total))}</span></div>` : ""}
    <div class="line tot"><span>Mesa ${esc(o.mesa)}</span><b>${money(o.total)}</b></div>
    ${o.review ? `<p class="stars">${stars(o.review.rating)} <span class="muted">${esc(o.review.comment || "")}</span></p>` : ""}
    <div class="acts">
      ${o.status === "espera" ? `<button class="btn ghost sm" data-act="cancelOrder" data-id="${esc(o.id)}">Cancelar pedido</button>` : ""}
      ${canReview ? `<button class="btn sm" data-act="openReview" data-id="${esc(o.id)}">Dejar reseña</button>` : ""}
    </div>
  </article>`;
}
function openCart() {
  if (!isOpen()) return toast("El negocio está cerrado", "bad");
  const lines = cartLines();
  if (!lines.length) return;
  const sub = lines.reduce((s, l) => s + l.lineTotal, 0);
  const d = discPct(), total = r2(sub * (1 - d / 100));
  $modal.innerHTML = `<div class="backdrop" data-act="backdrop"><form class="sheet" data-form="placeOrder">
    <h2>Tu pedido</h2>
    ${lines.map((l) => `<div class="line"><span>${l.qty}× ${esc(l.name)} ${l.combo ? '<span class="chip ok" style="font-size:0.6rem">Combo</span>' : offerFor(l.id)?.type === '2x1' ? '<span class="chip ok" style="font-size:0.6rem">2x1</span>' : ''}${incl(l)}</span><span style="display:flex;align-items:center;gap:8px"><b>${money(l.lineTotal)}</b><button type="button" class="icon-btn" data-act="removeLine" data-id="${esc(l.id)}" title="Quitar del pedido" aria-label="Quitar ${esc(l.name)} del pedido">🗑️</button></span></div>`).join("")}
    ${d ? `<div class="line"><span>Subtotal</span><span>${money(sub)}</span></div><div class="line dsc"><span>Descuento de cliente frecuente −${d}%</span><span>−${money(r2(sub - total))}</span></div>` : ""}
    <div class="line tot"><span>Total</span><b>${money(total)}</b></div>
    <label class="lbl">Número de mesa<input name="mesa" required maxlength="6" inputmode="numeric" value="${esc(S.mesa)}" placeholder="Ej. 5"></label>
    <label class="lbl">Nota (opcional)<textarea name="note" maxlength="140" rows="2" placeholder="Sin ají, sin hielo…"></textarea></label>
    <div class="row"><button type="button" class="btn ghost" data-act="closeModal">Seguir pidiendo</button><button class="btn">Confirmar pedido</button></div>
  </form></div>`;
}
function openReview(id) {
  S.rv = { id, n: 0 };
  $modal.innerHTML = `<div class="backdrop" data-act="backdrop"><form class="sheet" data-form="review">
    <h2>¿Cómo estuvo tu pedido?</h2>
    <div class="starpick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-act="star" data-n="${n}">★</button>`).join("")}</div>
    <label class="lbl">Comentario (opcional)<textarea name="comment" maxlength="200" rows="3" placeholder="Cuéntanos qué tal la atención y la comida"></textarea></label>
    <label class="lbl">Foto de tu plato (opcional)<input name="photo" type="file" accept="image/*"></label>
    <p class="muted">Tu reseña y tu foto serán visibles para otros clientes.</p>
    <div class="row" style="margin-top:12px"><button type="button" class="btn ghost" data-act="closeModal">Ahora no</button><button class="btn">Enviar reseña</button></div>
  </form></div>`;
}
function openEta(id) {
  S.etaFor = id;
  const o = S.orders.find((x) => x.id === id);
  $modal.innerHTML = `<div class="backdrop" data-act="backdrop"><form class="sheet" data-form="eta">
    <h2>Tiempo estimado</h2><p class="muted">Mesa ${esc(o?.mesa || "")} · ${o ? o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(", ") : ""}</p>
    <div class="etachips">${[5, 10, 15, 20, 30].map((n) => `<button type="button" class="btn ghost sm" data-act="etaPick" data-n="${n}">${n} min</button>`).join("")}</div>
    <label class="lbl">Minutos<input id="etaInput" name="eta" type="number" min="1" max="120" required placeholder="Ej. 12"></label>
    <div class="row"><button type="button" class="btn ghost" data-act="closeModal">Cancelar</button><button class="btn">Tomar pedido</button></div>
  </form></div>`;
}
function closeModal() { $modal.innerHTML = ""; S.rv = null; S.etaFor = null; }

/* ====================== MESERO ====================== */
const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
function meseroView() {
  if (S.tab === "team") return teamView();
  const t0 = startOfDay();
  const mine = stats(S.orders.filter((o) => wUid(o) === S.user.uid && o.createdAt >= t0));
  const late = S.orders.filter((o) => o.status === "espera" && now() - o.createdAt >= SLA).length;
  const cols = [
    ["espera", "Nuevos pedidos", ["espera"]],
    ["cocina", "En cocina", IN_KITCHEN],
    ["listo", "Por entregar", ["listo"]],
  ];
  return `${late ? `<div class="alert">${late} pedido(s) superan los ${CONFIG.acceptSlaSeconds / 60} min sin ser tomados</div>` : ""}
  <div class="me">
    <div class="kpi"><span>Tus pedidos hoy</span><b>${mine.taken}</b></div>
    <div class="kpi"><span>Resp. promedio</span><b>${dash(mine.avgWait, fmtDur)}</b></div>
    <div class="kpi ${mine.slaPct != null && mine.slaPct < 80 ? "bad" : "hl"}"><span>En meta</span><b>${dash(mine.slaPct, (v) => v + "%")}</b></div>
  </div>
  <div class="cols">${cols.map(([k, title, sts]) => {
    const rows = S.orders.filter((o) => sts.includes(o.status)).sort(byCreated);
    return `<section class="col ${S.tab === k ? "active" : ""}"><h3>${title}<span class="chip">${rows.length}</span></h3><div class="stack">${rows.map((o) => waiterCard(o)).join("") || `<div class="empty">Sin pedidos</div>`}</div></section>`;
  }).join("")}</div>`;
}
function waiterCard(o) {
  const queue = S.orders.filter((x) => x.status === "cocina").sort(byCreated);
  const pos = queue.findIndex((x) => x.id === o.id) + 1;
  const since = o.status === "espera" ? o.createdAt : o.status === "listo" ? o.readyAt : o.cookAt || o.acceptedAt || o.createdAt;
  const timerMode = o.status === "espera" ? `data-mode="sla"` : o.status === "preparando" || o.status === "estimado" ? `data-mode="eta" data-eta="${(o.etaMin || 0) * 60000}"` : "";
  const act = {
    espera: `<button class="btn" data-act="send" data-id="${esc(o.id)}">Enviar a cocina</button>`,
    cocina: `<span class="muted">En cola de cocina${pos ? ` · posición ${pos}` : ""}</span>`,
    estimado: `<span class="muted">Cocina estima ~${o.etaMin} min${o.cookName ? ` (${esc(first(o.cookName))})` : ""}</span><button class="btn" data-act="markPreparing" data-id="${esc(o.id)}">Marcar: preparando pedido</button>`,
    preparando: `<span class="muted">Preparando · estimado ~${o.etaMin || "?"} min</span>`,
    listo: o.robotAt
      ? `<span class="muted">🤖 Robot en camino a Mesa ${esc(o.mesa)}</span><button class="btn ok" data-act="delivered" data-id="${esc(o.id)}">Marcar entregado</button>`
      : `<button class="btn" data-act="sendRobot" data-id="${esc(o.id)}">🤖 Enviar robot</button><button class="btn ok" data-act="delivered" data-id="${esc(o.id)}">Entregar yo</button>`,
  }[o.status];
  return `<article class="card order ${o.status === "listo" ? "deliver" : ""}">
    <div class="oh"><b>${o.status === "listo" ? `<span class="mesa">Llevar a Mesa ${esc(o.mesa)}</span>` : `Mesa ${esc(o.mesa)}`} <span class="muted">· #${short(o.id)}</span></b>
      ${since ? `<span class="timer" data-since="${since}" ${timerMode}><b>0:00</b></span>` : ""}</div>
    ${o.status !== "espera" ? `<div><span class="chip ${o.status}">${ST[o.status].replace("tu pedido", "el pedido").replace("Tu pedido", "Pedido")}</span></div>` : ""}
    <div class="muted" style="margin-top:6px">${esc(first(o.customerName))}</div>
    <ul class="items">${o.items.map((i) => `<li><b>${i.qty}×</b> ${esc(i.name)}${incl(i)}</li>`).join("")}</ul>
    ${o.note ? `<div class="note">Nota: ${esc(o.note)}</div>` : ""}
    <div class="acts">${act}</div>
  </article>`;
}

/* ====================== COCINERO ====================== */
function cocineroView() {
  if (S.tab === "team") return teamView();
  const t0 = startOfDay();
  const done = S.orders.filter((o) => o.cookUid === S.user.uid && o.readyAt && o.readyAt >= t0);
  const st = stats(done);
  const cola = S.orders.filter((o) => o.status === "cocina").sort(byCreated);
  const curso = S.orders.filter((o) => ["estimado", "preparando"].includes(o.status)).sort((a, b) => (a.cookAt || 0) - (b.cookAt || 0));
  const cols = [["cola", "Cola de cocina", cola], ["curso", "En preparación", curso]];
  return `<div class="me">
    <div class="kpi"><span>Listos hoy</span><b>${done.length}</b></div>
    <div class="kpi"><span>Prep. promedio</span><b>${dash(st.avgPrep, fmtDur)}</b></div>
    <div class="kpi hl"><span>En cola</span><b>${cola.length}</b></div>
  </div>
  <div class="cols" style="--cols:2">${cols.map(([k, title, rows]) =>
    `<section class="col ${S.tab === k ? "active" : ""}"><h3>${title}<span class="chip">${rows.length}</span></h3><div class="stack">${rows.map((o, i) => cookCard(o, i)).join("") || `<div class="empty">Sin pedidos</div>`}</div></section>`).join("")}</div>`;
}
function cookCard(o, i) {
  let head = "", act = "";
  if (o.status === "cocina") {
    head = i === 0 ? `<span class="chip ok">Prioridad 1</span>` : `<span class="chip">#${i + 1} en cola</span>`;
    act = i === 0 ? `<button class="btn" data-act="openEta" data-id="${esc(o.id)}">Tomar y dar tiempo estimado</button>` : `<span class="muted">Espera tu turno (primero el que pidió antes)</span>`;
  } else if (o.status === "estimado") {
    head = `<span class="chip estimado">Estimado ~${o.etaMin} min</span>`;
    act = `<span class="muted">Esperando que el mesero lo marque como preparando</span><button class="btn ok" data-act="ready" data-id="${esc(o.id)}">Marcar listo</button>`;
  } else {
    head = `<span class="chip preparando">Preparando · ~${o.etaMin} min</span>`;
    act = `<button class="btn ok" data-act="ready" data-id="${esc(o.id)}">Marcar listo para entregar</button>`;
  }
  const timer = o.cookAt
    ? `<span class="timer" data-since="${o.cookAt}" data-mode="eta" data-eta="${(o.etaMin || 0) * 60000}"><b>0:00</b></span>`
    : `<span class="timer" data-since="${o.createdAt}"><b>0:00</b></span>`;
  return `<article class="card order">
    <div class="oh"><b>Mesa ${esc(o.mesa)} <span class="muted">· #${short(o.id)}</span></b>${timer}</div>
    <div>${head}</div>
    <ul class="items">${o.items.map((it) => `<li><b>${it.qty}×</b> ${esc(it.name)}${incl(it)}</li>`).join("")}</ul>
    ${o.note ? `<div class="note">Nota: ${esc(o.note)}</div>` : ""}
    <div class="acts">${act}</div>
  </article>`;
}

/* ====================== MODERADOR ====================== */
function modView() {
  return ({ clientes: clientesView, soporte: soporteView, ofertas: ofertasAdmin, resenas: resenasAdmin, team: teamView }[S.tab] || clientesView)();
}
function soporteView() {
  if (S.chatWith) {
    const c = S.chats.find((x) => x.id === S.chatWith);
    return `<button class="btn ghost sm" data-act="closeThread">← Conversaciones</button>
    <div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0 2px">
      <div><h2>${esc(c?.customerName || "Cliente")}</h2><p class="muted" style="margin:0">${esc(c?.customerEmail || "")}</p></div>
      <button class="btn sm bad" data-act="deleteChat" data-uid="${esc(S.chatWith)}">Borrar Chat</button>
    </div>
    ${chatBox(S.thread, "support", "Responder al cliente…")}`;
  }
  const list = S.chats.filter(c => !c.archived).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  return `<h2>Soporte</h2><p class="muted" style="margin:4px 0 12px">Conversaciones con clientes.</p>
  <div class="card">${list.map((c) => `<div class="item"><div><b>${c.unreadStaff ? `<span class="dot"></span>` : ""}${esc(c.customerName || "Cliente")}</b><div class="muted">${esc(c.lastText || "")} · ${c.lastAt ? hm(c.lastAt) : ""}</div></div>
    <div class="acts">
      <button class="btn sm" data-act="openThread" data-uid="${esc(c.id)}">Abrir</button>
      <button class="btn sm ghost" data-act="archiveChat" data-uid="${esc(c.id)}" title="Cerrar y archivar">Archivar</button>
      <button class="btn sm bad" data-act="deleteChat" data-uid="${esc(c.id)}" title="Eliminar">🗑️</button>
    </div></div>`).join("") || `<span class="muted">Aún no hay conversaciones.</span>`}</div>`;
}
function clientesView() {
  const map = {};
  S.orders.filter((o) => !o.demo && o.customerEmail && o.customerEmail !== "Invitado").forEach((o) => {
    const c = (map[o.customerUid] ??= { uid: o.customerUid, email: o.customerEmail, name: o.customerName, done: 0, total: 0 });
    if (o.status === "entregado") { c.done++; c.total += o.total || 0; }
  });
  const ld = Object.fromEntries(S.loyaltyAll.map((l) => [l.id, l]));
  const bannedSet = new Set(S.banned.map((b) => b.id));
  const list = Object.values(map).filter((c) => !bannedSet.has(c.email)).sort((a, b) => b.done - a.done);
  const opts = (cur) => Array.from({ length: CONFIG.loyaltyMax / CONFIG.loyaltyStep + 1 }, (_, i) => i * CONFIG.loyaltyStep)
    .map((p) => `<option value="${p}" ${p === cur ? "selected" : ""}>${p ? "−" + p + "%" : "Sin descuento"}</option>`).join("");
  return `<h2>Clientes y fidelidad</h2>
  <p class="muted" style="margin:4px 0 12px">Cada ${CONFIG.loyaltyEvery} pedidos entregados sugiere −${CONFIG.loyaltyStep}% (máximo −${CONFIG.loyaltyMax}%). Tú confirmas el descuento de cada cliente.</p>
  <div class="card">${list.map((c) => {
    const cur = Number(ld[c.uid]?.discount || 0), sug = suggestedPct(c.done);
    return `<div class="item"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.email)} · ${c.done} entregado(s) · ${money(c.total)}</div><div style="margin-top:4px"><span class="chip ${sug > cur ? "estimado" : ""}">Sugerido −${sug}%</span></div></div>
      <div class="acts"><select data-change="loyalty" data-uid="${esc(c.uid)}" data-email="${esc(c.email)}" data-name="${esc(c.name)}">${opts(cur)}</select>
      ${sug !== cur ? `<button class="btn sm ghost" data-act="applyLoyalty" data-uid="${esc(c.uid)}" data-email="${esc(c.email)}" data-name="${esc(c.name)}" data-pct="${sug}">Aplicar −${sug}%</button>` : ""}
      <button class="btn sm bad" data-act="ban" data-email="${esc(c.email)}">Banear</button></div></div>`;
  }).join("") || `<span class="muted">Aún no hay clientes con cuenta.</span>`}</div>
  <h2 class="sec">Bloquear por correo</h2>
  <form class="card form" data-form="banEmail"><input id="bnEmail" name="email" type="email" required placeholder="correo@ejemplo.com"><span></span><button class="btn bad">Banear</button></form>
  ${S.banned.length ? `<h2 class="sec">Baneados</h2><div class="card">${S.banned.map((b) => `<div class="item"><div><b>${esc(b.id)}</b><div class="muted">${esc(b.reason || "Sin motivo")}</div></div><button class="btn sm ghost" data-act="unban" data-email="${esc(b.id)}">Desbanear</button></div>`).join("")}</div>` : ""}`;
}
function ofertasAdmin() {
  const items = [...S.offers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const t = S.ofType || "combo";
  const menu = [...S.menu].sort((a, b) => a.name.localeCompare(b.name));
  const types = [["combo", "Combo (varios platos por un solo precio)"], ["fixed", "Un plato con precio especial"], ["2x1", "2x1 en un plato (lleva 2, paga 1)"], ["pct", "Descuento % en un plato"]];
  const dishSel = `<select id="ofMenu" name="menuId" required><option value="">Elige un plato...</option>${menu.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${money(m.price)})</option>`).join("")}</select>`;
  const fields = t === "combo"
    ? `<div class="card" style="padding:12px;display:grid;gap:8px"><b>Arma tu combo</b><span class="muted">Pon cuántas unidades de cada plato incluye (0 = no incluido).</span>
        ${menu.map((m) => `<div class="line"><span>${esc(m.emoji || "")} ${esc(m.name)} <span class="muted">· ${money(m.price)}</span></span><input class="cbq" id="cb_${esc(m.id)}" name="cq_${esc(m.id)}" data-mid="${esc(m.id)}" type="number" min="0" max="9" step="1" value="0" style="width:72px"></div>`).join("") || `<span class="muted">Primero agrega platos al menú.</span>`}
        <input id="ofPrice" name="offerPrice" type="number" step="0.1" min="0.1" required placeholder="Precio del combo (S/)">
        <span class="muted" id="comboHint">Elige las cantidades de cada plato del combo.</span></div>`
    : `${dishSel}${t === "fixed" ? `<input id="ofPrice" name="offerPrice" type="number" step="0.1" min="0" required placeholder="Precio especial (S/)">`
      : t === "pct" ? `<input id="ofPct" name="discountPct" type="number" step="1" min="1" max="99" required placeholder="% de descuento">`
      : `<p class="muted">El cliente lleva 2 unidades y paga 1 (se aplica en el carrito).</p>`}`;
  return `<h2>Ofertas</h2>
  <form class="card" style="margin:12px 0;display:grid;gap:8px" data-form="addOffer">
    <input id="ofTitle" name="title" required maxlength="50" placeholder="Título (ej. Combo Familiar: Chicha + Chuleta + Torta)">
    <textarea id="ofDesc" name="description" rows="2" maxlength="160" placeholder="Descripción (ej. Ideal para compartir en familia)"></textarea>
    <select id="ofType" name="type" data-change="ofType">${types.map(([v, l]) => `<option value="${v}" ${t === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    ${fields}
    <div class="row">
      <input id="ofBadge" name="badge" maxlength="20" placeholder="Etiqueta (ej. ¡Súper ahorro!)">
      <label class="lbl" style="margin:0">Válida hasta (opcional)<input id="ofEnds" name="endsAt" type="date"></label>
    </div>
    <label style="display:flex;gap:8px;align-items:center"><input id="ofFeat" name="featured" type="checkbox" style="width:auto"> 🔥 Destacar (sale primero y en la portada del menú)</label>
    <label class="lbl" style="margin:0">Imagen (opcional)<input name="image" type="file" accept="image/*"></label>
    <button class="btn">Publicar oferta</button></form>
  <div class="card">${items.map((o) => {
    const m = S.menu.find((x) => x.id === o.menuId);
    const expired = o.endsAt && o.endsAt < now();
    let what;
    if (o.type === "combo") what = `Combo: ${comboItems(o).map((it) => `${it.qty}× ${esc(it.m.name)}`).join(" + ") || "platos eliminados"} → ${money(o.offerPrice)}`;
    else what = m ? `${esc(m.name)} (${o.type === "2x1" ? "2x1" : o.type === "pct" ? `-${o.discountPct}%` : money(o.offerPrice)})` : "Promoción";
    const state = expired ? "Vencida" : o.active === false ? "Pausada" : "Activa";
    return `<div class="item"><div style="display:flex;align-items:center;gap:12px">
    ${o.imageUrl ? `<img src="${esc(o.imageUrl)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px" alt="">` : ""}
    <div><b>${o.featured ? "🔥 " : ""}${esc(o.title)}</b> ${o.badge ? `<span class="chip estimado">${esc(o.badge)}</span>` : ""}
    <div class="muted">${what} · ${state}${o.endsAt ? " · " + offerEnds(o) : ""}</div></div></div>
    <div class="acts"><button class="btn sm ghost" data-act="toggleFeatured" data-id="${esc(o.id)}">${o.featured ? "Quitar destacado" : "Destacar"}</button><button class="btn sm ghost" data-act="toggleOffer" data-id="${esc(o.id)}">${o.active === false ? "Activar" : "Pausar"}</button><button class="btn sm bad" data-act="delOffer" data-id="${esc(o.id)}">Eliminar</button></div></div>`;
  }).join("") || `<span class="muted">Sin ofertas</span>`}</div>`;
}
function updateComboHint() {
  const el = document.getElementById("comboHint");
  if (!el) return;
  let normal = 0, units = 0;
  $app.querySelectorAll("input.cbq").forEach((i) => {
    const q = Math.max(0, Math.floor(Number(i.value) || 0));
    const m = S.menu.find((x) => x.id === i.dataset.mid);
    if (m && q) { normal += m.price * q; units += q; }
  });
  const price = Number(document.getElementById("ofPrice")?.value || 0);
  if (!units) { el.textContent = "Elige las cantidades de cada plato del combo."; return; }
  let txt = "Valor normal: " + money(normal);
  if (price > 0) txt += price < normal ? ` · Ahorro del cliente: ${money(normal - price)} (${Math.round((1 - price / normal) * 100)}%)` : " · El precio del combo debe ser menor al valor normal";
  el.textContent = txt;
}
function resenasAdmin() {
  const rs = filteredReviews();
  const a = avg(S.reviews.map((r) => r.rating));
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>Reseñas de clientes</h2>${reviewFilter()}</div>
  <p class="muted" style="margin:4px 0 12px">${S.reviews.length ? `Promedio ${a.toFixed(1)} ★ · ${S.reviews.length} reseñas` : "Aún no hay reseñas."} Puedes eliminar contenido inapropiado.</p>
  <div class="card">${rs.map((r) => reviewCard(r, true)).join("") || `<span class="muted">—</span>`}</div>`;
}

/* ====================== ADMIN ====================== */
function adminView() {
  return ({ resumen: adminResumen, historial: adminHistorial, equipo: adminEquipo, menu: adminMenu, ofertas: ofertasAdmin, resenas: resenasAdmin, clientes: clientesView, soporte: soporteView, team: teamView }[S.tab] || adminResumen)();
}
function adminResumen() {
  const t = now(), t0 = startOfDay();
  const today = S.orders.filter((o) => o.createdAt >= t0 && o.status !== "cancelado");
  const st = stats(today);
  const waiting = S.orders.filter((o) => o.status === "espera");
  const late = waiting.filter((o) => t - o.createdAt >= SLA);
  const inKitchen = S.orders.filter((o) => IN_KITCHEN.includes(o.status)).length;
  const red = st.avgWait != null ? Math.round((1 - st.avgWait / (CONFIG.baselineWaitMin * 60000)) * 100) : null;
  const emailOf = (uid) => S.users.find((u) => u.id === uid)?.email || "—";

  const gW = {};
  today.filter((o) => wUid(o) && o.acceptedAt).forEach((o) => (gW[wUid(o)] ??= []).push(o));
  const wRows = Object.entries(gW).map(([uid, os]) => ({ name: wName(os[0]), email: emailOf(uid), st: stats(os) }));
  const activeUids = new Set(Object.keys(gW));
  S.staff.filter((s) => normRole(s.role) === "mesero" && s.active).forEach((s) => {
    const u = S.users.find((x) => x.email === s.id);
    if (!u || !activeUids.has(u.id)) wRows.push({ name: first(u?.name) || s.id.split("@")[0], email: s.id, st: stats([]) });
  });

  const gC = {};
  today.filter((o) => o.cookUid && o.readyAt && o.cookAt).forEach((o) => (gC[o.cookUid] ??= []).push(o));
  const cRows = Object.entries(gC).map(([uid, os]) => {
    const withEta = os.filter((o) => o.etaMin);
    return {
      name: os[0].cookName, email: emailOf(uid), n: os.length, prep: avg(os.map((o) => o.readyAt - o.cookAt)),
      acc: withEta.length ? Math.round((withEta.filter((o) => o.readyAt - o.cookAt <= o.etaMin * 60000 * 1.1).length / withEta.length) * 100) : null,
    };
  });

  const recent = today.filter((o) => o.acceptedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12).reverse();
  const hasDemo = S.orders.some((o) => o.demo);

  return `${late.length ? `<div class="alert">${late.length} pedido(s) retrasados sin mesero · revisa que haya personal atendiendo</div>` : ""}
  <div class="kpis">
    <div class="kpi hl"><span>Respuesta promedio (hoy)</span><b>${dash(st.avgWait, fmtDur)}</b><small>meta ${fmtDur(SLA)}</small></div>
    <div class="kpi ${st.slaPct != null && st.slaPct < 80 ? "bad" : ""}"><span>Tomados en meta</span><b>${dash(st.slaPct, (v) => v + "%")}</b><small>${st.taken} tomados</small></div>
    <div class="kpi"><span>Pedidos hoy</span><b>${st.count}</b><small>${waiting.length} en espera · ${inKitchen} en cocina</small></div>
    <div class="kpi"><span>Calificación</span><b>${dash(st.avgRating, (v) => v.toFixed(1) + " ★")}</b><small>${st.nRatings} reseñas</small></div>
  </div>
  ${red != null ? `<p class="muted" style="margin:10px 2px">Espera promedio <b>${red >= 0 ? red + "% menor" : Math.abs(red) + "% mayor"}</b> que la referencia sin sistema (${CONFIG.baselineWaitMin} min).</p>` : ""}
  <div class="two" style="margin-top:14px">
    <div><h2 class="sec">Meseros (hoy)</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Mesero</th><th>Pedidos</th><th>Resp.</th><th>En meta</th><th>★</th></tr></thead><tbody>
      ${wRows.map((r) => `<tr><td><b>${esc(first(r.name))}</b><div class="muted">${esc(r.email)}</div></td><td>${r.st.taken}</td><td>${dash(r.st.avgWait, fmtDur)}</td><td>${dash(r.st.slaPct, (v) => v + "%")}</td><td>${dash(r.st.avgRating, (v) => v.toFixed(1))}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Aún sin actividad</td></tr>`}
    </tbody></table></div>
    <h2 class="sec">Cocina (hoy)</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Cocinero</th><th>Pedidos</th><th>Prep.</th><th>Cumple estimado</th></tr></thead><tbody>
      ${cRows.map((r) => `<tr><td><b>${esc(first(r.name))}</b><div class="muted">${esc(r.email)}</div></td><td>${r.n}</td><td>${dash(r.prep, fmtDur)}</td><td>${dash(r.acc, (v) => v + "%")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Aún sin actividad</td></tr>`}
    </tbody></table></div></div>
    <div><h2 class="sec">Tiempo hasta ser tomado (últimos ${recent.length || 12})</h2><div class="card"><div class="bars">
      ${recent.map((o) => { const w = o.acceptedAt - o.createdAt; return `<div class="barrow"><span>Mesa ${esc(o.mesa)}</span><div class="bar"><span class="${w <= SLA ? "ok" : "bad"}" style="width:${Math.min(100, Math.round((w / (SLA * 2)) * 100))}%"></span></div><b>${fmtDur(w)}</b></div>`; }).join("") || `<span class="muted">Sin datos todavía</span>`}
    </div><p class="muted" style="margin-top:8px">La línea clara marca la meta de ${fmtDur(SLA)}.</p></div></div>
  </div>
  ${waiting.length ? `<h2 class="sec">En espera ahora</h2><div class="card">${waiting.map((o) => `<div class="line"><span>Mesa ${esc(o.mesa)} · ${esc(first(o.customerName))}</span><span class="timer" data-since="${o.createdAt}" data-mode="sla"><b>0:00</b></span></div>`).join("")}</div>` : ""}
  <div class="row" style="margin-top:22px"><button class="btn ghost sm" data-act="seedDemo">Generar datos de ejemplo</button>${hasDemo ? `<button class="btn ghost sm" data-act="clearDemo">Borrar datos de ejemplo</button>` : ""}</div>`;
}
/* ---------- Historial (todos los días guardados, con filtro de fechas) ---------- */
function histRange() {
  return (S.hist ??= { from: ymd(now() - 30 * 86400000), to: ymd(now()) });
}
function histOrders() {
  const h = histRange(), a = dayStart(h.from), b = dayEnd(h.to);
  return S.orders.filter((o) => !o.demo && o.createdAt >= a && o.createdAt <= b);
}
function adminHistorial() {
  const h = histRange();
  const all = histOrders();
  const valid = all.filter((o) => o.status !== "cancelado");
  const done = all.filter((o) => o.status === "entregado");
  const canceled = all.length - valid.length;
  const income = done.reduce((s, o) => s + (o.total || 0), 0);
  const disc = done.reduce((s, o) => s + Math.max(0, (o.subtotal || o.total || 0) - (o.total || 0)), 0);
  const st = stats(valid);
  const emailOf = (uid) => S.users.find((u) => u.id === uid)?.email || "—";

  const days = {};
  valid.forEach((o) => (days[ymd(o.createdAt)] ??= []).push(o));
  const dayRows = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).map(([d, os]) => ({
    d, n: os.length, inc: os.filter((o) => o.status === "entregado").reduce((s, o) => s + (o.total || 0), 0), st: stats(os),
  }));

  const dishes = {};
  done.forEach((o) => o.items.forEach((i) => { const x = (dishes[i.name] ??= { name: i.name, qty: 0, inc: 0 }); x.qty += i.qty; x.inc += i.lineTotal ?? i.qty * i.price; }));
  const top = Object.values(dishes).sort((a, b) => b.qty - a.qty).slice(0, 8);

  const gW = {};
  valid.filter((o) => wUid(o) && o.acceptedAt).forEach((o) => (gW[wUid(o)] ??= []).push(o));
  const wRows = Object.entries(gW).map(([uid, os]) => ({ name: wName(os[0]), email: emailOf(uid), st: stats(os) })).sort((a, b) => b.st.taken - a.st.taken);
  const gC = {};
  valid.filter((o) => o.cookUid && o.readyAt && o.cookAt).forEach((o) => (gC[o.cookUid] ??= []).push(o));
  const cRows = Object.entries(gC).map(([uid, os]) => ({ name: os[0].cookName, email: emailOf(uid), n: os.length, prep: avg(os.map((o) => o.readyAt - o.cookAt)) })).sort((a, b) => b.n - a.n);

  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>Historial</h2><button class="btn ghost sm" data-act="exportCsv">Descargar CSV</button></div>
  <div class="card" style="margin:12px 0;display:grid;gap:10px">
    <div style="display:flex;gap:6px;flex-wrap:wrap">${[["today", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["month", "Este mes"], ["all", "Ver Todo"]].map(([k, l]) => `<button class="btn sm ghost" data-act="histPreset" data-k="${k}">${l}</button>`).join("")}</div>
    <div class="row"><label class="lbl" style="margin:0">Desde<input type="date" value="${h.from}" data-change="histRange" data-r="from"></label>
    <label class="lbl" style="margin:0">Hasta<input type="date" value="${h.to}" data-change="histRange" data-r="to"></label></div>
    <p class="muted">Se guardan todos los pedidos; aquí eliges qué días ver. No incluye los datos de ejemplo.</p>
  </div>
  <div class="kpis">
    <div class="kpi hl"><span>Pedidos</span><b>${valid.length}</b><small>${canceled} cancelado(s)</small></div>
    <div class="kpi"><span>Ingresos</span><b>${money(income)}</b><small>${done.length} entregado(s)</small></div>
    <div class="kpi"><span>Ticket promedio</span><b>${done.length ? money(income / done.length) : "—"}</b></div>
    <div class="kpi"><span>Descuentos otorgados</span><b>${money(disc)}</b></div>
  </div>
  <div class="kpis" style="margin-top:10px">
    <div class="kpi"><span>Calificación</span><b>${dash(st.avgRating, (v) => v.toFixed(1) + " ★")}</b><small>${st.nRatings} reseñas</small></div>
    <div class="kpi"><span>Respuesta promedio</span><b>${dash(st.avgWait, fmtDur)}</b><small>meta ${fmtDur(SLA)}</small></div>
    <div class="kpi ${st.slaPct != null && st.slaPct < 80 ? "bad" : ""}"><span>Tomados en meta</span><b>${dash(st.slaPct, (v) => v + "%")}</b></div>
    <div class="kpi"><span>Prep. promedio</span><b>${dash(st.avgPrep, fmtDur)}</b></div>
  </div>
  <div class="two" style="margin-top:14px">
    <div><h2 class="sec">Por día</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Pedidos</th><th>Ingresos</th><th>Resp.</th><th>★</th></tr></thead><tbody>
      ${dayRows.map((r) => `<tr><td><b>${dmy(dayStart(r.d))}</b></td><td>${r.n}</td><td>${money(r.inc)}</td><td>${dash(r.st.avgWait, fmtDur)}</td><td>${dash(r.st.avgRating, (v) => v.toFixed(1))}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin pedidos en este rango</td></tr>`}
    </tbody></table></div></div>
    <div><h2 class="sec">Platos más pedidos</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Plato</th><th>Cant.</th><th>Ventas</th></tr></thead><tbody>
      ${top.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${d.qty}</td><td>${money(d.inc)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Sin datos</td></tr>`}
    </tbody></table></div></div>
  </div>
  <div class="two">
    <div><h2 class="sec">Meseros</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Mesero</th><th>Pedidos</th><th>Resp.</th><th>En meta</th><th>★</th></tr></thead><tbody>
      ${wRows.map((r) => `<tr><td><b>${esc(first(r.name))}</b><div class="muted">${esc(r.email)}</div></td><td>${r.st.taken}</td><td>${dash(r.st.avgWait, fmtDur)}</td><td>${dash(r.st.slaPct, (v) => v + "%")}</td><td>${dash(r.st.avgRating, (v) => v.toFixed(1))}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin datos</td></tr>`}
    </tbody></table></div></div>
    <div><h2 class="sec">Cocina</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Cocinero</th><th>Pedidos</th><th>Prep.</th></tr></thead><tbody>
      ${cRows.map((r) => `<tr><td><b>${esc(first(r.name))}</b><div class="muted">${esc(r.email)}</div></td><td>${r.n}</td><td>${dash(r.prep, fmtDur)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Sin datos</td></tr>`}
    </tbody></table></div></div>
  </div>`;
}
function adminEquipo() {
  const staff = [...S.staff].sort((a, b) => a.id.localeCompare(b.id));
  const roleOpts = (cur) => ["mesero", "cocinero", "moderador", "admin"].map((r) => `<option value="${r}" ${r === cur ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
  const row = (s) => {
    const self = s.id === S.user.email;
    return `<div class="item"><div><b>${esc(s.id)}</b><div class="muted">${ROLE_LABEL[normRole(s.role)]} · ${s.active ? "Activo" : "De baja"}</div></div>
      <div class="acts">
        <select data-change="role" data-email="${esc(s.id)}" ${self ? "disabled" : ""}>${roleOpts(normRole(s.role))}</select>
        <button class="btn sm ghost" data-act="toggleStaff" data-email="${esc(s.id)}" ${self ? "disabled" : ""}>${s.active ? "Dar de baja" : "Reactivar"}</button>
        <button class="btn sm bad" data-act="removeStaff" data-email="${esc(s.id)}" ${self ? "disabled" : ""}>Eliminar</button>
      </div></div>`;
  };
  return `<h2>Equipo</h2><p class="muted" style="margin:4px 0 12px">Agrega el correo de cada persona (debe ser un correo verificado, por ejemplo de Google). Al iniciar sesión verá su vista automáticamente.</p>
  <form class="card form" data-form="addStaff"><input id="stEmail" name="email" type="email" required placeholder="correo@gmail.com"><select id="stRole" name="role">${roleOpts("mesero")}</select><button class="btn">Agregar</button></form>
  <div class="card" style="margin-top:12px">
    <div class="item"><div><b>${esc(OWNER)}</b><div class="muted">Dueño · acceso solo con Google${CONFIG.ownerTwoFactor ? " y código por Gmail" : ""}</div></div><span class="chip ok">Dueño</span></div>
    ${staff.map(row).join("")}
  </div>`;
}
function adminMenu() {
  const items = [...S.menu].sort((a, b) => (a.category || "").localeCompare(b.category || ""));
  return `<h2>Menú</h2>
   <form class="card" style="margin:12px 0;display:grid;gap:8px" data-form="addMenu">
    <div class="row"><input id="mnName" name="name" required placeholder="Nombre del plato" maxlength="40"></div>
    <div class="row">
      <input id="mnPrice" name="price" type="number" step="0.1" min="0" required placeholder="Precio">
      <select id="mnCat" name="category">
        <option value="Platos">Platos</option>
        <option value="Bebidas">Bebidas</option>
        <option value="Postres">Postres</option>
        <option value="Entradas">Entradas</option>
        <option value="Combos">Combos</option>
        <option value="Otros">Otros</option>
      </select>
    </div>
    <label class="lbl" style="margin:0">Foto del plato (opcional)<input name="image" type="file" accept="image/*"></label>
    <button class="btn">Agregar al menú</button></form>
  <div class="card">${items.map((m) => `<div class="item"><div style="display:flex;align-items:center;gap:12px">
      ${m.imageUrl ? `<img src="${esc(m.imageUrl)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px" alt="">` : `<span style="font-size:1.5rem">${esc(m.emoji || "🍽️")}</span>`}
      <div><b>${esc(m.name)}</b><div class="muted">${esc(m.category || "")} · ${money(m.price)} · ${m.available === false ? "Agotado" : "Disponible"}</div></div>
    </div>
    <div class="acts"><button class="btn sm ghost" data-act="editPrice" data-id="${esc(m.id)}">Precio</button><button class="btn sm ghost" data-act="toggleMenu" data-id="${esc(m.id)}">${m.available === false ? "Marcar disponible" : "Marcar agotado"}</button><button class="btn sm bad" data-act="delMenu" data-id="${esc(m.id)}">Eliminar</button></div></div>`).join("") || `<span class="muted">Sin platos</span>`}</div>`;
}

/* ====================== acciones ====================== */
const fail = (e, what) => {
  console.error("[yaTA] error" + (what ? " en " + what : ""), e?.code, e?.message || e);
  toast(e?.code === "permission-denied" ? "No tienes permiso para esta acción" + (what ? ` (${what})` : "") : "Algo falló, intenta de nuevo", "bad");
};

const A = {
  async login() { try { await data.login(); } catch (e) { if (e?.code !== "auth/popup-closed-by-user") toast("No se pudo iniciar sesión: " + (e.code || e.message), "bad"); } },
  async loginGuest() {
    try {
      await data.loginGuest();
      toast("Las personas con cuenta reciben ofertas y descuentos exclusivos por fidelidad.", "ok", "Entraste como invitado");
    }
    catch (e) { toast("Error al entrar como invitado: " + e.message, "bad"); }
  },
  logout: () => data.logout(),
  toggleBiz() {
    if (!S.isOwner) return;
    const open = !isOpen();
    if (!confirm(open ? "¿Abrir el negocio y habilitar los pedidos?" : "¿Cerrar el negocio? Se bloquearán los pedidos nuevos hasta que lo vuelvas a abrir.")) return;
    data.set("settings", "business", { open, by: S.user.email, at: data.stamp() })
      .then(() => toast(open ? "Negocio abierto" : "Negocio cerrado", "ok")).catch(fail);
  },
  notif: () => Notification.requestPermission().then(render),
  resetPass() {
    const email = prompt("Escribe tu correo para enviarte el enlace de recuperación:");
    if (!email) return;
    data.resetPassword(email.trim()).then(() => toast("Revisa tu correo para restablecer la contraseña", "ok")).catch((e) => toast("Error: " + e.message, "bad"));
  },
  resend: () => data.resendVerification().then(() => toast("Correo de verificación enviado", "ok")).catch((e) => toast(e.message, "bad")),
  async recheck() { try { await data.recheck(); location.reload(); } catch (e) { toast(e.message, "bad"); } },
  sendCode: () => data.call("sendOwnerCode").then(() => toast("Código enviado a tu Gmail", "ok")).catch((e) => toast(e.message || "No se pudo enviar el código", "bad")),

  tab(d) {
    S.tab = d.t; S.selMsgs.clear(); render(); scrollTo(0, 0);
    if (S.role === "cliente" && d.t === "ayuda" && S.myChat?.unreadClient) data.set("chats", S.user.uid, { unreadClient: false }).catch(() => {});
  },
  add(d) {
    if (!isOpen()) return toast("El negocio está cerrado", "bad");
    S.cart[d.id] = (S.cart[d.id] || 0) + 1; render();
  },
  sub(d) { S.cart[d.id] = (S.cart[d.id] || 1) - 1; if (S.cart[d.id] <= 0) delete S.cart[d.id]; render(); },
  removeLine(d) {
    delete S.cart[d.id];
    if (!cartLines().length) { S.cart = {}; closeModal(); return render(); }
    const mesa = $modal.querySelector('[name="mesa"]')?.value, note = $modal.querySelector('[name="note"]')?.value;
    if (mesa != null) S.mesa = mesa;
    openCart();
    const nEl = $modal.querySelector('[name="note"]');
    if (nEl && note) nEl.value = note;
    render();
  },
  clearCart() {
    if (!confirm("¿Vaciar tu pedido?")) return;
    S.cart = {}; closeModal(); render();
  },
  selMsg(d) { S.selMsgs.has(d.id) ? S.selMsgs.delete(d.id) : S.selMsgs.add(d.id); render(); },
  selAllMsgs() {
    const ids = S.team.map((m) => m.id);
    if (ids.length && ids.every((id) => S.selMsgs.has(id))) S.selMsgs.clear();
    else ids.forEach((id) => S.selMsgs.add(id));
    render();
  },
  async delSelMsgs() {
    if (!S.isOwner) return;
    const ids = [...S.selMsgs].filter((id) => S.team.some((m) => m.id === id));
    if (!ids.length) return;
    if (!confirm(ids.length === 1 ? "¿Eliminar este mensaje del chat del equipo?" : `¿Eliminar ${ids.length} mensajes del chat del equipo?`)) return;
    try {
      for (const id of ids) await data.remove("teamchat", id);
      S.selMsgs.clear(); render();
      toast(ids.length === 1 ? "Mensaje eliminado" : `${ids.length} mensajes eliminados`, "ok");
    } catch (e) { fail(e, "borrar mensajes"); render(); }
  },
  openCart, closeModal,
  backdrop(d, el, e) { if (e.target === el) closeModal(); },
  openReview: (d) => openReview(d.id),
  star(d) { S.rv.n = Number(d.n); $modal.querySelectorAll(".star").forEach((b) => b.classList.toggle("on", Number(b.dataset.n) <= S.rv.n)); },
  async cancelOrder(d) { if (confirm("¿Cancelar este pedido?")) data.set("orders", d.id, { status: "cancelado" }).catch(fail); },

  // mesero
  send(d) {
    const o = S.orders.find((x) => x.id === d.id);
    if (!o || o.status !== "espera") return toast("Otro mesero ya tomó este pedido", "bad");
    data.set("orders", d.id, { status: "cocina", acceptedAt: data.stamp(), sentAt: data.stamp(), waiterUid: S.user.uid, waiterName: S.user.name })
      .then(() => { S.tab = "cocina"; render(); }).catch(fail);
  },
  markPreparing: (d) => data.set("orders", d.id, { status: "preparando", preparingAt: data.stamp() }).catch(fail),
  sendRobot: (d) => {
    const o = S.orders.find((x) => x.id === d.id);
    if (!o || o.status !== "listo" || o.robotAt) return;
    data.set("orders", d.id, { robotAt: data.stamp() }).then(() => toast(`🤖 Robot enviado a Mesa ${o.mesa}`, "ok")).catch(fail);
  },
  delivered: (d) => data.set("orders", d.id, { status: "entregado", deliveredAt: data.stamp() }).catch(fail),

  // cocinero
  openEta(d) {
    const q = S.orders.filter((o) => o.status === "cocina").sort(byCreated);
    if (q[0]?.id !== d.id) return toast("Primero atiende el pedido que llegó antes", "bad");
    openEta(d.id);
  },
  etaPick(d) { const el = document.getElementById("etaInput"); if (el) el.value = d.n; },
  ready: (d) => data.set("orders", d.id, { status: "listo", readyAt: data.stamp() }).catch(fail),

  // chat de soporte (moderación)
  openThread(d) {
    threadUnsub && threadUnsub();
    S.chatWith = d.uid; S.thread = [];
    threadUnsub = data.watch(`chats/${d.uid}/messages`, (rows) => { S.thread = rows; render(); });
    data.set("chats", d.uid, { unreadStaff: false }).catch(() => {});
    render();
  },
  closeThread() { threadUnsub && threadUnsub(); threadUnsub = null; S.chatWith = null; S.thread = []; render(); },
  archiveChat(d) { data.set("chats", d.uid, { archived: true }).then(() => toast("Chat archivado", "ok")).catch(fail); },
  deleteChat(d) {
    if (confirm("¿Eliminar esta conversación permanentemente?")) {
      data.remove("chats", d.uid).then(() => { if (S.chatWith === d.uid) A.closeThread(); toast("Chat eliminado", "ok"); }).catch(fail);
    }
  },

  // admin / moderación
  toggleStaff(d) { const s = S.staff.find((x) => x.id === d.email); s && data.set("staff", d.email, { active: !s.active }).catch(fail); },
  removeStaff(d) { if (confirm(`¿Eliminar a ${d.email} del equipo?`)) data.remove("staff", d.email).catch(fail); },
  toggleMenu(d) { const m = S.menu.find((x) => x.id === d.id); m && data.set("menu", d.id, { available: m.available === false }).catch(fail); },
  delMenu(d) { if (confirm("¿Eliminar este plato?")) data.remove("menu", d.id).catch(fail); },
  editPrice(d) {
    const m = S.menu.find((x) => x.id === d.id); if (!m) return;
    const v = prompt(`Nuevo precio para ${m.name}:`, m.price);
    if (v === null || isNaN(Number(v)) || Number(v) < 0) return;
    data.set("menu", d.id, { price: Number(v) }).catch(fail);
  },
  toggleOffer(d) { const o = S.offers.find((x) => x.id === d.id); o && data.set("offers", d.id, { active: o.active === false }).catch(fail); },
  toggleFeatured(d) { const o = S.offers.find((x) => x.id === d.id); o && data.set("offers", d.id, { featured: !o.featured }).catch(fail); },
  delOffer(d) { if (confirm("¿Eliminar esta oferta?")) data.remove("offers", d.id).catch(fail); },
  delReview(d) { if (confirm("¿Eliminar esta reseña?")) data.remove("reviews", d.id).catch(fail); },
  ban(d) {
    const reason = prompt(`Motivo para banear a ${d.email} (opcional):`);
    if (reason !== null) data.set("banned", d.email, { email: d.email, reason, by: S.user.email, at: data.stamp() }).then(() => toast("Cliente baneado", "ok")).catch(fail);
  },
  unban: (d) => data.remove("banned", d.email).catch(fail),
  applyLoyalty(d) { setLoyalty(d.uid, d.email, d.name, Number(d.pct)); },
  histPreset(d) {
    const t = now(), to = ymd(t);
    let from = to;
    if (d.k === "all") from = "2000-01-01";
    else if (d.k === "month") from = ymd(new Date(new Date(t).getFullYear(), new Date(t).getMonth(), 1).getTime());
    else if (d.k !== "today") from = ymd(t - (Number(d.k) - 1) * 86400000);
    S.hist = { from, to }; render();
  },
  exportCsv() {
    const os = histOrders().sort(byCreated);
    if (!os.length) return toast("No hay pedidos en ese rango", "bad");
    const q = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const head = ["Fecha", "Hora", "Mesa", "Cliente", "Estado", "Productos", "Subtotal", "Descuento %", "Total", "Mesero", "Cocinero", "Espera (s)", "Preparación (s)", "Calificación"];
    const rows = os.map((o) => [
      ymd(o.createdAt), hm(o.createdAt), o.mesa, o.customerName, o.status, o.items.map((i) => `${i.qty}x ${i.name}`).join(" | "),
      o.subtotal ?? o.total, o.discount || 0, o.total, wName(o), o.cookName || "",
      o.acceptedAt ? Math.round((o.acceptedAt - o.createdAt) / 1000) : "", o.readyAt && o.cookAt ? Math.round((o.readyAt - o.cookAt) / 1000) : "", o.review?.rating ?? "",
    ]);
    const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `historial_${histRange().from}_${histRange().to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  seedDemo,
  async clearDemo() {
    for (const o of S.orders.filter((x) => x.demo)) await data.remove("orders", o.id).catch(fail);
    for (const r of S.reviews.filter((x) => x.demo)) await data.remove("reviews", r.id).catch(fail);
  },
};

function setLoyalty(uid, email, name, pct) {
  data.set("loyalty", uid, { uid, email, name, discount: pct, by: S.user.email, at: data.stamp() })
    .then(() => toast(`Descuento de ${first(name)}: ${pct ? "−" + pct + "%" : "ninguno"}`, "ok")).catch(fail);
}

// selects con data-change
const C = {
  role: (d, el) => data.set("staff", d.email, { role: el.value }).catch(fail),
  loyalty: (d, el) => setLoyalty(d.uid, d.email, d.name, Number(el.value)),
  rvFilter: (d, el) => { S.rvFilter = el.value; render(); },
  ofType: (d, el) => { S.ofType = el.value; render(); },
  histRange: (d, el) => {
    if (!el.value) return;
    const h = { ...histRange(), [d.r]: el.value };
    if (d.r === "from" && h.from > h.to) h.to = h.from;
    if (d.r === "to" && h.to < h.from) h.from = h.to;
    S.hist = h; render();
  },
};

const F = {
  async emailAuth(f, submitter) {
    const v = new FormData(f);
    const email = String(v.get("email")).trim();
    const password = String(v.get("password"));
    const name = String(v.get("name") || "").trim();
    const mode = submitter?.value || "login";
    if (isCloud && email.toLowerCase() === OWNER) return toast("La cuenta del dueño solo puede ingresar con Google", "bad");

    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (mode === "register") {
        await data.register(email, password, name || email);
        toast("Cuenta creada. Te enviamos un correo para verificarla.", "ok");
      } else {
        await data.loginEmail(email, password);
        toast("Sesión iniciada", "ok");
      }
    } catch (e) {
      if (btn) btn.disabled = false;
      const msg =
        e.code === "auth/email-already-in-use" ? "Ese correo ya está registrado" :
        e.code === "auth/weak-password" ? "La contraseña es muy débil (mínimo 6)" :
        e.code === "auth/invalid-credential" ? "Correo o contraseña incorrectos" :
        e.code === "auth/user-not-found" ? "No existe una cuenta con ese correo" :
        e.code === "auth/wrong-password" ? "Contraseña incorrecta" :
        "Error al autenticar: " + e.message;
      toast(msg, "bad");
    }
  },

  verifyCode(f) {
    const code = String(new FormData(f).get("code") || "").trim();
    data.call("verifyOwnerCode", { code })
      .then(async () => { await data.refreshToken(); location.reload(); })
      .catch((e) => toast(e.message || "Código incorrecto", "bad"));
  },

  async chat(f) {
    const text = String(new FormData(f).get("text") || "").trim();
    if (!text) return;
    const kind = f.dataset.kind;
    f.reset();
    const msg = { text, fromUid: S.user.uid, fromName: S.user.name, fromRole: S.role, at: data.stamp() };
    try {
      if (kind === "team") return await data.set("teamchat", data.newId(), msg);
      const customer = S.role === "cliente";
      const cuid = customer ? S.user.uid : S.chatWith;
      if (!cuid) return;
      await data.set(`chats/${cuid}/messages`, data.newId(), msg);
      await data.set("chats", cuid, customer
        ? { uid: cuid, customerName: S.user.name, customerEmail: S.user.email || "Invitado", lastText: text.slice(0, 80), lastAt: data.stamp(), lastFrom: "cliente", unreadStaff: true }
        : { lastText: text.slice(0, 80), lastAt: data.stamp(), lastFrom: "staff", unreadStaff: false, unreadClient: true });
    } catch (e) { fail(e); }
  },

  async addMenu(f) {
    const v = new FormData(f);
    const file = v.get("image");
    const btn = f.querySelector("button");
    let imageUrl = "";
    if (file && file.size > 0) {
      if (btn) { btn.disabled = true; btn.textContent = "Subiendo foto..."; }
      try { imageUrl = await data.uploadImage(file); }
      catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = "Agregar al menú"; }
        return toast(e?.message || "Error al subir la imagen.", "bad");
      }
    }
    data.set("menu", data.newId(), {
      name: String(v.get("name")).trim(), price: Number(v.get("price")), imageUrl,
      category: String(v.get("category") || "Platos").trim(), available: true,
    }).then(() => { f.reset(); render(); toast("Plato agregado", "ok"); }).catch(fail);
  },

  async addOffer(f) {
    const v = new FormData(f);
    const file = v.get("image");
    const btn = f.querySelector("button");
    let imageUrl = "";
    const type = String(v.get("type") || "combo");
    const menuId = String(v.get("menuId") || "");
    const priceRaw = String(v.get("offerPrice") || "");
    const pctRaw = String(v.get("discountPct") || "");
    const endRaw = String(v.get("endsAt") || "");
    const endsAt = endRaw ? dayEnd(endRaw) : null;
    const title = String(v.get("title") || "").trim();
    let items = [];

    if (!title) return toast("Ponle un título a la oferta", "bad");
    if (endsAt && endsAt < now()) return toast("La fecha de vigencia ya pasó", "bad");
    if (type === "combo") {
      const picked = S.menu.map((m) => ({ id: m.id, price: m.price, qty: Math.min(9, Math.floor(Number(v.get("cq_" + m.id)) || 0)) })).filter((x) => x.qty > 0);
      const units = picked.reduce((s, x) => s + x.qty, 0);
      const normal = picked.reduce((s, x) => s + x.price * x.qty, 0);
      if (units < 2) return toast("Un combo necesita al menos 2 productos", "bad");
      if (!(Number(priceRaw) > 0)) return toast("Indica el precio del combo", "bad");
      if (Number(priceRaw) >= normal) return toast(`El precio del combo debe ser menor a ${money(normal)}`, "bad");
      items = picked.map((x) => ({ id: x.id, qty: x.qty }));
    } else {
      if (!menuId) return toast("Elige un plato para la oferta", "bad");
      if (type === "fixed" && priceRaw === "") return toast("Indica el precio de oferta", "bad");
      if (type === "pct" && pctRaw === "") return toast("Indica el % de descuento", "bad");
    }

    if (file && file.size > 0) {
      if (btn) { btn.disabled = true; btn.textContent = "Subiendo imagen..."; }
      try { imageUrl = await data.uploadImage(file); }
      catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = "Publicar oferta"; }
        return toast(e?.message || "Error al subir la imagen.", "bad");
      }
    }
    data.set("offers", data.newId(), {
      title, description: String(v.get("description") || "").trim(), badge: String(v.get("badge") || "").trim(),
      type, menuId: type === "combo" ? null : menuId, items,
      offerPrice: type === "fixed" || type === "combo" ? Number(priceRaw) : null, discountPct: type === "pct" ? Number(pctRaw) : null,
      featured: v.has("featured"), endsAt, imageUrl, active: true, createdAt: data.stamp(), by: S.user.email || "",
    }).then(() => { f.reset(); if (btn) { btn.disabled = false; btn.textContent = "Publicar oferta"; } render(); toast("Oferta publicada", "ok"); }).catch((e) => { if (btn) { btn.disabled = false; btn.textContent = "Publicar oferta"; } fail(e); });
  },

  async placeOrder(f) {
    if (!isOpen()) { closeModal(); return toast("El negocio acaba de cerrar. No se reciben pedidos por ahora.", "bad"); }
    const v = new FormData(f);
    const lines = cartLines();
    if (!lines.length) return;
    const btn = f.querySelector("button:not([type])"); btn && (btn.disabled = true);
    const mesa = String(v.get("mesa")).trim();
    const sub = lines.reduce((s, l) => s + l.lineTotal, 0), d = discPct();
    try {
      await data.set("orders", data.newId(), {
        customerUid: S.user.uid, customerEmail: S.user.email || "Invitado", customerName: S.user.name || "Invitado",
        items: lines, subtotal: r2(sub), discount: d, total: r2(sub * (1 - d / 100)),
        mesa, note: String(v.get("note") || "").trim(), status: "espera", createdAt: data.stamp(),
      });
      S.mesa = mesa; S.cart = {}; S.tab = "pedidos";
      closeModal(); render();
      toast("Tu pedido fue enviado. Te avisaremos en cada etapa.", "ok", "¡Pedido enviado!");
    } catch (e) { btn && (btn.disabled = false); fail(e, "crear pedido"); }
  },

  async review(f) {
    if (!S.rv || !S.rv.n) return toast("Elige de 1 a 5 estrellas", "bad");
    const v = new FormData(f);
    const comment = String(v.get("comment") || "").trim();
    const file = v.get("photo");
    const o = S.orders.find((x) => x.id === S.rv.id);
    if (!o) return;
    const btn = f.querySelector("button:not([type])"); btn && (btn.disabled = true);
    let photoUrl = "";
    if (file && file.size > 0) {
      try { photoUrl = await data.uploadImage(file); }
      catch (e) { btn && (btn.disabled = false); return toast(e?.message || "Error al subir la foto", "bad"); }
    }
    try {
      await data.set("reviews", o.id, {
        orderId: o.id, customerUid: S.user.uid, customerName: first(S.user.name) || "Cliente", rating: S.rv.n, comment, photoUrl,
        items: o.items.flatMap((i) => (i.includes ? i.includes.map((x) => ({ id: x.id, name: x.name })) : [{ id: i.id, name: i.name }])), at: data.stamp(),
      });
      await data.set("orders", o.id, { review: { rating: S.rv.n, comment, at: data.stamp() } });
      closeModal(); toast("¡Gracias por tu opinión!", "ok");
    } catch (e) { btn && (btn.disabled = false); fail(e); }
  },

  eta(f) {
    const n = Number(new FormData(f).get("eta"));
    if (!(n > 0)) return toast("Indica los minutos estimados", "bad");
    const id = S.etaFor;
    const o = S.orders.find((x) => x.id === id);
    if (!o || o.status !== "cocina") { closeModal(); return toast("Este pedido ya fue tomado", "bad"); }
    data.set("orders", id, { status: "estimado", etaMin: n, cookAt: data.stamp(), cookUid: S.user.uid, cookName: S.user.name })
      .then(() => { closeModal(); S.tab = "curso"; render(); }).catch(fail);
  },

  addStaff(f) {
    const v = new FormData(f);
    const email = String(v.get("email")).trim().toLowerCase();
    if (email === OWNER) return toast("El dueño ya tiene acceso total", "bad");
    data.set("staff", email, { email, role: v.get("role"), active: true, addedBy: S.user.email, createdAt: data.stamp() })
      .then(() => { f.reset(); render(); toast(`${email} agregado al equipo`, "ok"); }).catch(fail);
  },

  banEmail(f) {
    const email = String(new FormData(f).get("email")).trim().toLowerCase();
    if (email === OWNER) return toast("No se puede banear al dueño", "bad");
    A.ban({ email });
    f.reset();
  },
};

async function seedDemo() {
  if (!S.menu.length) return toast("Primero agrega platos al menú", "bad");
  const t = now(), waiters = ["Ana", "Luis", "Carla"], cooks = ["Diego", "Marta"], clients = ["Marco", "Lucía", "Pedro", "Sofía"];
  const comments = ["Rápido y rico", "Excelente atención", "Llegó calientito", "Buen servicio"];
  for (let i = 0; i < 14; i++) {
    const created = Math.round(t - (i * 7 + 5) * 60000 - Math.random() * 60000);
    const wait = Math.round((30 + Math.random() * 190) * 1000), eta = 5 + Math.floor(Math.random() * 8);
    const prep = Math.round((eta - 2 + Math.random() * 5) * 60000);
    const d = S.menu[Math.floor(Math.random() * S.menu.length)], qty = 1 + Math.floor(Math.random() * 2);
    const cookAt = created + wait + 20000;
    const o = {
      demo: true, customerUid: "demo", customerEmail: `cliente${i}@demo.com`, customerName: clients[i % 4],
      items: [{ id: d.id, name: d.name, price: d.price, qty }], subtotal: d.price * qty, discount: 0, total: d.price * qty, mesa: String(1 + (i % 8)), note: "",
      status: "entregado", createdAt: created, acceptedAt: created + wait, sentAt: created + wait,
      cookAt, etaMin: eta, readyAt: cookAt + prep,
      waiterUid: "demo_w" + (i % 3), waiterName: waiters[i % 3] + " (demo)", cookUid: "demo_c" + (i % 2), cookName: cooks[i % 2] + " (demo)",
    };
    if (i % 2 === 0) o.review = { rating: 3 + Math.floor(Math.random() * 3), comment: comments[i % 4], at: o.readyAt };
    const id = data.newId();
    await data.set("orders", id, o).catch(fail);
    if (o.review) await data.set("reviews", id, { demo: true, orderId: id, customerUid: "demo", customerName: clients[i % 4], rating: o.review.rating, comment: o.review.comment, photoUrl: "", items: [{ id: d.id, name: d.name }], at: o.readyAt }).catch(fail);
  }
  toast("Datos de ejemplo creados (marcados como demo)", "ok");
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = A[el.dataset.act];
  fn && fn(el.dataset, el, e);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  const fn = C[el.dataset.change];
  fn && fn(el.dataset, el);
});
document.addEventListener("input", (e) => {
  if (e.target.closest && e.target.closest('form[data-form="addOffer"]')) updateComboHint();
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  F[f.dataset.form]?.(f, e.submitter);
});

render();
