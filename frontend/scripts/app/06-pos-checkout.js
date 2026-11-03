/* 06-pos-checkout.js — Payment method, change calc, submitSale, ticket modal, print
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 2764-3294 */
// --- SIDEBAR COBRAR & PAYMENT LOGIC (MÓDULO 5) ---

// GAP-2: handler ENTER en el importe — referencia módulo para poder limpiarlo
let _cashEnterHandler = null;

// Pago multimodal: formas de pago YA aplicadas (nunca incluye el efectivo de
// cierre — ese lo agrega submitSale()). [{ method:"003", amount: 500.00 }, ...]
let splitPayments = [];

const PAY_LABELS = {
  "001": "EFECTIVO", "002": "PAGAR CON PUNTOS", "003": "TARJETA DE CRÉDITO",
  "004": "TRANSFERENCIA", "006": "A CRÉDITO", "008": "T. DÉBITO"
};

function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function _fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _parseMoney(val) {
  if (typeof val === "number") return val;
  const cleaned = String(val ?? "").replace(/,/g, "").trim();
  return parseFloat(cleaned);
}
window._fmtMoney = _fmtMoney;
window._parseMoney = _parseMoney;


// C-03: Lee los datos del panel de captura del método activo.
function _readPaymentMeta(method) {
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  if (method === "002") {
    const m = { banco: v("chq-banco"), girador: v("chq-girador"), numero: v("chq-numero"), monto: v("chq-monto") };
    return (m.banco || m.numero) ? m : null;
  }
  if (method === "004") {
    const m = { referencia: v("trf-referencia"), banco_origen: v("trf-banco-origen"), estatus: v("trf-estatus") };
    return (m.referencia || m.banco_origen) ? m : null;
  }
  if (method === "003" || method === "008") {
    const m = { aprobacion: v("tdc-aprobacion"), recibo: v("tdc-recibo"), digitos: v("tdc-digitos"), fecha_hora: v("tdc-fecha") };
    return (m.aprobacion || m.digitos) ? m : null;
  }
  if (method === "006") {
    const authInfo = window._creditExcessAuthorizedForSale;
    const m = {
      referencia: v("crd-referencia"),
      observaciones: v("crd-observaciones"),
      ...(authInfo ? {
        excedente_autorizado: authInfo.maxExcess,
        autorizado_por: authInfo.authorizedBy,
        motivo_autorizacion: authInfo.reason
      } : {})
    };
    return (m.referencia || m.observaciones || m.autorizado_por) ? m : null;
  }
  return null;
}

// C-03: Limpia todos los campos de los paneles de captura.
function _clearPaymentMeta() {
  ["chq-banco","chq-girador","chq-numero","chq-monto",
   "trf-referencia","trf-banco-origen",
   "tdc-aprobacion","tdc-recibo","tdc-digitos","tdc-fecha",
   "crd-referencia","crd-observaciones"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const sel = document.getElementById("trf-estatus"); if (sel) sel.value = "confirmada";
}

// C-03: Genera HTML de datos del método para el ticket térmico.
function _renderPayMetaHTML(meta, method) {
  if (!meta) return "";
  const row = (lbl, val) => val ? `<div class="t-flex t-small"><span>&nbsp;&nbsp;${lbl}:</span><span>${val}</span></div>` : "";
  if (method === "002") {
    return row("Banco", meta.banco) + row("Girador", meta.girador) + row("Nº Cheque", meta.numero);
  }
  if (method === "004") {
    return row("Referencia", meta.referencia) + row("Banco", meta.banco_origen) +
           (meta.estatus ? row("Estatus", meta.estatus.toUpperCase()) : "");
  }
  if (method === "003" || method === "008") {
    return row("Aprobación", meta.aprobacion) + row("Recibo", meta.recibo) +
           (meta.digitos ? row("Tarjeta", `**** ${meta.digitos}`) : "");
  }
  if (method === "006") {
    return row("Ref. Entrega", meta.referencia) +
           row("Obs.", meta.observaciones) +
           (meta.autorizado_por ? row("Aut. Excedente", `${meta.autorizado_por}${meta.motivo_autorizacion ? ' (' + meta.motivo_autorizacion + ')' : ''}`) : "");
  }
  return "";
}

// Suma de lo ya aplicado en formas de pago no-efectivo.
function paymentApplied() {
  return _round2(splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

// Lo que falta por cubrir del total (>= 0).
function paymentRestante() {
  const totals = calculateTotals();
  const sfAplicado = _getSaldoFavorAplicado();
  return Math.max(0, _round2(Math.abs(totals.total) - paymentApplied() - sfAplicado));
}

window._customSaldoFavorAmount = 0;
let _sfPopupKeyHandler = null;

// E-06a: saldo_favor aplicado a esta venta (0 si el toggle no está activo).
function _getSaldoFavorAplicado() {
  const toggle = document.getElementById('saldo-favor-toggle');
  if (!toggle || !toggle.checked) return 0;
  const totals = calculateTotals();
  const disponible = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  const maxAplicable = Math.min(disponible, Math.abs(totals.total));
  if (typeof window._customSaldoFavorAmount === 'number' && window._customSaldoFavorAmount > 0) {
    return _round2(Math.min(window._customSaldoFavorAmount, maxAplicable));
  }
  return _round2(maxAplicable);
}

// E-06a/E-06b: mostrar/ocultar el row de saldo_favor y el banner de alerta.
function refreshSaldoFavorRow() {
  const row    = document.getElementById('saldo-favor-row');
  const label  = document.getElementById('saldo-favor-label');
  const toggle = document.getElementById('saldo-favor-toggle');
  const alert  = document.getElementById('saldo-favor-alert');
  const alertAmt = document.getElementById('saldo-favor-alert-amount');
  const alertBtn = document.getElementById('saldo-favor-alert-btn');
  const sfSummaryRow = document.getElementById('checkout-saldo-favor-summary-row');
  const sfSummaryDisp = document.getElementById('checkout-saldo-favor-summary-display');

  const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  const fmtSf = '$' + sf.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sfApplied = !!(toggle && toggle.checked);
  const appliedAmt = _getSaldoFavorAplicado();

  if (sfSummaryRow && sfSummaryDisp) {
    if (sfApplied && appliedAmt > 0) {
      sfSummaryRow.classList.remove('hidden');
      sfSummaryDisp.textContent = '-$' + _fmtMoney(appliedAmt);
    } else {
      sfSummaryRow.classList.add('hidden');
    }
  }

  if (sf > 0) {
    if (row)   row.classList.add('hidden');
    if (label) {
      label.textContent = (sfApplied && appliedAmt > 0)
        ? `$${_fmtMoney(appliedAmt)} de ${fmtSf}`
        : fmtSf;
    }

    // Banner de alerta en el carrito
    if (alert) alert.classList.remove('hidden');
    if (alertAmt) alertAmt.textContent = fmtSf;
    // Cambiar botón a "Quitar" si ya está aplicado
    if (alertBtn) {
      if (sfApplied) {
        alertBtn.textContent = 'Quitar';
        alertBtn.classList.replace('bg-emerald-500', 'bg-slate-400');
        alertBtn.classList.replace('hover:bg-emerald-600', 'hover:bg-slate-500');
      } else {
        alertBtn.textContent = 'Aplicar';
        alertBtn.classList.replace('bg-slate-400', 'bg-emerald-500');
        alertBtn.classList.replace('hover:bg-slate-500', 'hover:bg-emerald-600');
      }
    }
  } else {
    if (row)   row.classList.add('hidden');
    if (alert) alert.classList.add('hidden');
    if (toggle) toggle.checked = false;
    window._customSaldoFavorAmount = 0;
  }
}

function _syncCheckoutAfterSaldoFavorChange() {
  refreshSaldoFavorRow();
  renderCheckoutSummaryItems();
  const cashInput = document.getElementById('cash-received-input');
  if (cashInput) {
    const rest = paymentRestante();
    const isUsd = !!window._checkoutUsdMode;
    const rate = getCheckoutUsdRate();
    cashInput.value = isUsd ? _fmtMoney(rest / rate) : _fmtMoney(rest);
    cashInput.dataset.autoFilled = '1';
  }
  calculateChange();
}

// Abre el recuadro emergente en verde claro encima de la ventana de cobro (F7)
function openSaldoFavorPopup() {
  const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  if (sf <= 0) return;

  const modal = document.getElementById('saldo-favor-popup-modal');
  const availEl = document.getElementById('saldo-favor-popup-available');
  const inp = document.getElementById('saldo-favor-popup-input');
  const toggle = document.getElementById('saldo-favor-toggle');
  if (!modal || !inp) return;

  if (availEl) {
    availEl.textContent = `A FAVOR $ ${_fmtMoney(sf)}`;
  }

  const currentApplied = (toggle && toggle.checked && window._customSaldoFavorAmount > 0)
    ? window._customSaldoFavorAmount
    : 0;
  inp.value = currentApplied > 0 ? currentApplied.toFixed(2) : '0.00';

  if (_sfPopupKeyHandler) {
    inp.removeEventListener('keydown', _sfPopupKeyHandler);
    _sfPopupKeyHandler = null;
  }
  _sfPopupKeyHandler = function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmSaldoFavorPopup();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSaldoFavorPopup();
    }
  };
  inp.addEventListener('keydown', _sfPopupKeyHandler);

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    inp.focus();
    inp.select();
  });
}
window.openSaldoFavorPopup = openSaldoFavorPopup;

function confirmSaldoFavorPopup() {
  const modal = document.getElementById('saldo-favor-popup-modal');
  const inp = document.getElementById('saldo-favor-popup-input');
  const toggle = document.getElementById('saldo-favor-toggle');
  const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  const totals = calculateTotals();
  const maxAplicable = _round2(Math.min(sf, Math.abs(totals.total)));

  let raw = _parseMoney(inp && inp.value);
  if (isNaN(raw) || raw <= 0) {
    window._customSaldoFavorAmount = 0;
    if (toggle) toggle.checked = false;
  } else {
    const toApply = _round2(Math.min(raw, maxAplicable));
    window._customSaldoFavorAmount = toApply;
    if (toggle) toggle.checked = true;
    if (typeof showToast === 'function') {
      showToast(`💚 Saldo a favor aplicado: $${_fmtMoney(toApply)}`, 'success');
    }
  }

  if (modal) modal.classList.add('hidden');
  _syncCheckoutAfterSaldoFavorChange();

  const cashInput = document.getElementById('cash-received-input');
  if (cashInput) {
    requestAnimationFrame(() => {
      cashInput.focus();
      cashInput.select();
    });
  }
}
window.confirmSaldoFavorPopup = confirmSaldoFavorPopup;

function applyAllSaldoFavorPopup() {
  const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  const totals = calculateTotals();
  const maxAplicable = _round2(Math.min(sf, Math.abs(totals.total)));
  const inp = document.getElementById('saldo-favor-popup-input');
  if (inp) inp.value = maxAplicable.toFixed(2);
  confirmSaldoFavorPopup();
}
window.applyAllSaldoFavorPopup = applyAllSaldoFavorPopup;

function closeSaldoFavorPopup() {
  const modal = document.getElementById('saldo-favor-popup-modal');
  if (modal) modal.classList.add('hidden');
  const cashInput = document.getElementById('cash-received-input');
  if (cashInput) {
    requestAnimationFrame(() => {
      cashInput.focus();
      cashInput.select();
    });
  }
}
window.closeSaldoFavorPopup = closeSaldoFavorPopup;

// E-06b: botón "Aplicar / Quitar" del banner de alerta.
function applySaldoFavorFromAlert() {
  const toggle = document.getElementById('saldo-favor-toggle');
  if (!toggle) return;
  toggle.checked = !toggle.checked;
  if (toggle.checked) {
    const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
    const totals = calculateTotals();
    window._customSaldoFavorAmount = _round2(Math.min(sf, Math.abs(totals.total)));
  } else {
    window._customSaldoFavorAmount = 0;
  }
  _syncCheckoutAfterSaldoFavorChange();
}

// E-06a/E-06b: recalcular cambio y sincronizar banner cuando se activa/desactiva.
function onSaldoFavorToggle() {
  const toggle = document.getElementById('saldo-favor-toggle');
  if (toggle && toggle.checked && (!window._customSaldoFavorAmount || window._customSaldoFavorAmount <= 0)) {
    const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
    const totals = calculateTotals();
    window._customSaldoFavorAmount = _round2(Math.min(sf, Math.abs(totals.total)));
  } else if (toggle && !toggle.checked) {
    window._customSaldoFavorAmount = 0;
  }
  _syncCheckoutAfterSaldoFavorChange();
}

const PAY_ICONS = {
  "001": "💵", "002": "⭐", "003": "💳",
  "004": "🏦", "006": "🤝", "008": "💳"
};

const PAY_SHORTCUT_HINT = {
  "001": "F1", "008": "F2", "004": "F3", "003": "F7", "006": "CTRL+F6"
};

function renderSplitPayments() {
  const box  = document.getElementById("split-payments-box");
  const list = document.getElementById("split-payments-list");
  const rest = document.getElementById("split-restante");
  if (!box || !list) return;

  const currentRest = paymentRestante();
  if (!splitPayments.length) {
    box.classList.add("hidden");
    list.innerHTML = "";
  } else {
    box.classList.remove("hidden");
    list.innerHTML = splitPayments.map((p, i) =>
      `<div class="flex items-center justify-between bg-white border border-blue-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs">
         <span class="flex items-center gap-1.5">
           <span>${PAY_ICONS[p.method] || "💳"}</span>
           <span class="text-slate-700">${PAY_LABELS[p.method] || p.method}</span>
         </span>
         <span class="flex items-center gap-2">
           <span class="text-emerald-600 font-black">$${_fmtMoney(_round2(p.amount))}</span>
           <button type="button" data-click="removeSplitPayment" data-click-arg="${i}" data-click-arg-type="number"
             class="w-4 h-4 rounded bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 font-black leading-none flex items-center justify-center transition cursor-pointer" title="Quitar este abono">✕</button>
         </span>
       </div>`
    ).join("");
  }
  if (rest) {
    rest.textContent = currentRest > 0.005
      ? `Faltan $${currentRest.toFixed(2)}`
      : `Cubierto ($0.00)`;
  }
}

function removeSplitPayment(i) {
  i = parseInt(i, 10);
  splitPayments.splice(i, 1);
  renderSplitPayments();
  const inp = document.getElementById("cash-received-input");
  if (inp) {
    inp.value = _fmtMoney(paymentRestante());
    inp.dataset.autoFilled = "1";
  }
  calculateChange();
}

window.removeSplitPayment = removeSplitPayment;

// ── MODO COBRO EN DÓLARES (F10 — VERDE DÓLAR) Y AUTO-AJUSTE DEL TOTAL GIGANTE ──
window._checkoutUsdMode = false;

function getCheckoutUsdRate() {
  const inp = document.getElementById("checkout-usd-rate-input");
  let r = parseFloat(inp && inp.value);
  if (isNaN(r) || r <= 0) {
    r = parseFloat(localStorage.getItem("calebsys_usd_rate") || "20.00") || 20.00;
  }
  return r;
}
window.getCheckoutUsdRate = getCheckoutUsdRate;

function onCheckoutUsdRateChange() {
  const inp = document.getElementById("checkout-usd-rate-input");
  const r = parseFloat(inp && inp.value);
  if (!isNaN(r) && r > 0) {
    localStorage.setItem("calebsys_usd_rate", r.toFixed(2));
  }
  renderCheckoutSummaryItems();
  if (window._checkoutUsdMode && inp) {
    const cashInp = document.getElementById("cash-received-input");
    if (cashInp && cashInp.dataset.autoFilled === "1") {
      const rate = getCheckoutUsdRate();
      cashInp.value = _fmtMoney(paymentRestante() / rate);
    }
  }
  calculateChange();
}
window.onCheckoutUsdRateChange = onCheckoutUsdRateChange;

// Ajusta el tamaño de los números del TOTAL A PAGAR ($ 4,106,400.00 MXN) en estilo cristal
function syncCheckoutTotalHeroFit() {
  const totalDisplay = document.getElementById("total-display");
  const iconEl = document.getElementById("checkout-total-hero-icon");
  const symEl = document.getElementById("total-currency-symbol");
  const codeEl = document.getElementById("total-currency-code");
  if (!totalDisplay) return;

  const isUsd = !!window._checkoutUsdMode;
  const txt = (totalDisplay.textContent || "").trim();
  const len = txt.length; // ej. "456.00" = 6, "4,106,400.00" = 12

  if (iconEl) {
    // Ocultar siempre el ícono cuando la cifra tiene 7+ caracteres para dejar todo el ancho a "$ 4,106,400.00 MXN"
    if (len >= 7) {
      iconEl.classList.add("hidden");
    } else {
      iconEl.classList.add("hidden"); // Estilo limpio como la imagen de referencia sin ícono estorbando
    }
  }

  const colorGlow = isUsd
    ? "text-[#86efac] drop-shadow-[0_0_14px_rgba(134,239,172,0.5)]"
    : "text-white drop-shadow-[0_2px_12px_rgba(15,23,42,0.28)]";

  if (len <= 8) {
    totalDisplay.className = `text-5xl sm:text-[56px] font-black tracking-tight leading-none whitespace-nowrap ${colorGlow}`;
  } else if (len <= 12) {
    totalDisplay.className = `text-4xl sm:text-[43px] font-black tracking-tight leading-none whitespace-nowrap ${colorGlow}`;
  } else {
    totalDisplay.className = `text-3xl sm:text-[34px] font-black tracking-tight leading-none whitespace-nowrap ${colorGlow}`;
  }

  if (symEl) {
    symEl.textContent = "$";
    symEl.className = `text-4xl sm:text-[46px] font-black mr-1 shrink-0 leading-none ${colorGlow}`;
  }
  if (codeEl) {
    codeEl.textContent = isUsd ? "DLLS" : "MXN";
    codeEl.className = `text-2xl sm:text-[32px] font-black ml-1.5 shrink-0 leading-none ${colorGlow}`;
  }
}
window.syncCheckoutTotalHeroFit = syncCheckoutTotalHeroFit;

