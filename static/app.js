const MONEDA = "$";

const $tabs = document.getElementById("tabs");
const $grid = document.getElementById("grid-productos");
const $gridVacio = document.getElementById("grid-vacio");
const $carrito = document.getElementById("carrito");
const $total = document.getElementById("total");
const $btnCobrar = document.getElementById("btn-cobrar");
const $btnFiado = document.getElementById("btn-fiado");
const $modal = document.getElementById("modal");
const $btnMasProductos = document.getElementById("btn-mas-productos");
const $btnMasVentas = document.getElementById("btn-mas-ventas");

const POR_PAGINA_GRID = 10;
const POR_PAGINA_HISTORIAL = 10;
let limiteGrid = POR_PAGINA_GRID;
let limiteHistorial = POR_PAGINA_HISTORIAL;
let historialCompleto = [];
const $historial = document.getElementById("historial");
const $toast = document.getElementById("toast");

let categorias = [];
let productos = [];
let categoriaActiva = null; // null = Todos
let textoBusqueda = "";
let carrito = {}; // producto_id -> { producto, cantidad }
let modoRapido = localStorage.getItem("ventaRapida") === "1"; // default OFF

const $chkRapido = document.getElementById("chk-rapido");
$chkRapido.checked = modoRapido;
document.body.classList.toggle("modo-rapido", modoRapido);

$chkRapido.addEventListener("change", () => {
  modoRapido = $chkRapido.checked;
  localStorage.setItem("ventaRapida", modoRapido ? "1" : "0");
  document.body.classList.toggle("modo-rapido", modoRapido);
  toast(modoRapido ? "Venta rápida activada: un clic vende" : "Venta rápida desactivada");
});

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
  return res.json();
}

