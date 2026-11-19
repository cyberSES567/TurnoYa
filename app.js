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
const SLA = CONFIG.acceptSlaSeconds * 1000;
const OWNER = CONFIG.ownerEmail.toLowerCase();

const ST = {
  espera: ["⏳", "En espera de confirmación"],
  trabajando: ["👨‍🍳", "Preparando tu pedido"],
  listo: ["✅", "¡Tu pedido está listo!"],
  entregado: ["🎉", "Entregado"],
  cancelado: ["✖️", "Cancelado"],
};
const NAV = {
  admin: [["resumen", "📊", "Resumen"], ["equipo", "👥", "Equipo"], ["menu", "🍽️", "Menú"], ["resenas", "⭐", "Reseñas"], ["clientes", "🙋", "Clientes"]],
  receptor: [["espera", "⏳", "En espera"], ["trabajando", "👨‍🍳", "Preparando"], ["listo", "✅", "Listos"]],
  cliente: [["menu", "🍽️", "Menú"], ["pedidos", "🧾", "Mis pedidos"]],
};
const ROLE_LABEL = { admin: "Admin", receptor: "Receptor", cliente: "Cliente", baneado: "Bloqueado" };

/* ====================== estado ====================== */
const S = {
  user: null, role: null, isOwner: false, loading: true, offset: 0,
  menu: [], orders: [], staff: [], banned: [], users: [],
  tab: null, cart: {}, mesa: new URLSearchParams(location.search).get("mesa") || "", rv: null,
};
let authUnsubs = [], roleUnsubs = [], seen = null, prevStatus = {}, lateAlerted = new Set(), seeded = false, seq = 0;
const now = () => Date.now() + S.offset;
const startOfDay = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); };

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

/* ====================== estadísticas ====================== */
function stats(orders) {
  const taken = orders.filter((o) => o.acceptedAt);
  const waits = taken.map((o) => o.acceptedAt - o.createdAt);
  const preps = orders.filter((o) => o.readyAt && o.acceptedAt).map((o) => o.readyAt - o.acceptedAt);
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

/* ====================== sesión y roles ====================== */
data.onAuth((user) => {
  const my = ++seq;
  authUnsubs.forEach((f) => f()); authUnsubs = [];
  roleUnsubs.forEach((f) => f()); roleUnsubs = [];
  Object.assign(S, { user, role: null, loading: !!user, cart: {}, orders: [], menu: [], staff: [], banned: [], users: [], offset: 0, isOwner: false });
  seen = null; prevStatus = {}; lateAlerted = new Set(); seeded = false;
  closeModal();
  if (!user) return render();

  const owner = user.email === OWNER;
  let banned = null, staffDoc = null, gotB = owner || !user.email, gotS = owner || !user.email;
  const resolve = () => {
    if (my !== seq || !gotB || !gotS) return;
    const role = owner ? "admin" : banned ? "baneado" : staffDoc && staffDoc.active ? staffDoc.role : "cliente";
    S.isOwner = owner;
    if (role !== S.role) { S.role = role; startRole(); }
    S.loading = false;
    render();
  };
  if (!owner && user.email) {
    authUnsubs.push(data.watchDoc("banned", user.email, (d) => { banned = d; gotB = true; resolve(); }));
    authUnsubs.push(data.watchDoc("staff", user.email, (d) => { staffDoc = d; gotS = true; resolve(); }));
  } else resolve();

  authUnsubs.push(data.watchDoc("users", user.uid, (u, meta) => {
    if (u && typeof u.seen === "number" && !(meta && meta.pending)) S.offset = u.seen - Date.now();
  }));
  data.set("users", user.uid, { email: user.email, name: user.name, seen: data.stamp() }).catch(() => {});
  render();
});

function startRole() {
  roleUnsubs.forEach((f) => f()); roleUnsubs = [];
  Object.assign(S, { orders: [], menu: [], staff: [], banned: [], users: [] });
  seen = null; prevStatus = {};
  S.tab = { admin: "resumen", receptor: "espera", cliente: "menu" }[S.role] || null;
  if (!S.role || S.role === "baneado") return;
  const w = (col, key, where, after) =>
    roleUnsubs.push(data.watch(col, (rows) => { S[key] = rows; after && after(rows); render(); }, where));
  if (S.role === "admin") {
    w("menu", "menu", null, seedMenuIfEmpty);
    w("orders", "orders", null, onOrders);
    w("staff", "staff"); w("banned", "banned"); w("users", "users");
  } else if (S.role === "receptor") {
    w("orders", "orders", null, onOrders);
  } else {
    w("menu", "menu");
    w("orders", "orders", ["customerUid", S.user.uid], onOrders);
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
    return;
  }
  for (const o of rows) {
    if (S.role === "receptor") {
      if (!seen.has(o.id) && o.status === "espera") alertUser("🔔 Nuevo pedido", `Mesa ${o.mesa} · ${o.items.length} producto(s)`, "new");
    } else if (S.role === "cliente") {
      const p = prevStatus[o.id];
      if (p && p !== o.status) {
        if (o.status === "trabajando") alertUser("¡Pedido confirmado!", `${first(o.receptorName) || "El equipo"} ya está preparando tu pedido.`, "ok");
        if (o.status === "listo") alertUser("¡Tu pedido está listo! 🎉", "Pronto llegará a tu mesa.", "ok");
      }
    }
    seen.add(o.id);
    prevStatus[o.id] = o.status;
  }
}

function checkLate() {
  if (S.role !== "receptor" && S.role !== "admin") return;
  const t = now();
  for (const o of S.orders) {
    if (o.status === "espera" && t - o.createdAt >= SLA && !lateAlerted.has(o.id)) {
      lateAlerted.add(o.id);
      alertUser("⚠️ Pedido retrasado", `Mesa ${o.mesa} lleva más de ${CONFIG.acceptSlaSeconds / 60} min sin ser tomado.`, "late", "bad");
      render();
    }
  }
}

/* ====================== render ====================== */
function render() {
  const act = document.activeElement;
  const keep = {};
  $app.querySelectorAll("input[id],textarea[id],select[id]").forEach((el) => (keep[el.id] = el.value));
  const fid = act && $app.contains(act) ? act.id : null;
  const ss = act?.selectionStart, se = act?.selectionEnd;
  $app.innerHTML = view();
  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el) el.value = v; }
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(ss, se); } catch {} } }
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
    }
  });
}
setInterval(() => { tick(); checkLate(); }, 1000);