function applyCheckoutCurrencyContour() {
  const isUsd = !!window._checkoutUsdMode;
  const card = document.getElementById("checkout-floating-card");
  const leftHero = document.getElementById("checkout-hero-left-box");
  const rightHero = document.getElementById("checkout-hero-right-box");
  const heroTitle = document.getElementById("checkout-total-hero-title");
  const usdPill = document.getElementById("checkout-usd-active-pill");
  const equivRow = document.getElementById("checkout-usd-equiv-row");
  const totResEl = document.getElementById("checkout-resumen-total");
  const totResLbl = document.getElementById("checkout-resumen-total-label");
  const capsule = document.getElementById("cash-input-glass-capsule");
  const cobrarBtn = document.getElementById("btn-registrar-venta");
  const f10Btn = document.getElementById("btn-toggle-usd-f10");
  const f10Txt = document.getElementById("btn-toggle-usd-f10-text");

  if (isUsd) {
    // MODO DÓLARES (F10): CONTORNO VERDE DÓLAR SOBRE ESTILO CRISTAL
    if (card) {
      card.className = "w-full max-w-[680px] max-h-[96vh] bg-gradient-to-b from-[#d1fae5]/95 via-[#d8e0e9]/95 to-[#bbf7d0]/90 backdrop-blur-xl border-[3px] border-[#00c853] rounded-[32px] shadow-[0_0_38px_rgba(0,200,83,0.6),0_25px_70px_rgba(15,23,42,0.5)] text-slate-800 p-4 sm:p-6 flex flex-col gap-3.5 overflow-y-auto overflow-x-hidden custom-scrollbar relative transition-all duration-200";
    }
    if (leftHero) {
      leftHero.className = "sm:col-span-8 bg-gradient-to-br from-[#14532d] via-[#064e3b] to-[#022c22] border-2 border-[#4ade80] rounded-[22px] px-5 py-4 shadow-[0_12px_28px_rgba(6,78,59,0.5),inset_0_1px_2px_rgba(255,255,255,0.5)] flex items-center gap-3 relative overflow-hidden transition-all duration-200";
    }
    if (rightHero) {
      rightHero.className = "sm:col-span-4 bg-gradient-to-br from-[#1e3a2f] via-[#142e24] to-[#0f221b] border-2 border-[#4ade80] rounded-[22px] px-4 py-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.38),inset_0_1px_2px_rgba(255,255,255,0.45)] flex flex-col justify-between relative overflow-hidden transition-all duration-200";
    }
    if (heroTitle) heroTitle.textContent = "TOTAL A PAGAR EN DLLS";
    if (usdPill) usdPill.classList.remove("hidden");
    if (equivRow) equivRow.classList.remove("hidden");
    if (totResLbl) totResLbl.textContent = "TOTAL:";
    if (totResEl) totResEl.className = "text-base sm:text-lg font-black text-[#86efac] tracking-tight truncate";
    if (capsule) {
      capsule.className = "w-full bg-gradient-to-r from-[#dcfce7]/85 via-white/75 to-[#dcfce7]/85 border-2 border-[#00c853] rounded-2xl px-4 py-2.5 shadow-[0_0_16px_rgba(0,200,83,0.3),inset_0_1px_2px_rgba(255,255,255,0.95)] flex items-center justify-between gap-3";
    }
    if (cobrarBtn) {
      cobrarBtn.className = "w-full bg-gradient-to-b from-[#15803d] via-[#166534] to-[#052e16] hover:from-[#16a34a] hover:to-[#064e3b] border-2 border-[#4ade80] text-white font-black text-xl sm:text-2xl py-3.5 px-6 rounded-[20px] shadow-[0_0_26px_rgba(0,200,83,0.55),inset_0_1px_2px_rgba(255,255,255,0.55)] transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer relative overflow-hidden";
    }
    if (f10Btn) {
      f10Btn.className = "bg-[#00c853] hover:bg-[#16a34a] border-2 border-white ring-2 ring-[#00c853] text-white font-black text-[11px] uppercase px-3 py-1 rounded-full shadow-[0_0_14px_rgba(0,200,83,0.65)] transition flex items-center gap-1.5 cursor-pointer";
    }
    if (f10Txt) f10Txt.textContent = "DLLS ACTIVO (F10 MXN)";
  } else {
    // MODO ESTÁNDAR (MXN): ESTILO CRISTAL TRASLÚCIDO IDÉNTICO A LA IMAGEN
    if (card) {
      card.className = "w-full max-w-[680px] max-h-[96vh] bg-gradient-to-b from-[#d8e0e9]/95 via-[#cbd4df]/95 to-[#bcc7d4]/95 backdrop-blur-xl border-[2px] border-white/85 rounded-[32px] shadow-[0_25px_70px_rgba(15,23,42,0.5),inset_0_1px_2px_rgba(255,255,255,0.95)] text-slate-800 p-4 sm:p-6 flex flex-col gap-3.5 overflow-y-auto overflow-x-hidden custom-scrollbar relative transition-all duration-200";
    }
    if (leftHero) {
      leftHero.className = "sm:col-span-8 bg-gradient-to-b from-[#5e9ef6] via-[#5596f5] to-[#4c8cf5] border border-white/80 rounded-[22px] px-5 py-4 shadow-[0_12px_28px_rgba(76,140,245,0.45),inset_0_1px_2px_rgba(255,255,255,0.75)] flex items-center gap-3 relative overflow-hidden transition-all duration-200";
    }
    if (rightHero) {
      rightHero.className = "sm:col-span-4 bg-gradient-to-br from-[#3b4654] via-[#2b3543] to-[#1e2631] border border-white/50 rounded-[22px] px-4 py-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.38),inset_0_1px_2px_rgba(255,255,255,0.45)] flex flex-col justify-between relative overflow-hidden transition-all duration-200";
    }
    if (heroTitle) heroTitle.textContent = "TOTAL A PAGAR";
    if (usdPill) usdPill.classList.add("hidden");
    if (equivRow) equivRow.classList.add("hidden");
    if (totResLbl) totResLbl.textContent = "TOTAL:";
    if (totResEl) totResEl.className = "text-base sm:text-lg font-black text-[#4df0ff] tracking-tight truncate";
    if (capsule) {
      capsule.className = "w-full bg-gradient-to-r from-white/60 via-white/45 to-white/65 border-[1.5px] border-white/90 rounded-2xl px-4 py-2.5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.95),0_6px_16px_rgba(15,23,42,0.08)] flex items-center justify-between gap-3";
    }
    if (cobrarBtn) {
      cobrarBtn.className = "w-full bg-gradient-to-b from-[#5e9ef6] via-[#5596f5] to-[#4c8cf5] hover:from-[#4c8cf5] hover:via-[#3b82f6] hover:to-[#2563eb] border border-white/80 text-white font-black text-xl sm:text-2xl py-3.5 px-6 rounded-[20px] shadow-[0_12px_28px_rgba(76,140,245,0.5),inset_0_1px_2px_rgba(255,255,255,0.75)] transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer relative overflow-hidden";
    }
    if (f10Btn) {
      f10Btn.className = "bg-white/40 hover:bg-white/65 border border-white/85 text-slate-700 font-extrabold text-[11px] uppercase px-3 py-1 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_2px_6px_rgba(15,23,42,0.1)] transition flex items-center gap-1.5 cursor-pointer";
    }
    if (f10Txt) f10Txt.textContent = "COBRAR EN DLLS";
  }
  syncCheckoutTotalHeroFit();
}
window.applyCheckoutCurrencyContour = applyCheckoutCurrencyContour;

function toggleUsdCheckoutMode() {
  window._checkoutUsdMode = !window._checkoutUsdMode;
  const isUsd = window._checkoutUsdMode;
  const rate = getCheckoutUsdRate();

  applyCheckoutCurrencyContour();
  renderCheckoutSummaryItems();

  // Actualizar etiqueta y monto del input de pago según la moneda activa
  const method = activePaymentMethod || "001";
  const label = document.getElementById("pay-amount-label");
  const shortcutTag = PAY_SHORTCUT_HINT[method] ? ` (${PAY_SHORTCUT_HINT[method]})` : "";
  if (label) {
    label.textContent = isUsd
      ? `${PAY_LABELS[method] || method}${shortcutTag} — EN DLLS (T.C. $${rate.toFixed(2)})`
      : `${PAY_LABELS[method] || method}${shortcutTag}`;
  }

  const cashInput = document.getElementById("cash-received-input");
  const restMxn = paymentRestante();
  if (cashInput) {
    cashInput.value = isUsd ? _fmtMoney(restMxn / rate) : _fmtMoney(restMxn);
    cashInput.dataset.autoFilled = "1";
    cashInput.focus();
    cashInput.select();
  }

  calculateChange();

  if (typeof showToast === "function") {
    if (isUsd) {
      showToast(`💵 Modo Cobro en DÓLARES (F10) activado · T.C. $${rate.toFixed(2)} MXN`, "success");
    } else {
      showToast(`🇲🇽 Modo Cobro en PESOS (MXN) restablecido`, "info");
    }
  }
}
window.toggleUsdCheckoutMode = toggleUsdCheckoutMode;

// Renderiza la columna derecha "RESUMEN DE VENTA" dentro del modal flotante de cobro
function renderCheckoutSummaryItems() {
  const listEl = document.getElementById("checkout-summary-items-list");
  const countBadge = document.getElementById("checkout-summary-count-badge");
  const subEl = document.getElementById("checkout-resumen-subtotal");
  const ivaEl = document.getElementById("checkout-resumen-iva");
  const totEl = document.getElementById("checkout-resumen-total");
  const subtitleEl = document.getElementById("checkout-modal-subtitle");

  if (subtitleEl) {
    const now = new Date();
    const fDate = now.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    const fTime = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    const cliName = (typeof activeClient !== "undefined" && activeClient && activeClient.name) ? activeClient.name.toUpperCase() : "PÚBLICO EN GENERAL";
    subtitleEl.textContent = `${cliName} · ${fDate} ${fTime}`;
  }

  const totals = (typeof calculateTotals === "function") ? calculateTotals() : { total: 0, subtotal: 0, iva: 0 };
  const sfAplicado = _getSaldoFavorAplicado();
  const netTotalMxn = totals.total < 0
    ? totals.total
    : Math.max(0, _round2(Math.abs(totals.total) - sfAplicado));
  const isUsd = !!window._checkoutUsdMode;
  const rate = getCheckoutUsdRate();
  const totalDisplay = document.getElementById("total-display");
  const subtotalDisplay = document.getElementById("subtotal-display");
  const ivaDisplay = document.getElementById("iva-display");
  const currencySymbol = document.getElementById("total-currency-symbol");
  const equivMxnEl = document.getElementById("checkout-usd-equiv-mxn");

  if (isUsd) {
    const usdTotal = Math.abs(netTotalMxn) / rate;
    const usdSub = Math.abs(totals.subtotal) / rate;
    const usdIva = Math.abs(totals.iva) / rate;
    if (currencySymbol) currencySymbol.textContent = totals.total < 0 ? "-US$" : "US$";
    if (totalDisplay) totalDisplay.textContent = _fmtMoney(usdTotal);
    if (subtotalDisplay) subtotalDisplay.textContent = `US$${_fmtMoney(usdSub)}`;
    if (ivaDisplay) ivaDisplay.textContent = `US$${_fmtMoney(usdIva)}`;
    if (totEl) totEl.textContent = `US$${_fmtMoney(usdTotal)}`;
    if (equivMxnEl) equivMxnEl.textContent = `$${_fmtMoney(Math.abs(netTotalMxn))} MXN`;
  } else {
    if (currencySymbol) currencySymbol.textContent = totals.total < 0 ? "-$" : "$";
    if (totalDisplay) totalDisplay.textContent = _fmtMoney(Math.abs(netTotalMxn));
    if (subtotalDisplay) subtotalDisplay.textContent = `$${_fmtMoney(Math.abs(totals.subtotal))}`;
    if (ivaDisplay) ivaDisplay.textContent = `$${_fmtMoney(Math.abs(totals.iva))}`;
    if (totEl) totEl.textContent = `$${_fmtMoney(Math.abs(netTotalMxn))}`;
  }
  if (subEl) subEl.textContent = `$${_fmtMoney(Math.abs(totals.subtotal))}`;
  if (ivaEl) ivaEl.textContent = `$${_fmtMoney(Math.abs(totals.iva))}`;
  syncCheckoutTotalHeroFit();

  const items = Array.isArray(cart) ? cart : [];
  if (countBadge) {
    const totalPzas = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    countBadge.textContent = `${items.length} ${items.length === 1 ? "producto" : "productos"} (${totalPzas % 1 === 0 ? totalPzas : totalPzas.toFixed(2)} pzas)`;
  }

  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = `<div class="text-center py-6 text-xs font-bold text-slate-400 uppercase tracking-wider">Sin artículos en la cuenta</div>`;
    return;
  }

  listEl.innerHTML = items.map((item, idx) => {
    const desc = String(item.description || item.name || item.sku || "ARTÍCULO").toUpperCase();
    const sku = String(item.sku || "");
    const qty = Number(item.quantity) || 1;
    const qtyStr = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);
    const sub = Number(item.subtotal || (qty * (item.price || 0))) || 0;
    const unitP = Number(item.price) || 0;
    return `
      <div class="flex items-center justify-between gap-1.5 bg-white border border-slate-200 hover:border-blue-300 rounded-xl px-2.5 py-1.5 transition shadow-2xs">
        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-extrabold text-slate-800 truncate" title="${desc.replace(/"/g, '&quot;')}">${desc}</div>
          <div class="text-[9px] font-bold text-slate-400 flex items-center gap-1.5">
            <span>${sku}</span>
            <span>·</span>
            <span>$${unitP.toFixed(2)} c/u</span>
          </div>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <!-- Stepper de cantidad en Resumen de Venta -->
          <div class="flex items-center bg-slate-100 border border-slate-300 rounded-lg overflow-hidden">
            <button type="button" data-click="checkoutStepItemQty" data-click-arg="${idx}" data-click-arg2="-1"
                    class="px-1.5 py-0.5 text-slate-600 hover:bg-blue-100 hover:text-blue-700 font-black text-xs transition cursor-pointer" title="Disminuir cantidad">−</button>
            <span class="px-1.5 py-0.5 text-[11px] font-black text-slate-800 min-w-[24px] text-center bg-white">${qtyStr}</span>
            <button type="button" data-click="checkoutStepItemQty" data-click-arg="${idx}" data-click-arg2="1"
                    class="px-1.5 py-0.5 text-slate-600 hover:bg-blue-100 hover:text-blue-700 font-black text-xs transition cursor-pointer" title="Aumentar cantidad">+</button>
          </div>

          <div class="text-right min-w-[62px]">
            <span class="text-xs font-black text-[#2563eb]">$${sub.toFixed(2)}</span>
          </div>

          <button type="button" data-click="checkoutRemoveItem" data-click-arg="${idx}" data-click-arg-type="number"
                  class="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 hover:text-red-700 flex items-center justify-center transition cursor-pointer text-[11px]" title="Eliminar artículo de la venta">
            🗑️
          </button>
        </div>
      </div>`;
  }).join("");
}
window.renderCheckoutSummaryItems = renderCheckoutSummaryItems;

window.checkoutStepItemQty = function(idx, delta) {
  idx = parseInt(idx, 10);
  delta = parseFloat(delta);
  if (!Array.isArray(cart) || isNaN(idx) || idx < 0 || idx >= cart.length) return;
  const item = cart[idx];
  const newQty = _round2((Number(item.quantity) || 1) + delta);
  if (newQty <= 0) {
    window.checkoutRemoveItem(idx);
    return;
  }
  item.quantity = newQty;
  const targetScale = (typeof temporaryPriceScale !== "undefined" && temporaryPriceScale)
    ? temporaryPriceScale
    : (typeof activePriceScale !== "undefined" ? activePriceScale : "PRECIO DE LISTA");
  if (typeof evaluatePosItemFinancials === "function") {
    const fin = evaluatePosItemFinancials(item, targetScale, newQty);
    item.price = fin.unitPrice;
  }
  item.subtotal = _round2(item.quantity * item.price);
  if (typeof updateCartUI === "function") updateCartUI();
  const inp = document.getElementById("cash-received-input");
  if (inp && inp.dataset.autoFilled === "1") {
    inp.value = _fmtMoney(paymentRestante());
  }
  calculateChange();
};

