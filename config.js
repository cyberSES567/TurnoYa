// ============================================================
//  CONFIGURACIÓN DE yaTA!
// ============================================================

export const CONFIG = {
  firebase: {
    apiKey: "AIzaSyCHJjVIKvPCKa9Yy54_0nu0jNZqcFwO_Do",
    authDomain: "turnoya-c49a0.firebaseapp.com",
    projectId: "turnoya-c49a0",
    storageBucket: "turnoya-c49a0.firebasestorage.app",
    messagingSenderId: "1037565797476",
    appId: "1:1037565797476:web:5058ef58f167c71150eb71",
    measurementId: "G-KFM9PVBKVC"
  },

  ownerEmail: "adminnegocio1923@gmail.com",
  
  ownerTwoFactor: false,

  restaurantName: "Sabor Express",
  currency: "S/",

  acceptSlaSeconds: 180,

  baselineWaitMin: 8,

  loyaltyEvery: 5,
  loyaltyStep: 5,
  loyaltyMax: 50,
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
