// ============================================================
//  CONFIGURACIÓN DE TURNOYA
// ============================================================

export const CONFIG = {
  // 1) Pega aquí la config de tu app web de Firebase (Consola → Configuración del proyecto).
  //    Si dejas apiKey vacío, la app corre en MODO DEMO (datos locales en el navegador).
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  },

  // 2) Correo del dueño. Debe ser el correo con el que inicias sesión con Google.
  //    OJO: Gmail NO permite "$" en las direcciones, así que "adminegocio1923$@gmail.com"
  //    no existe. Usa el real. También debe coincidir con firestore.rules.
  ownerEmail: "adminegocio1923@gmail.com",

  restaurantName: "Sabor Express",
  currency: "S/",

  // Meta: un pedido debe ser TOMADO en menos de este tiempo (segundos).
  acceptSlaSeconds: 180,

  // Tiempo de espera típico SIN el sistema (minutos). Solo para mostrar el % de mejora
  // en el panel. Cámbialo por el dato real que midan en su demo.
  baselineWaitMin: 8,
};

export const DEFAULT_MENU = [
  { name: "Ceviche clásico", price: 32, emoji: "🐟", category: "Platos" },
  { name: "Lomo saltado", price: 28, emoji: "🥩", category: "Platos" },
  { name: "Ají de gallina", price: 24, emoji: "🍗", category: "Platos" },
  { name: "Anticuchos", price: 22, emoji: "🍢", category: "Platos" },
  { name: "Hamburguesa criolla", price: 20, emoji: "🍔", category: "Platos" },
  { name: "Chicha morada", price: 6, emoji: "🍇", category: "Bebidas" },
  { name: "Limonada frozen", price: 8, emoji: "🍋", category: "Bebidas" },
  { name: "Suspiro limeño", price: 10, emoji: "🍮", category: "Postres" },
  { name: "Tres leches", price: 12, emoji: "🍰", category: "Postres" },
];
