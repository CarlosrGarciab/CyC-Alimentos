const MONEDA = "$";

const $toast = document.getElementById("toast");
const $inputImagen = document.getElementById("input-imagen");
const $previewCrear = document.getElementById("foto-preview-crear");
const $imgPreviewCrear = document.getElementById("img-preview-crear");
const $btnFotoCrear = document.getElementById("btn-foto-crear");
const $btnFotoCrearQuitar = document.getElementById("btn-foto-crear-quitar");

let editandoCatId = null;
let editandoProdId = null;
let modoImagen = null; // { tipo: 'crear' } | { tipo: 'editar', id }
let archivoCrear = null;
let proveedores = [];

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

function inputChico(id, valor, tipo = "text", ancho = "100%") {
  const input = document.createElement("input");
  input.id = id;
  input.value = valor;
  input.type = tipo;
  if (tipo === "number") {
    input.min = "0";
    input.step = "0.01";
  }
  input.style.width = ancho;
  return input;
}

function conLabel(control, etiqueta, ancho = "100%") {
  const wrap = document.createElement("div");
  wrap.style.cssText = `display: inline-block; vertical-align: top; width: ${ancho}; margin-bottom: 4px;`;
  wrap.appendChild(control);
  const lbl = document.createElement("div");
  lbl.className = "label-edit";
  lbl.textContent = etiqueta;
  wrap.appendChild(lbl);
  return wrap;
}

function selectProveedores(id, valor) {
  const sel = document.createElement("select");
  sel.id = id;
  sel.style.width = "100%";
  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "Sin proveedor";
  sel.appendChild(optNone);
  for (const p of proveedores) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nombre;
    sel.appendChild(opt);
  }
  sel.value = valor ?? "";
  return sel;
}

// ---------- Stock ----------

function estadoStock(p) {
  if (p.stock_actual === null) return { texto: "—", clase: "" };
  if (p.stock_actual <= 0) return { texto: `${p.stock_actual} · Agotado`, clase: "agotado" };
  if (p.stock_minimo !== null && p.stock_actual <= p.stock_minimo)
    return { texto: `${p.stock_actual} · Bajo`, clase: "bajo" };
  return { texto: String(p.stock_actual), clase: "" };
}

function celdaStock(p) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  const estado = estadoStock(p);
  if (estado.clase) {
    const badge = document.createElement("span");
    badge.className = `badge ${estado.clase}`;
    badge.textContent = estado.texto;
    wrap.appendChild(badge);
  } else {
    const val = document.createElement("div");
    val.textContent = estado.texto;
    wrap.appendChild(val);
  }
  const lbl = document.createElement("div");
  lbl.style.cssText = "font-size: 0.75rem; color: var(--muted); margin-top: 1px;";
  lbl.textContent = p.stock_minimo === null ? "mín: —" : `mín: ${p.stock_minimo}`;
  wrap.appendChild(lbl);
  td.appendChild(wrap);
  return td;
}

// ---------- Categorías ----------

const POR_PAGINA_CAT = 10;
let limiteCatTabla = POR_PAGINA_CAT;
let todasCats = [];

async function cargarCategorias() {
  todasCats = await api("/api/categorias?incluir_inactivas=true");
  const cats = todasCats.slice(0, limiteCatTabla);
  const tbody = document.getElementById("tabla-categorias");
  tbody.innerHTML = "";

  for (const c of cats) {
    const tr = document.createElement("tr");
    tr.className = editandoCatId === c.id ? "editando" : "";

    const tdNombre = document.createElement("td");
    tdNombre.style.width = "50%";
    if (editandoCatId === c.id) {
      tdNombre.appendChild(inputChico(`cat-edit-${c.id}`, c.nombre));
    } else {
      tdNombre.textContent = c.nombre;
    }

    const tdEstado = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge" + (c.activo ? "" : " inactivo");
    badge.textContent = c.activo ? "Activa" : "Inactiva";
    tdEstado.appendChild(badge);

    const tdAcc = document.createElement("td");
    tdAcc.className = "celda-acciones";

    if (editandoCatId === c.id) {
      tdAcc.append(
        btnAccion("Guardar", "", () => guardarEdicionCat(c.id)),
        btnAccion("Cancelar", "secundario", () => { editandoCatId = null; cargarCategorias(); })
      );
    } else {
      if (c.activo) {
        tdAcc.append(
          btnAccion("Editar", "secundario", () => { editandoCatId = c.id; cargarCategorias(); }),
          btnAccion("Desactivar", "advertencia", () => cambiarActivoCat(c.id, false)),
          btnAccion("Eliminar", "peligro", () => eliminarCat(c))
        );
      } else {
        tdAcc.append(
          btnAccion("Reactivar", "", () => cambiarActivoCat(c.id, true)),
          btnAccion("Eliminar", "peligro", () => eliminarCat(c))
        );
      }
    }

    tr.append(tdNombre, tdEstado, tdAcc);
    tbody.appendChild(tr);
  }

  const btnMasCat = document.getElementById("btn-mas-cat-tabla");
  const restantesCat = todasCats.length - cats.length;
  btnMasCat.hidden = restantesCat <= 0;
  if (restantesCat > 0) {
    btnMasCat.textContent = `Ver más categorías (${restantesCat} restantes)`;
  }

  const activas = todasCats.filter((c) => c.activo);
  const select = document.getElementById("prod-categoria");
  const actual = select.value;
  select.innerHTML = "";
  for (const c of activas) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    select.appendChild(opt);
  }
  if (actual) select.value = actual;
}

