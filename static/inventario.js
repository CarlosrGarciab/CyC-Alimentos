const MONEDA = "$";

const $toast = document.getElementById("toast");
const $items = document.getElementById("items-compra");
const $total = document.getElementById("compra-total");
const $modal = document.getElementById("modal");

let productos = [];
let itemsCompra = []; // { producto_id, cantidad, costo_unitario }

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

function btnAccion(texto, clase, onClick) {
  const b = document.createElement("button");
  b.className = `chico ${clase}`;
  b.textContent = texto;
  b.onclick = onClick;
  return b;
}

// ---------- Compra: formulario ----------

let proveedores = [];

function productosDelProveedor() {
  const provId = Number(document.getElementById("compra-proveedor").value) || null;
  if (!provId) return productos;
  const filtrados = productos.filter((p) => p.proveedor_id === provId);
  return filtrados.length ? filtrados : productos;
}

async function cargarProductosCombo() {
  productos = await api("/api/productos");
  const sel = document.getElementById("compra-proveedor");
  proveedores = await api("/api/proveedores");
  const actual = sel.value;
  sel.innerHTML = `<option value="">— Todos los productos —</option>`;
  for (const p of proveedores) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nombre;
    sel.appendChild(opt);
  }
  if (actual) sel.value = actual;
}

document.getElementById("compra-proveedor").addEventListener("change", () => {
  itemsCompra = [];
  renderItemsCompra();
});

function actualizarTotalCompra() {
  const total = itemsCompra.reduce((s, i) => s + (i.cantidad || 0) * (i.costo_unitario || 0), 0);
  $total.textContent = fmtPrecio(total);
}

