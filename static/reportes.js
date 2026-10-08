const MONEDA = "$";

const $toast = document.getElementById("toast");
const $tabs = document.getElementById("tabs-rango");
const $fechasCustom = document.getElementById("fechas-custom");
const $rangoInfo = document.getElementById("rango-info");

let rangoActivo = "7";
let charts = {};

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

function fechaHace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function rangoActual() {
  if (rangoActivo === "hoy") return { desde: hoy(), hasta: hoy() };
  if (rangoActivo === "custom") {
    const desde = document.getElementById("fecha-desde").value;
    const hasta = document.getElementById("fecha-hasta").value;
    if (!desde || !hasta) return null;
    return { desde, hasta };
  }
  return { desde: fechaHace(Number(rangoActivo) - 1), hasta: hoy() };
}

// ---------- Gráficos ----------

const PALETA = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
];

function destruir(nombre) {
  if (charts[nombre]) {
    charts[nombre].destroy();
    delete charts[nombre];
  }
}

function graficoBarrasHorizontales(id, nombre, labels, datos, etiqueta) {
  destruir(nombre);
  charts[nombre] = new Chart(document.getElementById(id), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: etiqueta,
        data: datos,
        backgroundColor: labels.map((_, i) => PALETA[i % PALETA.length]),
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function graficoPastel(id, nombre, labels, datos) {
  destruir(nombre);
  charts[nombre] = new Chart(document.getElementById(id), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: datos,
        backgroundColor: labels.map((_, i) => PALETA[i % PALETA.length]),
      }],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function graficoDias(porDia) {
  destruir("dias");
  charts.dias = new Chart(document.getElementById("chart-dias"), {
    type: "line",
    data: {
      labels: porDia.map((d) => d.fecha.slice(5).split("-").reverse().join("/")),
      datasets: [
        {
          label: "Total",
          data: porDia.map((d) => d.total),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          fill: true,
          tension: 0.3,
        },
        {
          label: "Efectivo",
          data: porDia.map((d) => d.efectivo),
          borderColor: "#16a34a",
          tension: 0.3,
        },
        {
          label: "Fiado",
          data: porDia.map((d) => d.fiado),
          borderColor: "#d97706",
          tension: 0.3,
        },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function graficoHoras(porHora) {
  destruir("horas");
  const horas = [];
  const totales = [];
  for (let h = 6; h <= 20; h++) {
    const fila = porHora.find((x) => x.hora === h);
    horas.push(`${h}:00`);
    totales.push(fila ? fila.total : 0);
  }
  charts.horas = new Chart(document.getElementById("chart-horas"), {
    type: "bar",
    data: {
      labels: horas,
      datasets: [{
        label: "Ventas",
        data: totales,
        backgroundColor: "#7c3aed",
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

// ---------- Carga ----------

async function cargarReportes() {
  const r = rangoActual();
  if (!r) return toast("Selecciona las fechas", "error");

  const data = await api(`/api/reportes?desde=${r.desde}&hasta=${r.hasta}`);
  $rangoInfo.textContent = `Mostrando ${r.desde === r.hasta ? "el " + r.desde : `del ${r.desde} al ${r.hasta}`}`;

  const k = data.kpis;
  document.getElementById("k-total").textContent = fmtPrecio(k.total_vendido);
  document.getElementById("k-cantidad").textContent = k.cantidad_ventas;
  document.getElementById("k-ticket").textContent = fmtPrecio(k.ticket_promedio);
  document.getElementById("k-unidades").textContent = k.unidades_vendidas;
  document.getElementById("k-fiado").textContent = fmtPrecio(k.total_fiado);
  document.getElementById("k-cobros").textContent = fmtPrecio(k.total_cobros);

  if (data.por_dia.length) {
    graficoDias(data.por_dia);
  } else {
    destruir("dias");
    toast("No hay ventas en este rango", "error");
  }

  const vacioProd = !data.top_productos.length;
  document.getElementById("productos-vacio").hidden = !vacioProd;
  document.getElementById("chart-productos").style.display = vacioProd ? "none" : "";
  if (!vacioProd) {
    graficoBarrasHorizontales(
      "chart-productos", "productos",
      data.top_productos.map((p) => p.nombre),
      data.top_productos.map((p) => p.unidades),
      "Unidades"
    );
  }

  const vacioCat = !data.por_categoria.length;
  document.getElementById("categorias-vacio").hidden = !vacioCat;
  document.getElementById("chart-categorias").style.display = vacioCat ? "none" : "";
  if (!vacioCat) {
    graficoPastel(
      "chart-categorias", "categorias",
      data.por_categoria.map((c) => c.categoria),
      data.por_categoria.map((c) => c.total),
    );
  }

  graficoHoras(data.por_hora);
}

// ---------- Filtros ----------

$tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  rangoActivo = btn.dataset.rango;
  [...$tabs.children].forEach((t) => t.classList.toggle("activo", t === btn));
  $fechasCustom.hidden = rangoActivo !== "custom";
  if (rangoActivo !== "custom") cargarReportes();
});

document.getElementById("btn-aplicar").onclick = () => cargarReportes();

// ---------- Init ----------

document.getElementById("fecha-desde").value = fechaHace(29);
document.getElementById("fecha-hasta").value = hoy();
cargarReportes().catch((e) => toast(e.message, "error"));