function view() {
  if (!S.user) return loginView();
  if (S.loading || !S.role) return topbar() + `<div class="center"><div class="spin"></div></div>`;
  if (S.role === "baneado")
    return topbar() + `<main class="wrap"><div class="empty"><h2>Cuenta bloqueada</h2><p class="muted" style="margin-top:8px">El administrador bloqueó esta cuenta. Si crees que es un error, habla con el personal del local.</p></div></main>`;
  const body = { admin: adminView, receptor: receptorView, cliente: clienteView }[S.role]();
  return topbar() + nav() + `<main class="wrap">${body}</main>` + (S.role === "cliente" ? cartBar() : "");
}

function topbar() {
  const u = S.user;
  const label = S.isOwner ? "Dueño" : ROLE_LABEL[S.role] || "";
  const canNotif = "Notification" in window && Notification.permission === "default";
  return `<header class="top">
    <div class="brand">TurnoYa<small>${esc(CONFIG.restaurantName)}</small></div><div class="sp"></div>
    ${label ? `<span class="badge">${label}</span>` : ""}
    ${canNotif ? `<button class="icon-btn" data-act="notif" title="Activar avisos del sistema">🔔</button>` : ""}
    <div class="avatar" title="${esc(u.email || u.name)}">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc((u.name || "?")[0].toUpperCase())}</div>
    <button class="btn ghost sm" data-act="logout">Salir</button>
  </header>`;
}

function nav() {
  const items = NAV[S.role];
  if (!items) return "";
  const cnt = (k) => (S.role === "receptor" ? S.orders.filter((o) => o.status === k).length : 0);
  return `<nav class="tabs ${S.role === "receptor" ? "mobile-only" : ""}">${items
    .map(([k, ic, l]) => `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-t="${k}"><span>${ic}</span>${l}${cnt(k) ? `<em class="n">${cnt(k)}</em>` : ""}</button>`)
    .join("")}</nav>`;
}