function renderItemsCompra() {
  const disponibles = productosDelProveedor();
  $items.innerHTML = "";
  itemsCompra.forEach((item, i) => {
    const fila = document.createElement("div");
    fila.className = "fila-item-compra";

    const sel = document.createElement("select");
    for (const p of disponibles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.nombre} (${p.categoria})`;
      sel.appendChild(opt);
    }
    sel.value = item.producto_id;
    sel.onchange = () => { item.producto_id = Number(sel.value); };

    const cant = document.createElement("input");
    cant.type = "number";
    cant.min = "1";
    cant.placeholder = "Cant.";
    cant.value = item.cantidad || "";
    cant.oninput = () => { item.cantidad = Number(cant.value) || 0; actualizarTotalCompra(); };

    const costo = document.createElement("input");
    costo.type = "number";
    costo.min = "0";
    costo.step = "0.01";
    costo.placeholder = "Costo unit.";
    costo.value = item.costo_unitario || "";
    costo.oninput = () => { item.costo_unitario = Number(costo.value) || 0; actualizarTotalCompra(); };

    const quitar = btnAccion("×", "peligro chico", () => {
      itemsCompra.splice(i, 1);
      renderItemsCompra();
    });

    fila.append(sel, cant, costo, quitar);
    $items.appendChild(fila);
  });

  actualizarTotalCompra();
}

document.getElementById("btn-agregar-item").onclick = () => {
  const disponibles = productosDelProveedor();
  if (!disponibles.length) return toast("No hay productos cargados", "error");
  itemsCompra.push({ producto_id: disponibles[0].id, cantidad: 1, costo_unitario: 0 });
  renderItemsCompra();
};

document.getElementById("btn-guardar-compra").onclick = async () => {
  const validos = itemsCompra.filter((i) => i.cantidad > 0 && i.costo_unitario >= 0);
  if (!validos.length) return toast("Agrega al menos un producto con cantidad y costo", "error");
  const proveedor_id = Number(document.getElementById("compra-proveedor").value) || null;
  const notas = document.getElementById("compra-notas").value.trim() || null;
  try {
    const r = await api("/api/compras", {
      method: "POST",
      body: JSON.stringify({ proveedor_id, notas, items: validos }),
    });
    itemsCompra = [];
    renderItemsCompra();
    document.getElementById("compra-notas").value = "";
    toast(`Compra registrada: ${fmtPrecio(r.total)}. Stock actualizado.`);
    await Promise.all([cargarInventario(), cargarHistorial()]);
  } catch (e) {
    toast(e.message, "error");
  }
};

// ---------- Inventario ----------

const ESTADOS = {
  ok: ["OK", "ok"],
  bajo: ["Stock bajo", "bajo"],
  agotado: ["Agotado", "agotado"],
  sin_control: ["Sin control", "sin_control"],
};

const POR_PAGINA_INV = 10;
let limiteInv = POR_PAGINA_INV;
let invCompleto = [];
let textoInv = "";

async function cargarInventario() {
  invCompleto = await api("/api/inventario");
  renderInventario();
}

function renderInventario() {
  let inv = invCompleto;
  if (textoInv) {
    inv = inv.filter(
      (p) =>
        p.nombre.toLowerCase().includes(textoInv) ||
        (p.categoria || "").toLowerCase().includes(textoInv) ||
        (ESTADOS[p.estado] && ESTADOS[p.estado][0].toLowerCase().includes(textoInv))
    );
  }
  const visibles = inv.slice(0, limiteInv);
  const tbody = document.getElementById("tabla-inventario");
  tbody.innerHTML = "";

  const conAlerta = inv.filter((p) => p.estado === "bajo" || p.estado === "agotado");
  if (conAlerta.length) {
    const trAlerta = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.style.cssText = "background: #fef2f2; color: #991b1b; font-weight: 600;";
    td.textContent = `⚠ ${conAlerta.length} producto(s) necesitan reposición`;
    trAlerta.appendChild(td);
    tbody.appendChild(trAlerta);
  }

  for (const p of visibles) {
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = p.nombre;

    const tdCat = document.createElement("td");
    tdCat.textContent = p.categoria;

    const tdStock = document.createElement("td");
    tdStock.textContent = p.stock_actual === null ? "—" : p.stock_actual;

    const tdMin = document.createElement("td");
    tdMin.textContent = p.stock_minimo === null ? "—" : p.stock_minimo;

    const tdCosto = document.createElement("td");
    tdCosto.textContent = p.ultimo_costo === null ? "—" : fmtPrecio(p.ultimo_costo);
    if (p.ultimo_proveedor) {
      tdCosto.title = `Último proveedor: ${p.ultimo_proveedor}`;
    }

    const tdEstado = document.createElement("td");
    const [texto, clase] = ESTADOS[p.estado];
    const badge = document.createElement("span");
    badge.className = `badge ${clase}`;
    badge.textContent = texto;
    tdEstado.appendChild(badge);

    tr.append(tdNombre, tdCat, tdStock, tdMin, tdCosto, tdEstado);
    tbody.appendChild(tr);
  }

  const btnMas = document.getElementById("btn-mas-inv");
  const restantes = inv.length - visibles.length;
  btnMas.hidden = restantes <= 0;
  if (restantes > 0) {
    btnMas.textContent = `Ver más (${restantes} restantes)`;
  }
}

document.getElementById("btn-mas-inv").onclick = () => {
  limiteInv += POR_PAGINA_INV;
  renderInventario();
};

document.getElementById("inv-buscador").addEventListener("input", (e) => {
  textoInv = e.target.value.trim().toLowerCase();
  limiteInv = POR_PAGINA_INV;
  renderInventario();
});

// ---------- Proveedores ----------

document.getElementById("btn-mas-prov").onclick = () => {
  limiteProv += POR_PAGINA_PROV;
  cargarProveedores();
};

const POR_PAGINA_PROV = 10;
let limiteProv = POR_PAGINA_PROV;
let provsCompleto = [];

async function cargarProveedores() {
  provsCompleto = await api("/api/proveedores?incluir_inactivos=true");
  const provs = provsCompleto.slice(0, limiteProv);
  const tbody = document.getElementById("tabla-proveedores");
  tbody.innerHTML = "";
  for (const p of provs) {
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = p.nombre;

    const tdTel = document.createElement("td");
    tdTel.textContent = p.telefono || "—";

    const tdEstado = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge" + (p.activo ? "" : " inactivo");
    badge.textContent = p.activo ? "Activo" : "Inactivo";
    tdEstado.appendChild(badge);

    const tdAcc = document.createElement("td");
    tdAcc.className = "celda-acciones";
    tdAcc.append(btnAccion("Editar", "secundario", () => modalEditarProveedor(p)));
    if (p.activo) {
      tdAcc.append(
        btnAccion("Desactivar", "advertencia", async () => {
          try {
            await api(`/api/proveedores/${p.id}/activo?activo=false`, { method: "PUT" });
            toast("Proveedor desactivado");
            await Promise.all([cargarProveedores(), cargarProductosCombo()]);
          } catch (e) { toast(e.message, "error"); }
        })
      );
    } else {
      tdAcc.append(
        btnAccion("Reactivar", "", async () => {
          try {
            await api(`/api/proveedores/${p.id}/activo?activo=true`, { method: "PUT" });
            toast("Proveedor reactivado");
            await Promise.all([cargarProveedores(), cargarProductosCombo()]);
          } catch (e) { toast(e.message, "error"); }
        })
      );
    }
    tdAcc.append(btnAccion("Eliminar", "peligro", () => eliminarProveedor(p)));

    tr.append(tdNombre, tdTel, tdEstado, tdAcc);
    tbody.appendChild(tr);
  }

  const btnMasProv = document.getElementById("btn-mas-prov");
  const restantesProv = provsCompleto.length - provs.length;
  btnMasProv.hidden = restantesProv <= 0;
  if (restantesProv > 0) {
    btnMasProv.textContent = `Ver más proveedores (${restantesProv} restantes)`;
  }

  const sel = document.getElementById("compra-proveedor");
  const actual = sel.value;
  sel.innerHTML = `<option value="">— Todos los productos —</option>`;
  for (const p of provsCompleto.filter((x) => x.activo)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nombre;
    sel.appendChild(opt);
  }
  if (actual) sel.value = actual;
}

document.getElementById("btn-prov-guardar").onclick = async () => {
  const nombre = document.getElementById("prov-nombre").value.trim();
  const telefono = document.getElementById("prov-telefono").value.trim() || null;
  if (!nombre) return toast("Escribe el nombre del proveedor", "error");
  try {
    await api("/api/proveedores", { method: "POST", body: JSON.stringify({ nombre, telefono }) });
    document.getElementById("prov-nombre").value = "";
    document.getElementById("prov-telefono").value = "";
    toast("Proveedor agregado");
    await cargarProveedores();
  } catch (e) {
    toast(e.message, "error");
  }
};

function modalEditarProveedor(p) {
  $modal.innerHTML = "";
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  const caja = document.createElement("div");
  caja.className = "modal";
  caja.innerHTML = `
    <h3>Editar proveedor</h3>
    <div class="form-fila"><input id="prov-edit-nombre" placeholder="Nombre"></div>
    <div class="form-fila"><input id="prov-edit-tel" placeholder="Teléfono (opcional)"></div>
    <div class="modal-acciones">
      <button class="secundario" id="prov-edit-cancelar">Cancelar</button>
      <button id="prov-edit-guardar">Guardar</button>
    </div>
  `;
  fondo.appendChild(caja);
  $modal.appendChild(fondo);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) $modal.innerHTML = ""; });
  document.getElementById("prov-edit-nombre").value = p.nombre;
  document.getElementById("prov-edit-tel").value = p.telefono || "";
  document.getElementById("prov-edit-cancelar").onclick = () => ($modal.innerHTML = "");
  document.getElementById("prov-edit-guardar").onclick = async () => {
    const nombre = document.getElementById("prov-edit-nombre").value.trim();
    const telefono = document.getElementById("prov-edit-tel").value.trim() || null;
    if (!nombre) return toast("Escribe el nombre", "error");
    try {
      await api(`/api/proveedores/${p.id}`, {
        method: "PUT",
        body: JSON.stringify({ nombre, telefono }),
      });
      $modal.innerHTML = "";
      toast("Proveedor actualizado");
      await Promise.all([cargarProveedores(), cargarProductosCombo()]);
    } catch (e) {
      toast(e.message, "error");
    }
  };
  document.getElementById("prov-edit-nombre").focus();
}

async function eliminarProveedor(p) {
  if (!confirm(`¿Eliminar el proveedor "${p.nombre}"?`)) return;
  try {
    await api(`/api/proveedores/${p.id}`, { method: "DELETE" });
    toast("Proveedor eliminado");
    await Promise.all([cargarProveedores(), cargarProductosCombo()]);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- Historial de compras ----------

const POR_PAGINA_COMPRAS = 10;
let limiteCompras = POR_PAGINA_COMPRAS;
let comprasCompleto = [];

async function cargarHistorial() {
  comprasCompleto = await api("/api/compras");
  renderHistorial();
}

function renderHistorial() {
  const cont = document.getElementById("historial-compras");
  cont.innerHTML = "";
  const btnMas = document.getElementById("btn-mas-compras");
  if (!comprasCompleto.length) {
    cont.innerHTML = `<p class="vacio">Todavía no hay compras registradas.</p>`;
    btnMas.hidden = true;
    return;
  }
  const visibles = comprasCompleto.slice(0, limiteCompras);
  for (const co of visibles) {
    const div = document.createElement("div");
    div.className = "venta-historial-item";
    const fecha = co.creado_en.slice(0, 16).replace("T", " ");
    const detalle = co.detalles.map((d) => `${d.cantidad}× ${d.nombre_producto}`).join(", ");
    const prov = co.proveedor ? ` · ${co.proveedor}` : "";
    div.innerHTML = `<span class="total"></span><span class="hora"></span><br><span class="detalle"></span>`;
    div.querySelector(".total").textContent = fmtPrecio(co.total);
    div.querySelector(".hora").textContent = `${fecha}${prov}`;
    div.querySelector(".detalle").textContent = detalle;
    cont.appendChild(div);
  }
  const restantes = comprasCompleto.length - visibles.length;
  btnMas.hidden = restantes <= 0;
  if (restantes > 0) {
    btnMas.textContent = `Ver más compras (${restantes} restantes)`;
  }
}

document.getElementById("btn-mas-compras").onclick = () => {
  limiteCompras += POR_PAGINA_COMPRAS;
  renderHistorial();
};

// ---------- Init ----------

(async function init() {
  await Promise.all([cargarProductosCombo(), cargarInventario(), cargarProveedores(), cargarHistorial()]);
  renderItemsCompra();
})();
