const MONEDA = "$";

const $toast = document.getElementById("toast");
const $fondo = document.getElementById("fondo-inicial");
const $contado = document.getElementById("efectivo-contado");
const $notas = document.getElementById("notas-cierre");
const $esperado = document.getElementById("total-esperado");
const $diferencia = document.getElementById("diferencia");
const $btnCerrar = document.getElementById("btn-cerrar-caja");

let resumenActual = null;
let cierreHoy = null;

function toast(msg, tipo = "exito") {
  $toast.textContent = msg;
  $toast.className = `toast visible ${tipo}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => ($toast.className = "toast"), 2500);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Error en la petición");
  }
  return res.status === 204 ? null : res.json();
}

function fmtPrecio(n) {
  return MONEDA + " " + Number(n).toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function calcular() {
  if (!resumenActual) return;
  const fondo = Number($fondo.value) || 0;
  const contado = Number($contado.value);
  const esperado = fondo + resumenActual.ventas_efectivo + resumenActual.cobros_fiado;
  $esperado.textContent = fmtPrecio(esperado);

  if ($contado.value === "") {
    $diferencia.textContent = "—";
    $diferencia.className = "";
    return;
  }
  const dif = contado - esperado;
  if (Math.abs(dif) < 0.01) {
    $diferencia.style.color = "var(--success)";
    $diferencia.textContent = "Cuadra ✓";
  } else if (dif > 0) {
    $diferencia.style.color = "var(--primary)";
    $diferencia.textContent = "Sobra " + fmtPrecio(dif);
  } else {
    $diferencia.style.color = "var(--danger)";
    $diferencia.textContent = "Falta " + fmtPrecio(Math.abs(dif));
  }
}

$fondo.addEventListener("input", calcular);
$contado.addEventListener("input", calcular);

async function cargarHoy() {
  const data = await api("/api/caja/hoy");
  resumenActual = data;
  cierreHoy = data.cierre;

  document.getElementById("caja-fecha").textContent = `Resumen del día ${data.fecha}`;
  document.getElementById("r-ventas-efectivo").textContent = fmtPrecio(data.ventas_efectivo);
  document.getElementById("r-ventas-fiado").textContent = fmtPrecio(data.ventas_fiado);
  document.getElementById("r-cobros-fiado").textContent = fmtPrecio(data.cobros_fiado);
  document.getElementById("r-compras").textContent =
    `${data.cantidad_compras} (${fmtPrecio(data.compras_total)})`;

  const info = document.getElementById("r-cierre-info");
  if (data.cierre) {
    info.hidden = false;
    info.textContent = `Caja cerrada a las ${data.cierre.creado_en.slice(11, 16)} · contado ${fmtPrecio(data.cierre.efectivo_contado)} · diferencia ${fmtPrecio(data.cierre.diferencia)}`;
    info.style.cssText = "color: var(--success); font-weight: 600;";
    $btnCerrar.textContent = "Actualizar cierre de hoy";
    if ($contado.value === "") {
      $contado.value = data.cierre.efectivo_contado;
      $fondo.value = data.cierre.fondo_inicial;
      $notas.value = data.cierre.notas || "";
    }
  } else {
    info.hidden = true;
    $btnCerrar.textContent = "Cerrar caja del día";
  }
  calcular();
}

$btnCerrar.onclick = async () => {
  if ($contado.value === "") return toast("Escribe el efectivo contado", "error");
  const fondo_inicial = Number($fondo.value) || 0;
  const efectivo_contado = Number($contado.value);
  const notas = $notas.value.trim() || null;

  if (cierreHoy) {
    if (!confirm("Ya hay un cierre de hoy. ¿Reemplazarlo con los datos actuales?")) return;
  }
  try {
    const r = await api("/api/caja/cierres", {
      method: "POST",
      body: JSON.stringify({ fondo_inicial, efectivo_contado, notas, sobreescribir: !!cierreHoy }),
    });
    toast(`Caja cerrada. Diferencia: ${fmtPrecio(r.diferencia)}`);
    await Promise.all([cargarHoy(), cargarCierres()]);
  } catch (e) {
    toast(e.message, "error");
  }
};

const POR_PAGINA_CIERRES = 10;
let limiteCierres = POR_PAGINA_CIERRES;
let cierresCompleto = [];

async function cargarCierres() {
  cierresCompleto = await api("/api/caja/cierres");
  const cierres = cierresCompleto.slice(0, limiteCierres);
  const tbody = document.getElementById("tabla-cierres");
  tbody.innerHTML = "";
  document.getElementById("cierres-vacio").hidden = cierresCompleto.length > 0;

  for (const c of cierres) {
    const tr = document.createElement("tr");

    const tdFecha = document.createElement("td");
    tdFecha.textContent = c.fecha;

    const tdEfec = document.createElement("td");
    tdEfec.textContent = fmtPrecio(c.ventas_efectivo);

    const tdFiado = document.createElement("td");
    tdFiado.textContent = fmtPrecio(c.ventas_fiado);

    const tdCobros = document.createElement("td");
    tdCobros.textContent = fmtPrecio(c.cobros_fiado);

    const tdEsperado = document.createElement("td");
    tdEsperado.textContent = fmtPrecio(c.total_esperado);

    const tdContado = document.createElement("td");
    tdContado.textContent = fmtPrecio(c.efectivo_contado);

    const tdDif = document.createElement("td");
    if (Math.abs(c.diferencia) < 0.01) {
      tdDif.style.color = "var(--success)";
      tdDif.textContent = "Cuadra";
    } else if (c.diferencia > 0) {
      tdDif.style.color = "var(--primary)";
      tdDif.textContent = "Sobra " + fmtPrecio(c.diferencia);
    } else {
      tdDif.style.color = "var(--danger)";
      tdDif.textContent = "Falta " + fmtPrecio(Math.abs(c.diferencia));
    }

    tr.append(tdFecha, tdEfec, tdFiado, tdCobros, tdEsperado, tdContado, tdDif);
    tbody.appendChild(tr);
  }

  const btnMas = document.getElementById("btn-mas-cierres");
  const restantes = cierresCompleto.length - cierres.length;
  btnMas.hidden = restantes <= 0;
  if (restantes > 0) {
    btnMas.textContent = `Ver más cierres (${restantes} restantes)`;
  }
}

document.getElementById("btn-mas-cierres").onclick = () => {
  limiteCierres += POR_PAGINA_CIERRES;
  cargarCierres();
};

(async function init() {
  await Promise.all([cargarHoy(), cargarCierres()]);
})();