/* ====================== LOGIN ====================== */
function loginView() {
  const loginForm = `
    <div class="card" style="max-width:420px;margin:0 auto;text-align:left">
      <form data-form="emailAuth">
        <h3 style="margin-bottom:12px">Acceso con correo</h3>
        <label class="lbl">Correo
          <input name="email" type="email" required placeholder="tucorreo@gmail.com">
        </label>
        <label class="lbl">Contraseña
          <input name="password" type="password" required minlength="6" placeholder="Mínimo 6 caracteres">
        </label>
        <label class="lbl" id="nameField" style="display:none">Nombre completo (para registrarte)
          <input name="name" placeholder="Tu nombre">
        </label>
        <div class="row" style="margin-top:12px">
          <button class="btn full" type="submit" value="login" name="mode">Iniciar sesión</button>
          <button class="btn ghost full" type="submit" value="register" name="mode" id="btnReg">Registrarme</button>
        </div>
      </form>
      <button class="btn ghost full sm" type="button" data-act="resetPass" style="margin-top:12px">¿Olvidaste tu contraseña?</button>
    </div>
  `;
  
  return `<header class="top"><div class="brand">TurnoYa<small>${esc(CONFIG.restaurantName)}</small></div></header>
  <section class="hero">
    <span class="pill">Reto: reducir los tiempos de espera en restaurantes</span>
    <h1>Pide. Te toman en menos de 3 minutos.</h1>
    <p>Pedidos en tiempo real, aviso sonoro cuando tu pedido es confirmado y listo, y un panel que mide qué tan rápido atiende cada persona del equipo.</p>
    
    ${isCloud ? `
      <button class="btn big gbtn" data-act="login" style="margin-bottom:12px; width:100%; max-width:420px;"><i>G</i> Continuar con Google</button>
      <button class="btn big ghost" data-act="loginGuest" style="margin-bottom:20px; width:100%; max-width:420px;"><i>👤</i> Entrar como invitado (Cliente)</button>
    ` : ""}
    
    ${loginForm}
  </section>`;
}

/* ====================== CLIENTE ====================== */
const cartLines = () =>
  Object.entries(S.cart).map(([id, qty]) => { const m = S.menu.find((x) => x.id === id); return m && { id, name: m.name, price: m.price, qty }; }).filter(Boolean);

function clienteView() {
  return S.tab === "pedidos" ? misPedidos() : menuView();
}
function menuView() {
  const active = S.orders.find((o) => ["espera", "trabajando", "listo"].includes(o.status));
  const cats = [...new Set(S.menu.map((m) => m.category || "Otros"))];
  const banner = active
    ? `<div class="banner" data-act="tab" data-t="pedidos"><span style="font-size:1.6rem">${ST[active.status][0]}</span><div><b>Pedido #${short(active.id)} · ${ST[active.status][1]}</b><div class="muted">Toca para ver el seguimiento</div></div></div>`
    : "";
  const mesa = S.mesa ? `<span class="chip ok">Mesa ${esc(S.mesa)}</span>` : "";
  const dishes = cats.map((c) => `<h2 class="sec">${esc(c)}</h2><div class="grid">${S.menu.filter((m) => (m.category || "Otros") === c).map(dishCard).join("")}</div>`).join("");
  return `${banner}<div style="display:flex;justify-content:space-between;align-items:center"><h2>¿Qué se te antoja?</h2>${mesa}</div>${dishes || `<div class="empty" style="margin-top:16px">El menú aún no tiene platos.</div>`}<div style="height:70px"></div>`;
}
function dishCard(m) {
  const q = S.cart[m.id] || 0;
  const off = m.available === false;
  const ctl = off
    ? `<span class="chip bad">Agotado</span>`
    : q
    ? `<div class="qty"><button data-act="sub" data-id="${esc(m.id)}">−</button><b>${q}</b><button class="p" data-act="add" data-id="${esc(m.id)}">+</button></div>`
    : `<button class="btn sm" data-act="add" data-id="${esc(m.id)}">Agregar</button>`;
  return `<div class="dish ${off ? "off" : ""}"><div class="emo">${esc(m.emoji || "🍽️")}</div><div class="dn">${esc(m.name)}</div><div class="dp">${money(m.price)}</div>${ctl}</div>`;
}
function cartBar() {
  if (S.tab !== "menu") return "";
  const lines = cartLines();
  if (!lines.length) return "";
  const n = lines.reduce((s, l) => s + l.qty, 0), total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  return `<div class="cartbar"><button class="btn" data-act="openCart"><span>🛒 Ver pedido (${n})</span><span>${money(total)}</span></button></div>`;
}
function misPedidos() {
  const list = [...S.orders].sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return `<div class="empty">Aún no has hecho pedidos.<br><button class="btn" style="margin-top:12px" data-act="tab" data-t="menu">Ver menú</button></div>`;
  return `<h2 style="margin-bottom:12px">Mis pedidos</h2><div class="stack">${list.map(myOrderCard).join("")}</div>`;
}
function myOrderCard(o) {
  const active = ["espera", "trabajando", "listo"].includes(o.status);
  const idx = { espera: 0, trabajando: 1, listo: 2, entregado: 3 }[o.status];
  const steps = ["Enviado", "Preparando", "Listo"];
  const since = o.status === "espera" ? o.createdAt : o.status === "trabajando" ? o.acceptedAt : null;
  const canReview = ["listo", "entregado"].includes(o.status) && !o.review;
  return `<article class="card order">
    <div class="oh"><b>Pedido #${short(o.id)}</b><span class="chip ${o.status}">${ST[o.status][0]} ${ST[o.status][1]}</span></div>
    ${active ? `<div class="steps">${steps.map((s, i) => `<div class="step ${i < idx ? "done" : i === idx ? "cur" : ""}"><i>${i < idx ? "✓" : i + 1}</i>${s}</div>`).join("")}</div>` : ""}
    ${since ? `<p class="muted">${o.status === "espera" ? "Esperando confirmación" : "Preparando"} · <span class="timer" data-since="${since}"><b>0:00</b></span></p>` : ""}
    ${o.status === "trabajando" ? `<p class="muted">Te atiende ${esc(first(o.receptorName))}</p>` : ""}
    <ul class="items">${o.items.map((i) => `<li>${i.qty}× ${esc(i.name)}</li>`).join("")}</ul>
    <div class="line tot"><span>Mesa ${esc(o.mesa)}</span><b>${money(o.total)}</b></div>
    ${o.review ? `<p class="stars">${stars(o.review.rating)} <span class="muted">${esc(o.review.comment || "")}</span></p>` : ""}
    <div class="acts">
      ${o.status === "espera" ? `<button class="btn ghost sm" data-act="cancelOrder" data-id="${esc(o.id)}">Cancelar pedido</button>` : ""}
      ${canReview ? `<button class="btn sm" data-act="openReview" data-id="${esc(o.id)}">⭐ Dejar reseña</button>` : ""}
    </div>
  </article>`;
}
function openCart() {
  const lines = cartLines();
  if (!lines.length) return;
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  $modal.innerHTML = `<div class="backdrop" data-act="backdrop"><form class="sheet" data-form="placeOrder">
    <h2>Tu pedido</h2>
    ${lines.map((l) => `<div class="line"><span>${l.qty}× ${esc(l.name)}</span><b>${money(l.price * l.qty)}</b></div>`).join("")}
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
    <div class="row"><button type="button" class="btn ghost" data-act="closeModal">Ahora no</button><button class="btn">Enviar reseña</button></div>
  </form></div>`;
}
function closeModal() { $modal.innerHTML = ""; S.rv = null; }