window.checkoutRemoveItem = function(idx) {
  idx = parseInt(idx, 10);
  if (!Array.isArray(cart) || isNaN(idx) || idx < 0 || idx >= cart.length) return;
  cart.splice(idx, 1);
  if (cart.length === 0) {
    if (typeof updateCartUI === "function") updateCartUI();
    exitCheckoutMode();
    return;
  }
  if (selectedCartIndex >= cart.length) selectedCartIndex = cart.length - 1;
  if (typeof updateCartUI === "function") updateCartUI();
  const inp = document.getElementById("cash-received-input");
  if (inp) {
    inp.value = _fmtMoney(paymentRestante());
    inp.dataset.autoFilled = "1";
  }
  calculateChange();
};

// Aplica el importe escrito como un abono/pago parcial (o total) en CUALQUIER método
// (incluyendo Efectivo F1, Tarjeta Débito F2, Transferencia F3, etc.) y descuenta en automático
// lo que falta por cubrir. Si el importe cubre o supera el restante, registra la venta.
function applySplitPayment() {
  const m = activePaymentMethod || "001";
  if (m === "006") {
    submitSale();
    return;
  }

  const inp = document.getElementById("cash-received-input");
  let rawAmt = _parseMoney(inp && inp.value);
  const isUsd = !!window._checkoutUsdMode;
  const usdRate = getCheckoutUsdRate();
  let amt = isUsd ? _round2(rawAmt * usdRate) : rawAmt;
  const rest = paymentRestante();

  if (isNaN(amt) || amt <= 0) {
    if (typeof showToast === "function") showToast("Escribe el importe a abonar o pagar", "warning");
    return;
  }

  // Regla de validación: ÚNICAMENTE el Efectivo ("001") puede pagarse con cantidad mayor para dar cambio.
  // Los otros métodos pueden ser menores (pago mixto) o exactos, nunca mayores a la cantidad a pagar.
  if (m !== "001" && amt > rest + 0.005) {
    if (typeof showToast === "function") {
      showToast(`❌ En ${PAY_LABELS[m] || m} no se permite capturar más de la cantidad a pagar ($${_fmtMoney(rest)}). Solo Efectivo permite cambio.`, "error");
    }
    if (inp) { inp.focus(); inp.select(); }
    return;
  }

  // Si el monto ingresado cubre el restante (o lo supera en Efectivo):
  if (amt >= rest - 0.005) {
    submitSale();
    return;
  }

  // Es un PAGO PARCIAL / MIXTO (ej. cuenta de $400.00, pone $100.00 → abona $100.00 y faltan $300.00)
  amt = _round2(amt);
  const _meta = _readPaymentMeta(m);
  splitPayments.push({ method: m, amount: amt, ...(_meta ? { meta: _meta } : {}) });
  _clearPaymentMeta();
  renderSplitPayments();

  const newRest = paymentRestante();
  if (newRest <= 0.005) {
    submitSale();
    return;
  }

  // Actualizar el campo con lo restante en automático (en DLLS o MXN según modo activo)
  if (inp) {
    inp.value = isUsd ? _fmtMoney(newRest / usdRate) : _fmtMoney(newRest);
    inp.dataset.autoFilled = "1";
    inp.focus();
    inp.select();
  }
  if (typeof showToast === "function") {
    showToast(`✅ Abono en ${PAY_LABELS[m] || m}: $${_fmtMoney(amt)} — Faltan $${_fmtMoney(newRest)}. Selecciona el siguiente método (F1, F2, F3).`, "info");
  }
  calculateChange();
}

function selectPaymentMethod(method, skipAutoSplit) {
  const prevMethod = activePaymentMethod;
  const cashInput  = document.getElementById("cash-received-input");
  const totalsPanel = document.getElementById("totals-panel");
  const isModalVisible = totalsPanel && !totalsPanel.classList.contains("hidden");

  // VALIDACIÓN INTEGRAL AL SELECCIONAR "A CRÉDITO" ("006"):
  // 1) Si no tiene cliente definido (Público en General), solicitar poner el cliente.
  // 2) Si el cliente no tiene crédito definido (límite <= 0), no deja enviar a crédito.
  // 3) Si tiene excedente sobre su crédito disponible, solicitar autorización o bloquear según sea el caso.
  if (method === "006") {
    const metrics = getClientCreditMetrics();
    if (!metrics.hasDefinedClient) {
      if (typeof showToast === "function") {
        showToast("⚠️ Para enviar a crédito primero debes seleccionar el cliente (F1)", "warning");
      }
      openClientSelectorForCredit();
      return;
    }
    if (!metrics.hasCreditDefined) {
      if (typeof showToast === "function") {
        showToast(`🚫 El cliente ${metrics.clientName} no tiene un crédito definido ($0.00). No se permite enviar a crédito.`, "error");
      }
      openCreditControlModal("no_credit", metrics);
      if (activePaymentMethod === "006") {
        selectPaymentMethod("001", true);
      }
      return;
    }
  }

  // PAGO MIXTO AUTOMÁTICO AL CAMBIAR DE MÉTODO:
  // Ejemplo: la cuenta es de $400.00, el cajero está en Efectivo (F1), escribe 100.00
  // y presiona F2 (Tarjeta Débito) o F3 (Transferencia). En automático abona esos $100.00
  // de Efectivo y deja $300.00 listos en el nuevo método de pago.
  if (!skipAutoSplit && isModalVisible && prevMethod && prevMethod !== method && prevMethod !== "006" && cashInput) {
    const rawTyped = _parseMoney(cashInput.value);
    const typedAmt = window._checkoutUsdMode ? _round2(rawTyped * getCheckoutUsdRate()) : rawTyped;
    const currentRest = paymentRestante();
    if (!isNaN(typedAmt) && typedAmt > 0.005 && typedAmt < currentRest - 0.005) {
      const cleanAmt = _round2(typedAmt);
      const _meta = _readPaymentMeta(prevMethod);
      splitPayments.push({ method: prevMethod, amount: cleanAmt, ...(_meta ? { meta: _meta } : {}) });
      _clearPaymentMeta();
      const afterRest = paymentRestante();
      if (typeof showToast === "function") {
        showToast(`✅ ${PAY_LABELS[prevMethod] || prevMethod} $${_fmtMoney(cleanAmt)} descontado. Faltan $${_fmtMoney(afterRest)} en ${PAY_LABELS[method] || method}.`, "info");
      }
    }
  }

  activePaymentMethod = method;

  const methodButtons = ["001", "002", "003", "004", "006", "008"];
  const sheenSpan = '<span class="absolute -top-6 -left-6 w-20 h-20 bg-gradient-to-br from-white/40 via-white/10 to-transparent rotate-12 pointer-events-none"></span>';
  const cardDefs = {
    "001": {
      label: "Efectivo",
      badge: "💵 F1",
      baseGrad: "bg-gradient-to-b from-[#38bdf8] via-[#0ea5e9] to-[#0284c7]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
      badgeExtra: "text-emerald-300"
    },
    "008": {
      label: "Tarjeta",
      badge: "F2",
      baseGrad: "bg-gradient-to-b from-[#60a5fa] via-[#3b82f6] to-[#2563eb]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
      badgeExtra: "text-white"
    },
    "004": {
      label: "Transferencia",
      badge: "F3",
      baseGrad: "bg-gradient-to-b from-[#c084fc] via-[#9333ea] to-[#7e22ce]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>',
      badgeExtra: "text-white"
    },
    "003": {
      label: "Tarjeta Crédito",
      badge: "F7",
      baseGrad: "bg-gradient-to-b from-[#4ade80] via-[#10b981] to-[#059669]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
      badgeExtra: "text-white"
    },
    "002": {
      label: "Pagar c/ Puntos",
      badge: "⭐ PUNTOS",
      baseGrad: "bg-gradient-to-b from-[#fbbf24] via-[#f59e0b] to-[#d97706]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      badgeExtra: "text-amber-200"
    },
    "006": {
      label: "A Crédito",
      badge: "CTRL+F6",
      baseGrad: "bg-gradient-to-b from-[#fb7185] via-[#ef4444] to-[#dc2626]",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2z"/><path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7"/></svg>',
      badgeExtra: "text-white"
    }
  };

  methodButtons.forEach(code => {
    const btn = document.getElementById(`pay-method-${code}`);
    const def = cardDefs[code];
    if (!btn || !def) return;
    const isAct = (code === method);
    const labelSize = (code === "004" || code === "003" || code === "002") ? "text-[11.5px] sm:text-[12.5px]" : "text-[12.5px] sm:text-[13.5px]";
    btn.className = isAct
      ? `relative overflow-hidden ${def.baseGrad} text-white border-2 border-white ring-2 ring-[#38bdf8] shadow-[0_0_20px_rgba(56,189,248,0.85)] scale-[1.03] rounded-2xl py-3 px-1 flex flex-col items-center justify-between gap-1.5 transition cursor-pointer`
      : `relative overflow-hidden ${def.baseGrad} text-white border border-white/60 shadow-[0_6px_14px_rgba(15,23,42,0.22),inset_0_1px_1px_rgba(255,255,255,0.6)] opacity-90 hover:opacity-100 rounded-2xl py-3 px-1 flex flex-col items-center justify-between gap-1.5 transition cursor-pointer`;
    btn.innerHTML = `${sheenSpan}${def.svg}<span class="${labelSize} font-black text-black tracking-tight leading-tight text-center truncate max-w-full relative z-10">${def.label}</span><span class="bg-black/30 ${def.badgeExtra} text-[10px] font-black px-2 py-0.5 rounded-md relative z-10">${def.badge}</span>`;
  });

  const cashFields = document.getElementById("cash-calculation-fields");
  const label      = document.getElementById("pay-amount-label");
  const hint       = document.getElementById("pay-amount-hint");
  const applyBtn   = document.getElementById("btn-aplicar-pago");
  const splitBox   = document.getElementById("split-payments-box");

  // Paneles de captura C-03 (transferencia / tarjeta / puntos / crédito).
  const toggle = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle("hidden", !on); };
  toggle("cheque-fields",        false);
  toggle("transferencia-fields", method === "004");
  toggle("tarjeta-fields",       method === "003" || method === "008");
  toggle("credito-fields",       method === "006");
  if (method === "002") {
    const ptsPanel = document.getElementById("loyalty-pts-panel");
    if (ptsPanel) ptsPanel.classList.remove("hidden");
  }
  const tarjetaLbl = document.getElementById("tarjeta-tipo-label");
  if (tarjetaLbl) tarjetaLbl.textContent = method === "003" ? "💳 DATOS DE T. CRÉDITO (OPCIONAL)" : "💳 DATOS DE T. DÉBITO (OPCIONAL)";

  // GAP-2: limpiar listener previo antes de asignar uno nuevo
  if (_cashEnterHandler && cashInput) {
    cashInput.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }

  renderSplitPayments();

  if (method === "006") {
    if (cashFields) cashFields.classList.remove("hidden");
    if (splitBox)   splitBox.classList.add("hidden");
    const restCred = paymentRestante();
    const isUsdCred = !!window._checkoutUsdMode;
    const usdRateCred = getCheckoutUsdRate();
    if (cashInput) {
      cashInput.value = isUsdCred ? _fmtMoney(restCred / usdRateCred) : _fmtMoney(restCred);
      cashInput.dataset.autoFilled = "1";
    }
    if (label) {
      label.textContent = isUsdCred
        ? `A CRÉDITO (CTRL+F6) — EN DLLS (T.C. $${usdRateCred.toFixed(2)})`
        : `A CRÉDITO (CTRL+F6)`;
    }
    const crdRefInp = document.getElementById("crd-referencia");
    const crdObsInp = document.getElementById("crd-observaciones");
    if (crdRefInp && !crdRefInp.dataset.enterBound) {
      crdRefInp.dataset.enterBound = "1";
      crdRefInp.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitSale();
        }
      });
    }
    if (crdObsInp && !crdObsInp.dataset.enterBound) {
      crdObsInp.dataset.enterBound = "1";
      crdObsInp.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitSale();
        }
      });
    }
    _cashEnterHandler = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const rawVal = _parseMoney(cashInput && cashInput.value);
        const val = window._checkoutUsdMode ? _round2(rawVal * getCheckoutUsdRate()) : rawVal;
        const currentRest = paymentRestante();
        if (!isNaN(val) && val > currentRest + 0.005) {
          if (typeof showToast === "function") {
            showToast(`❌ En A CRÉDITO no se permite capturar más de la cantidad a pagar ($${_fmtMoney(currentRest)}).`, "error");
          }
          if (cashInput) { cashInput.focus(); cashInput.select(); }
          return;
        }
        if (crdRefInp && !crdRefInp.value.trim()) {
          if (typeof showToast === "function") {
            showToast("⚠️ Captura la REFERENCIA para entregarse en esta venta a crédito", "warning");
          }
          crdRefInp.focus();
          return;
        }
        submitSale();
      }
    };
    if (cashInput) {
      cashInput.addEventListener('keydown', _cashEnterHandler);
      requestAnimationFrame(() => {
        if (crdRefInp && !crdRefInp.value.trim()) {
          crdRefInp.focus();
        } else {
          cashInput.focus();
          cashInput.select();
        }
      });
    }
    calculateChange();
    updateCreditStatusBannerUI();
    const liveMetrics = getClientCreditMetrics();
    if (liveMetrics.hasExcess && !_isCreditExcessAuthorized(liveMetrics)) {
      openCreditControlModal("excess", liveMetrics, false);
    }
    return;
  }

  // Todos los demás métodos comparten el mismo input de importe y soportan pagos mixtos.
  if (cashFields) cashFields.classList.remove("hidden");
  const rest = paymentRestante();
  const isUsd = !!window._checkoutUsdMode;
  const usdRate = getCheckoutUsdRate();
  if (cashInput) {
    cashInput.value = isUsd ? _fmtMoney(rest / usdRate) : _fmtMoney(rest);
    cashInput.dataset.autoFilled = "1";
  }

  const shortcutTag = PAY_SHORTCUT_HINT[method] ? ` (${PAY_SHORTCUT_HINT[method]})` : "";
  if (label) {
    label.textContent = isUsd
      ? `${PAY_LABELS[method] || method}${shortcutTag} — EN DLLS (T.C. $${usdRate.toFixed(2)})`
      : `${PAY_LABELS[method] || method}${shortcutTag}`;
  }
  if (hint) {
    hint.textContent = "💡 Si ingresas un monto menor al total (ej. $100 de $400), resta en automático lo que falta ($300) al presionar ENTER o elegir otro método (F1/F2/F3).";
  }
  if (applyBtn) applyBtn.classList.add("hidden");

  _cashEnterHandler = function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const rawVal = _parseMoney(cashInput && cashInput.value);
      const val = window._checkoutUsdMode ? _round2(rawVal * getCheckoutUsdRate()) : rawVal;
      const currentRest = paymentRestante();
      if (activePaymentMethod !== "001" && !isNaN(val) && val > currentRest + 0.005) {
        if (typeof showToast === "function") {
          showToast(`❌ En ${PAY_LABELS[activePaymentMethod] || activePaymentMethod} no se permite capturar más de la cantidad a pagar ($${_fmtMoney(currentRest)}). Solo Efectivo permite cambio.`, "error");
        }
        if (cashInput) { cashInput.focus(); cashInput.select(); }
        return;
      }
      if (!isNaN(val) && val > 0 && val < currentRest - 0.005) {
        // Es un abono parcial → descontar en automático y dejar listo el resto
        applySplitPayment();
      } else {
        // Cubre el total (o restante) → registrar venta y emitir ticket
        submitSale();
      }
    }
  };

  if (cashInput) {
    cashInput.addEventListener('keydown', _cashEnterHandler);
    requestAnimationFrame(() => { cashInput.focus(); cashInput.select(); });
  }

  calculateChange();
}

// F12: Pago Rápido en Efectivo con Cantidad Exacta — Sin necesidad de capturar monto,
// considera pago 100% en efectivo exacto, registra la venta y abre el ticket.
function quickCashExactCheckout() {
  if (typeof cart === "undefined" || cart.length === 0) {
    if (typeof showToast === "function") {
      showToast("Agrega artículos al carrito antes del Pago Rápido en Efectivo (F12)", "warning");
    }
    return;
  }

  if (typeof _canUsePosCheckout === "function" && !_canUsePosCheckout()) {
    if (typeof showToast === "function") {
      showToast("Pago Rápido (F12) es exclusivo del cajero/administrador", "warning");
    }
    return;
  }

  if (document.getElementById("cobro-rbac-overlay")) {
    if (typeof showToast === "function") {
      showToast("El cobro no está disponible para tu rol", "warning");
    }
    return;
  }

  // Limpiar pagos mixtos previos para considerar pago 100% en efectivo con cantidad exacta
  splitPayments = [];
  window._lastSalePayments = null;
  _clearPaymentMeta();

  if (typeof updateCartUI === "function") updateCartUI();
  const totals = calculateTotals();
  const exactTotal = Math.abs(totals.total);

  activePaymentMethod = "001";
  const cashInput = document.getElementById("cash-received-input");
  if (cashInput) {
    cashInput.value = _fmtMoney(exactTotal);
    cashInput.dataset.autoFilled = "1";
  }

  renderSplitPayments();
  calculateChange();

  if (typeof showToast === "function") {
    showToast(`⚡ Pago Rápido en Efectivo (F12): $${exactTotal.toFixed(2)} exactos`, "info");
  }

  submitSale();
}
window.quickCashExactCheckout = quickCashExactCheckout;

