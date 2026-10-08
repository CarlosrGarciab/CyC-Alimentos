const MONEDA = "$";
const POR_PAGINA = 20;

const $toast = document.getElementById("toast");
const $tabsTipo = document.getElementById("tabs-tipo");
const $tabsRango = document.getElementById("tabs-rango");
const $fechasCustom = document.getElementById("fechas-custom");
const $lista = document.getElementById("lista-historial");
const $vacio = document.getElementById("historial-vacio");
const $btnMas = document.getElementById("btn-mas-historial");
const $resumen = document.getElementById("resumen-info");
const $titulo = document.getElementById("titulo-lista");

let tipo = "ventas";
let rangoActivo = "30";
let offset = 0;
let cargando = false;
let hayMas = true;
let items = [];

function toast(msg, tipo = "exito") {
  $toast.textContent = msg;
  $toast.className = `toast visible ${tipo}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => ($toast.className = "toast"), 2500);
}

async function api(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Error en la petición");
  }
  return res.json();
}

function fmtPrecio(n) {
  return MONEDA + " " + Number(n).toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function fechaHace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function rangoActual() {
  if (rangoActivo === "hoy") return { desde: hoy(), hasta: hoy() };
  if (rangoActivo === "todo") return { desde: null, hasta: null };
  if (rangoActivo === "custom") {
    const desde = document.getElementById("fecha-desde").value;
    const hasta = document.getElementById("fecha-hasta").value;
    if (!desde || !hasta) return null;
    return { desde, hasta };
  }
  return { desde: fechaHace(Number(rangoActivo) - 1), hasta: hoy() };
}

function textoDetalle(detalles, precioKey) {
  return detalles
    .map((d) => `${d.cantidad}× ${d.nombre_producto}`)
    .join(", ");
}

function renderItem(mov) {
  const div = document.createElement("div");
  div.className = "venta-historial-item";

  const fecha = mov.creado_en.replace("T", " ").slice(0, 16);
  const detalle = textoDetalle(mov.detalles);

  div.innerHTML = `<span class="total"></span><span class="hora"></span><br><span class="detalle"></span>`;
  div.querySelector(".total").textContent = fmtPrecio(mov.total);
  div.querySelector(".hora").textContent = fecha;

  if (tipo === "ventas" && mov.metodo_pago === "fiado") {
    const tag = document.createElement("span");
    tag.className = "etiqueta-fiado";
    tag.textContent = mov.cliente_nombre ? `Fiado · ${mov.cliente_nombre}` : "Fiado";
    div.querySelector(".hora").after(tag);
  }
  if (tipo === "compras" && mov.proveedor) {
    const tag = document.createElement("span");
    tag.className = "etiqueta-fiado";
    tag.style.background = "#e0f2fe";
    tag.style.color = "#075985";
    tag.textContent = mov.proveedor;
    div.querySelector(".hora").after(tag);
  }

  div.querySelector(".detalle").textContent = detalle;
  return div;
}

function renderLista() {
  $lista.innerHTML = "";
  $vacio.hidden = items.length > 0;
  for (const mov of items) {
    $lista.appendChild(renderItem(mov));
  }

  const total = items.reduce((s, m) => s + Number(m.total), 0);
  const etiqueta = tipo === "ventas" ? "ventas" : "compras";
  let info = `${items.length} ${etiqueta} · total ${fmtPrecio(total)}`;
  if (rangoActivo !== "todo") {
    const r = rangoActual();
    if (r) info = `Del ${r.desde} al ${r.hasta} · ${info}`;
  }
  $resumen.textContent = info;

  $btnMas.hidden = !hayMas;
  if (hayMas) $btnMas.textContent = "Ver más";
}

async function cargar(reset = false) {
  if (cargando) return;
  if (reset) {
    offset = 0;
    items = [];
    hayMas = true;
  }
  if (!hayMas) return;

  const r = rangoActual();
  if (!r) return toast("Selecciona las fechas", "error");

  const params = new URLSearchParams();
  if (r.desde) params.set("desde", r.desde);
  if (r.hasta) params.set("hasta", r.hasta);
  params.set("limite", POR_PAGINA);
  params.set("offset", offset);

  cargando = true;
  try {
    const data = await api(`/api/${tipo}?${params}`);
    items = items.concat(data);
    hayMas = data.length === POR_PAGINA;
    offset += data.length;
    renderLista();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    cargando = false;
  }
}

// ---------- Filtros ----------

$tabsTipo.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  tipo = btn.dataset.tipo;
  [...$tabsTipo.children].forEach((t) => t.classList.toggle("activo", t === btn));
  $titulo.textContent = tipo === "ventas" ? "Últimas ventas" : "Últimas compras";
  cargar(true);
});

$tabsRango.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  rangoActivo = btn.dataset.rango;
  [...$tabsRango.children].forEach((t) => t.classList.toggle("activo", t === btn));
  $fechasCustom.hidden = rangoActivo !== "custom";
  if (rangoActivo !== "custom") cargar(true);
});

$btnMas.onclick = () => cargar(false);
document.getElementById("btn-aplicar").onclick = () => cargar(true);

// ---------- Init ----------
document.getElementById("fecha-desde").value = fechaHace(29);
document.getElementById("fecha-hasta").value = hoy();
cargar(true);