document.getElementById("btn-mas-cat-tabla").onclick = () => {
  limiteCatTabla += POR_PAGINA_CAT;
  cargarCategorias();
};

async function guardarEdicionCat(id) {
  const input = document.getElementById(`cat-edit-${id}`);
  try {
    await api(`/api/categorias/${id}`, { method: "PUT", body: JSON.stringify({ nombre: input.value }) });
    editandoCatId = null;
    toast("Categoría actualizada");
    await cargarCategorias();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function cambiarActivoCat(id, activo) {
  try {
    await api(`/api/categorias/${id}/activo?activo=${activo}`, { method: "PUT" });
    toast(activo ? "Categoría reactivada" : "Categoría desactivada");
    await cargarCategorias();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function eliminarCat(c) {
  if (!confirm(`¿Eliminar la categoría "${c.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/categorias/${c.id}`, { method: "DELETE" });
    toast("Categoría eliminada");
    await cargarCategorias();
  } catch (e) {
    toast(e.message, "error");
  }
}

document.getElementById("btn-cat-guardar").onclick = async () => {
  const input = document.getElementById("cat-nombre");
  const nombre = input.value.trim();
  if (!nombre) return toast("Escribe el nombre de la categoría", "error");
  try {
    const r = await api("/api/categorias", { method: "POST", body: JSON.stringify({ nombre }) });
    input.value = "";
    toast(r.reactivada ? "La categoría ya existía y se reactivó" : "Categoría creada");
    await cargarCategorias();
  } catch (e) {
    toast(e.message, "error");
  }
};

// ---------- Productos ----------

async function cargarProveedores() {
  proveedores = await api("/api/proveedores");
  const sel = document.getElementById("prod-proveedor");
  const actual = sel.value;
  sel.innerHTML = `<option value="">Sin proveedor</option>`;
  for (const p of proveedores) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nombre;
    sel.appendChild(opt);
  }
  if (actual) sel.value = actual;
}

const POR_PAGINA_PROD = 10;
let limiteProdTabla = POR_PAGINA_PROD;
let todosProds = [];
let textoBusProd = "";

async function cargarProductos() {
  todosProds = await api("/api/productos?incluir_inactivos=true");
  let lista = todosProds;
  if (textoBusProd) {
    lista = lista.filter(
      (p) =>
        p.nombre.toLowerCase().includes(textoBusProd) ||
        (p.categoria || "").toLowerCase().includes(textoBusProd)
    );
  }
  const prods = lista.slice(0, limiteProdTabla);
  const tbody = document.getElementById("tabla-productos");
  tbody.innerHTML = "";

  for (const p of prods) {
    const tr = document.createElement("tr");
    tr.className = editandoProdId === p.id ? "editando" : "";

    // Producto (nombre + proveedor al editar)
    const tdNombre = document.createElement("td");
    if (editandoProdId === p.id) {
      tdNombre.appendChild(conLabel(inputChico(`prod-edit-nombre-${p.id}`, p.nombre), "Nombre"));
      tdNombre.appendChild(
        conLabel(selectProveedores(`prod-edit-prov-${p.id}`, p.proveedor_id), "Proveedor")
      );
    } else {
      if (p.imagen) {
        const img = document.createElement("img");
        img.className = "thumb-producto";
        img.src = `/static/uploads/${p.imagen}`;
        img.alt = p.nombre;
        tdNombre.appendChild(img);
      } else {
        const ph = document.createElement("span");
        ph.className = "thumb-placeholder";
        ph.textContent = "🍽️";
        tdNombre.appendChild(ph);
      }
      tdNombre.appendChild(document.createTextNode(p.nombre));
      if (p.proveedor) {
        const tag = document.createElement("div");
        tag.style.cssText = "font-size: 0.75rem; color: var(--muted); margin-left: 52px; margin-top: -4px;";
        tag.textContent = p.proveedor;
        tdNombre.appendChild(tag);
      }
    }

    // Categoría
    const tdCat = document.createElement("td");
    tdCat.style.width = "18%";
    if (editandoProdId === p.id) {
      const sel = document.createElement("select");
      sel.id = `prod-edit-cat-${p.id}`;
      sel.style.width = "100%";
      document.querySelectorAll("#prod-categoria option").forEach((o) =>
        sel.appendChild(o.cloneNode(true))
      );
      sel.value = p.categoria_id;
      tdCat.appendChild(conLabel(sel, "Categoría"));
    } else {
      tdCat.textContent = p.categoria;
    }

    // Precio
    const tdPrecio = document.createElement("td");
    tdPrecio.style.width = "14%";
    if (editandoProdId === p.id) {
      const precioInput = inputChico(`prod-edit-precio-${p.id}`, p.precio, "number", "100%");
      tdPrecio.append(conLabel(precioInput, "Precio ($)"));
    } else {
      const wrapPrecio = document.createElement("div");
      const val = document.createElement("div");
      val.textContent = fmtPrecio(p.precio);
      wrapPrecio.append(val);
      tdPrecio.appendChild(wrapPrecio);
    }

    // Stock
    const tdStock = document.createElement("td");
    tdStock.style.width = "18%";
    if (editandoProdId === p.id) {
      const filaStock = document.createElement("div");
      filaStock.style.cssText = "display: flex; align-items: flex-start; gap: 6px;";
      const actualInput = inputChico(`prod-edit-actual-${p.id}`, p.stock_actual ?? "", "number", "100%");
      const minInput = inputChico(`prod-edit-min-${p.id}`, p.stock_minimo ?? "", "number", "100%");
      filaStock.append(
        conLabel(actualInput, "Actual", "80px"),
        conLabel(minInput, "Mínimo", "80px")
      );
      tdStock.appendChild(filaStock);
    } else {
      tdStock.appendChild(celdaStock(p));
    }

    // Estado
    const tdEstado = document.createElement("td");
    tdEstado.style.width = "90px";
    const badge = document.createElement("span");
    badge.className = "badge" + (p.activo ? "" : " inactivo");
    badge.textContent = p.activo ? "Activo" : "Inactivo";
    tdEstado.appendChild(badge);

    // Acciones
    const tdAcc = document.createElement("td");
    tdAcc.className = "celda-acciones";

    if (editandoProdId === p.id) {
      tdAcc.append(
        btnAccion(p.imagen ? "Cambiar foto" : "Foto", "secundario", () => pedirImagen("editar", p.id))
      );
      if (p.imagen) {
        tdAcc.append(btnAccion("Quitar foto", "advertencia", () => quitarImagen(p.id)));
      }
      tdAcc.append(
        btnAccion("Guardar", "", () => guardarEdicionProd(p.id)),
        btnAccion("Cancelar", "secundario", () => { editandoProdId = null; cargarProductos(); })
      );
    } else {
      if (p.activo) {
        tdAcc.append(
          btnAccion("Editar", "secundario", () => { editandoProdId = p.id; cargarProductos(); }),
          btnAccion("Desactivar", "advertencia", () => cambiarActivoProd(p.id, false)),
          btnAccion("Eliminar", "peligro", () => eliminarProd(p))
        );
      } else {
        tdAcc.append(
          btnAccion("Reactivar", "", () => cambiarActivoProd(p.id, true)),
          btnAccion("Eliminar", "peligro", () => eliminarProd(p))
        );
      }
    }

    tr.append(tdNombre, tdCat, tdPrecio, tdStock, tdEstado, tdAcc);
    tbody.appendChild(tr);
  }

  const btnMas = document.getElementById("btn-mas-prod-tabla");
  const restantes = lista.length - prods.length;
  btnMas.hidden = restantes <= 0;
  if (restantes > 0) {
    btnMas.textContent = `Ver más productos (${restantes} restantes)`;
  }
}

document.getElementById("btn-mas-prod-tabla").onclick = () => {
  limiteProdTabla += POR_PAGINA_PROD;
  cargarProductos();
};

document.getElementById("prod-buscador").addEventListener("input", (e) => {
  textoBusProd = e.target.value.trim().toLowerCase();
  limiteProdTabla = POR_PAGINA_PROD;
  cargarProductos();
});

async function guardarEdicionProd(id) {
  const nombre = document.getElementById(`prod-edit-nombre-${id}`).value;
  const categoria_id = Number(document.getElementById(`prod-edit-cat-${id}`).value);
  const precio = Number(document.getElementById(`prod-edit-precio-${id}`).value);
  const actualVal = document.getElementById(`prod-edit-actual-${id}`).value;
  const stock_actual = actualVal === "" ? null : Number(actualVal);
  const minVal = document.getElementById(`prod-edit-min-${id}`).value;
  const stock_minimo = minVal === "" ? null : Number(minVal);
  const provVal = document.getElementById(`prod-edit-prov-${id}`).value;
  const proveedor_id = provVal === "" ? null : Number(provVal);
  try {
    await api(`/api/productos/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nombre, categoria_id, precio, stock_actual, stock_minimo, proveedor_id }),
    });
    editandoProdId = null;
    toast("Producto actualizado");
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function cambiarActivoProd(id, activo) {
  try {
    await api(`/api/productos/${id}/activo?activo=${activo}`, { method: "PUT" });
    toast(activo ? "Producto reactivado" : "Producto desactivado");
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function eliminarProd(p) {
  if (!confirm(`¿Eliminar el producto "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/productos/${p.id}`, { method: "DELETE" });
    toast("Producto eliminado");
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
}

document.getElementById("btn-prod-guardar").onclick = async () => {
  const nombre = document.getElementById("prod-nombre").value.trim();
  const categoria_id = Number(document.getElementById("prod-categoria").value);
  const precio = Number(document.getElementById("prod-precio").value);
  const stockRaw = document.getElementById("prod-stock").value;
  const stockMinRaw = document.getElementById("prod-stock-min").value;
  const provRaw = document.getElementById("prod-proveedor").value;
  const stock_actual = stockRaw === "" ? null : Number(stockRaw);
  const stock_minimo = stockMinRaw === "" ? null : Number(stockMinRaw);
  const proveedor_id = provRaw === "" ? null : Number(provRaw);
  if (!nombre) return toast("Escribe el nombre del producto", "error");
  if (!categoria_id) return toast("Selecciona una categoría", "error");
  if (!(precio >= 0)) return toast("Escribe un precio válido", "error");
  try {
    const nuevo = await api("/api/productos", {
      method: "POST",
      body: JSON.stringify({ nombre, categoria_id, precio, stock_actual, stock_minimo, proveedor_id }),
    });
    if (archivoCrear) {
      try {
        await subirImagenProducto(nuevo.id, archivoCrear);
      } catch (e) {
        toast("Producto creado, pero la foto falló: " + e.message, "error");
      }
      archivoCrear = null;
      $previewCrear.hidden = true;
      $imgPreviewCrear.src = "";
      $btnFotoCrearQuitar.hidden = true;
    }
    document.getElementById("prod-nombre").value = "";
    document.getElementById("prod-precio").value = "";
    document.getElementById("prod-stock").value = "";
    document.getElementById("prod-stock-min").value = "";
    toast("Producto creado");
    limiteProdTabla += 1;
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
};

// ---------- Imágenes ----------

function pedirImagen(tipo, id = null) {
  modoImagen = { tipo, id };
  $inputImagen.value = "";
  $inputImagen.click();
}

$btnFotoCrear.onclick = () => pedirImagen("crear");

$btnFotoCrearQuitar.onclick = () => {
  archivoCrear = null;
  $previewCrear.hidden = true;
  $imgPreviewCrear.src = "";
  $btnFotoCrearQuitar.hidden = true;
};

$inputImagen.addEventListener("change", async () => {
  const modo = modoImagen;
  const archivo = $inputImagen.files[0];
  modoImagen = null;
  if (!modo || !archivo) return;

  if (modo.tipo === "crear") {
    archivoCrear = archivo;
    $imgPreviewCrear.src = URL.createObjectURL(archivo);
    $previewCrear.hidden = false;
    $btnFotoCrearQuitar.hidden = false;
    return;
  }

  const formData = new FormData();
  formData.append("archivo", archivo);
  try {
    const res = await fetch(`/api/productos/${modo.id}/imagen`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Error al subir la imagen");
    }
    toast("Imagen actualizada");
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
});

async function subirImagenProducto(productoId, archivo) {
  const formData = new FormData();
  formData.append("archivo", archivo);
  const res = await fetch(`/api/productos/${productoId}/imagen`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Error al subir la imagen");
  }
}

async function quitarImagen(productoId) {
  if (!confirm("¿Quitar la foto de este producto?")) return;
  try {
    await api(`/api/productos/${productoId}/imagen`, { method: "DELETE" });
    toast("Imagen quitada");
    await cargarProductos();
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- Init ----------

(async function init() {
  await Promise.all([cargarCategorias(), cargarProveedores()]);
  await cargarProductos();
})();