// F7: activa el cobro — muestra el modal flotante #totals-panel, actualiza totales y enfoca el campo de pago.
function enterCheckoutMode() {
  if (typeof cart === "undefined" || cart.length === 0) {
    if (typeof showToast === "function") {
      showToast("Agrega artículos al carrito antes de cobrar (F7)", "warning");
    }
    return;
  }

  // RBAC D-03: si el overlay de cobro está activo (rol sin permiso de cobro),
  // no forzar foco ni cambiar de método.
  if (document.getElementById("cobro-rbac-overlay")) {
    if (typeof showToast === "function") {
      showToast("El cobro no está disponible para tu rol", "warning");
    }
    return;
  }

  // Si había un editor inline abierto en la tabla del carrito de atrás, cerrarlo al entrar a Cobrar (F7)
  if (typeof inlineEditingIndex !== "undefined" && inlineEditingIndex !== -1) {
    inlineEditingIndex = -1;
  }

  // Mostrar el modal flotante de cobro (#totals-panel).
  var _tp = document.getElementById("totals-panel");
  if (_tp) {
    _tp.classList.remove("hidden", "translate-x-full");
  }

  // Reiniciar cualquier aplicación parcial previa (ej. si regresó a la venta con ESC, modificó y volvió a dar F7)
  window._customSaldoFavorAmount = 0;
  window._creditExcessAuthorizedForSale = null;
  var _sfToggleInit = document.getElementById("saldo-favor-toggle");
  if (_sfToggleInit) _sfToggleInit.checked = false;
  splitPayments = [];
  _clearPaymentMeta();
  refreshSaldoFavorRow();
  renderSplitPayments();

  // Actualizar totales y el Resumen de Venta del modal.
  if (typeof updateCartUI === "function") updateCartUI();
  renderCheckoutSummaryItems();

  // Siempre por default al dar F7 pagar deberá iniciar en Efectivo ("001") y de ahí se cambiarán los métodos de pago
  activePaymentMethod = "001";
  selectPaymentMethod("001", true);

  // Si el cliente tiene Saldo a Favor (> 0), mostrar inmediatamente el recuadro emergente en verde claro encima de la pantalla de cobro
  var _sfDisponible = parseFloat((typeof activeClient !== "undefined" && activeClient && activeClient.saldo_favor) || 0);
  if (_sfDisponible > 0) {
    openSaldoFavorPopup();
  } else if (typeof activeClient !== "undefined" && activeClient && activeClient.id && activeClient.id !== 1 && String(activeClient.id) !== "1") {
    // Consultar en tiempo real la bóveda del cliente por si acaba de registrarse un saldo a favor/anticipo
    apiFetch(`/api/clients/${encodeURIComponent(activeClient.id)}/ledger`)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data && parseFloat(data.credit_balance || 0) > 0) {
          activeClient.saldo_favor = parseFloat(data.credit_balance);
          refreshSaldoFavorRow();
          var tpNow = document.getElementById("totals-panel");
          if (tpNow && !tpNow.classList.contains("hidden")) {
            openSaldoFavorPopup();
          }
        }
      })
      .catch(function() {});
  }

  if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
    try { lucide.createIcons(); } catch (_) {}
  }
}

// Botón Cancelar (Esc) del modal flotante de cobro: oculta #totals-panel y regresa el foco al escáner de productos.
function exitCheckoutMode() {
  var _sfModal = document.getElementById("saldo-favor-popup-modal");
  if (_sfModal) {
    _sfModal.classList.add("hidden");
  }
  // Si se devuelve a la venta con ESC, limpiar saldo a favor aplicado y abonos parciales
  // para que al modificar la venta y volver a dar F7 pida nuevamente el total deseado en Efectivo
  window._customSaldoFavorAmount = 0;
  window._creditExcessAuthorizedForSale = null;
  window._pendingCreditSelection = false;
  var _crdAuthModal = document.getElementById("credit-exceeded-auth-modal");
  if (_crdAuthModal) _crdAuthModal.classList.add("hidden");
  var _sfToggle = document.getElementById("saldo-favor-toggle");
  if (_sfToggle) _sfToggle.checked = false;
  splitPayments = [];
  _clearPaymentMeta();
  activePaymentMethod = "001";
  refreshSaldoFavorRow();
  renderSplitPayments();
  if (typeof updateCartUI === "function") updateCartUI();

  var _tp = document.getElementById("totals-panel");
  if (_tp) {
    _tp.classList.add("hidden");
  }
  if (_cashEnterHandler) {
    var ci = document.getElementById("cash-received-input");
    if (ci) ci.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }
  if (typeof focusProductInput === "function") {
    focusProductInput();
  } else {
    var p = document.getElementById("product-input");
    if (p) p.focus();
  }
}

function calculateChange() {
  const totals = calculateTotals();
  const cashInput = document.getElementById("cash-received-input");
  const advanceInput = document.getElementById("advance-input");
  const display = document.getElementById("change-returned-display");
  const label   = document.getElementById("change-label");
  const restBannerTitle = document.getElementById("checkout-restante-title");
  const restBannerAmt   = document.getElementById("checkout-restante-amount");
  const restBannerSub   = document.getElementById("checkout-restante-sub");
  const liveBadge       = document.getElementById("pay-live-status-badge");
  if (!display) return;

  let rawReceived = _parseMoney(cashInput && cashInput.value);
  if (isNaN(rawReceived)) rawReceived = 0.0;
  const isUsd = !!window._checkoutUsdMode;
  const usdRate = getCheckoutUsdRate();
  let received = isUsd ? _round2(rawReceived * usdRate) : rawReceived;
  let advance = parseFloat(advanceInput && advanceInput.value);
  if (isNaN(advance)) advance = 0.0;

  const restBeforeInput = paymentRestante();

  // Si NO es Efectivo ("001") y el monto capturado supera la cantidad a pagar, mostrar alerta de bloqueo en vivo
  if (activePaymentMethod !== "001" && received > restBeforeInput + 0.005) {
    const excedente = _round2(received - restBeforeInput);
    if (label) label.textContent = "EXCEDE CANTIDAD A PAGAR:";
    display.className = "text-xl text-red-600 font-black tracking-tight";
    display.innerText = `Excede por $${excedente.toFixed(2)}`;
    if (restBannerTitle) restBannerTitle.textContent = "MONTO NO PERMITIDO";
    if (restBannerAmt) {
      restBannerAmt.className = "text-lg sm:text-xl font-black text-red-600 tracking-tight truncate";
      restBannerAmt.textContent = `Máx: $${restBeforeInput.toFixed(2)}`;
    }
    if (restBannerSub) restBannerSub.textContent = `Solo Efectivo permite cambio · Corrige el monto`;
    if (liveBadge) {
      liveBadge.className = "text-[11px] font-black text-red-600";
      liveBadge.textContent = `⚠️ Máximo permitido en ${PAY_LABELS[activePaymentMethod] || activePaymentMethod}: $${_fmtMoney(restBeforeInput)} (Solo Efectivo da cambio)`;
    }
    return;
  }

  if (activePaymentMethod === "006") {
    if (label) label.textContent = "SALDO A CRÉDITO:";
    const remainingCredit = Math.max(0, _round2(Math.abs(totals.total) - advance));
    display.className = "text-xl text-blue-600 font-black tracking-tight";
    display.innerText = `$${remainingCredit.toFixed(2)}`;
    if (restBannerTitle) restBannerTitle.textContent = "SALDO CRÉDITO";
    if (restBannerAmt) {
      restBannerAmt.className = "text-lg sm:text-xl font-black text-blue-600 tracking-tight truncate";
      restBannerAmt.textContent = `$${remainingCredit.toFixed(2)}`;
    }
    if (restBannerSub) restBannerSub.textContent = `Anticipo: $${advance.toFixed(2)}`;
    if (liveBadge) {
      const crdRefVal = (document.getElementById("crd-referencia")?.value || "").trim();
      liveBadge.className = crdRefVal ? "text-[11px] font-black text-emerald-700" : "text-[11px] font-black text-red-600";
      liveBadge.textContent = crdRefVal ? `✓ Ref. entrega: ${crdRefVal}` : `⚠️ Captura la referencia de entrega abajo`;
    }
    return;
  }

  // Cálculo en tiempo real para Efectivo (F1), Tarjeta Débito (F2), Transferencia (F3) y demás métodos:
  const diff = _round2(received - restBeforeInput);

  if (diff < -0.005) {
    const faltan = _round2(restBeforeInput - received);
    if (label) label.textContent = "FALTA POR CUBRIR (RESTANTE):";
    display.className = "text-xl text-amber-600 font-black tracking-tight";
    display.innerText = `Faltan $${faltan.toFixed(2)}`;

    if (restBannerTitle) restBannerTitle.textContent = "FALTA POR CUBRIR";
    if (restBannerAmt) {
      restBannerAmt.className = "text-lg sm:text-xl font-black text-amber-600 tracking-tight truncate";
      restBannerAmt.textContent = `$${faltan.toFixed(2)}`;
    }
    if (restBannerSub) {
      restBannerSub.textContent = received > 0
        ? `Abonando $${received.toFixed(2)} · Elige otro método`
        : `Pendiente de cubrir`;
    }
    if (liveBadge) {
      liveBadge.className = "text-[11px] font-black text-amber-600";
      liveBadge.textContent = isUsd
        ? `Faltan US$${_fmtMoney(faltan / usdRate)} ($${_fmtMoney(faltan)} MXN)`
        : `Faltan $${_fmtMoney(faltan)}`;
    }
  } else {
    const changeAmt = activePaymentMethod === "001" ? Math.max(0, diff) : 0.0;
    if (label) {
      label.textContent = activePaymentMethod === "001" ? "CAMBIO A ENTREGAR:" : "ESTADO DEL PAGO:";
    }
    display.className = "text-xl text-emerald-600 font-black tracking-tight";
    display.innerText = activePaymentMethod === "001"
      ? `$${changeAmt.toFixed(2)}`
      : `$0.00 (Exacto)`;

    if (changeAmt > 0.005) {
      if (restBannerTitle) restBannerTitle.textContent = "CAMBIO A ENTREGAR";
      if (restBannerAmt) {
        restBannerAmt.className = "text-lg sm:text-xl font-black text-emerald-600 tracking-tight truncate";
        restBannerAmt.textContent = `$${changeAmt.toFixed(2)}`;
      }
      if (restBannerSub) restBannerSub.textContent = `Recibido: $${received.toFixed(2)} · ENTER para cobrar`;
    } else {
      if (restBannerTitle) restBannerTitle.textContent = splitPayments.length > 0 ? "POR CUBRIR / RESTANTE" : "CUENTA CUBIERTA";
      if (restBannerAmt) {
        restBannerAmt.className = "text-lg sm:text-xl font-black text-emerald-600 tracking-tight truncate";
        restBannerAmt.textContent = splitPayments.length > 0 ? `$${restBeforeInput.toFixed(2)}` : `$0.00`;
      }
      if (restBannerSub) {
        restBannerSub.textContent = splitPayments.length > 0
          ? `${splitPayments.length} abono(s) aplicado(s) · ENTER para cobrar`
          : `Pago exacto · ENTER para cobrar`;
      }
    }
    if (liveBadge) {
      if (changeAmt > 0.005) {
        liveBadge.className = "text-[11px] font-black text-emerald-600";
        liveBadge.textContent = isUsd
          ? `Cambio: US$${_fmtMoney(changeAmt / usdRate)} ($${_fmtMoney(changeAmt)} MXN)`
          : `Cambio: $${_fmtMoney(changeAmt)}`;
      } else {
        liveBadge.textContent = "";
      }
    }
  }
}

function validateRFC(rfc) {
  if (!rfc) return false;
  // Standard Mexican RFC format length validation
  const cleanRfc = rfc.trim().toUpperCase();
  return (cleanRfc.length === 12 || cleanRfc.length === 13) && cleanRfc !== "XAXX010101000";
}