/* ====================== RECEPTOR ====================== */
function receptorView() {
  const t0 = startOfDay();
  const mine = stats(S.orders.filter((o) => o.receptorUid === S.user.uid && o.createdAt >= t0));
  const cols = [["espera", "⏳ En espera"], ["trabajando", "👨‍🍳 Preparando"], ["listo", "✅ Listos para entregar"]];
  const late = S.orders.filter((o) => o.status === "espera" && now() - o.createdAt >= SLA).length;
  return `${late ? `<div class="alert">⚠️ ${late} pedido(s) superan los ${CONFIG.acceptSlaSeconds / 60} min sin ser tomados</div>` : ""}
  <div class="me">
    <div class="kpi"><span>Tus pedidos hoy</span><b>${mine.taken}</b></div>
    <div class="kpi"><span>Resp. promedio</span><b>${dash(mine.avgWait, fmtDur)}</b></div>
    <div class="kpi ${mine.slaPct != null && mine.slaPct < 80 ? "bad" : "hl"}"><span>En meta</span><b>${dash(mine.slaPct, (v) => v + "%")}</b></div>
  </div>
  <div class="cols">${cols.map(([k, title]) => {
    const rows = S.orders.filter((o) => o.status === k).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return `<section class="col ${S.tab === k ? "active" : ""}"><h3>${title}<span class="chip">${rows.length}</span></h3><div class="stack">${rows.map(orderCard).join("") || `<div class="empty">Sin pedidos</div>`}</div></section>`;
  }).join("")}</div>`;
}
function orderCard(o) {
  const mineOrder = o.receptorUid === S.user.uid;
  const since = o.status === "espera" ? o.createdAt : o.status === "trabajando" ? o.acceptedAt : o.readyAt;
  const act = {
    espera: `<button class="btn" data-act="take" data-id="${esc(o.id)}">Tomar pedido</button>`,
    trabajando: mineOrder ? `<button class="btn ok" data-act="ready" data-id="${esc(o.id)}">Marcar listo</button>` : `<span class="muted">Lo prepara ${esc(first(o.receptorName))}</span>`,
    listo: `<button class="btn" data-act="delivered" data-id="${esc(o.id)}">Entregado</button>`,
  }[o.status];
  return `<article class="card order">
    <div class="oh"><b>Mesa ${esc(o.mesa)} <span class="muted">· #${short(o.id)}</span></b>${since ? `<span class="timer" data-since="${since}" data-mode="${o.status === "espera" ? "sla" : ""}"><b>0:00</b></span>` : ""}</div>
    <div class="muted">${esc(first(o.customerName))}</div>
    <ul class="items">${o.items.map((i) => `<li><b>${i.qty}×</b> ${esc(i.name)}</li>`).join("")}</ul>
    ${o.note ? `<div class="note">📝 ${esc(o.note)}</div>` : ""}
    <div class="acts">${act}</div>
  </article>`;
}

