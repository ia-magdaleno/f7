# Documentación Técnica de Ingeniería: Módulo POS `F7` (Cobro Avanzado) y Ficha Técnica `Ctrl+O`
**Destinatario:** Don Isael (Ingeniería / Arquitectura Cloud)  
**Repositorio:** `https://github.com/ia-magdaleno/f7`  
**Stack de Referencia:** Frontend Vanilla ES6+ Modular (`frontend/scripts/app/*.js`) + TailwindCSS + Backend FastAPI / SQLAlchemy (`backend/`)

---

## Índice de Arquitectura
1. [Módulo 1: Panel Desplegable de Ficha Técnica e Imagen del Producto (`Ctrl+O`)](#1-módulo-1-panel-desplegable-de-ficha-técnica-e-imagen-del-producto-ctrlo)
2. [Módulo 2: Máquina de Estados del Panel de Cobro (`F7` — `#totals-panel`)](#2-módulo-2-máquina-de-estados-del-panel-de-cobro-f7--totals-panel)
3. [Módulo 3: Aislamiento de Eventos de Teclado (`KeyboardEvent` Capturing & Bubbling)](#3-módulo-3-aislamiento-de-eventos-de-teclado-keyboardevent-capturing--bubbling)
4. [Módulo 4: Lógica Transaccional de Saldo a Favor (`#saldo-favor-popup-modal`)](#4-módulo-4-lógica-transaccional-de-saldo-a-favor-saldo-favor-popup-modal)
5. [Módulo 5: Reglas de Validación de Importes (Cambio en Efectivo vs. Tope Exacto/Mixto)](#5-módulo-5-reglas-de-validación-de-importes-cambio-en-efectivo-vs-tope-exactomixto)
6. [Módulo 6: Motor de Reglas para Ventas a Crédito (`CTRL+F6` / Código SAT `"006"`)](#6-módulo-6-motor-de-reglas-para-ventas-a-crédito-ctrlf6--código-sat-006)
7. [Módulo 7: Liga de Pago Multicanal, Polling/Webhooks y Auto-Liquidación en Caja](#7-módulo-7-liga-de-pago-multicanal-pollingwebhooks-y-auto-liquidación-en-caja)
8. [Módulo 8: Impresión Térmica Silenciosa (80mm) y Modal Post-Venta con Temporizador (`4000ms`)](#8-módulo-8-impresión-térmica-silenciosa-80mm-y-modal-post-venta-con-temporizador-4000ms)
9. [Contratos de API (Payloads JSON y Cambios en Base de Datos Cloud)](#9-contratos-de-api-payloads-json-y-cambios-en-base-de-datos-cloud)

---

## 1. Módulo 1: Panel Desplegable de Ficha Técnica e Imagen del Producto (`Ctrl+O`)

### 1.1 Archivos y Selectores DOM
- **Vista HTML:** `frontend/index.html`
  - Botón superior en barra de búsqueda: `#btn-toggle-product-info` (`data-click="toggleProductInfoPanel"`)
  - Pestaña divisoria lateral (divisor central-derecho): `#btn-toggle-product-info-edge` (`data-click="toggleProductInfoPanel"`)
  - Contenedor colapsable derecho: `<aside id="pos-right-product-card" class="w-72 xl:w-80 shrink-0 ...">`
- **Controlador JS:** `frontend/scripts/app/04-pos-cart.js` y `frontend/scripts/app/02-shortcuts.js`

### 1.2 Estado de Colapso y Persistencia (`toggleProductInfoPanel`)
```javascript
// Estado persistido en localStorage bajo la llave "calebsys_pos_product_panel_open" ("1" = abierto, "0" = cerrado)
function toggleProductInfoPanel(forceState) {
  const card = document.getElementById("pos-right-product-card");
  if (!card) return;
  const isCurrentlyHidden = card.classList.contains("hidden");
  const shouldOpen = typeof forceState === "boolean" ? forceState : isCurrentlyHidden;

  card.classList.toggle("hidden", !shouldOpen);
  localStorage.setItem("calebsys_pos_product_panel_open", shouldOpen ? "1" : "0");

  // Sincronización de íconos SVG (abierto vs cerrado) en el botón superior y en la pestaña lateral
  document.getElementById("icon-product-info-open")?.classList.toggle("hidden", !shouldOpen);
  document.getElementById("icon-product-info-closed")?.classList.toggle("hidden", shouldOpen);
  document.getElementById("edge-chevron-product-open")?.classList.toggle("hidden", !shouldOpen);
  document.getElementById("edge-chevron-product-closed")?.classList.toggle("hidden", shouldOpen);
}
window.toggleProductInfoPanel = toggleProductInfoPanel;
```
- **Efecto en el Layout CSS (`Flexbox`):** El contenedor padre `#sales-view` es `flex flex-row gap-4`. La columna izquierda/central tiene `flex-1 min-w-0`. Al aplicar `.hidden` (`display: none`) sobre `#pos-right-product-card`, el navegador recalcula el `flex-basis` y la tabla de ventas (`#cart-table-body`) ocupa el 100% del viewport horizontal sin recargar el DOM.

### 1.3 Data Binding Reactivo (`updatePosProductDetailCard(product)`)
Se invoca cada vez que cambia el producto activo por:
1. Navegación con `ArrowUp` / `ArrowDown` en `#autocomplete-dropdown`.
2. Inserción o escaneo en `addToCart(product)`.
3. Selección de fila en `#cart-table-body` (`selectedCartRowIndex`).
4. Navegación en el modal de búsqueda de artículos (`#modal-articles`, `renderProductSearchResults()`).

```javascript
window.currentPosSpecProduct = product; // Referencia en memoria del producto inspeccionado
```

| Selector DOM | Propiedad del Objeto `Product` | Transformación / Fallback |
| :--- | :--- | :--- |
| `#pos-spec-title` | `product.description` | `.toUpperCase()` |
| `#pos-spec-status` | `product.stock` | Si `stock > 0`: clase `bg-emerald-50 text-emerald-700`, texto `"En stock"`. Si `<= 0`: clase `bg-rose-50 text-rose-700`, texto `"Agotado"`. |
| `#pos-spec-image` | `product.image_url` | Si existe URL válida, quita `.hidden` de `<img>` y oculta `#pos-spec-image-placeholder`. En `onerror`, revierte al placeholder SVG. |
| `#pos-spec-price` | `product.price` / escalas | Calcula precio dinámico con `getProductPriceForClient(product, activeScale)` según escala activa (`Público General`, `Contratista`, `Distribuidor`). |
| `#pos-spec-sku` | `product.sku` | String directo |
| `#pos-spec-sat` | `product.sat_key` | Default `"40171517"` |
| `#pos-spec-unit` | `product.unit` | Default `"PIEZA"` |
| `#pos-spec-brand` | `product.brand \|\| product.department` | Default `"GENÉRICO"` |
| `#pos-spec-date` | `product.created_at` | Formateado `DD/MM/YYYY` |
| `#pos-spec-location` | `product.location` | Default `"Pasillo 2, A-3"` |
| `#pos-spec-suc1..4` | `product.stock_branch_1..4` | Stock multialmacén por sucursal (`"${qty} Pz"`). |

---

## 2. Módulo 2: Máquina de Estados del Panel de Cobro (`F7` — `#totals-panel`)

### 2.1 Variables Globales de Estado (`01-core.js` y `06-pos-checkout.js`)
```javascript
let selectedPaymentMethodCode = "001"; // "001"=Efectivo, "008"=Tarjeta Débito, "004"=Transferencia, "003"=Tarjeta Crédito, "002"=Puntos, "006"=A Crédito
let currentPayments = [];              // Array<{ method_code: string, amount: number, reference?: string }>
let isChargingInUsd = false;           // Bandera F10 (Cobro en dólares)
let saldoFavorApplied = false;         // Indica si se aplicó Saldo a Favor en el ciclo actual de F7
let saldoFavorAmount = 0;              // Monto en MXN descontado del total por Saldo a Favor
window._lastPreferredSaldoFavorAmount = 0; // Memoria temporal si el cajero sale con ESC y regresa con F7
window._creditExcessAuthorization = null;  // Firma de autorización de supervisor cuando hay excedente de crédito
window._pendingCreditClientSelection = false; // Flag de redirección automática desde #modal-clients hacia A Crédito
```

### 2.2 Inicialización Determinista al Presionar `F7` (`enterCheckoutMode`)
**Regla crítica de negocio:** Siempre que se presiona `F7`, el método de pago **debe iniciar forzosamente en `Efectivo ("001")`** y a partir de ahí el cajero puede cambiar de método.

```javascript
function enterCheckoutMode() {
  if (cart.length === 0) {
    showToast("Agrega productos antes de cobrar", "warning");
    return;
  }
  currentPayments = [];
  isChargingInUsd = false;
  window._creditExcessAuthorization = null;

  // Mostrar modal flotante #totals-panel
  const panel = document.getElementById("totals-panel");
  panel.classList.remove("hidden");

  // SIEMPRE inicializar en Efectivo ("001") por defecto
  selectPaymentMethod("001");

  // Si el cliente activo tiene Saldo a Favor disponible (> 0) y no se ha aplicado en esta sesión de cobro:
  const availFav = parseFloat(activeClient?.saldo_favor || 0);
  if (availFav > 0.009 && !saldoFavorApplied) {
    setTimeout(() => openSaldoFavorPopup(), 60);
    return;
  }

  // Precargar el total exacto a pagar en #amount-tendered y seleccionar texto
  const input = document.getElementById("amount-tendered");
  if (input) {
    input.value = getRemainingToPay().toFixed(2);
    input.focus();
    input.select();
  }
}
```

---

## 3. Módulo 3: Aislamiento de Eventos de Teclado (`KeyboardEvent` Capturing & Bubbling)

### 3.1 Problema Técnico Resuelto
En el POS, las teclas `ArrowUp`, `ArrowDown`, `ArrowLeft` y `ArrowRight` navegaban las filas del carrito (`#cart-table-body`) o abrían el modal de edición de cantidad. Cuando `#totals-panel` (`F7`) estaba abierto y el cajero usaba las flechas o se equivocaba al cambiar a `F2 Tarjeta`, el evento bajaba al carrito de atrás.

### 3.2 Implementación del Interceptor en `02-shortcuts.js` y `06-pos-checkout.js`
En `handleGlobalShortcuts(e)` (`02-shortcuts.js`) y en el listener de `#amount-tendered` (`06-pos-checkout.js`):

```javascript
// Orden secuencial de métodos de pago en el carrusel de F7:
const CHECKOUT_METHODS_ORDER = ["001", "008", "004", "003", "002", "006"];

function stepCheckoutPaymentMethod(delta) {
  const idx = CHECKOUT_METHODS_ORDER.indexOf(selectedPaymentMethodCode);
  const currentIdx = idx >= 0 ? idx : 0;
  const nextIdx = (currentIdx + delta + CHECKOUT_METHODS_ORDER.length) % CHECKOUT_METHODS_ORDER.length;
  selectPaymentMethod(CHECKOUT_METHODS_ORDER[nextIdx]);
}
```

Cuando `#totals-panel` está visible (`!totalsPanel.classList.contains("hidden")`):
1. **Si hay un sub-modal activo encima de `F7`** (`#saldo-favor-popup-modal`, `#credit-exceeded-auth-modal`, `#payment-link-modal`): el teclado es gobernado exclusivamente por ese sub-modal (`Enter` confirma, `Escape` cierra el sub-modal).
2. **Si el foco está en un input auxiliar secundario** (ej. `#credito-ref-input`, `#transfer-ref-input`): las flechas `ArrowLeft`/`ArrowRight` mueven el cursor de texto normalmente dentro de ese input sin tocar el carrito.
3. **En el flujo normal de `F7` (foco en `#amount-tendered` o en tarjetas de método):**
   - `ArrowRight` / `ArrowDown` → `e.preventDefault(); e.stopPropagation(); stepCheckoutPaymentMethod(+1);`
   - `ArrowLeft` / `ArrowUp` → `e.preventDefault(); e.stopPropagation(); stepCheckoutPaymentMethod(-1);`
   - `F1` → `selectPaymentMethod("001")` (Efectivo)
   - `F2` → `selectPaymentMethod("008")` (Tarjeta Débito)
   - `F3` → `selectPaymentMethod("004")` (Transferencia)
   - `F7` → `selectPaymentMethod("003")` (Tarjeta Crédito)
   - `Ctrl + F6` → `selectPaymentMethod("006")` (A Crédito)
   - `F10` → `toggleUsdPayment()` (Cobrar en DLLS)
   - `Escape` → `exitCheckoutMode()` (Cancela sesión de cobro y regresa a la tabla de venta).

---

## 4. Módulo 4: Lógica Transaccional de Saldo a Favor (`#saldo-favor-popup-modal`)

### 4.1 Regla de Negocio (Ciclo `F7` → Aplicar Parcial → `ESC` → Modificar Venta → `F7`)
> *"Si el cliente tiene saldo a favor (ejemplo $100.00) y se van a aplicar $30.00, pero se tiene que devolver a la venta con `ESC`, se modifica la venta y se va a `F7` de nuevo para pagar, debe volver a pedir aplicarse el total deseado."*

### 4.2 Implementación en Código (`06-pos-checkout.js`)
1. **Al abrir `openSaldoFavorPopup()`:**
   - Calcula el máximo aplicable: `maxApplicable = Math.min(availFav, totalCart)`.
   - Si existe `window._lastPreferredSaldoFavorAmount > 0`, sugiere `Math.min(window._lastPreferredSaldoFavorAmount, maxApplicable)`. De lo contrario, inicia en `0.00` seleccionado para que el cajero escriba la cantidad deseada o presione `APLICAR TODO`.
2. **Al confirmar `confirmSaldoFavorPopup()` (`Enter`):**
   - Valida `0 <= val <= maxApplicable`.
   - Guarda `window._lastPreferredSaldoFavorAmount = val`.
   - Si `val > 0`:
     ```javascript
     saldoFavorApplied = true;
     saldoFavorAmount = val;
     ```
   - Recalcula `getRemainingToPay()` (`totalVenta - saldoFavorAmount - sum(currentPayments)`).
   - Cierra `#saldo-favor-popup-modal`, selecciona `Efectivo ("001")` y coloca en `#amount-tendered` el restante por pagar (ej. `$70.00`).
3. **Al salir con `ESC` sin concretar la venta (`exitCheckoutMode()`):**
   ```javascript
   // Si el cajero sale con ESC para modificar la venta, se revierte la aplicación en curso
   // para que al volver a presionar F7 vuelva a preguntar cuánto desea aplicar sobre el nuevo total.
   saldoFavorApplied = false;
   saldoFavorAmount = 0;
   ```
4. **Al concretar la venta (`submitCheckoutSale`):**
   - Se envía al backend `use_saldo_favor: saldoFavorAmount` dentro del payload de `POST /api/sales` y se descuenta de `activeClient.saldo_favor`.

### 4.3 Estilo Visual Glassmorphism Verde (`#saldo-favor-popup-modal`)
Para evitar que compilaciones parciales de Tailwind omitan modificadores de opacidad arbitrarios (`bg-emerald-200/82`), el contenedor aplica CSS explícito inline con soporte WebKit:
```css
background: linear-gradient(180deg, rgba(209, 250, 229, 0.86) 0%, rgba(167, 243, 208, 0.82) 52%, rgba(110, 231, 183, 0.78) 100%);
backdrop-filter: blur(18px) saturate(160%);
-webkit-backdrop-filter: blur(18px) saturate(160%);
border: 2px solid rgba(16, 185, 129, 0.65);
box-shadow: 0 24px 60px rgba(6, 78, 59, 0.38), inset 0 1.5px 2px rgba(255, 255, 255, 0.92);
```

---

## 5. Módulo 5: Reglas de Validación de Importes (Cambio en Efectivo vs. Tope Exacto/Mixto)

### 5.1 Matriz de Comportamiento por Método de Pago

| Código | Método | ¿Permite `monto < restante` (Pago Mixto)? | ¿Permite `monto == restante` (Pago Exacto)? | ¿Permite `monto > restante` (Dar Cambio)? |
| :---: | :--- | :---: | :---: | :---: |
| **`001`** | **Efectivo (`F1`)** | ✅ Sí (registra abono parcial) | ✅ Sí (liquida venta) | ✅ **SÍ (Calcula Cambio: `monto - restante`)** |
| **`008`** | **Tarjeta Débito (`F2`)** | ✅ Sí (Pago Mixto) | ✅ Sí (Pago Exacto) | ❌ **BLOQUEADO (`max = restante`)** |
| **`004`** | **Transferencia (`F3`)** | ✅ Sí (Pago Mixto) | ✅ Sí (Pago Exacto) | ❌ **BLOQUEADO (`max = restante`)** |
| **`003`** | **Tarjeta Crédito (`F7`)** | ✅ Sí (Pago Mixto) | ✅ Sí (Pago Exacto) | ❌ **BLOQUEADO (`max = restante`)** |
| **`002`** | **Puntos Lealtad** | ✅ Sí (Pago Mixto) | ✅ Sí (Pago Exacto) | ❌ **BLOQUEADO (`max = restante`)** |
| **`006`** | **A Crédito (`CTRL+F6`)** | ✅ Sí (Pago Mixto) | ✅ Sí (Pago Exacto) | ❌ **BLOQUEADO (`max = restante`)** |

### 5.2 Tres Capas de Protección en `06-pos-checkout.js`
1. **Capa 1 — Sanitización en vivo (`input` event en `#amount-tendered`):**
   ```javascript
   if (selectedPaymentMethodCode !== "001") {
     const maxAllowed = isChargingInUsd ? (remainingMxn / exchangeRate) : remainingMxn;
     if (typedValue > maxAllowed + 0.009) {
       amountInput.value = maxAllowed.toFixed(2);
       showToast("Solo en Efectivo se permite capturar una cantidad mayor para dar cambio", "warning");
     }
   }
   ```
2. **Capa 2 — Normalización al cambiar de método (`selectPaymentMethod(code)`):**
   - Si el cajero cambia a cualquier método `!== "001"` y el valor en `#amount-tendered` supera `getRemainingToPay()`, lo recorta automáticamente a `getRemainingToPay().toFixed(2)`.
3. **Capa 3 — Barrera transaccional antes de emitir ticket (`handlePaymentConfirmation` y `submitCheckoutSale`):**
   ```javascript
   if (selectedPaymentMethodCode !== "001" && amountInMxn > remaining + 0.009) {
     showToast("En este método de pago el monto debe ser exacto o menor (pago mixto). No se puede expedir ticket con excedente.", "error");
     amountInput.value = (isChargingInUsd ? remaining / rate : remaining).toFixed(2);
     return; // ABORTA COBRO Y NO EXPIDE TICKET
   }
   ```

---

## 6. Módulo 6: Motor de Reglas para Ventas a Crédito (`CTRL+F6` / Código SAT `"006"`)

### 6.1 Métricas Financieras del Cliente (`getClientCreditMetrics`)
```javascript
function getClientCreditMetrics(clientObj, requestedMxn = null) {
  const isPublicClient = !clientObj || !clientObj.id || Number(clientObj.id) === 1 ||
    (clientObj.rfc || "").toUpperCase() === "XAXX010101000" ||
    (clientObj.name || "").toUpperCase().includes("PUBLICO EN GENERAL");

  const creditLimit = isPublicClient ? 0 : Math.max(0, parseFloat(clientObj.limite_credito || 0));
  const currentBalance = isPublicClient ? 0 : Math.max(0, parseFloat(clientObj.saldo_actual || 0));
  const availableCredit = Math.max(0, creditLimit - currentBalance);
  const requested = requestedMxn !== null ? requestedMxn : getRemainingToPay();
  const excessAmount = Math.max(0, requested - availableCredit);

  return {
    isPublicClient,
    hasCreditDefined: !isPublicClient && creditLimit > 0.009,
    creditLimit,
    currentBalance,
    availableCredit,
    requested,
    excessAmount,
    isExceeded: !isPublicClient && creditLimit > 0.009 && excessAmount > 0.009
  };
}
```

### 6.2 Secuencia de 4 Validaciones Obligatorias en `06-pos-checkout.js`

#### Validación A: ¿Tiene Cliente Definido? (`!metrics.isPublicClient`)
- Si `isPublicClient === true` cuando el cajero selecciona `A Crédito ("006")` o intenta cobrar a crédito:
  1. Invoca `openClientSelectorForCredit()`.
  2. Activa la bandera `window._pendingCreditClientSelection = true`.
  3. Abre `#modal-clients` (`z-[80]`, superior al `z-50` de `#totals-panel`) y muestra el banner `#client-modal-credit-prompt-banner`.
  4. Cuando el cajero elige o crea un cliente en `selectClientForPOS(client)` (`05-search-client.js`), el callback detecta `window._pendingCreditClientSelection === true`, cierra `#modal-clients` y ejecuta `selectPaymentMethod("006")` automáticamente.

#### Validación B: ¿El Cliente Tiene Línea de Crédito Definida? (`metrics.hasCreditDefined`)
- Si `creditLimit <= 0`:
  - Invoca `openCreditControlModal("no_credit_defined", metrics)`.
  - Muestra `#credit-exceeded-auth-modal` con el bloque `#credit-modal-no-credit-box` (**ENVÍO A CRÉDITO BLOQUEADO**).
  - **No existe botón de autorización cuando el límite es `$0.00`**: el cajero solo puede elegir **`👥 CAMBIAR CLIENTE (F1)`** o **`💵 VOLVER A EFECTIVO (ESC)`**.

#### Validación C: ¿El Monto Solicitado Excede el Crédito Disponible? (`metrics.isExceeded`)
- Si `requested > availableCredit` y no existe una firma válida en `window._creditExcessAuthorization` para ese cliente y monto:
  - Invoca `openCreditControlModal("credit_exceeded", metrics)`.
  - Presenta en `#credit-exceeded-auth-modal` el desglose financiero (`Límite`, `Saldo Actual`, `Disponible`, `Monto Solicitado` y `Excedente`) y ofrece **3 acciones**:
    1. **`✅ AUTORIZAR EXCEDENTE` (`authorizeCreditExcessSale()`):**
       - Verifica si el usuario logueado tiene rol `admin`/`gerente`/`supervisor` o valida el PIN de autorización (`#credit-auth-pin-input`) + el motivo/autorizador (`#credit-auth-reason-input`).
       - Registra la autorización:
         ```javascript
         window._creditExcessAuthorization = {
           clientId: activeClient.id,
           authorizedUpTo: metrics.requested,
           excessAmount: metrics.excessAmount,
           authorizedBy: reasonText,
           timestamp: new Date().toISOString()
         };
         ```
    2. **`💳 USAR SOLO DISPONIBLE` (`adjustCreditToAvailableMixed()`):**
       - Si `availableCredit > 0`, ajusta `#amount-tendered` exactamente a `availableCredit.toFixed(2)` para que se cobre como **Pago Mixto** (la parte disponible se va a Crédito y el resto se liquida con Efectivo/Tarjeta).
    3. **`🚫 BLOQUEAR CRÉDITO` (`blockAndCancelCreditSale()`):**
       - Cancela el cargo a crédito y regresa a `Efectivo ("001")`.

#### Validación D: Referencia Obligatoria para Entregarse (`#credito-ref-input`)
- En toda venta con cargo a `"006"`, antes de enviar `POST /api/sales`, se exige que `#credito-ref-input.value.trim().length > 0`.
- Si está vacío, aborta el cobro, aplica borde rojo (`ring-2 ring-red-500`) y hace `.focus()` en `#credito-ref-input`.
- La referencia se concatena en el campo `reference` del pago:
  ```javascript
  // Formato almacenado en SalePayment.reference y AccountsReceivable.notes:
  "ENTREGA: Ing. Roberto Gómez | OBRA: Fracc. Los Pinos | AUT. EXCEDENTE (+$1,200.00): Autorizado por Gerencia"
  ```

### 6.3 Sincronización Contable en Backend (`backend/crud.py`)
En `backend/crud.py`, tanto al crear una venta a crédito (`_create_sale_credit`) como al abonar en CxC (`register_ar_payment`), se mantiene sincronizado el campo `Client.saldo_actual` en la tabla `clients`:
```python
# En _create_sale_credit(db, db_sale, credit_amount):
client_obj = db.query(models.Client).filter(models.Client.id == db_sale.client_id).first()
if client_obj:
    open_ars = db.query(models.AccountsReceivable).filter(
        models.AccountsReceivable.client_id == db_sale.client_id,
        models.AccountsReceivable.status != "paid"
    ).all()
    client_obj.saldo_actual = round(sum(float(a.balance or 0) for a in open_ars), 2)
```

---

## 7. Módulo 7: Liga de Pago Multicanal, Polling/Webhooks y Auto-Liquidación en Caja

### 7.1 Flujo Técnico End-to-End
1. **Generación de Orden (`openPaymentLinkModal`):**
   - Dentro de `Transferencia ("004")`, el botón `#btn-open-payment-link` invoca `POST /api/payment-links` enviando:
     ```json
     {
       "amount": 456.00,
       "client_id": 12,
       "client_name": "ANA LUCIA MENDOZA PAREDES",
       "client_phone": "8151234567",
       "client_email": "analucia@correo.com",
       "items_summary": "1x CEMENTO GRIS PORTLAND GALLITO"
     }
     ```
   - **Pre-llenado inteligente:**
     - Si `activeClient` es un cliente registrado (`!isPublicClient`), precarga automáticamente `name`, `phone` y `email` en los inputs `#paylink-recipient-name`, `#paylink-recipient-phone` y `#paylink-recipient-email`, dejándolos **editables** por si el cliente pide mandar la liga a otro número o correo.
     - Si es `Público en General`, limpia los campos y muestra el banner ámbar pidiendo capturar el destinatario.
2. **Despacho Multicanal y Liberación de Caja (`sendPaymentLinkByChannel(channel)`):**
   - Canales soportados: `"whatsapp"`, `"email"`, `"sms"`, `"portal"`, `"alert_only"`.
   - Clona el snapshot del carrito actual (`cartSnapshot`), el cliente (`clientSnapshot`), pagos previos (`paymentsSnapshot`) y saldo a favor aplicado.
   - Registra el objeto monitor en `window._activePaymentLinkWatches` (persistido en `sessionStorage`) y renderiza la tarjeta flotante en `#cashier-payment-link-watches` con estado `"pending"`.
   - **Libera la caja inmediatamente:** limpia `cart = []`, cierra `#totals-panel` y permite al cajero cobrar a los siguientes clientes en la fila mientras la orden espera el pago.
3. **Monitoreo Asíncrono (`startPaymentLinkPolling` + `BroadcastChannel`):**
   - Un `setInterval` cada `2500ms` consulta `GET /api/payment-links/{order_id}` (además de escuchar eventos instantáneos vía `BroadcastChannel("calebsys_payment_links")`).
4. **Autorización Bancaria Automática (`autoCompleteSaleFromPaidLink(watch)`):**
   - En cuanto el endpoint reporta `status === "paid"` (porque el cliente pagó en el portal o el webhook de la pasarela confirmó el SPEI/Tarjeta):
     1. El POS construye automáticamente el payload de `POST /api/sales` usando el `cartSnapshot` guardado en el `watch` y adjunta la referencia bancaria (`auth_reference`, ej. `SPEI-849201`).
     2. Registra la venta en la base de datos sin intervención manual del cajero.
     3. Reproduce alerta sonora y despliega el modal `#payment-link-authorized-modal` (**PAGO DE LIGA AUTORIZADO AUTOMÁTICAMENTE**) con el Folio de Venta POS asignado y botón directo para imprimir el ticket.

---

## 8. Módulo 8: Impresión Térmica Silenciosa (80mm) y Modal Post-Venta con Temporizador (`4000ms`)

### 8.1 Impresión Directa al Concretar la Venta (`showTicketModal`)
- Al recibir el `200 OK` de `POST /api/sales`:
  1. Se construye el HTML del ticket térmico en `#ticket-80mm`.
  2. Se invoca inmediatamente `triggerSilentThermalPrint(sale)` **sin preguntar**, enviando los comandos ESC/POS a `POST /api/Hardware/print-raw`.
  3. Se abre en cascada `openPrintShareFlow(true)` (`#modal-print-share`).

### 8.2 Modal Post-Venta Simplificado (`#modal-print-share` en `index.html` y `02-shortcuts.js`)
Como el ticket de 80mm ya se imprimió en automático, el paso 1 (`#ps-step-1`) ofrece **únicamente 2 opciones**:
1. **`IMPRIMIR EN CARTA` (`#ps-btn-carta` → `psImprimirCartaDirecto()`):**
   - Establece `_psFormat = "carta"`, genera el documento A4 membretado (`buildCartaHTML`) y abre el diálogo de impresión de hoja Carta.
2. **`ENVIAR` (`#ps-btn-enviar` → `psPaso3()`):**
   - Abre el paso de canales digitales (`WhatsApp`, `Correo Electrónico`, `Facebook Messenger` y anexado de `Liga de Pago`).

### 8.3 Temporizador de 4 Segundos (`4000ms`), Navegación con Flechas y Cierre Rápido con `ESC`
```javascript
// En openPrintShareFlow(autoAfterSale = true):
if (_postSaleAutoMode) {
  _postSaleFormatTimer = setTimeout(() => {
    dismissPostSaleFormatAndContinue(); // Cierra #modal-print-share y #modal-ticket a los 4 segundos
  }, 4000);
}
```
- **Interacción por Teclado (`02-shortcuts.js`):**
  - `ArrowLeft` / `ArrowRight`: Cancela el timer de 4 segundos (`clearPostSaleFormatTimer()`), alterna `_psStep1SelectedIndex` entre `0` (`IMPRIMIR EN CARTA`) y `1` (`ENVIAR`) y actualiza el anillo visual (`renderPsStep1Highlight()`).
  - `Enter`: Cancela el timer de 4 segundos y ejecuta la opción activa (`executePsStep1Selection()`).
  - `Escape`: Cancela el timer de 4 segundos y ejecuta inmediatamente `dismissPostSaleFormatAndContinue()`, cerrando todo antes de los 4 segundos y devolviendo el foco a `#product-input`.
- **Interacción por Mouse:**
  - Eventos `mouseenter` y `pointerdown` sobre `#ps-btn-carta` y `#ps-btn-enviar` detienen automáticamente `_postSaleFormatTimer` para que la ventana nunca se cierre mientras el cajero está eligiendo con el cursor.

---

## 9. Contratos de API (Payloads JSON y Cambios en Base de Datos Cloud)

### 9.1 Payload de Creación de Venta (`POST /api/sales`)
```json
{
  "branch_id": 1,
  "user_id": 1,
  "client_id": 12,
  "total": 410.64,
  "discount": 0,
  "paid_with": 410.64,
  "change_given": 0,
  "payment_method": "006",
  "status": "completed",
  "is_Safekept": false,
  "is_invoiced": false,
  "use_saldo_favor": 30.00,
  "loyalty_points_used": 0,
  "items": [
    {
      "product_sku": "CEM50",
      "description": "CEMENTO GALLOS 50 KG",
      "quantity": 1,
      "unit_price": 410.64,
      "subtotal": 410.64,
      "from_branch_id": 1
    }
  ],
  "payments": [
    {
      "method_code": "006",
      "amount": 380.64,
      "reference": "ENTREGA: Juan Pérez | OBRA: Bodega Norte | AUT. EXCEDENTE (+$80.64): Aut. Supervisor"
    }
  ]
}
```

### 9.2 Campos Requeridos en la Tabla `clients` (Base de Datos Cloud)
Para que todas las validaciones de Crédito y Saldo a Favor operen idénticamente en la nube:
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS dias_credito INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS saldo_actual NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS saldo_favor NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0;
```

### 9.3 Endpoints de Ligas de Pago (`backend/main.py`)
| Método | Ruta | Descripción |
| :---: | :--- | :--- |
| `POST` | `/api/payment-links` | Crea una orden de liga de pago con `order_id` único (`ORD-XXXXXX`), `amount`, datos del destinatario y `status = "pending"`. |
| `GET` | `/api/payment-links/{order_id}` | Consulta el estado actual (`pending` \| `paid` \| `cancelled`) y datos de autorización bancaria (`auth_reference`, `paid_at`, `payment_channel`). |
| `GET` | `/api/payment-links/{order_id}/portal` | Renderiza la pasarela web interactiva (`frontend/pay-link.html`) para que el cliente realice el pago desde su celular o navegador. |
| `POST` | `/api/payment-links/{order_id}/confirm` | Endpoint de confirmación/webhook que marca `status = "paid"`, genera el código de autorización bancaria y dispara la auto-liquidación en la caja del POS. |