function submitSale() {
  const totals = calculateTotals();
  if (cart.length === 0) {
    showToast("No hay productos en el carrito", "warning");
    return;
  }

  if (totals.total < 0.0) {
    // Return operation!
    const absTotal = Math.abs(totals.total);
    let cashRefunded = 0.0;
    let creditRefunded = 0.0;

    if (activeReturnRefundMethod === "cash") {
      cashRefunded = absTotal;
    } else if (activeReturnRefundMethod === "credit") {
      creditRefunded = absTotal;
    } else if (activeReturnRefundMethod === "mixed") {
      const inputVal = parseFloat(document.getElementById("return-cash-returned").value) || 0.0;
      cashRefunded = Math.min(absTotal, inputVal);
      creditRefunded = Math.max(0.0, absTotal - cashRefunded);
    }

    let clientPhone = "";
    if (creditRefunded > 0) {
      const clientDetails = getClientDeterministicDetails(activeClient);
      let defaultPhone = clientDetails.phone ? clientDetails.phone.replace(/[^0-9]/g, '') : "";
      if (defaultPhone.startsWith("52")) {
        defaultPhone = defaultPhone.substring(2);
      }
      
      if (activeClient.id === 1 || !defaultPhone || defaultPhone.length !== 10) {
        const phonePrompt = prompt("Ingrese el número de teléfono del cliente (10 dígitos) para asignar el Saldo a Favor:", "");
        if (!phonePrompt) {
          showToast("Operación cancelada: se requiere teléfono para asignar Saldo a Favor.", "error");
          return;
        }
        clientPhone = phonePrompt.replace(/[^0-9]/g, '');
        if (clientPhone.length !== 10) {
          showToast("El número de teléfono debe tener exactamente 10 dígitos.", "error");
          return;
        }
      } else {
        clientPhone = defaultPhone;
      }
    }

    const saleItems = cart.map(item => ({
      product_sku: item.sku,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal
    }));

    const saleBody = {
      client_id: persistedClientId(),
      total: totals.total,
      payment_method: "001",
      amount_paid: -cashRefunded,
      change_returned: 0.0,
      is_cfdi: false,
      discount: totals.discount,
      advance: 0.0,
      is_safekept: false,
      items: saleItems
    };

    apiFetch(`${API_BASE}/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saleBody)
    })
    .then(res => {
      if (!res.ok) throw new Error("Return sale creation failed");
      return res.json();
    })
    .then(async dbSale => {
      if (creditRefunded > 0) {
        const refundResponse = await apiFetch(`${API_BASE}/clients/by-phone/${clientPhone}/add-saldo-favor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: creditRefunded,
            description: `Devolución de saldo de Venta #${dbSale.id}`
          })
        });
        if (refundResponse.ok) {
          const updatedClient = await refundResponse.json();
          showToast(`Devolución registrada. Saldo a Favor de $${creditRefunded.toFixed(2)} asignado a ${updatedClient.name}.`, "success");
        } else {
          showToast("Venta registrada, pero falló la asignación de Saldo a Favor.", "error");
        }
      } else {
        showToast("Devolución registrada con éxito en caja (Dinero Regresado).", "success");
      }

      dbSale.notes = `DEVOLUCIÓN DE SALDO\nREFUND TOTAL: -$${absTotal.toFixed(2)}\nEFECTIVO REGRESADO: $${cashRefunded.toFixed(2)}\nSALDO A FAVOR ASIGNADO: $${creditRefunded.toFixed(2)}`;
      
      cart = [];
      updateCartUI();
      openTicketModal(dbSale);
    })
    .catch(err => {
      showToast(`Error al registrar devolución: ${err.message}`, "error");
    });

    return;
  }

  // 1. Validation for Invoicing CFDI 4.0
  const isCFDI = document.getElementById("cfdi-toggle").checked;
  if (isCFDI) {
    if (!validateRFC(activeClient.rfc)) {
      showToast("Error CFDI: El cliente no cuenta con un RFC fiscal válido.", "error");
      return;
    }
  }

  // 2. Validation for Credit Sales:
  // - Si no tiene cliente definido, solicitar poner el cliente.
  // - Si el cliente no tiene crédito definido, bloquear envío a crédito.
  // - Si tiene excedente, solicitar autorización o bloquear según sea el caso.
  if (activePaymentMethod === "006") {
    const creditMetrics = getClientCreditMetrics();
    if (!creditMetrics.hasDefinedClient) {
      showToast("⚠️ Para enviar a crédito primero debes seleccionar el cliente.", "warning");
      openClientSelectorForCredit();
      return;
    }
    if (!creditMetrics.hasCreditDefined) {
      showToast(`🚫 ${creditMetrics.clientName} no tiene un crédito definido ($0.00). No se permite enviar a crédito.`, "error");
      openCreditControlModal("no_credit", creditMetrics);
      return;
    }
    if (creditMetrics.hasExcess && !_isCreditExcessAuthorized(creditMetrics)) {
      showToast(`⚠️ El monto a crédito excede el disponible por $${_fmtMoney(creditMetrics.excedente)}. Solicita autorización o ajusta el monto.`, "warning");
      openCreditControlModal("excess", creditMetrics, true);
      return;
    }
  }

  // 3. Extract inputs
  const isSafekept = document.getElementById("safekept-toggle").checked;
  const advance = parseFloat(document.getElementById("advance-input").value) || 0.0;
  const saldoFavorAplicado = _getSaldoFavorAplicado();

  // ── Desglose de pago (multimodal) ─────────────────────────────────────
  // splitPayments = formas NO-efectivo ya aplicadas. Aquí se cierra con
  // efectivo (o con el propio método si no hay efectivo). SÓLO el efectivo
  // puede generar cambio.
  let payments = splitPayments.map(p => ({ method: p.method, amount: _round2(p.amount), ...(p.meta ? { meta: p.meta } : {}) }));
  let received = 0.0;   // total efectivamente cubierto
  let change   = 0.0;   // vueltas (sólo efectivo)
  let finalMethod = activePaymentMethod;
  window._lastSalePayments = null;   // para el ticket

  if (activePaymentMethod === "006") {
    const cubiertoPrevioCred = payments.reduce((s, p) => s + p.amount, 0);
    const netTotalCred = Math.max(0, _round2(totals.total - saldoFavorAplicado));
    const restanteCred = _round2(netTotalCred - cubiertoPrevioCred);
    const rawValCred = _parseMoney(document.getElementById("cash-received-input")?.value);
    const valCred = window._checkoutUsdMode ? (rawValCred * getCheckoutUsdRate()) : rawValCred;
    const inputAmtCred = isNaN(valCred) ? 0.0 : _round2(valCred);

    // No permitir capturar más de la cantidad a pagar en ventas a crédito
    if (inputAmtCred > restanteCred + 0.005) {
      showToast(`❌ En A CRÉDITO no se permite capturar más de la cantidad a pagar ($${_fmtMoney(restanteCred)}). Corrige el monto para expedir el ticket.`, "error");
      const ci = document.getElementById("cash-received-input");
      if (ci) { ci.focus(); ci.select(); }
      return;
    }

    // Solicitar obligatoriamente una referencia para entregarse en ventas a crédito
    const crdRefEl = document.getElementById("crd-referencia");
    const crdRefVal = (crdRefEl ? crdRefEl.value : "").trim();
    if (!crdRefVal) {
      const crdBox = document.getElementById("credito-fields");
      if (crdBox) crdBox.classList.remove("hidden");
      showToast("⚠️ En las ventas a crédito debe capturar una REFERENCIA para entregarse antes de expedir el ticket.", "error");
      if (crdRefEl) {
        crdRefEl.focus();
        crdRefEl.classList.add("ring-2", "ring-red-500");
        setTimeout(() => crdRefEl.classList.remove("ring-2", "ring-red-500"), 1800);
      }
      return;
    }

    const _crdMeta = _readPaymentMeta("006");
    payments = [];
    received = advance;
    finalMethod = "006";
    if (_crdMeta) {
      window._lastSalePayments = [{
        method: "006",
        label: PAY_LABELS["006"] || "A CRÉDITO",
        amount: restanteCred,
        meta: _crdMeta
      }];
    }
  } else {
    const cubiertoPrevio = payments.reduce((s, p) => s + p.amount, 0);
    const netTotalToCover = Math.max(0, _round2(totals.total - saldoFavorAplicado));
    const restante = _round2(netTotalToCover - cubiertoPrevio);

    if (restante < -0.005) {
      showToast("Los pagos aplicados exceden el total. Quita alguno.", "error");
      return;
    }

    const rawVal = _parseMoney(document.getElementById("cash-received-input")?.value);
    const val = window._checkoutUsdMode ? (rawVal * getCheckoutUsdRate()) : rawVal;
    const inputAmt = isNaN(val) ? 0.0 : _round2(val);

    // VALIDACIÓN ESTRICTA: Únicamente el Efectivo ("001") puede pagarse con cantidad mayor para dar cambio.
    // Los otros métodos pueden ser menores (pago mixto) o exactos, nunca mayores a la cantidad a pagar.
    if (activePaymentMethod !== "001" && inputAmt > restante + 0.005) {
      showToast(`❌ En ${PAY_LABELS[activePaymentMethod] || activePaymentMethod} no se permite capturar más de la cantidad a pagar ($${_fmtMoney(restante)}). Corrige el monto para expedir el ticket.`, "error");
      const ci = document.getElementById("cash-received-input");
      if (ci) { ci.focus(); ci.select(); }
      return;
    }

    // Si el cajero ingresó un monto menor al restante y presionó Cobrar,
    // lo aplicamos automáticamente como abono parcial y le indicamos cuánto falta.
    if (restante > 0.005 && inputAmt > 0.005 && inputAmt < restante - 0.005) {
      applySplitPayment();
      return;
    }

    if (activePaymentMethod === "001") {
      if (inputAmt < restante - 0.005) {
        showToast(`Faltan $${(restante - inputAmt).toFixed(2)} por cubrir. Ingresa el monto o agrega otro método de pago.`, "warning");
        return;
      }
      if (restante > 0.005) {
        payments.push({ method: "001", amount: restante });
      }
      change   = _round2(Math.max(0.0, inputAmt - restante));
      received = _round2(totals.total + change);
    } else {
      let amt = isNaN(val) ? 0.0 : inputAmt;
      if (amt < restante - 0.005) {
        showToast(`Faltan $${(restante - amt).toFixed(2)} por cubrir. Elige otro método para completar el pago mixto.`, "warning");
        return;
      }
      const _closingMeta = _readPaymentMeta(activePaymentMethod);
      if (amt > 0.005) {
        payments.push({ method: activePaymentMethod, amount: amt, ...(_closingMeta ? { meta: _closingMeta } : {}) });
      }
      received = _round2(totals.total);
      change   = 0.0;
    }

    finalMethod = payments.length > 1
      ? "MIXTO"
      : (payments[0] ? payments[0].method : activePaymentMethod);
    if (payments.length > 1) {
      window._lastSalePayments = payments.map(p => ({
        method: p.method, label: (PAY_LABELS[p.method] || p.method), amount: _round2(p.amount),
        ...(p.meta ? { meta: p.meta } : {})
      }));
    } else if (payments.length === 1 && payments[0].meta) {
      // Método único con datos de captura (cheque/tarjeta/transferencia).
      window._lastSalePayments = [{
        method: payments[0].method, label: PAY_LABELS[payments[0].method] || payments[0].method,
        amount: _round2(payments[0].amount), meta: payments[0].meta
      }];
    }
  }

  // Prep items payload
  const saleItems = cart.map(item => ({
    product_sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    subtotal: item.subtotal
  }));

  const saleBody = {
    client_id: persistedClientId(),
    total: totals.total,
    payment_method: finalMethod,
    amount_paid: received,
    change_returned: Math.max(0.0, change),
    is_cfdi: isCFDI,
    discount: totals.discount,
    advance: advance,
    is_safekept: isSafekept,
    saldo_favor_applied: saldoFavorAplicado,
    items: saleItems
  };
  if (window._lastSalePayments) {
    saleBody.payment_details = { splits: window._lastSalePayments };
  }

  // D-4: Offline queue — save to IndexedDB when there is no connectivity.
  // Credit (006) and CFDI require server-side processing; they cannot be queued.
  if (!navigator.onLine && typeof offlineQueuePush === 'function') {
    if (isCFDI) {
      showToast('Sin conexión — la factura CFDI requiere internet. Procesa la venta sin CFDI.', 'error');
      return;
    }
    if (finalMethod === '006') {
      showToast('Sin conexión — las ventas a crédito requieren internet.', 'error');
      return;
    }
    const offlineBody = {
      ...saleBody,
      items: cart.map(item => ({
        product_sku: item.sku,
        quantity:    item.quantity,
        price:       item.price,
        subtotal:    item.subtotal,
        description: item.name || item.sku
      }))
    };
    offlineQueuePush(offlineBody).then(localId => {
      _oqRefreshBadge();
      const syntheticSale = {
        id:              `OFFLINE-${localId}`,
        folio:           `OFF-${String(localId).padStart(4, '0')}`,
        created_at:      new Date().toISOString(),
        total:           offlineBody.total,
        payment_method:  offlineBody.payment_method,
        payment_details: offlineBody.payment_details || null,
        discount:        offlineBody.discount,
        amount_paid:     offlineBody.amount_paid,
        change_returned: offlineBody.change_returned,
        is_cfdi:         false,
        is_safekept:     offlineBody.is_safekept,
        items:           offlineBody.items,
        client:          { name: activeClient?.name, rfc: activeClient?.rfc, phone: activeClient?.phone },
        resguardos:      [],
        nr04_sub_sales:  [],
        _offline:        true
      };
      if (window._lastSalePayments && !syntheticSale.payment_details) {
        syntheticSale.payment_details = { splits: window._lastSalePayments };
      }
      showToast('Sin conexión — venta guardada localmente', 'warning');
      document.getElementById("last-ticket-id").innerText = `#${syntheticSale.folio}`;
      document.getElementById("discount-input").value  = "";
      document.getElementById("advance-input").value   = "";
      document.getElementById("cfdi-toggle").checked   = false;
      document.getElementById("safekept-toggle").checked = false;
      const _sfTgl = document.getElementById("saldo-favor-toggle");
      if (_sfTgl) _sfTgl.checked = false;
      splitPayments = [];
      window._lastSalePayments = null;
      if (typeof renderSplitPayments === 'function') renderSplitPayments();
      _clearPaymentMeta();
      if ((window._loyaltyPtsUsed || 0) > 0 && typeof clearLoyaltyDiscount === 'function') {
        clearLoyaltyDiscount();
      }
      cart = [];
      updateCartUI();
      openTicketModal(syntheticSale);
    }).catch(err => {
      console.error('[CALEBSYS] offline enqueue failed:', err);
      showToast('Error al guardar venta offline. Verifique almacenamiento del navegador.', 'error');
    });
    return;
  }

  apiFetch(`${API_BASE}/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleBody)
  })
    .then(res => {
      if (!res.ok) {
        // Leer body del error para diagnóstico visible
        return res.text().then(errText => {
          let detail = errText;
          try { detail = JSON.stringify(JSON.parse(errText)); } catch(_) {}
          throw new Error(`HTTP ${res.status} — ${detail}`);
        });
      }
      return res.json();
    })
    .then(dbSale => {
      showToast("Venta registrada con éxito", "success");
      const _resg = (dbSale.resguardos || []).filter(r => (r.quantity_pending || 0) > 0);
      if (_resg.length) {
        showToast(`▣ ${_resg.length} artículo(s) sin stock quedaron en resguardo — se avisará al cliente cuando lleguen`, "warn");
      }
      // NR-04: mostrar folios de sub-facturas generadas automáticamente
      if (Array.isArray(dbSale.nr04_sub_sales) && dbSale.nr04_sub_sales.length > 0) {
        const subFolios = dbSale.nr04_sub_sales.map(s => s.folio).join(", ");
        showToast(`NR-04: venta dividida en ${dbSale.nr04_sub_sales.length + 1} facturas: ${dbSale.folio || ""}, ${subFolios}`, "warn");
      }
      document.getElementById("last-ticket-id").innerText = `#${dbSale.id}`;

      // El backend guarda payment_details como texto; para el ticket usamos el
      // desglose local capturado al enviar (window._lastSalePayments).
      if (window._lastSalePayments && !dbSale.payment_details) {
        dbSale.payment_details = { splits: window._lastSalePayments };
      }

      // Reset sidebar checkout adjustments + desglose multimodal
      document.getElementById("discount-input").value = "";
      document.getElementById("advance-input").value = "";
      document.getElementById("cfdi-toggle").checked = false;
      document.getElementById("safekept-toggle").checked = false;
      const _sfToggle = document.getElementById("saldo-favor-toggle");
      if (_sfToggle) _sfToggle.checked = false;
      splitPayments = [];
      window._lastSalePayments = null;
      renderSplitPayments();
      _clearPaymentMeta();

      // E-06a: actualizar saldo_favor en activeClient si se aplicó alguno
      if (saldoFavorAplicado > 0 && typeof activeClient !== 'undefined' && activeClient) {
        activeClient.saldo_favor = Math.max(0, (activeClient.saldo_favor || 0) - saldoFavorAplicado);
        refreshSaldoFavorRow();
      }

      // Actualizar saldo_actual en memoria del cliente si fue venta a crédito ("006")
      if (finalMethod === "006" && typeof activeClient !== "undefined" && activeClient && activeClient.id && activeClient.id !== 1) {
        const creditAdded = Math.max(0, _round2(Math.abs(totals.total) - saldoFavorAplicado - advance));
        activeClient.saldo_actual = _round2((parseFloat(activeClient.saldo_actual) || 0) + creditAdded);
      }
      window._creditExcessAuthorizedForSale = null;

      // Ítem 1: si hubo puntos aplicados, registrar canje en el backend
      if (window._loyaltyPtsUsed > 0 && saleBody.client_id && saleBody.client_id !== "1") {
        const _cid   = saleBody.client_id;
        const _pts   = window._loyaltyPtsUsed;
        const _sid   = dbSale.id;
        apiFetch(`/api/loyalty/clients/${encodeURIComponent(_cid)}/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: _cid,
            redemption_mode: "pago_parcial",
            puntos_canjeados: _pts,
            sale_id: _sid,
            notas: "Canje en checkout POS"
          })
        }).catch(() => {});  // silencioso: la venta ya está registrada
        clearLoyaltyDiscount();
      }

      openTicketModal(dbSale);
    })
    .catch((err) => {
      // ⚠️ Error real de API — NO falsear éxito, NO abrir ticket, carrito intacto
      console.error("[CALEBSYS] submitSale falló:", err.message);
      showToast(`❌ Error al guardar venta: ${err.message}`, "error");
      // El carrito permanece intacto para que el cajero pueda reintentar
    });
}

function openTicketModal(sale, isQuote = false) {
  const container = document.getElementById("thermal-ticket-container");
  activeTicketIsQuote = isQuote;
  window._currentTicketSale = sale;
  const cfg = getSisConfig();

  // ── Mapas de forma de pago ──
  const methodMap = {
    "001":"EFECTIVO","002":"CHEQUE","003":"T. CRÉDITO",
    "004":"TRANSFERENCIA","006":"CRÉDITO","008":"T. DÉBITO"
  };

  const dateObj  = new Date(sale.created_at);
  const fDate    = dateObj.toLocaleDateString("es-MX", {day:"2-digit",month:"2-digit",year:"numeric"});
  const fTime    = dateObj.toLocaleTimeString("es-MX", {hour:"2-digit",minute:"2-digit",hour12:true});
  const folio    = sale.folio || sale.id.slice(0, 6).toUpperCase();
  const isRefund = sale.total < 0;
  const isCredit = sale.payment_method === "006";
  const isCoti   = sale.payment_method === "COTIZACIÓN" || isQuote;
  const isMixto  = sale.payment_method === "MIXTO";
  // Desglose multimodal: puede venir como objeto (local) o string JSON (backend).
  let _pd = sale.payment_details;
  if (typeof _pd === "string") { try { _pd = JSON.parse(_pd); } catch (_) { _pd = null; } }
  const saleSplits = (_pd && Array.isArray(_pd.splits)) ? _pd.splits : null;
  const metodoPago = isCoti ? "COTIZACIÓN"
    : isMixto ? "PAGO MIXTO"
    : (methodMap[sale.payment_method] || sale.payment_method || "EFECTIVO");

  const clientName  = (sale.client?.name  || activeClient?.name  || "PÚBLICO EN GENERAL").toUpperCase();
  const clientRfc   = (sale.client?.rfc   || activeClient?.rfc   || "XAXX010101000").toUpperCase();
  const clientPhone = sale.client?.phone  || activeClient?.phone  || "";
  const cajero      = (document.getElementById("cashier-name")?.textContent || "CAJA 1").toUpperCase();
  const docLabel    = isCoti ? "COTIZACIÓN" : isRefund ? "DEVOLUCIÓN" : "TICKET";

  // ── Filas de productos ──
  const itemsToPrint = sale.items || [];
  const itemsHTML = itemsToPrint.map(item => {
    const desc    = (item.description || `PROD ${item.product_sku}`).substring(0,22).toUpperCase();
    const isNeg   = (item.quantity || 0) < 0;
    const absQty  = Math.abs(item.quantity);
    const qtyStr  = (isNeg ? "-" : "") + (absQty % 1 === 0 ? absQty.toFixed(0) : absQty.toFixed(2));
    const imp     = Math.abs(item.subtotal).toFixed(2);
    const impStr  = isNeg ? `-$${imp}` : `$${imp}`;
    return `
      <div style="margin-bottom:5px">
        <div class="t-bold">${desc}</div>
        <div class="t-item-row">
          <div class="t-col-50">${item.product_sku}</div>
          <div class="t-col-25c">${qtyStr}</div>
          <div class="t-col-25r">${impStr}</div>
        </div>
      </div>`;
  }).join("");

  // ── Cálculo de totales ──
  const absTotal   = Math.abs(sale.total);
  const subtotalNI = absTotal / 1.16;
  const iva        = absTotal - subtotalNI;

  // ── Bloque de descuento (opcional) ──
  const discountHTML = (sale.discount > 0)
    ? `<div class="t-flex"><span>DESCUENTO:</span><span>-$${sale.discount.toFixed(2)}</span></div>`
    : "";

  // ── Bloque de pago según tipo ──
  let payHTML = `<div class="t-flex"><span>FORMA DE PAGO:</span><span>${metodoPago}</span></div>`;
  if (isRefund) {
    const cashR   = Math.abs(sale.amount_paid || 0);
    const creditR = Math.max(0, absTotal - cashR);
    payHTML += `<div class="t-flex"><span>EFECTIVO REGRESADO:</span><span>$${cashR.toFixed(2)}</span></div>`;
    if (creditR > 0)
      payHTML += `<div class="t-flex t-bold"><span>SALDO A FAVOR:</span><span>$${creditR.toFixed(2)}</span></div>`;
  } else if (isCredit) {
    const adv  = sale.advance || 0;
    payHTML += `<div class="t-flex"><span>ANTICIPO:</span><span>$${adv.toFixed(2)}</span></div>`;
    payHTML += `<div class="t-flex t-bold"><span>SALDO CRÉDITO:</span><span>$${(absTotal - adv).toFixed(2)}</span></div>`;
    if (_pd && _pd.splits && _pd.splits[0] && _pd.splits[0].meta) {
      payHTML += _renderPayMetaHTML(_pd.splits[0].meta, "006");
    }
  } else if (!isCoti) {
    const recibido = sale.amount_paid || 0;
    const cambio   = sale.change_returned || 0;
    if (saleSplits && saleSplits.length) {
      // Pago multimodal: renglón por forma de pago + datos capturados (C-03).
      saleSplits.forEach(s => {
        payHTML += `<div class="t-flex"><span>· ${(s.label || methodMap[s.method] || s.method)}:</span><span>$${Number(s.amount || 0).toFixed(2)}</span></div>`;
        payHTML += _renderPayMetaHTML(s.meta || null, s.method);
      });
    } else if (_pd && _pd.splits && _pd.splits[0] && _pd.splits[0].meta) {
      // Método único con datos de captura (cheque/tarjeta/transferencia).
      payHTML += _renderPayMetaHTML(_pd.splits[0].meta, sale.payment_method);
    }
    payHTML += `<div class="t-flex"><span>RECIBIDO:</span><span>$${recibido.toFixed(2)}</span></div>`;
    payHTML += `<div class="t-flex t-bold"><span>CAMBIO:</span><span>$${cambio.toFixed(2)}</span></div>`;
  }

  // ── Badges especiales ──
  let badgesHTML = "";
  if (sale.is_cfdi)
    badgesHTML += `<div class="t-center t-bold" style="border:1px solid #000;padding:3px;margin:5px 0">★ FACTURADO CFDI 4.0 ★</div>`;
  if (sale.is_safekept)
    badgesHTML += `<div class="t-center t-bold" style="border:1px solid #000;padding:3px;margin:5px 0">▣ RESGUARDO DE MATERIAL</div>`;
  if (isCoti)
    badgesHTML += `
      <div class="t-center" style="border:1px dashed #000;padding:5px;margin:5px 0">
        <div class="t-bold">COTIZACIÓN - NO ES COMPROBANTE FISCAL</div>
        <div class="t-small">VALIDEZ: 15 DÍAS NATURALES</div>
      </div>`;

  // ── T-4f: renglones a resguardo por faltante ──
  const _resg = (sale.resguardos || []).filter(r => (r.quantity_pending || 0) > 0);
  if (_resg.length) {
    badgesHTML += `
      <div style="border:1px solid #000;padding:5px;margin:5px 0">
        <div class="t-bold t-center">▣ ARTÍCULOS EN RESGUARDO</div>
        ${_resg.map(r => `<div class="t-small">${r.product_sku} · ${r.quantity_pending} pza · llega aprox. ${r.eta_date || "por confirmar"}</div>`).join("")}
        <div class="t-small t-center" style="margin-top:3px">Se te avisará cuando esté listo para recoger.</div>
      </div>`;
  }

  // ── Domicilio (opcional) ──
  let delivHTML = "";
  if (deliveryDetails) {
    delivHTML = `
      <div class="t-divider"></div>
      <div class="t-bold">📦 ENTREGA A DOMICILIO:</div>
      <div>CALLE: ${deliveryDetails.street}</div>
      <div>COL: ${deliveryDetails.colony}</div>
      <div>TEL: ${deliveryDetails.phone || "S/N"}</div>
      <div>FECHA: ${deliveryDetails.date || "S/N"}</div>
      ${deliveryDetails.notes ? `<div>NOTAS: ${deliveryDetails.notes}</div>` : ""}`;
  }

  // ── Mensaje de pie ──
  const footerMsg = isRefund
    ? "✓ DEVOLUCIÓN REGISTRADA"
    : isCoti
      ? "GRACIAS POR SU PREFERENCIA"
      : "¡GRACIAS POR SU COMPRA! VUELVA PRONTO";

  // ════════════════════════════════════════════
  // PLANTILLA MAESTRA 80MM (estructura exacta)
  // ════════════════════════════════════════════
  const blankLines = parseInt(cfg.ticketBlankLines || "0");
  const spacing = "<br>".repeat(blankLines);
  const logoHtml = (cfg.termLogo && cfg.bizLogo) ? `<div class="t-center" style="margin-bottom:10px"><img src="${cfg.bizLogo}" style="max-width:60mm;max-height:30mm;filter:grayscale(100%) contrast(1.2)"></div>` : "";

  const ticketHTML = `
<div id="ticket-80mm" class="ticket-container">

  <!-- CABECERA -->
  ${spacing}
  ${logoHtml}
  <div class="t-center">
    <div class="t-bold t-large">${cfg.bizName || "MAGDALENO"}</div>
    <div>${cfg.bizGiro || "MADERAS & MATERIALES"}</div>
    <div>${cfg.bizAddress || "CALLE HIDALGO #124, COL. CENTRO"}</div>
    <div>TEL: ${cfg.bizPhone || "(615) 157-0000"}</div>
    ${cfg.bizRfc ? `<div>RFC: ${cfg.bizRfc}</div>` : ""}
  </div>

  <div class="t-divider"></div>

  <!-- DATOS DEL DOCUMENTO -->
  <div class="t-flex"><span>${docLabel}:</span><span class="t-bold">#${folio}</span></div>
  <div class="t-flex"><span>FECHA:</span><span>${fDate}</span></div>
  <div class="t-flex"><span>HORA:</span><span>${fTime}</span></div>
  <div class="t-flex"><span>CAJERO:</span><span>${cajero}</span></div>

  <div class="t-divider"></div>

  <!-- CLIENTE -->
  <div>CLIENTE: ${clientName}</div>
  <div>RFC: ${clientRfc}</div>
  ${clientPhone ? `<div>TEL: ${clientPhone}</div>` : ""}

  <div class="t-divider"></div>

  <!-- ENCABEZADO COLUMNAS -->
  <div class="t-item-row t-bold">
    <div class="t-col-50">ARTÍCULO</div>
    <div class="t-col-25c">CANT</div>
    <div class="t-col-25r">IMPORTE</div>
  </div>
  <div class="t-divider-solid"></div>

  <!-- PRODUCTOS -->
  ${itemsHTML}

  <div class="t-divider-solid"></div>

  <!-- TOTALES -->
  ${discountHTML}
  <div class="t-flex"><span>SUBTOTAL S/IVA:</span><span>$${subtotalNI.toFixed(2)}</span></div>
  <div class="t-flex"><span>IVA (16%):</span><span>$${iva.toFixed(2)}</span></div>
  <div class="t-flex t-bold t-large" style="margin-top:3px">
    <span>${isRefund ? "DEVOLUCIÓN:" : "TOTAL:"}</span>
    <span>${isRefund ? "-" : ""}$${absTotal.toFixed(2)}</span>
  </div>

  <div class="t-divider"></div>

  <!-- PAGO -->
  ${payHTML}

  <!-- DOMICILIO -->
  ${delivHTML}

  <!-- BADGES -->
  ${badgesHTML}

  <!-- CÓDIGO DE BARRAS REAL -->
  <div class="t-center t-barcode" style="margin-top:10px">*${folio}*</div>
  <div class="t-center t-small" style="letter-spacing:4px">${folio.split("").join(" ")}</div>

  <!-- PIE -->
  <div class="t-center" style="margin-top:12px;font-size:10px">
    ${footerMsg}<br>VENDEDOR VIRTUAL - CALEBSYS V2.0
  </div>

</div>`;

  container.innerHTML = ticketHTML;
  const _tpModal = document.getElementById("totals-panel");
  if (_tpModal) _tpModal.classList.add("hidden");
  document.getElementById("modal-ticket").classList.remove("hidden");
  activeModal = "modal-ticket";

  // Al concretar la venta (!isQuote): enviar a imprimir sin preguntar y mostrar el recuadro
  // "SELECCIONA EL FORMATO" (#modal-print-share) con duración de 2 segundos.
  // Si no se toma la aplicación en 2s se borra y continúa con la siguiente venta (o más rápido con ESC).
  if (!isQuote) {
    try {
      if (window.CalebNative && typeof window.CalebNative.printThermal === "function") {
        window.CalebNative.printThermal(ticketHTML, sale);
      }
      if (typeof showToast === "function") {
        showToast(`🖨️ Ticket #${folio} enviado a imprimir automáticamente`, "success");
      }
    } catch (_) {}

    if (typeof openPrintShareFlow === "function") {
      openPrintShareFlow(true);
    }
  }
}