function fmtPrecio(n) {
  return MONEDA + " " + Number(n).toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ---------- Productos / tabs ----------

async function cargarCatalogo() {
  [categorias, productos] = await Promise.all([
    api("/api/categorias"),
    api("/api/productos"),
  ]);
  renderTabs();
  renderGrid();
}

function renderTabs() {
  $tabs.innerHTML = "";

  const btnTodos = document.createElement("button");
  btnTodos.className = "tab" + (categoriaActiva === null ? " activo" : "");
  btnTodos.textContent = "Todos";
  btnTodos.onclick = () => {
    categoriaActiva = null;
    limiteGrid = POR_PAGINA_GRID;
    renderTabs();
    renderGrid();
  };
  $tabs.appendChild(btnTodos);

  for (const c of categorias) {
    const btn = document.createElement("button");
    btn.className = "tab" + (c.id === categoriaActiva ? " activo" : "");
    btn.textContent = c.nombre;
    btn.onclick = () => {
      categoriaActiva = c.id;
      limiteGrid = POR_PAGINA_GRID;
      renderTabs();
      renderGrid();
    };
    $tabs.appendChild(btn);
  }
}

function renderGrid() {
  $grid.innerHTML = "";
  let prods = productos.slice().sort((a, b) => {
    if (b.vendidos !== a.vendidos) return b.vendidos - a.vendidos;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  if (categoriaActiva !== null) {
    prods = prods.filter((p) => p.categoria_id === categoriaActiva);
  }
  if (textoBusqueda) {
    prods = prods.filter((p) =>
      p.nombre.toLowerCase().includes(textoBusqueda) ||
      p.categoria.toLowerCase().includes(textoBusqueda)
    );
  }
  $gridVacio.hidden = prods.length > 0;

  const visibles = prods.slice(0, limiteGrid);
  for (const p of visibles) {
    const btn = document.createElement("button");
    btn.className = "btn-producto";

    if (p.imagen) {
      const img = document.createElement("img");
      img.className = "foto";
      img.src = `/static/uploads/${p.imagen}`;
      img.alt = p.nombre;
      btn.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "foto-placeholder";
      ph.textContent = "🍽️";
      btn.appendChild(ph);
    }

    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = p.nombre;

    const precio = document.createElement("span");
    precio.className = "precio";
    precio.textContent = fmtPrecio(p.precio);

    btn.append(nombre, precio);
    btn.onclick = () => {
      if (modoRapido) {
        ventaDirecta(p);
      } else {
        agregarAlCarrito(p);
        btn.blur();
      }
    };
    $grid.appendChild(btn);
  }

  const restantes = prods.length - visibles.length;
  $btnMasProductos.hidden = restantes <= 0;
  if (restantes > 0) {
    $btnMasProductos.textContent = `Ver más productos (${restantes} restantes)`;
  }
}

$btnMasProductos.onclick = () => {
  limiteGrid += POR_PAGINA_GRID;
  renderGrid();
};

document.getElementById("buscador").addEventListener("input", (e) => {
  textoBusqueda = e.target.value.trim().toLowerCase();
  limiteGrid = POR_PAGINA_GRID;
  renderGrid();
});

// ---------- Carrito ----------

function agregarAlCarrito(producto) {
  const actual = carrito[producto.id];
  if (actual) {
    actual.cantidad += 1;
  } else {
    carrito[producto.id] = { producto, cantidad: 1 };
  }
  renderCarrito();
}

function cambiarCantidad(productoId, delta) {
  const item = carrito[productoId];
  if (!item) return;
  item.cantidad += delta;
  if (item.cantidad <= 0) delete carrito[productoId];
  renderCarrito();
}

function totalCarrito() {
  return Object.values(carrito).reduce(
    (sum, i) => sum + i.producto.precio * i.cantidad,
    0
  );
}

function renderCarrito() {
  $carrito.innerHTML = "";
  const items = Object.entries(carrito);

  if (!items.length) {
    $carrito.innerHTML = `<p class="carrito-vacio">Tocá un producto para agregarlo.</p>`;
  }

  for (const [id, item] of items) {
    const linea = document.createElement("div");
    linea.className = "carrito-linea";

    const btnMenos = document.createElement("button");
    btnMenos.className = "chico secundario";
    btnMenos.textContent = "−";
    btnMenos.onclick = () => { cambiarCantidad(Number(id), -1); btnMenos.blur(); };

    const btnMas = document.createElement("button");
    btnMas.className = "chico secundario";
    btnMas.textContent = "+";
    btnMas.onclick = () => { cambiarCantidad(Number(id), 1); btnMas.blur(); };

    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = `${item.cantidad} × ${item.producto.nombre}`;

    const sub = document.createElement("span");
    sub.className = "subtotal";
    sub.textContent = fmtPrecio(item.producto.precio * item.cantidad);

    linea.append(btnMenos, nombre, btnMas, sub);
    $carrito.appendChild(linea);
  }

  const total = totalCarrito();
  $total.textContent = fmtPrecio(total);
  const vacio = items.length === 0;
  $btnCobrar.disabled = vacio;
  $btnFiado.disabled = vacio;
}

// ---------- Fiado ----------

function cerrarModal() {
  $modal.innerHTML = "";
}

function abrirModalFiado() {
  $modal.innerHTML = "";
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  const caja = document.createElement("div");
  caja.className = "modal";
  caja.innerHTML = `
    <h3>Vender a fiado</h3>
    <p style="margin-top: 0; color: var(--muted); font-size: 0.92rem;">
      Total: <strong id="fiado-total"></strong>
    </p>
    <input id="fiado-buscar" class="buscador-cliente" placeholder="Buscar cliente por nombre o curso...">
    <div id="fiado-lista" class="lista-clientes-modal"></div>
    <p style="font-size: 0.85rem; color: var(--muted); margin: 12px 0 4px;">¿No lo encuentra?</p>
    <div class="form-fila">
      <input id="fiado-nuevo-nombre" placeholder="Nombre del cliente">
      <select id="fiado-nuevo-tipo">
        <option value="estudiante">Estudiante</option>
        <option value="profesor">Profesor</option>
      </select>
      <input id="fiado-nuevo-curso" placeholder="Curso (ej. 3°B)">
    </div>
    <div class="modal-acciones">
      <button class="secundario" id="fiado-cancelar">Cancelar</button>
      <button id="fiado-confirmar">Registrar fiado</button>
    </div>
  `;
  fondo.appendChild(caja);
  $modal.appendChild(fondo);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrarModal(); });

  document.getElementById("fiado-total").textContent = fmtPrecio(totalCarrito());
  document.getElementById("fiado-cancelar").onclick = cerrarModal;
  document.getElementById("fiado-confirmar").onclick = confirmarFiado;
  document.getElementById("fiado-buscar").addEventListener("input", (e) => cargarClientesModal(e.target.value));
  document.getElementById("fiado-nuevo-tipo").addEventListener("change", (e) => {
    document.getElementById("fiado-nuevo-curso").style.display =
      e.target.value === "profesor" ? "none" : "";
  });
  document.getElementById("fiado-buscar").focus();
  cargarClientesModal("");
}

let clienteSeleccionado = null;

async function cargarClientesModal(q) {
  const $lista = document.getElementById("fiado-lista");
  if (!$lista) return;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const clientes = await api(`/api/clientes?${params}`);
  $lista.innerHTML = "";
  if (!clientes.length) {
    $lista.innerHTML = `<p class="vacio" style="padding: 10px 12px;">Sin clientes</p>`;
    return;
  }
  for (const c of clientes) {
    const btn = document.createElement("button");
    btn.type = "button";
    const info = document.createElement("span");
    info.textContent = `${c.nombre}${c.curso ? " · " + c.curso : ""}`;
    const saldo = document.createElement("span");
    if (c.saldo_pendiente > 0.001) {
      saldo.className = "saldo-debe";
      saldo.textContent = `Debe ${fmtPrecio(c.saldo_pendiente)}`;
    } else {
      saldo.className = "saldo-ok";
      saldo.textContent = "Al día";
    }
    btn.append(info, saldo);
    btn.onclick = () => {
      clienteSeleccionado = c;
      info.style.fontWeight = "700";
      toast(`Seleccionado: ${c.nombre}`);
      [...$lista.children].forEach((el) => (el.style.background = ""));
      btn.style.background = "#dbeafe";
    };
    $lista.appendChild(btn);
  }
}

async function confirmarFiado() {
  const nombreNuevo = document.getElementById("fiado-nuevo-nombre").value.trim();
  let cliente = clienteSeleccionado;
  try {
    if (!cliente && nombreNuevo) {
      const tipo = document.getElementById("fiado-nuevo-tipo").value;
      const curso = document.getElementById("fiado-nuevo-curso").value.trim() || null;
      cliente = await api("/api/clientes", {
        method: "POST",
        body: JSON.stringify({ nombre: nombreNuevo, tipo, curso }),
      });
    }
    if (!cliente) {
      toast("Selecciona un cliente o crea uno nuevo", "error");
      return;
    }
    const items = Object.values(carrito).map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
    }));
    const r = await api("/api/ventas", {
      method: "POST",
      body: JSON.stringify({ metodo_pago: "fiado", cliente_id: cliente.id, items }),
    });
    cerrarModal();
    clienteSeleccionado = null;
    toast(`Fiado registrado a ${cliente.nombre}: ${fmtPrecio(r.total)}`);
    carrito = {};
    renderCarrito();
    await cargarHistorial();
  } catch (e) {
    toast(e.message, "error");
  }
}

