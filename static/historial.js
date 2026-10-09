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

function cerrarModal() {
  const $modal = document.getElementById("modal");
  if ($modal) $modal.innerHTML = "";
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
  if (tipo === "ventas" && mov.metodo_pago === "saldo") {
    const tag = document.createElement("span");
    tag.className = "etiqueta-fiado";
    tag.style.background = "#ede9fe";
    tag.style.color = "#5b21b6";
    tag.textContent = mov.cliente_nombre ? `Saldo · ${mov.cliente_nombre}` : "Saldo";
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

  const acciones = document.createElement("div");
  acciones.className = "hist-acciones";
  const bEditar = document.createElement("button");
  bEditar.className = "chico secundario";
  bEditar.textContent = "Editar";
  bEditar.onclick = () => abrirEditar(mov);
  const bEliminar = document.createElement("button");
  bEliminar.className = "chico peligro";
  bEliminar.textContent = "Eliminar";
  bEliminar.onclick = () => eliminarMov(mov);
  acciones.append(bEditar, bEliminar);
  div.appendChild(acciones);

  return div;
}

// ---------- Editar / eliminar ----------

async function eliminarMov(mov) {
  const esVenta = tipo === "ventas";
  const aviso = esVenta
    ? "Se devolverá el stock y se anulará la deuda o el saldo usado."
    : "Se descontará del stock lo que había sumado esta compra.";
  if (!confirm(`¿Eliminar esta ${esVenta ? "venta" : "compra"} de ${fmtPrecio(mov.total)}?\n${aviso}`)) return;
  try {
    await api(`/api/${tipo}/${mov.id}`, { method: "DELETE" });
    toast("Eliminado");
    cargar(true);
  } catch (e) {
    toast(e.message, "error");
  }
}

function opcionesProductos(select, productos, selId, nombreAlt) {
  const ids = new Set(productos.map((p) => p.id));
  select.innerHTML = "";
  for (const p of productos) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.nombre;
    select.appendChild(o);
  }
  if (selId != null && !ids.has(selId)) {
    const o = document.createElement("option");
    o.value = selId;
    o.textContent = (nombreAlt || `Producto ${selId}`) + " (inactivo)";
    select.appendChild(o);
  }
  if (selId != null) select.value = String(selId);
}

function filaItem(esVenta, productos, det) {
  const fila = document.createElement("div");
  fila.className = "fila-item-compra";

  const sel = document.createElement("select");
  opcionesProductos(sel, productos, det.producto_id, det.nombre_producto);

  const cant = document.createElement("input");
  cant.type = "number";
  cant.min = "1";
  cant.step = "1";
  cant.value = det.cantidad;

  fila.append(sel, cant);
  fila._sel = sel;
  fila._cant = cant;

  if (!esVenta) {
    const costo = document.createElement("input");
    costo.type = "number";
    costo.min = "0";
    costo.step = "0.01";
    costo.value = det.costo_unitario != null ? det.costo_unitario : "";
    fila.appendChild(costo);
    fila._costo = costo;
  }

  const quitar = document.createElement("button");
  quitar.type = "button";
  quitar.className = "chico peligro";
  quitar.textContent = "×";
  quitar.onclick = () => fila.remove();
  fila.appendChild(quitar);
  return fila;
}

function labelCampo(texto, control) {
  const lab = document.createElement("label");
  lab.textContent = texto;
  lab.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;font-size:0.85rem;color:var(--muted);";
  lab.appendChild(control);
  return lab;
}