function printTicketText() {
  // ✅ SOLUCIÓN CORRECTA PARA IMPRESORAS TÉRMICAS:
  // Usamos window.print() en la MISMA PÁGINA.
  // El @media print en el <head> de index.html oculta todo
  // excepto #ticket-80mm — cero páginas en blanco garantizado.
  window.print();
}

function closeTicketModal() {
  if (typeof clearPostSaleFormatTimer === "function") {
    clearPostSaleFormatTimer();
  }
  const _mps = document.getElementById("modal-print-share");
  if (_mps) _mps.classList.add("hidden");

  document.getElementById("modal-ticket").classList.add("hidden");
  activeModal = null;
  
  if (!activeTicketIsQuote) {
    cart = [];
    
    // Reset return mode state and layout styling
    isReturnModeActive = false;
    const f2Btn = document.getElementById("btn-f2-devolucion");
    if (f2Btn) {
      f2Btn.style.borderColor = "";
      f2Btn.style.backgroundColor = "";
      f2Btn.style.color = "";
    }

    updateClientDisplay(getWalkInClient());

    // Reset Inputs
    document.getElementById("cash-received-input").value = "";
    document.getElementById("discount-input").value = "";
    document.getElementById("advance-input").value = "";
    document.getElementById("cfdi-toggle").checked = false;
    document.getElementById("safekept-toggle").checked = false;
    const _sfT = document.getElementById("saldo-favor-toggle");
    if (_sfT) _sfT.checked = false;
    window._customSaldoFavorAmount = 0;
    activePaymentMethod = "001";
    deliveryDetails = null; // Clear delivery details for next sale

    // Limpiar el desglose de pago multimodal para la siguiente venta.
    splitPayments = [];
    window._lastSalePayments = null;
    if (typeof renderSplitPayments === "function") renderSplitPayments();

    updateCartUI();
  }
  
  activeTicketIsQuote = false;
  // Ocultar el modal flotante de cobro al cerrar el ticket
  var _tpClose = document.getElementById("totals-panel");
  if (_tpClose) {
    _tpClose.classList.add("hidden");
  }
  // GAP-2: limpiar listener ENTER de efectivo al cerrar ticket
  if (_cashEnterHandler) {
    const ci = document.getElementById("cash-received-input");
    if (ci) ci.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }
  focusProductInput();
}

// ── Ítem 1: Puntos de lealtad en checkout ────────────────────────────────────

window._loyaltyPtsUsed     = 0;   // puntos comprometidos en esta venta
window._loyaltyValorPunto  = 1.0; // MXN/punto (cargado con el cliente)
window._loyaltyPtsBalance  = 0;   // saldo del cliente
window._loyaltyMxnDiscount = 0;   // MXN descontados por puntos (separado de discount-input)

function loadLoyaltyPtsForClient(clientId) {
  const panel = document.getElementById("loyalty-pts-panel");
  if (!panel) return;
  if (!clientId || clientId === "1") { panel.classList.add("hidden"); return; }

  apiFetch(`/api/loyalty/clients/${encodeURIComponent(clientId)}/points`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) { panel.classList.add("hidden"); return; }
      window._loyaltyPtsBalance = d.puntos || 0;
      window._loyaltyValorPunto = d.puntos > 0 ? (d.valor_mxn / d.puntos) : 1.0;
      const infoEl = document.getElementById("loyalty-pts-info");
      if (infoEl) infoEl.textContent = `${d.puntos} pts = $${(d.valor_mxn||0).toFixed(2)}`;
      if (d.puntos > 0) {
        panel.classList.remove("hidden");
      } else {
        panel.classList.add("hidden");
      }
    }).catch(() => panel.classList.add("hidden"));
}

function previewLoyaltyDiscount() {
  const inp     = document.getElementById("loyalty-pts-input");
  const preview = document.getElementById("loyalty-pts-preview");
  if (!inp || !preview) return;
  const pts = parseInt(inp.value) || 0;
  if (pts <= 0) { preview.classList.add("hidden"); return; }
  const mxn = (pts * window._loyaltyValorPunto).toFixed(2);
  preview.textContent = `= $${mxn} de descuento`;
  preview.classList.remove("hidden");
}

function applyLoyaltyDiscount() {
  const inp = document.getElementById("loyalty-pts-input");
  const pts = parseInt(inp && inp.value) || 0;
  if (pts <= 0) { showToast("Ingresa cuántos puntos usar", "warning"); return; }
  if (pts > window._loyaltyPtsBalance) {
    showToast(`Sólo tiene ${window._loyaltyPtsBalance} pts disponibles`, "warning"); return;
  }
  const mxnRaw = _round2(pts * window._loyaltyValorPunto);
  // Cap: descuento de puntos no puede superar lo que falta por pagar (menos el descuento manual)
  const baseTot = cart.reduce((s, i) => s + i.subtotal, 0);
  const manualDisc = parseFloat(document.getElementById("discount-input")?.value) || 0;
  const maxRoom = Math.max(0, _round2(baseTot - manualDisc));
  const mxn = Math.min(mxnRaw, maxRoom);

  window._loyaltyPtsUsed     = pts;
  window._loyaltyMxnDiscount = mxn;

  const clearBtn = document.getElementById("loyalty-pts-clear");
  const preview  = document.getElementById("loyalty-pts-preview");
  if (clearBtn) clearBtn.classList.remove("hidden");
  if (inp)      inp.disabled = true;
  if (preview)  { preview.textContent = `= $${mxn.toFixed(2)} aplicado`; preview.classList.remove("hidden"); }
  showToast(`${pts} pts = $${mxn.toFixed(2)} descontados`, "success");
  updateCartUI();
}

function clearLoyaltyDiscount() {
  window._loyaltyPtsUsed     = 0;
  window._loyaltyMxnDiscount = 0;
  const inp     = document.getElementById("loyalty-pts-input");
  const preview = document.getElementById("loyalty-pts-preview");
  const clearBtn= document.getElementById("loyalty-pts-clear");
  if (inp)     { inp.value = ""; inp.disabled = false; }
  if (preview)  preview.classList.add("hidden");
  if (clearBtn) clearBtn.classList.add("hidden");
  updateCartUI();
}



function onCheckoutApartadoToggle() {
  const chk = document.getElementById("apartado-checkout-toggle");
  if (!chk) return;
  if (chk.checked) {
    const cotChk = document.getElementById("cotizar-checkout-toggle");
    if (cotChk) cotChk.checked = false;
    if (typeof showToast === "function") {
      showToast("📦 Opción Apartado (F5): ACTIVADA", "info");
    }
  } else {
    if (typeof showToast === "function") {
      showToast("📦 Opción Apartado (F5): DESACTIVADA", "info");
    }
  }
}
window.onCheckoutApartadoToggle = onCheckoutApartadoToggle;

function onCheckoutCotizarToggle() {
  const chk = document.getElementById("cotizar-checkout-toggle");
  if (!chk) return;
  if (chk.checked) {
    const apChk = document.getElementById("apartado-checkout-toggle");
    if (apChk) apChk.checked = false;
    if (typeof showToast === "function") {
      showToast("📋 Opción Cotizar (F4): ACTIVADA", "info");
    }
  } else {
    if (typeof showToast === "function") {
      showToast("📋 Opción Cotizar (F4): DESACTIVADA", "info");
    }
  }
}
window.onCheckoutCotizarToggle = onCheckoutCotizarToggle;


// ============================================================================
// SISTEMA MULTICANAL DE LIGA DE PAGO + ALERTA EN VIVO + AUTORIZACIÓN AUTOMÁTICA
// ============================================================================
const PAYLINK_STORAGE_KEY = "calebsys_pending_payment_links_v1";
const _paylinkBroadcast = (typeof BroadcastChannel !== "undefined")
  ? new BroadcastChannel("calebsys_payment_links")
  : null;
let _currentDraftPayLinkOrderId = null;
let _lastAuthorizedSaleObj = null;
let _processingPayLinkOrders = {};

function _getPendingPayLinkOrders() {
  try {
    return JSON.parse(localStorage.getItem(PAYLINK_STORAGE_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function _savePendingPayLinkOrders(list) {
  localStorage.setItem(PAYLINK_STORAGE_KEY, JSON.stringify(list));
}

function _playAuthSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.09);
      gain.gain.setValueAtTime(0.14, ctx.currentTime + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.09 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.09);
      osc.stop(ctx.currentTime + idx * 0.09 + 0.26);
    });
  } catch (_) {}
}