$btnFiado.onclick = abrirModalFiado;

// ---------- Cobro ----------

let vendiendoDirecto = false;

async function ventaDirecta(producto) {
  if (vendiendoDirecto) return;
  vendiendoDirecto = true;
  try {
    const r = await api("/api/ventas", {
      method: "POST",
      body: JSON.stringify({
        metodo_pago: "efectivo",
        items: [{ producto_id: producto.id, cantidad: 1 }],
      }),
    });
    toast(`✓ ${producto.nombre} · ${fmtPrecio(r.total)}`);
    await cargarHistorial();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    vendiendoDirecto = false;
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !modoRapido && Object.keys(carrito).length > 0) {
    $btnCobrar.click();
  }
  if (e.key === "Escape" && Object.keys(carrito).length > 0) {
    carrito = {};
    renderCarrito();
    toast("Venta cancelada");
  }
});

$btnCobrar.onclick = async () => {
  const items = Object.values(carrito).map((i) => ({
    producto_id: i.producto.id,
    cantidad: i.cantidad,
  }));
  if (!items.length) return;
  try {
    const r = await api("/api/ventas", {
      method: "POST",
      body: JSON.stringify({ metodo_pago: "efectivo", items }),
    });
    toast(`Venta registrada: ${fmtPrecio(r.total)}`);
    carrito = {};
    renderCarrito();
    await cargarHistorial();
  } catch (e) {
    toast(e.message, "error");
  }
};

// ---------- Historial ----------

function hoyDesde() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} 00:00:00`;
}

async function cargarHistorial() {
  const ventas = await api(`/api/ventas?desde=${encodeURIComponent(hoyDesde())}`);
  historialCompleto = ventas;
  renderHistorial();
}

function renderHistorial() {
  $historial.innerHTML = "";
  if (!historialCompleto.length) {
    $historial.innerHTML = `<p class="vacio">Todavía no hay ventas hoy.</p>`;
    $btnMasVentas.hidden = true;
    return;
  }
  const visibles = historialCompleto.slice(0, limiteHistorial);
  for (const v of visibles) {
    const div = document.createElement("div");
    div.className = "venta-historial-item";
    const hora = v.creado_en.slice(11, 16);
    const detalle = v.detalles.map((d) => `${d.cantidad}× ${d.nombre_producto}`).join(", ");
    div.innerHTML = `<span class="total"></span><span class="hora"></span><br><span class="detalle"></span>`;
    div.querySelector(".total").textContent = fmtPrecio(v.total);
    div.querySelector(".hora").textContent = hora;
    if (v.metodo_pago === "fiado") {
      const tag = document.createElement("span");
      tag.className = "etiqueta-fiado";
      tag.textContent = v.cliente_nombre ? `Fiado · ${v.cliente_nombre}` : "Fiado";
      div.querySelector(".hora").after(tag);
    }
    div.querySelector(".detalle").textContent = detalle;
    $historial.appendChild(div);
  }
  const restantes = historialCompleto.length - visibles.length;
  $btnMasVentas.hidden = restantes <= 0;
  if (restantes > 0) {
    $btnMasVentas.textContent = `Ver más ventas (${restantes} restantes)`;
  }
}

$btnMasVentas.onclick = () => {
  limiteHistorial += POR_PAGINA_HISTORIAL;
  renderHistorial();
};

// ---------- Init ----------

(async function init() {
  await cargarCatalogo();
  renderCarrito();
  await cargarHistorial();
  setInterval(() => {
    cargarCatalogo().catch(() => {});
  }, 180000);
})();