async function abrirEditar(mov) {
  const esVenta = tipo === "ventas";
  const productos = await api("/api/productos");
  const proveedores = esVenta ? [] : await api("/api/proveedores");
  const clientes = esVenta ? await api("/api/clientes") : [];

  const $modal = document.getElementById("modal");
  $modal.innerHTML = "";
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  const caja = document.createElement("div");
  caja.className = "modal";

  const h3 = document.createElement("h3");
  h3.textContent = `Editar ${esVenta ? "venta" : "compra"} #${mov.id}`;
  caja.appendChild(h3);

  const cuerpo = document.createElement("div");
  caja.appendChild(cuerpo);

  if (esVenta) {
    const fila = document.createElement("div");
    fila.className = "form-fila";
    const selMetodo = document.createElement("select");
    [["efectivo", "Efectivo"], ["fiado", "Fiado"], ["saldo", "Saldo a favor"]].forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      selMetodo.appendChild(o);
    });
    selMetodo.value = mov.metodo_pago;
    const labCliente = document.createElement("label");
    labCliente.textContent = "Cliente";
    labCliente.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;font-size:0.85rem;color:var(--muted);";
    const selCliente = document.createElement("select");
    clientes.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.nombre;
      selCliente.appendChild(o);
    });
    if (mov.cliente_id) selCliente.value = String(mov.cliente_id);
    labCliente.appendChild(selCliente);

    const actualizar = () => { labCliente.style.display = selMetodo.value === "efectivo" ? "none" : ""; };
    selMetodo.onchange = actualizar;
    actualizar();

    fila.append(labelCampo("Forma de pago", selMetodo), labCliente);
    cuerpo.appendChild(fila);
    caja._selMetodo = selMetodo;
    caja._selCliente = selCliente;
  } else {
    const fila = document.createElement("div");
    fila.className = "form-fila";
    const selProv = document.createElement("select");
    const sinProv = document.createElement("option");
    sinProv.value = "";
    sinProv.textContent = "Sin proveedor";
    selProv.appendChild(sinProv);
    proveedores.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.nombre;
      selProv.appendChild(o);
    });
    if (mov.proveedor_id) selProv.value = String(mov.proveedor_id);
    const inputNotas = document.createElement("input");
    inputNotas.value = mov.notas || "";
    fila.append(labelCampo("Proveedor (opcional)", selProv), labelCampo("Notas", inputNotas));
    cuerpo.appendChild(fila);
    caja._selProv = selProv;
    caja._notas = inputNotas;
  }

  const titulo = document.createElement("p");
  titulo.textContent = esVenta ? "Productos" : "Productos y costos";
  titulo.style.cssText = "margin:12px 0 4px;font-weight:600;";
  cuerpo.appendChild(titulo);

  const contItems = document.createElement("div");
  cuerpo.appendChild(contItems);
  for (const d of mov.detalles) {
    contItems.appendChild(filaItem(esVenta, productos, d));
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "secundario";
  btnAgregar.textContent = "+ Agregar producto";
  btnAgregar.style.marginTop = "10px";
  btnAgregar.onclick = () => {
    const base = productos[0]?.id;
    const d = esVenta
      ? { producto_id: base, cantidad: 1 }
      : { producto_id: base, cantidad: 1, costo_unitario: 0 };
    contItems.appendChild(filaItem(esVenta, productos, d));
  };
  cuerpo.appendChild(btnAgregar);

  const accionesDiv = document.createElement("div");
  accionesDiv.className = "modal-acciones";
  const bCancelar = document.createElement("button");
  bCancelar.className = "secundario";
  bCancelar.textContent = "Cancelar";
  bCancelar.onclick = cerrarModal;
  const bGuardar = document.createElement("button");
  bGuardar.textContent = "Guardar";
  bGuardar.onclick = () => guardarEdicion(mov, esVenta, contItems, caja);
  accionesDiv.append(bCancelar, bGuardar);
  caja.appendChild(accionesDiv);

  fondo.appendChild(caja);
  $modal.appendChild(fondo);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrarModal(); });
}

async function guardarEdicion(mov, esVenta, contItems, caja) {
  const items = [];
  for (const fila of contItems.children) {
    const producto_id = Number(fila._sel.value);
    const cantidad = Number(fila._cant.value);
    if (!producto_id || !(cantidad > 0)) return toast("Revisá productos y cantidades", "error");
    const it = { producto_id, cantidad };
    if (!esVenta) {
      const costo_unitario = Number(fila._costo.value);
      if (!(costo_unitario >= 0)) return toast("Revisá los costos", "error");
      it.costo_unitario = costo_unitario;
    }
    items.push(it);
  }
  if (!items.length) return toast("Agregá al menos un producto", "error");

  let body;
  if (esVenta) {
    const metodo = caja._selMetodo.value;
    body = { metodo_pago: metodo, items };
    if (metodo !== "efectivo") {
      body.cliente_id = Number(caja._selCliente.value) || null;
      if (!body.cliente_id) return toast("Seleccioná un cliente", "error");
    }
  } else {
    body = {
      proveedor_id: Number(caja._selProv.value) || null,
      notas: caja._notas.value.trim() || null,
      items,
    };
  }

  try {
    await api(`/api/${tipo}/${mov.id}`, { method: "PUT", body: JSON.stringify(body) });
    cerrarModal();
    toast("Guardado");
    cargar(true);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- Exportar CSV ----------

function descargarCSV(nombre, filas) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const contenido = "\uFEFF" + filas.map((f) => f.map(esc).join(";")).join("\r\n");
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportar() {
  const r = rangoActual();
  const params = new URLSearchParams();
  if (r) {
    if (r.desde) params.set("desde", r.desde);
    if (r.hasta) params.set("hasta", r.hasta);
  }
  params.set("limite", "5000");
  params.set("offset", "0");
  try {
    const data = await api(`/api/${tipo}?${params}`);
    let filas;
    if (tipo === "ventas") {
      filas = [["ID", "Fecha", "Total", "Forma de pago", "Cliente", "Detalle"]];
      for (const m of data) {
        filas.push([
          m.id,
          m.creado_en.replace("T", " "),
          m.total,
          m.metodo_pago,
          m.cliente_nombre || "",
          m.detalles.map((d) => `${d.cantidad}x ${d.nombre_producto}`).join(" | "),
        ]);
      }
    } else {
      filas = [["ID", "Fecha", "Total", "Proveedor", "Notas", "Detalle"]];
      for (const m of data) {
        filas.push([
          m.id,
          m.creado_en.replace("T", " "),
          m.total,
          m.proveedor || "",
          m.notas || "",
          m.detalles.map((d) => `${d.cantidad}x ${d.nombre_producto} @ ${d.costo_unitario}`).join(" | "),
        ]);
      }
    }
    if (filas.length === 1) return toast("No hay datos para exportar", "error");
    descargarCSV(`${tipo}_${hoy()}.csv`, filas);
    toast("CSV exportado");
  } catch (e) {
    toast(e.message, "error");
  }
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
document.getElementById("btn-exportar").onclick = exportar;

// ---------- Init ----------
document.getElementById("fecha-desde").value = fechaHace(29);
document.getElementById("fecha-hasta").value = hoy();
cargar(true);