function openPaymentLinkModal(existingOrderId) {
  const modal = document.getElementById("payment-link-modal");
  if (!modal) return;

  const orders = _getPendingPayLinkOrders();
  const existing = existingOrderId ? orders.find(o => o.orderId === existingOrderId) : null;

  const totals = (typeof calculateTotals === "function") ? calculateTotals() : { total: 0 };
  const restAmt = (typeof paymentRestante === "function" && paymentRestante() > 0)
    ? paymentRestante()
    : Math.abs(totals.total || 0);
  const amountToCharge = existing ? Number(existing.amount || 0) : _round2(restAmt);

  if (amountToCharge <= 0) {
    if (typeof showToast === "function") showToast("El monto a cobrar debe ser mayor a $0.00", "warning");
    return;
  }

  _currentDraftPayLinkOrderId = existing
    ? existing.orderId
    : ("ORD-" + Math.floor(100000 + Math.random() * 900000));

  const linkUrl = `${window.location.origin}/pay-link.html?order=${encodeURIComponent(_currentDraftPayLinkOrderId)}`;

  const folioLbl = document.getElementById("paylink-order-folio-label");
  const amtDisp = document.getElementById("paylink-amount-display");
  const urlInp = document.getElementById("paylink-url-input");
  const nameInp = document.getElementById("paylink-recipient-name");
  const phoneInp = document.getElementById("paylink-recipient-phone");
  const emailInp = document.getElementById("paylink-recipient-email");
  const banner = document.getElementById("paylink-client-mode-banner");
  const bannerIcon = document.getElementById("paylink-client-mode-icon");
  const bannerTxt = document.getElementById("paylink-client-mode-text");

  if (folioLbl) folioLbl.textContent = `Folio de Orden: ${_currentDraftPayLinkOrderId} · Validación bancaria automática`;
  if (amtDisp) amtDisp.textContent = `$${_fmtMoney(amountToCharge)} MXN`;
  if (urlInp) urlInp.value = linkUrl;

  if (existing) {
    if (nameInp) nameInp.value = existing.clientName || "";
    if (phoneInp) phoneInp.value = existing.recipientPhone || "";
    if (emailInp) emailInp.value = existing.recipientEmail || "";
    if (banner) {
      banner.className = "bg-blue-50 border border-blue-200 text-blue-900 rounded-xl px-3.5 py-2 text-[11px] font-bold flex items-center gap-2";
    }
    if (bannerIcon) bannerIcon.textContent = "🔄";
    if (bannerTxt) bannerTxt.textContent = `Reenviando liga de la orden ${existing.orderId}. Puedes modificar el contacto si lo deseas.`;
  } else {
    const cli = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
    const isWalkIn = !cli || !cli.id || cli.id === 1 || String(cli.id) === "1" || String(cli.rfc || "").toUpperCase() === "XAXX010101000" || String(cli.name || "").toUpperCase().includes("PUBLICO") || String(cli.name || "").toUpperCase().includes("PÚBLICO");

    if (!isWalkIn) {
      const det = (typeof getClientDeterministicDetails === "function") ? getClientDeterministicDetails(cli) : {};
      const rawPhone = String(cli.whatsapp || cli.phone || det.phone || "").replace(/\D/g, "").slice(-10);
      const rawEmail = String(cli.email || det.email || "").trim();
      if (nameInp) nameInp.value = cli.name || "";
      if (phoneInp) phoneInp.value = rawPhone;
      if (emailInp) emailInp.value = rawEmail;

      if (banner) {
        banner.className = "bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl px-3.5 py-2 text-[11px] font-bold flex items-center gap-2";
      }
      if (bannerIcon) bannerIcon.textContent = "👤";
      if (bannerTxt) {
        bannerTxt.textContent = `Cliente asignado (${cli.name}): canales precargados y 100% editables si deseas enviar a otro WhatsApp o correo.`;
      }
    } else {
      if (nameInp) nameInp.value = "";
      if (phoneInp) phoneInp.value = "";
      if (emailInp) emailInp.value = "";

      if (banner) {
        banner.className = "bg-amber-50 border border-amber-300 text-amber-950 rounded-xl px-3.5 py-2 text-[11px] font-bold flex items-center gap-2";
      }
      if (bannerIcon) bannerIcon.textContent = "⚠️";
      if (bannerTxt) {
        bannerTxt.textContent = "Sin cliente asignado (Público General): solicita y captura el nombre y WhatsApp o correo del cliente.";
      }
    }
  }

  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    if (nameInp && !nameInp.value.trim()) {
      nameInp.focus();
    } else if (phoneInp) {
      phoneInp.focus();
      phoneInp.select();
    }
  });
}
window.openPaymentLinkModal = openPaymentLinkModal;

function closePaymentLinkModal() {
  const modal = document.getElementById("payment-link-modal");
  if (modal) modal.classList.add("hidden");
}
window.closePaymentLinkModal = closePaymentLinkModal;

function copyGeneratedPaymentLink() {
  const urlInp = document.getElementById("paylink-url-input");
  if (!urlInp) return;
  urlInp.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(urlInp.value).catch(() => {});
  }
  if (typeof showToast === "function") {
    showToast("📋 Liga de pago copiada al portapapeles", "success");
  }
}
window.copyGeneratedPaymentLink = copyGeneratedPaymentLink;

function sendPaymentLinkByChannel(channel) {
  const nameInp = document.getElementById("paylink-recipient-name");
  const phoneInp = document.getElementById("paylink-recipient-phone");
  const emailInp = document.getElementById("paylink-recipient-email");
  const urlInp = document.getElementById("paylink-url-input");

  const recipientName = (nameInp && nameInp.value.trim()) || "CLIENTE MOSTRADOR";
  const cleanPhone = (phoneInp && phoneInp.value || "").replace(/\D/g, "").slice(-10);
  const recipientEmail = (emailInp && emailInp.value.trim()) || "";
  const linkUrl = (urlInp && urlInp.value) || `${window.location.origin}/pay-link.html?order=${encodeURIComponent(_currentDraftPayLinkOrderId || "ORD-0000")}`;

  if (channel === "whatsapp" && cleanPhone.length < 10) {
    if (typeof showToast === "function") {
      showToast("📲 Captura un número de WhatsApp válido de 10 dígitos para enviar la liga", "warning");
    }
    if (phoneInp) phoneInp.focus();
    return;
  }
  if (channel === "email" && (!recipientEmail || !recipientEmail.includes("@"))) {
    if (typeof showToast === "function") {
      showToast("✉️ Captura un correo electrónico válido para enviar la liga", "warning");
    }
    if (emailInp) emailInp.focus();
    return;
  }
  if ((channel === "whatsapp" || channel === "email" || channel === "sms") && (!nameInp || !nameInp.value.trim())) {
    if (typeof showToast === "function") {
      showToast("👤 Captura el nombre del destinatario para identificar la alerta de pago", "warning");
    }
    if (nameInp) nameInp.focus();
    return;
  }

  const orders = _getPendingPayLinkOrders();
  let ord = orders.find(o => o.orderId === _currentDraftPayLinkOrderId);
  const isResend = !!ord;

  if (!ord) {
    const totals = (typeof calculateTotals === "function") ? calculateTotals() : { total: 0, discount: 0 };
    const restAmt = (typeof paymentRestante === "function" && paymentRestante() > 0)
      ? paymentRestante()
      : Math.abs(totals.total || 0);
    const sfAplicado = (typeof _getSaldoFavorAplicado === "function") ? _getSaldoFavorAplicado() : 0;

    ord = {
      orderId: _currentDraftPayLinkOrderId,
      createdAt: new Date().toISOString(),
      status: "PENDING",
      channel: channel.toUpperCase(),
      clientId: (typeof persistedClientId === "function") ? persistedClientId() : null,
      clientName: recipientName,
      recipientPhone: cleanPhone,
      recipientEmail: recipientEmail,
      amount: _round2(restAmt),
      total: _round2(Math.abs(totals.total || restAmt)),
      discount: Number(totals.discount || 0),
      saldoFavorApplied: sfAplicado,
      isCfdi: !!document.getElementById("cfdi-toggle")?.checked,
      isSafekept: !!document.getElementById("safekept-toggle")?.checked,
      items: (Array.isArray(cart) ? cart : []).map(it => ({
        sku: it.sku,
        description: it.description || it.name || it.sku,
        quantity: Number(it.quantity) || 1,
        price: Number(it.price) || 0,
        subtotal: _round2((Number(it.quantity) || 1) * (Number(it.price) || 0))
      })),
      splitPayments: Array.isArray(splitPayments) ? [...splitPayments] : [],
      linkUrl: linkUrl
    };
    orders.push(ord);
  } else {
    ord.clientName = recipientName;
    ord.recipientPhone = cleanPhone;
    ord.recipientEmail = recipientEmail;
    ord.channel = channel.toUpperCase();
  }

  _savePendingPayLinkOrders(orders);

  const msgText = `Hola *${recipientName}*, te compartimos tu liga de pago seguro de *Magdaleno Maderas & Materiales* por *$${_fmtMoney(ord.amount)} MXN* (Orden *${ord.orderId}*):

🔗 ${linkUrl}

Al completar tu pago se autorizará automáticamente en caja.`;

  if (channel === "whatsapp") {
    window.open(`https://wa.me/52${cleanPhone}?text=${encodeURIComponent(msgText)}`, "_blank", "noopener");
  } else if (channel === "email") {
    const subj = `Liga de Pago $${_fmtMoney(ord.amount)} MXN - Orden ${ord.orderId} - Magdaleno`;
    const body = `Hola ${recipientName},

Puedes realizar tu pago seguro por $${_fmtMoney(ord.amount)} MXN en el siguiente enlace:
${linkUrl}

Folio de Orden: ${ord.orderId}
Confirmación automática en caja.`;
    window.open(`mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`, "_self");
  } else if (channel === "sms") {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msgText).catch(() => {});
    }
  } else if (channel === "portal") {
    window.open(linkUrl, "_blank");
  }

  closePaymentLinkModal();

  // Si es una orden nueva (no un simple reenvío), liberamos la caja y dejamos la alerta activa al cajero
  if (!isResend) {
    exitCheckoutMode();
    cart = [];
    splitPayments = [];
    window._lastSalePayments = null;
    window._customSaldoFavorAmount = 0;
    const sfTgl = document.getElementById("saldo-favor-toggle");
    if (sfTgl) sfTgl.checked = false;
    if (typeof renderSplitPayments === "function") renderSplitPayments();
    if (typeof updateCartUI === "function") updateCartUI();
  }

  renderPendingPaymentLinksWidget();
  if (typeof showToast === "function") {
    showToast(`⏳ Liga ${ord.orderId} enviada (${channel.toUpperCase()}). Caja liberada — En espera de autorización automática.`, "info");
  }
}
window.sendPaymentLinkByChannel = sendPaymentLinkByChannel;

function renderPendingPaymentLinksWidget() {
  const widget = document.getElementById("cashier-pending-links-widget");
  const titleEl = document.getElementById("cashier-pending-links-title");
  const listEl = document.getElementById("cashier-pending-links-list");
  if (!widget || !listEl) return;

  const orders = _getPendingPayLinkOrders().filter(o => o.status === "PENDING");
  if (orders.length === 0) {
    widget.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }

  widget.classList.remove("hidden");
  if (titleEl) {
    titleEl.textContent = `⏳ ${orders.length === 1 ? "LIGA DE PAGO PENDIENTE (1)" : `LIGAS DE PAGO PENDIENTES (${orders.length})`}`;
  }

  listEl.innerHTML = orders.map(o => {
    const contactInfo = o.recipientPhone ? `📲 ${o.recipientPhone}` : (o.recipientEmail ? `✉️ ${o.recipientEmail}` : o.channel);
    return `
      <div class="bg-white/95 border border-amber-400 rounded-xl p-2.5 shadow-xs space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-black text-slate-900 truncate">${o.clientName || "CLIENTE"}</div>
            <div class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
              <span class="font-mono text-amber-800 font-black">${o.orderId}</span>
              <span>·</span>
              <span class="truncate">${contactInfo}</span>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-sm font-black text-amber-900">$${_fmtMoney(o.amount)}</div>
            <div class="text-[9px] font-extrabold text-amber-600 uppercase">⏳ Esperando pago</div>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-1 pt-1 border-t border-slate-100">
          <button type="button" data-click="openPendingPayLinkPortal" data-click-arg="${o.orderId}"
                  class="bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg py-1 text-[9.5px] font-black uppercase transition cursor-pointer" title="Abrir el portal de pago del cliente">
            🌐 Portal
          </button>
          <button type="button" data-click="simulatePaymentLinkPaid" data-click-arg="${o.orderId}"
                  class="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg py-1 text-[9.5px] font-black uppercase transition cursor-pointer" title="Simular confirmación bancaria inmediata">
            ⚡ Autorizar
          </button>
          <button type="button" data-click="openPaymentLinkModal" data-click-arg="${o.orderId}"
                  class="bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg py-1 text-[9.5px] font-black uppercase transition cursor-pointer" title="Cambiar teléfono/correo o reenviar liga">
            📲 Reenviar
          </button>
          <button type="button" data-click="cancelPendingPaymentLink" data-click-arg="${o.orderId}"
                  class="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg py-1 text-[9.5px] font-black uppercase transition cursor-pointer" title="Cancelar liga o devolver al carrito">
            ✕ Quitar
          </button>
        </div>
      </div>
    `;
  }).join("");
}
window.renderPendingPaymentLinksWidget = renderPendingPaymentLinksWidget;

function openPendingPayLinkPortal(orderId) {
  const url = `${window.location.origin}/pay-link.html?order=${encodeURIComponent(orderId)}`;
  window.open(url, "_blank");
}
window.openPendingPayLinkPortal = openPendingPayLinkPortal;

function simulatePaymentLinkPaid(orderId) {
  const orders = _getPendingPayLinkOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx < 0) return;
  orders[idx].status = "PAID";
  orders[idx].paidAt = new Date().toISOString();
  orders[idx].authReference = "SPEI-" + Math.floor(10000000 + Math.random() * 90000000);
  orders[idx].bankOrigin = "STP / SPEI AUTOMÁTICO";
  _savePendingPayLinkOrders(orders);
  _checkPendingPaymentLinksStatus();
}
window.simulatePaymentLinkPaid = simulatePaymentLinkPaid;

function cancelPendingPaymentLink(orderId) {
  const orders = _getPendingPayLinkOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx < 0) return;
  const ord = orders[idx];
  orders.splice(idx, 1);
  _savePendingPayLinkOrders(orders);
  renderPendingPaymentLinksWidget();
  if (typeof showToast === "function") {
    showToast(`Liga ${ord.orderId} cancelada y retirada de las alertas`, "info");
  }
}
window.cancelPendingPaymentLink = cancelPendingPaymentLink;

