# TurnoYa ⏱️ — Reduce los tiempos de espera en restaurantes

Web app (HTML + JS puro, **sin build**) para pedir en mesa y atender en tiempo real con una meta clara:
**cada pedido debe ser tomado en menos de 3 minutos.**

| Rol | Qué ve / hace |
|---|---|
| 🙋 Cliente | Menú, carrito, número de mesa, seguimiento en vivo (Enviado → Preparando → Listo), aviso con sonido, reseña al final. Nunca ve correos del equipo. |
| 🧑‍🍳 Receptor | Cola en vivo con alarma sonora, cronómetro por pedido (verde → ámbar → rojo a los 3 min), "Tomar pedido" → "Marcar listo" → "Entregado". Ve su propio rendimiento. |
| 👑 Dueño / Admin | Resumen con KPIs (espera promedio, % en meta, reseñas), rendimiento por receptor, alerta de pedidos retrasados, gestión de equipo (alta/baja/permiso admin), menú, reseñas y baneo de clientes. El dueño no se puede quitar. |

El rol se decide por el correo con el que inicia sesión (Google): dueño (config) → equipo (lista de admin) → cliente.

## Probar ya (modo demo, sin configurar nada)

Los módulos ES necesitan un servidor local:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Sin credenciales de Firebase corre en **modo demo**: los datos viven en el navegador. Abre 3 pestañas
(Dueño / Receptor / Cliente) con los botones rápidos y verás los pedidos sincronizarse entre pestañas.

## Demo en vivo con personas reales (Firebase, gratis)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Crear proyecto**.
2. **Authentication → Sign-in method → Google → Habilitar.**
3. **Firestore Database → Crear base de datos** (modo producción).
4. **Firestore → Reglas** → pega el contenido de `firestore.rules` → Publicar.
5. **Configuración del proyecto → Tus apps → Web (`</>`)** → copia el objeto `firebaseConfig` en `config.js`
   (solo necesitas `apiKey`, `authDomain`, `projectId`, `appId`).
6. En `config.js` y en `firestore.rules` pon **tu correo real de dueño**.
7. Sube el repo a GitHub → **Settings → Pages → Deploy from branch → main / root**.
8. **Authentication → Settings → Dominios autorizados** → agrega `TU-USUARIO.github.io`.

> ⚠️ Los correos de Gmail **no permiten el símbolo `$`**, así que `adminegocio1923$@gmail.com` no existe.
> Usa el correo real (por defecto el proyecto trae `adminegocio1923@gmail.com`).

La `apiKey` de Firebase es pública por diseño; lo que protege los datos son las **reglas de Firestore**.

## Guion sugerido para la demo

1. Dueño (tu laptop): agrega los correos de 1–2 compañeros como **Receptor**.
2. Público: escanea el link/QR de la web → entra con Google → pide. Tip: `?mesa=5` en la URL rellena la mesa
   (puedes generar un QR por mesa con cualquier generador).
3. Receptor (celular): suena la alarma → "Tomar pedido" → el cliente recibe sonido de confirmación.
4. Deja un pedido sin tomar 3 min: se pone rojo y avisa a receptores y dueño.
5. Muestra el **Resumen**: espera promedio, % en meta, ranking del equipo y reseñas.
   Ajusta `baselineWaitMin` en `config.js` con el tiempo real que midan sin el sistema para mostrar el % de mejora.
   El botón "Generar datos de ejemplo" llena el panel (marcado como demo y se borra con un clic).

## Lo que lo hace más sólido (mejoras sobre la idea original)

- **Meta de 3 min medida**: cronómetro, semáforo, alarma de retraso y métrica "% en meta".
- **Reloj del servidor**: los tiempos no dependen de la hora de cada celular.
- **Seguridad real** en `firestore.rules`: roles, dueño inamovible, clientes solo ven sus pedidos,
  reseña única y solo cuando el pedido está listo, baneados no pueden pedir.
- **Modo demo offline** por si falla el WiFi del evento.
- Sin dependencias ni build: se despliega arrastrando archivos.

## Límites conocidos (dilo con honestidad si preguntan)

- Dos receptores pulsando "Tomar" en el mismo segundo podrían pisarse (se resolvería con una transacción).
- Los receptores pueden editar cualquier campo de un pedido (las reglas no restringen campos para el equipo).
- Notificaciones: suena con la app abierta; con la pestaña cerrada haría falta Firebase Cloud Messaging.

## Archivos

`index.html` · `styles.css` · `app.js` (UI y lógica) · `data.js` (Firebase / modo demo) · `config.js` · `firestore.rules`