/* ====================== ADMIN ====================== */
function adminView() {
  return { resumen: adminResumen, equipo: adminEquipo, menu: adminMenu, resenas: adminResenas, clientes: adminClientes }[S.tab]();
}
function adminResumen() {
  const t = now(), t0 = startOfDay();
  const today = S.orders.filter((o) => o.createdAt >= t0 && o.status !== "cancelado");
  const st = stats(today);
  const waiting = S.orders.filter((o) => o.status === "espera");
  const late = waiting.filter((o) => t - o.createdAt >= SLA);
  const red = st.avgWait != null ? Math.round((1 - st.avgWait / (CONFIG.baselineWaitMin * 60000)) * 100) : null;

  const groups = {};
  today.filter((o) => o.receptorUid && o.acceptedAt).forEach((o) => (groups[o.receptorUid] ??= []).push(o));
  const emailOf = (uid) => S.users.find((u) => u.id === uid)?.email || "—";
  const rows = Object.entries(groups).map(([uid, os]) => ({ name: os[0].receptorName, email: emailOf(uid), st: stats(os) }));
  const activeUids = new Set(Object.keys(groups));
  S.staff.filter((s) => s.role === "receptor" && s.active).forEach((s) => {
    const uid = S.users.find((u) => u.email === s.id)?.id;
    if (!uid || !activeUids.has(uid)) rows.push({ name: first(S.users.find((u) => u.email === s.id)?.name) || s.id.split("@")[0], email: s.id, st: stats([]) });
  });

  const recent = today.filter((o) => o.acceptedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12).reverse();
  const hasDemo = S.orders.some((o) => o.demo);

  return `${late.length ? `<div class="alert">⚠️ ${late.length} pedido(s) retrasados sin receptor · revisa que haya personal atendiendo</div>` : ""}
  <div class="kpis">
    <div class="kpi hl"><span>Respuesta promedio (hoy)</span><b>${dash(st.avgWait, fmtDur)}</b><small>meta ${fmtDur(SLA)}</small></div>
    <div class="kpi ${st.slaPct != null && st.slaPct < 80 ? "bad" : ""}"><span>Pedidos tomados en meta</span><b>${dash(st.slaPct, (v) => v + "%")}</b><small>${st.taken} tomados</small></div>
    <div class="kpi"><span>Pedidos hoy</span><b>${st.count}</b><small>${waiting.length} en espera ahora</small></div>
    <div class="kpi"><span>Calificación</span><b>${dash(st.avgRating, (v) => v.toFixed(1) + " ★")}</b><small>${st.nRatings} reseñas</small></div>
  </div>
  ${red != null ? `<p class="muted" style="margin:10px 2px">📉 Espera promedio <b>${red >= 0 ? red + "% menor" : Math.abs(red) + "% mayor"}</b> que la referencia sin sistema (${CONFIG.baselineWaitMin} min).</p>` : ""}
  <div class="two" style="margin-top:14px">
    <div><h2 class="sec">Rendimiento del equipo (hoy)</h2><div class="card tblwrap"><table class="tbl"><thead><tr><th>Receptor</th><th>Pedidos</th><th>Resp.</th><th>En meta</th><th>Prep.</th><th>★</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(first(r.name))}</b><div class="muted">${esc(r.email)}</div></td><td>${r.st.taken}</td><td>${dash(r.st.avgWait, fmtDur)}</td><td>${dash(r.st.slaPct, (v) => v + "%")}</td><td>${dash(r.st.avgPrep, fmtDur)}</td><td>${dash(r.st.avgRating, (v) => v.toFixed(1))}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Aún sin actividad</td></tr>`}
    </tbody></table></div></div>
    <div><h2 class="sec">Tiempo hasta ser tomado (últimos ${recent.length || 12})</h2><div class="card"><div class="bars">
      ${recent.map((o) => { const w = o.acceptedAt - o.createdAt; return `<div class="barrow"><span>Mesa ${esc(o.mesa)}</span><div class="bar"><span class="${w <= SLA ? "ok" : "bad"}" style="width:${Math.min(100, Math.round((w / (SLA * 2)) * 100))}%"></span></div><b>${fmtDur(w)}</b></div>`; }).join("") || `<span class="muted">Sin datos todavía</span>`}
    </div><p class="muted" style="margin-top:8px">La línea blanca marca la meta de ${fmtDur(SLA)}.</p></div></div>
  </div>
  ${waiting.length ? `<h2 class="sec">En espera ahora</h2><div class="card">${waiting.map((o) => `<div class="line"><span>Mesa ${esc(o.mesa)} · ${esc(first(o.customerName))}</span><span class="timer" data-since="${o.createdAt}" data-mode="sla"><b>0:00</b></span></div>`).join("")}</div>` : ""}
  <div class="row" style="margin-top:22px"><button class="btn ghost sm" data-act="seedDemo">🧪 Generar datos de ejemplo</button>${hasDemo ? `<button class="btn ghost sm" data-act="clearDemo">Borrar datos de ejemplo</button>` : ""}</div>`;
}
function adminEquipo() {
  const staff = [...S.staff].sort((a, b) => a.id.localeCompare(b.id));
  const row = (s) => {
    const self = s.id === S.user.email;
    return `<div class="item"><div><b>${esc(s.id)}</b><div class="muted">${s.role === "admin" ? "Admin" : "Receptor"} · ${s.active ? "Activo" : "De baja"}</div></div>
      <div class="acts">
        <button class="btn sm ghost" data-act="toggleStaff" data-email="${esc(s.id)}" ${self ? "disabled" : ""}>${s.active ? "Dar de baja" : "Reactivar"}</button>
        <button class="btn sm ghost" data-act="setRole" data-email="${esc(s.id)}" data-role="${s.role === "admin" ? "receptor" : "admin"}" ${self ? "disabled" : ""}>${s.role === "admin" ? "Quitar admin" : "Hacer admin"}</button>
        <button class="btn sm bad" data-act="removeStaff" data-email="${esc(s.id)}" ${self ? "disabled" : ""}>Eliminar</button>
      </div></div>`;
  };
  return `<h2>Equipo</h2><p class="muted" style="margin:4px 0 12px">Agrega el correo de Google de cada persona. Al iniciar sesión verá su vista automáticamente.</p>
  <form class="card form" data-form="addStaff"><input id="stEmail" name="email" type="email" required placeholder="correo@gmail.com"><select id="stRole" name="role"><option value="receptor">Receptor</option><option value="admin">Admin</option></select><button class="btn">Agregar</button></form>
  <div class="card" style="margin-top:12px">
    <div class="item"><div><b>${esc(OWNER)}</b><div class="muted">Dueño · no se puede quitar ni dar de baja</div></div><span class="chip ok">🔒 Dueño</span></div>
    ${staff.map(row).join("")}
  </div>`;
}
function adminMenu() {
  const items = [...S.menu].sort((a, b) => (a.category || "").localeCompare(b.category || ""));
  return `<h2>Menú</h2>
  <form class="card" style="margin:12px 0;display:grid;gap:8px" data-form="addMenu">
    <div class="row"><input id="mnEmoji" name="emoji" placeholder="🍕" maxlength="4" style="max-width:80px"><input id="mnName" name="name" required placeholder="Nombre del plato" maxlength="40"></div>
    <div class="row"><input id="mnPrice" name="price" type="number" step="0.1" min="0" required placeholder="Precio"><input id="mnCat" name="category" placeholder="Categoría (Platos…)" maxlength="20"></div>
    <button class="btn">Agregar al menú</button></form>
  <div class="card">${items.map((m) => `<div class="item"><div><b>${esc(m.emoji || "🍽️")} ${esc(m.name)}</b><div class="muted">${esc(m.category || "")} · ${money(m.price)} · ${m.available === false ? "Agotado" : "Disponible"}</div></div>
    <div class="acts"><button class="btn sm ghost" data-act="toggleMenu" data-id="${esc(m.id)}">${m.available === false ? "Marcar disponible" : "Marcar agotado"}</button><button class="btn sm bad" data-act="delMenu" data-id="${esc(m.id)}">Eliminar</button></div></div>`).join("") || `<span class="muted">Sin platos</span>`}</div>`;
}
function adminResenas() {
  const rs = S.orders.filter((o) => o.review).sort((a, b) => (b.review.at || 0) - (a.review.at || 0));
  const a = avg(rs.map((o) => o.review.rating));
  return `<h2>Reseñas de clientes</h2><p class="muted" style="margin:4px 0 12px">${rs.length ? `Promedio ${a.toFixed(1)} ★ · ${rs.length} reseñas` : "Aún no hay reseñas."}</p>
  <div class="card">${rs.map((o) => `<div class="review"><div class="stars">${stars(o.review.rating)}</div>${o.review.comment ? `<p>${esc(o.review.comment)}</p>` : ""}<p class="muted">${esc(first(o.customerName))} · ${o.items.map((i) => esc(i.name)).join(", ")} · atendió ${esc(first(o.receptorName)) || "—"}</p></div>`).join("") || `<span class="muted">—</span>`}</div>`;
}
function adminClientes() {
  const map = {};
  S.orders.filter((o) => !o.demo).forEach((o) => {
    const c = (map[o.customerEmail] ??= { email: o.customerEmail, name: o.customerName, n: 0, total: 0 });
    c.n++; c.total += o.total || 0;
  });
  const bannedSet = new Set(S.banned.map((b) => b.id));
  const list = Object.values(map).filter((c) => c.email && !bannedSet.has(c.email)).sort((a, b) => b.n - a.n);
  return `<h2>Clientes</h2>
  <form class="card form" style="margin:12px 0" data-form="banEmail"><input id="bnEmail" name="email" type="email" required placeholder="Bloquear por correo"><span></span><button class="btn bad">Banear</button></form>
  <div class="card">${list.map((c) => `<div class="item"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.email)} · ${c.n} pedido(s) · ${money(c.total)}</div></div><button class="btn sm bad" data-act="ban" data-email="${esc(c.email)}">Banear</button></div>`).join("") || `<span class="muted">Aún no hay clientes</span>`}</div>
  ${S.banned.length ? `<h2 class="sec">Baneados</h2><div class="card">${S.banned.map((b) => `<div class="item"><div><b>${esc(b.id)}</b><div class="muted">${esc(b.reason || "Sin motivo")}</div></div><button class="btn sm ghost" data-act="unban" data-email="${esc(b.id)}">Desbanear</button></div>`).join("")}</div>` : ""}`;
}

/* ====================== acciones ====================== */
const fail = (e) => { console.error(e); toast(e?.code === "permission-denied" ? "No tienes permiso para esta acción" : "Algo falló, intenta de nuevo", "bad"); };

const A = {
  async login() { try { await data.login(); } catch (e) { if (e?.code !== "auth/popup-closed-by-user") toast("No se pudo iniciar sesión: " + (e.code || e.message), "bad"); } },
  async loginGuest() {
    try {
      await data.loginGuest();
      toast("Entraste como invitado", "ok");
    } catch (e) {
      toast("Error al entrar como invitado: " + e.message, "bad");
    }
  },
  logout: () => data.logout(),
  notif: () => Notification.requestPermission().then(render),
  tab(d) { S.tab = d.t; render(); scrollTo(0, 0); },
  add(d) { S.cart[d.id] = (S.cart[d.id] || 0) + 1; render(); },
  sub(d) { S.cart[d.id] = (S.cart[d.id] || 1) - 1; if (S.cart[d.id] <= 0) delete S.cart[d.id]; render(); },
  openCart, closeModal,
  backdrop(d, el, e) { if (e.target === el) closeModal(); },
  openReview: (d) => openReview(d.id),
  star(d) { S.rv.n = Number(d.n); $modal.querySelectorAll(".star").forEach((b) => b.classList.toggle("on", Number(b.dataset.n) <= S.rv.n)); },
  async cancelOrder(d) { if (confirm("¿Cancelar este pedido?")) data.set("orders", d.id, { status: "cancelado" }).catch(fail); },
  
  resetPass() {
    const email = prompt("Escribe tu correo para enviarte el enlace de recuperación:");
    if (!email) return;
    data.resetPassword(email.trim())
      .then(() => toast("Revisa tu correo para restablecer la contraseña", "ok"))
      .catch((e) => toast("Error: " + e.message, "bad"));
  },

  // receptor
  async take(d) {
    const o = S.orders.find((x) => x.id === d.id);
    if (!o || o.status !== "espera") return toast("Otro receptor ya tomó este pedido", "bad");
    data.set("orders", d.id, { status: "trabajando", acceptedAt: data.stamp(), receptorUid: S.user.uid, receptorName: S.user.name }).then(() => { S.tab = "trabajando"; render(); }).catch(fail);
  },
  ready: (d) => data.set("orders", d.id, { status: "listo", readyAt: data.stamp() }).catch(fail),
  delivered: (d) => data.set("orders", d.id, { status: "entregado", deliveredAt: data.stamp() }).catch(fail),

  // admin
  toggleStaff(d) { const s = S.staff.find((x) => x.id === d.email); s && data.set("staff", d.email, { active: !s.active }).catch(fail); },
  setRole: (d) => data.set("staff", d.email, { role: d.role }).catch(fail),
  removeStaff(d) { if (confirm(`¿Eliminar a ${d.email} del equipo?`)) data.remove("staff", d.email).catch(fail); },
  toggleMenu(d) { const m = S.menu.find((x) => x.id === d.id); m && data.set("menu", d.id, { available: m.available === false }).catch(fail); },
  delMenu(d) { if (confirm("¿Eliminar este plato?")) data.remove("menu", d.id).catch(fail); },
  ban(d) { const reason = prompt(`Motivo para banear a ${d.email} (opcional):`); if (reason !== null) data.set("banned", d.email, { email: d.email, reason, by: S.user.email, at: data.stamp() }).then(() => toast("Cliente baneado", "ok")).catch(fail); },
  unban: (d) => data.remove("banned", d.email).catch(fail),
  seedDemo,
  async clearDemo() { for (const o of S.orders.filter((x) => x.demo)) await data.remove("orders", o.id).catch(fail); },
};

const F = {
  async emailAuth(f, submitter) {
    const v = new FormData(f);
    const email = String(v.get("email")).trim();
    const password = String(v.get("password"));
    const name = String(v.get("name") || "").trim();
    const mode = submitter?.value || "login";

    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      if (mode === "register") {
        await data.register(email, password, name || email);
        toast("Cuenta creada. ¡Bienvenido!", "ok");
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

  async placeOrder(f) {
    const v = new FormData(f);
    const lines = cartLines();
    if (!lines.length) return;
    const btn = f.querySelector("button:not([type])"); btn && (btn.disabled = true);
    const mesa = String(v.get("mesa")).trim();
    try {
      await data.set("orders", data.newId(), {
        customerUid: S.user.uid, 
        customerEmail: S.user.email || "Invitado", // Si no hay correo (invitado), se guarda como "Invitado"
        customerName: S.user.name || "Invitado",
        items: lines, total: lines.reduce((s, l) => s + l.price * l.qty, 0),
        mesa, note: String(v.get("note") || "").trim(), status: "espera", createdAt: data.stamp(),
      });
      S.mesa = mesa; S.cart = {}; S.tab = "pedidos";
      closeModal(); render();
      toast("Tu pedido fue enviado. Te avisaremos apenas lo tomen.", "ok", "¡Pedido enviado!");
    } catch (e) { btn && (btn.disabled = false); fail(e); }
  },

  review(f) {
    if (!S.rv || !S.rv.n) return toast("Elige de 1 a 5 estrellas", "bad");
    const comment = String(new FormData(f).get("comment") || "").trim();
    data.set("orders", S.rv.id, { review: { rating: S.rv.n, comment, at: data.stamp() } })
      .then(() => { closeModal(); toast("¡Gracias por tu opinión!", "ok"); }).catch(fail);
  },

  addStaff(f) {
    const v = new FormData(f);
    const email = String(v.get("email")).trim().toLowerCase();
    if (email === OWNER) return toast("El dueño ya tiene acceso total", "bad");
    data.set("staff", email, { email, role: v.get("role"), active: true, addedBy: S.user.email, createdAt: data.stamp() })
      .then(() => { f.reset(); render(); toast(`${email} agregado al equipo`, "ok"); }).catch(fail);
  },

  addMenu(f) {
    const v = new FormData(f);
    data.set("menu", data.newId(), {
      name: String(v.get("name")).trim(), price: Number(v.get("price")),
      emoji: String(v.get("emoji") || "🍽️").trim(), category: String(v.get("category") || "Platos").trim(), available: true,
    }).then(() => { f.reset(); render(); }).catch(fail);
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
  const t = now(), names = ["Ana", "Luis", "Carla"], clients = ["Marco", "Lucía", "Pedro", "Sofía"];
  const comments = ["Rápido y rico", "Excelente atención", "Llegó calientito", "Buen servicio"];
  for (let i = 0; i < 14; i++) {
    const created = Math.round(t - (i * 7 + 5) * 60000 - Math.random() * 60000);
    const wait = Math.round((30 + Math.random() * 190) * 1000), prep = Math.round((4 + Math.random() * 7) * 60000);
    const d = S.menu[Math.floor(Math.random() * S.menu.length)], qty = 1 + Math.floor(Math.random() * 2);
    const o = {
      demo: true, customerUid: "demo", customerEmail: `cliente${i}@demo.com`, customerName: clients[i % 4],
      items: [{ id: d.id, name: d.name, price: d.price, qty }], total: d.price * qty, mesa: String(1 + (i % 8)), note: "",
      status: "entregado", createdAt: created, acceptedAt: created + wait, readyAt: created + wait + prep,
      receptorUid: "demo_" + (i % 3), receptorName: names[i % 3] + " (demo)",
    };
    if (i % 2 === 0) o.review = { rating: 3 + Math.floor(Math.random() * 3), comment: comments[i % 4], at: o.readyAt };
    await data.set("orders", data.newId(), o).catch(fail);
  }
  toast("Datos de ejemplo creados (marcados como demo)", "ok");
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = A[el.dataset.act];
  fn && fn(el.dataset, el, e);
});

document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  F[f.dataset.form]?.(f, e.submitter);
});

render();