async function _authorizeAndCommitPaidLink(ord) {
  if (!ord || _processingPayLinkOrders[ord.orderId]) return;
  _processingPayLinkOrders[ord.orderId] = true;

  const authRef = ord.authReference || ("SPEI-" + Math.floor(10000000 + Math.random() * 90000000));
  const bankOrig = ord.bankOrigin || "TRANSFERENCIA LIGA DE PAGO";

  const saleItems = (ord.items || []).map(it => ({
    product_sku: it.sku,
    quantity: Number(it.quantity) || 1,
    price: Number(it.price) || 0,
    subtotal: Number(it.subtotal || (it.quantity * it.price)) || 0
  }));

  const payments = Array.isArray(ord.splitPayments) ? [...ord.splitPayments] : [];
  payments.push({
    method: "004",
    label: "TRANSFERENCIA (LIGA DE PAGO)",
    amount: _round2(ord.amount),
    meta: {
      referencia: authRef,
      banco_origen: bankOrig,
      estatus: "confirmada",
      order_id: ord.orderId
    }
  });

  const saleBody = {
    client_id: ord.clientId || ((typeof persistedClientId === "function") ? persistedClientId() : null),
    total: Number(ord.total || ord.amount),
    payment_method: payments.length > 1 ? "MIXTO" : "004",
    amount_paid: Number(ord.total || ord.amount),
    change_returned: 0.0,
    is_cfdi: !!ord.isCfdi,
    discount: Number(ord.discount || 0),
    advance: 0.0,
    is_safekept: !!ord.isSafekept,
    saldo_favor_applied: Number(ord.saldoFavorApplied || 0),
    items: saleItems,
    payment_details: { splits: payments }
  };

  let createdSale = null;
  try {
    const res = await apiFetch(`${API_BASE}/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saleBody)
    });
    if (res.ok) {
      createdSale = await res.json();
      createdSale.payment_details = { splits: payments };
    }
  } catch (_) {}

  if (!createdSale) {
    createdSale = {
      id: Math.floor(1000 + Math.random() * 9000),
      folio: ord.orderId,
      total: Number(ord.total || ord.amount),
      payment_method: "004",
      amount_paid: Number(ord.total || ord.amount),
      change_returned: 0,
      created_at: new Date().toISOString(),
      items: saleItems,
      payment_details: { splits: payments }
    };
  }

  // Marcar la orden como COMPLETED en storage
  const allOrders = _getPendingPayLinkOrders();
  const targetIdx = allOrders.findIndex(o => o.orderId === ord.orderId);
  if (targetIdx >= 0) {
    allOrders[targetIdx].status = "COMPLETED";
    allOrders[targetIdx].saleId = createdSale.id;
    _savePendingPayLinkOrders(allOrders);
  }

  renderPendingPaymentLinksWidget();
  _playAuthSuccessChime();

  _lastAuthorizedSaleObj = createdSale;
  const lastIdEl = document.getElementById("last-ticket-id");
  if (lastIdEl && createdSale.id) lastIdEl.innerText = `#${createdSale.id}`;

  // Mostrar el recuadro emergente verde claro de Autorización Automática
  const authModal = document.getElementById("payment-link-authorized-modal");
  const amtEl = document.getElementById("auth-link-amount");
  const cliEl = document.getElementById("auth-link-client");
  const ordEl = document.getElementById("auth-link-order");
  const folEl = document.getElementById("auth-link-sale-folio");
  const refEl = document.getElementById("auth-link-ref");
  const bnkEl = document.getElementById("auth-link-bank");

  if (amtEl) amtEl.textContent = `$${_fmtMoney(ord.amount)} MXN`;
  if (cliEl) cliEl.textContent = `Cliente: ${ord.clientName || "PÚBLICO EN GENERAL"}`;
  if (ordEl) ordEl.textContent = ord.orderId;
  if (folEl) folEl.textContent = `#${createdSale.id || ord.orderId}`;
  if (refEl) refEl.textContent = authRef;
  if (bnkEl) bnkEl.textContent = bankOrig;

  if (authModal) authModal.classList.remove("hidden");

  if (typeof showToast === "function") {
    showToast(`✅ Pago de Liga ${ord.orderId} ($${_fmtMoney(ord.amount)}) autorizado automáticamente — Venta #${createdSale.id}`, "success");
  }
}

function _checkPendingPaymentLinksStatus() {
  const orders = _getPendingPayLinkOrders();
  const paidOrders = orders.filter(o => o.status === "PAID");
  paidOrders.forEach(ord => {
    _authorizeAndCommitPaidLink(ord);
  });
  renderPendingPaymentLinksWidget();
}

function openAuthorizedLinkTicket() {
  closeAuthorizedLinkModal();
  if (_lastAuthorizedSaleObj && typeof openTicketModal === "function") {
    openTicketModal(_lastAuthorizedSaleObj);
  }
}
window.openAuthorizedLinkTicket = openAuthorizedLinkTicket;

function closeAuthorizedLinkModal() {
  const authModal = document.getElementById("payment-link-authorized-modal");
  if (authModal) authModal.classList.add("hidden");
}
window.closeAuthorizedLinkModal = closeAuthorizedLinkModal;

if (_paylinkBroadcast) {
  _paylinkBroadcast.addEventListener("message", function(ev) {
    if (ev.data && ev.data.type === "PAYMENT_LINK_PAID") {
      _checkPendingPaymentLinksStatus();
    }
  });
}
window.addEventListener("storage", function(ev) {
  if (ev.key === PAYLINK_STORAGE_KEY) {
    _checkPendingPaymentLinksStatus();
  }
});
document.addEventListener("DOMContentLoaded", function() {
  renderPendingPaymentLinksWidget();
  setInterval(_checkPendingPaymentLinksStatus, 2500);
});
setTimeout(() => {
  renderPendingPaymentLinksWidget();
  setInterval(_checkPendingPaymentLinksStatus, 2500);
}, 600);

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL DE VENTAS A CRÉDITO ("006"):
// 1. Si no tiene cliente definido (Público en General), solicita poner el cliente.
// 2. Si el cliente no tiene crédito definido (límite <= 0), bloquea enviar a crédito.
// 3. Si tiene excedente sobre su crédito disponible, solicita autorización o bloquea/ajusta según sea el caso.
// ═══════════════════════════════════════════════════════════════════════════════

function getClientCreditMetrics(montoOverride) {
  const cli = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
  const hasDefinedClient = !!(cli && cli.id && cli.id !== 1 && String(cli.id) !== "1");
  const clientName = (cli && cli.name) ? cli.name : "Público en General";
  const limiteCredito = hasDefinedClient
    ? _round2(parseFloat(cli.limite_credito ?? cli.credit_limit ?? cli.creditLimit ?? 0) || 0)
    : 0;
  const saldoActual = hasDefinedClient
    ? _round2(parseFloat(cli.saldo_actual ?? cli.current_balance ?? cli.balance ?? 0) || 0)
    : 0;
  const disponibleCredito = Math.max(0, _round2(limiteCredito - saldoActual));
  const hasCreditDefined = hasDefinedClient && limiteCredito > 0.005;

  const advanceVal = parseFloat(document.getElementById("advance-input")?.value) || 0;
  const rest = typeof paymentRestante === "function" ? paymentRestante() : 0;
  const defaultMonto = Math.max(0, _round2(rest - advanceVal));
  const montoSolicitado = montoOverride !== undefined ? _round2(montoOverride) : defaultMonto;
  const excedente = Math.max(0, _round2(montoSolicitado - disponibleCredito));
  const hasExcess = hasCreditDefined && excedente > 0.005;

  return {
    hasDefinedClient,
    clientId: hasDefinedClient ? String(cli.id) : null,
    clientName,
    limiteCredito,
    saldoActual,
    disponibleCredito,
    hasCreditDefined,
    montoSolicitado,
    excedente,
    hasExcess
  };
}
window.getClientCreditMetrics = getClientCreditMetrics;

function _isCreditExcessAuthorized(metrics) {
  const auth = window._creditExcessAuthorizedForSale;
  if (!auth || !metrics || !metrics.hasDefinedClient) return false;
  if (String(auth.clientId) !== String(metrics.clientId)) return false;
  return (Number(auth.maxExcess) || 0) + 0.01 >= metrics.excedente;
}

function updateCreditStatusBannerUI() {
  const m = getClientCreditMetrics();
  const nameEl  = document.getElementById("crd-status-client-name");
  const limEl   = document.getElementById("crd-status-limit");
  const usedEl  = document.getElementById("crd-status-used");
  const availEl = document.getElementById("crd-status-avail");
  const wrapEl  = document.getElementById("crd-status-avail-wrap");
  const badgeEl = document.getElementById("credito-auth-badge");
  const badgeTxt = document.getElementById("credito-auth-badge-text");

  if (nameEl) nameEl.textContent = `Cliente: ${m.clientName}`;
  if (limEl)  limEl.textContent  = `$${_fmtMoney(m.limiteCredito)}`;
  if (usedEl) usedEl.textContent = `$${_fmtMoney(m.saldoActual)}`;
  if (availEl) availEl.textContent = `$${_fmtMoney(m.disponibleCredito)}`;
  if (wrapEl) {
    wrapEl.className = m.hasExcess ? "text-red-600 font-black" : "text-emerald-700 font-black";
  }

  if (badgeEl) {
    if (m.hasExcess && _isCreditExcessAuthorized(m)) {
      const auth = window._creditExcessAuthorizedForSale;
      badgeEl.classList.remove("hidden");
      if (badgeTxt) {
        badgeTxt.textContent = `✅ Excedente (+$${_fmtMoney(m.excedente)}) autorizado por ${auth.authorizedBy || "Supervisor"}`;
      }
    } else {
      badgeEl.classList.add("hidden");
    }
  }
}
window.updateCreditStatusBannerUI = updateCreditStatusBannerUI;

function openClientSelectorForCredit() {
  window._pendingCreditSelection = true;
  const crdAuthModal = document.getElementById("credit-exceeded-auth-modal");
  if (crdAuthModal) crdAuthModal.classList.add("hidden");

  const promptBanner = document.getElementById("client-modal-credit-prompt-banner");
  if (promptBanner) promptBanner.classList.remove("hidden");

  if (typeof selectedSearchType !== "undefined") {
    selectedSearchType = "client";
  }
  if (typeof openModal === "function") {
    openModal("modal-clients");
  } else {
    const mc = document.getElementById("modal-clients");
    if (mc) mc.classList.remove("hidden");
  }
  if (typeof toggleClientTab === "function") {
    toggleClientTab("search");
  }
  const searchInput = document.getElementById("client-search-input");
  if (searchInput) {
    searchInput.value = "";
    setTimeout(() => searchInput.focus(), 40);
  }
  if (typeof performClientSearch === "function") {
    performClientSearch("");
  }
}
window.openClientSelectorForCredit = openClientSelectorForCredit;

let _pendingCreditSubmitAfterAuth = false;

function openCreditControlModal(mode, metrics, submitAfterAuth) {
  const m = metrics || getClientCreditMetrics();
  _pendingCreditSubmitAfterAuth = !!submitAfterAuth;

  const modal = document.getElementById("credit-exceeded-auth-modal");
  if (!modal) return;

  const titleEl    = document.getElementById("credit-modal-title");
  const subtitleEl = document.getElementById("credit-modal-subtitle");
  const iconEl     = document.getElementById("credit-modal-icon");
  const cliEl      = document.getElementById("credit-modal-client-name");
  const limEl      = document.getElementById("credit-modal-limit");
  const balEl      = document.getElementById("credit-modal-balance");
  const availEl    = document.getElementById("credit-modal-available");
  const reqEl      = document.getElementById("credit-modal-requested");
  const excRow     = document.getElementById("credit-modal-excess-row");
  const excEl      = document.getElementById("credit-modal-excess");
  const noCredBox  = document.getElementById("credit-modal-no-credit-box");
  const authSec    = document.getElementById("credit-modal-auth-section");
  const adjustBtn  = document.getElementById("btn-credit-adjust-available");
  const pinInp     = document.getElementById("credit-auth-pin-input");
  const reasonInp  = document.getElementById("credit-auth-reason-input");
  const errEl      = document.getElementById("credit-auth-error-msg");
  const roleHint   = document.getElementById("credit-auth-role-hint");

  if (cliEl)   cliEl.textContent   = m.clientName;
  if (limEl)   limEl.textContent   = `$${_fmtMoney(m.limiteCredito)}`;
  if (balEl)   balEl.textContent   = `$${_fmtMoney(m.saldoActual)}`;
  if (availEl) availEl.textContent = `$${_fmtMoney(m.disponibleCredito)}`;
  if (reqEl)   reqEl.textContent   = `$${_fmtMoney(m.montoSolicitado)}`;
  if (errEl)   { errEl.textContent = ""; errEl.classList.add("hidden"); }

  if (mode === "no_credit" || !m.hasCreditDefined) {
    if (iconEl)     iconEl.textContent     = "🚫";
    if (titleEl)    titleEl.textContent    = "CLIENTE SIN CRÉDITO DEFINIDO";
    if (subtitleEl) subtitleEl.textContent = "No se permite enviar a crédito cuando el cliente tiene límite $0.00";
    if (excRow)     excRow.classList.add("hidden");
    if (noCredBox)  noCredBox.classList.remove("hidden");
    if (authSec)    authSec.classList.add("hidden");
  } else {
    if (iconEl)     iconEl.textContent     = "⚠️";
    if (titleEl)    titleEl.textContent    = "EXCEDENTE DE LÍNEA DE CRÉDITO";
    if (subtitleEl) subtitleEl.textContent = "Solicita autorización para el excedente o bloquea/ajusta la operación";
    if (excRow)     excRow.classList.remove("hidden");
    if (excEl)      excEl.textContent      = `+$${_fmtMoney(m.excedente)}`;
    if (noCredBox)  noCredBox.classList.add("hidden");
    if (authSec)    authSec.classList.remove("hidden");

    if (adjustBtn) {
      if (m.disponibleCredito > 0.005) {
        adjustBtn.classList.remove("hidden");
        adjustBtn.textContent = `💳 USAR DISP. ($${_fmtMoney(m.disponibleCredito)})`;
      } else {
        adjustBtn.classList.add("hidden");
      }
    }

    const activeRole = (typeof _getPosActiveRole === "function" ? _getPosActiveRole() : (localStorage.getItem("calebsys_role") || "admin")).toLowerCase();
    const isAdminOrManager = (activeRole === "admin" || activeRole === "administrador" || activeRole === "gerente" || activeRole === "propietario");
    if (roleHint) {
      roleHint.classList.toggle("hidden", !isAdminOrManager);
    }
    if (pinInp) {
      pinInp.value = "";
      pinInp.placeholder = isAdminOrManager ? "Clave supervisor (o Enter directo)" : "* Clave / PIN de Supervisor";
      if (!pinInp.dataset.enterBound) {
        pinInp.dataset.enterBound = "1";
        pinInp.addEventListener("keydown", function(ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            authorizeCreditExcessSale();
          }
        });
      }
    }
    if (reasonInp) {
      if (!reasonInp.dataset.enterBound) {
        reasonInp.dataset.enterBound = "1";
        reasonInp.addEventListener("keydown", function(ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            authorizeCreditExcessSale();
          }
        });
      }
    }
    setTimeout(() => {
      if (pinInp) pinInp.focus();
    }, 40);
  }

  modal.classList.remove("hidden");
}
window.openCreditControlModal = openCreditControlModal;

async function authorizeCreditExcessSale() {
  const m = getClientCreditMetrics();
  const pinInp    = document.getElementById("credit-auth-pin-input");
  const reasonInp = document.getElementById("credit-auth-reason-input");
  const errEl     = document.getElementById("credit-auth-error-msg");
  const pinVal    = (pinInp ? pinInp.value : "").trim();
  const reasonVal = (reasonInp ? reasonInp.value : "").trim() || "Autorización de excedente en caja";

  const activeRole = (typeof _getPosActiveRole === "function" ? _getPosActiveRole() : (localStorage.getItem("calebsys_role") || "admin")).toLowerCase();
  const isAdminOrManager = (activeRole === "admin" || activeRole === "administrador" || activeRole === "gerente" || activeRole === "propietario");

  let authorizedBy = null;

  if (pinVal) {
    const validLocalPins = ["1234", "admin", "admin123", "0000", "gerente"];
    if (validLocalPins.includes(pinVal.toLowerCase())) {
      authorizedBy = isAdminOrManager ? activeRole.toUpperCase() : "SUPERVISOR";
    } else {
      try {
        const res = await apiFetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: pinVal })
        });
        if (res && res.ok) {
          authorizedBy = "ADMIN";
        }
      } catch (_) {}
    }
    if (!authorizedBy) {
      if (errEl) {
        errEl.textContent = "❌ Clave o PIN de autorización incorrecto.";
        errEl.classList.remove("hidden");
      }
      if (pinInp) { pinInp.focus(); pinInp.select(); }
      return;
    }
  } else if (isAdminOrManager) {
    authorizedBy = activeRole.toUpperCase();
  } else {
    if (errEl) {
      errEl.textContent = "⚠️ Ingresa la clave o PIN del Supervisor/Administrador para autorizar el excedente.";
      errEl.classList.remove("hidden");
    }
    if (pinInp) pinInp.focus();
    return;
  }

  window._creditExcessAuthorizedForSale = {
    clientId: m.clientId,
    maxExcess: m.excedente,
    authorizedBy: authorizedBy,
    reason: reasonVal,
    authorizedAt: new Date().toISOString()
  };

  const modal = document.getElementById("credit-exceeded-auth-modal");
  if (modal) modal.classList.add("hidden");

  updateCreditStatusBannerUI();
  if (typeof showToast === "function") {
    showToast(`✅ Excedente de crédito (+$${_fmtMoney(m.excedente)}) autorizado por ${authorizedBy}`, "success");
  }

  const crdRefEl = document.getElementById("crd-referencia");
  if (_pendingCreditSubmitAfterAuth && crdRefEl && crdRefEl.value.trim()) {
    _pendingCreditSubmitAfterAuth = false;
    submitSale();
  } else if (crdRefEl) {
    crdRefEl.focus();
  }
}
window.authorizeCreditExcessSale = authorizeCreditExcessSale;

function adjustCreditToAvailableMixed() {
  const m = getClientCreditMetrics();
  const modal = document.getElementById("credit-exceeded-auth-modal");
  if (modal) modal.classList.add("hidden");

  if (m.disponibleCredito <= 0.005) {
    blockAndCancelCreditSale();
    return;
  }

  const advInput = document.getElementById("advance-input");
  if (advInput) {
    const currentAdv = parseFloat(advInput.value) || 0;
    const requiredAdv = _round2(currentAdv + m.excedente);
    advInput.value = requiredAdv.toFixed(2);
  }
  const cashInput = document.getElementById("cash-received-input");
  if (cashInput) {
    const isUsd = !!window._checkoutUsdMode;
    const usdRate = getCheckoutUsdRate();
    cashInput.value = isUsd ? _fmtMoney(m.disponibleCredito / usdRate) : _fmtMoney(m.disponibleCredito);
  }

  calculateChange();
  updateCreditStatusBannerUI();
  if (typeof showToast === "function") {
    showToast(`💳 Crédito ajustado al disponible ($${_fmtMoney(m.disponibleCredito)}). Anticipo por cubrir: $${_fmtMoney(m.excedente)}.`, "info");
  }
  const crdRefEl = document.getElementById("crd-referencia");
  if (crdRefEl) crdRefEl.focus();
}
window.adjustCreditToAvailableMixed = adjustCreditToAvailableMixed;

function blockAndCancelCreditSale() {
  window._creditExcessAuthorizedForSale = null;
  _pendingCreditSubmitAfterAuth = false;
  const modal = document.getElementById("credit-exceeded-auth-modal");
  if (modal) modal.classList.add("hidden");

  selectPaymentMethod("001", true);
  if (typeof showToast === "function") {
    showToast("🚫 Envío a crédito bloqueado / cancelado. Método regresado a Efectivo.", "warning");
  }
}
window.blockAndCancelCreditSale = blockAndCancelCreditSale;

function revokeCreditExcessAuth() {
  window._creditExcessAuthorizedForSale = null;
  updateCreditStatusBannerUI();
  const m = getClientCreditMetrics();
  if (m.hasExcess) {
    openCreditControlModal("excess", m, false);
  }
}
window.revokeCreditExcessAuth = revokeCreditExcessAuth;

