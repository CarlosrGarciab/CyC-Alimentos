const MONEDA = "$";

const $toast = document.getElementById("toast");
const $tabla = document.getElementById("tabla-clientes");
const $tablaVacia = document.getElementById("tabla-vacia");
const $buscador = document.getElementById("buscador");
const $chkInactivos = document.getElementById("chk-inactivos");
const $modal = document.getElementById("modal");

let textoBusqueda = "";

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
  return MONEDA + " " + Number(n ?? 0).toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function btnAccion(texto, clase, onClick) {
  const b = document.createElement("button");
  b.className = `chico ${clase}`;
  b.textContent = texto;
  b.onclick = onClick;
  return b;
}

// ---------- Modal ----------

function abrirModal(titulo, contenidoFn, acciones) {
  $modal.innerHTML = "";
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  const caja = document.createElement("div");
  caja.className = "modal";

  const h3 = document.createElement("h3");
  h3.textContent = titulo;
  caja.appendChild(h3);

  const cuerpo = document.createElement("div");
  caja.appendChild(cuerpo);

  const accionesDiv = document.createElement("div");
  accionesDiv.className = "modal-acciones";
  caja.appendChild(accionesDiv);

  fondo.appendChild(caja);
  $modal.appendChild(fondo);

  fondo.addEventListener("click", (e) => {
    if (e.target === fondo) cerrarModal();
  });

  contenidoFn(cuerpo, accionesDiv);
  return { cuerpo, accionesDiv };
}

function cerrarModal() {
  $modal.innerHTML = "";
}

function campoForm(label, tipo, valor = "", extra = {}) {
  const wrap = document.createElement("div");
  wrap.className = "form-fila";
  const lab = document.createElement("label");
  lab.textContent = label;
  lab.style.cssText = "flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; color: var(--muted);";
  const input = document.createElement(tipo === "select" ? "select" : "input");
  if (tipo !== "select") input.type = tipo;
  if (tipo === "number") {
    input.min = "0";
    input.step = "0.01";
  }
  input.value = valor;
  Object.entries(extra).forEach(([k, v]) => (input[k] = v));
  lab.appendChild(input);
  wrap.appendChild(lab);
  return { wrap, input };
}

// ---------- Lista de clientes ----------

const POR_PAGINA_CLI = 10;
let limiteClientes = POR_PAGINA_CLI;
let clientesCompleto = [];

async function cargarClientes() {
  const params = new URLSearchParams();
  if (textoBusqueda) params.set("q", textoBusqueda);
  if ($chkInactivos.checked) params.set("incluir_inactivos", "true");
  clientesCompleto = await api(`/api/clientes?${params}`);
  const clientes = clientesCompleto.slice(0, limiteClientes);
  $tabla.innerHTML = "";
  $tablaVacia.hidden = clientesCompleto.length > 0;

  for (const c of clientes) {
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = c.nombre;
    if (!c.activo) {
      const b = document.createElement("span");
      b.className = "badge inactivo";
      b.textContent = "Inactivo";
      b.style.marginLeft = "8px";
      tdNombre.appendChild(b);
    }

    const tdTipo = document.createElement("td");
    tdTipo.textContent = c.tipo === "profesor" ? "Profesor" : "Estudiante";

    const tdCurso = document.createElement("td");
    tdCurso.textContent = c.curso || "—";

    const tdSaldo = document.createElement("td");
    const esProfesor = c.tipo === "profesor";
    const debe = Number(c.saldo_pendiente || 0) > 0.001;
    const favor = Number(c.saldo_favor || 0) > 0.001;
    if (esProfesor) {
      tdSaldo.className = "saldo-ok";
      tdSaldo.textContent = "—";
    } else if (debe) {
      tdSaldo.className = "saldo-debe";
      tdSaldo.textContent = `Debe ${fmtPrecio(c.saldo_pendiente)}`;
      if (favor) {
        const extra = document.createElement("div");
        extra.className = "saldo-ok";
        extra.style.fontSize = "0.8rem";
        extra.textContent = `A favor ${fmtPrecio(c.saldo_favor)}`;
        tdSaldo.appendChild(extra);
      }
    } else if (favor) {
      tdSaldo.className = "saldo-ok";
      tdSaldo.textContent = `A favor ${fmtPrecio(c.saldo_favor)}`;
    } else {
      tdSaldo.className = "saldo-ok";
      tdSaldo.textContent = "Al día";
    }

    const tdAcc = document.createElement("td");
    tdAcc.className = "celda-acciones";
    if (c.saldo_pendiente > 0.001) {
      tdAcc.append(btnAccion("Cobrar", "", () => modalCobrar(c)));
    }
    if (!esProfesor) {
      tdAcc.append(btnAccion("+ Saldo", "", () => modalCargarSaldo(c)));
    }
    tdAcc.append(
      btnAccion("Historial", "secundario", () => modalHistorial(c.id)),
      btnAccion("Editar", "secundario", () => modalEditar(c))
    );
    if (c.activo) {
      tdAcc.append(btnAccion("Desactivar", "advertencia", () => cambiarActivo(c.id, false)));
    } else {
      tdAcc.append(btnAccion("Reactivar", "", () => cambiarActivo(c.id, true)));
    }
    tdAcc.append(btnAccion("Eliminar", "peligro", () => eliminar(c)));

    tr.append(tdNombre, tdTipo, tdCurso, tdSaldo, tdAcc);
    $tabla.appendChild(tr);
  }

  const btnMas = document.getElementById("btn-mas-clientes");
  const restantes = clientesCompleto.length - clientes.length;
  btnMas.hidden = restantes <= 0;
  if (restantes > 0) {
    btnMas.textContent = `Ver más clientes (${restantes} restantes)`;
  }
}

document.getElementById("btn-mas-clientes").onclick = () => {
  limiteClientes += POR_PAGINA_CLI;
  cargarClientes();
};

// ---------- Alta / edición ----------

function camposCliente(c = {}) {
  const nombre = campoForm("Nombre", "text", c.nombre || "");
  const tipo = campoForm("Tipo", "select", c.tipo || "estudiante", {
    onchange: (e) => { curso.wrap.style.display = e.target.value === "profesor" ? "none" : ""; }
  });
  tipo.input.append(
    Object.assign(document.createElement("option"), { value: "estudiante", text: "Estudiante" }),
    Object.assign(document.createElement("option"), { value: "profesor", text: "Profesor" })
  );
  tipo.input.value = c.tipo || "estudiante";
  const curso = campoForm("Curso / sección", "text", c.curso || "", { placeholder: "ej. 3°B" });
  const telefono = campoForm("Teléfono (opcional)", "text", c.telefono || "");
  if ((c.tipo || "estudiante") === "profesor") curso.wrap.style.display = "none";
  return { nombre, tipo, curso, telefono };
}

function leerCampos(campos) {
  const nombre = campos.nombre.input.value.trim();
  if (!nombre) {
    toast("Escribe el nombre del cliente", "error");
    return null;
  }
  return {
    nombre,
    tipo: campos.tipo.input.value,
    curso: campos.curso.input.value.trim() || null,
    telefono: campos.telefono.input.value.trim() || null,
  };
}

document.getElementById("btn-cli-guardar").onclick = async () => {
  const nombre = document.getElementById("cli-nombre").value.trim();
  const tipo = document.getElementById("cli-tipo").value;
  const curso = document.getElementById("cli-curso").value.trim() || null;
  const telefono = document.getElementById("cli-telefono").value.trim() || null;
  if (!nombre) return toast("Escribe el nombre del cliente", "error");
  try {
    await api("/api/clientes", {
      method: "POST",
      body: JSON.stringify({ nombre, tipo, curso, telefono }),
    });
    document.getElementById("cli-nombre").value = "";
    document.getElementById("cli-curso").value = "";
    document.getElementById("cli-telefono").value = "";
    toast("Cliente creado");
    await cargarClientes();
  } catch (e) {
    toast(e.message, "error");
  }
};

// oculta curso si el tipo del card es profesor
document.getElementById("cli-tipo").addEventListener("change", (e) => {
  document.getElementById("cli-curso").style.display =
    e.target.value === "profesor" ? "none" : "";
});

function modalEditar(c) {
  const campos = camposCliente(c);
  abrirModal(`Editar: ${c.nombre}`, (cuerpo, acciones) => {
    [campos.nombre.wrap, campos.tipo.wrap, campos.curso.wrap, campos.telefono.wrap].forEach((w) => cuerpo.appendChild(w));
    acciones.append(
      btnAccion("Cancelar", "secundario", cerrarModal),
      btnAccion("Guardar", "", async () => {
        const data = leerCampos(campos);
        if (!data) return;
        try {
          await api(`/api/clientes/${c.id}`, { method: "PUT", body: JSON.stringify(data) });
          cerrarModal();
          toast("Cliente actualizado");
          await cargarClientes();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
  });
}

// ---------- Cobro de fiado ----------

function modalCobrar(c) {
  abrirModal(`Cobrar a ${c.nombre}`, (cuerpo, acciones) => {
    const info = document.createElement("p");
    info.style.marginTop = "0";
    info.innerHTML = `Saldo pendiente: <strong class="saldo-debe">${fmtPrecio(c.saldo_pendiente)}</strong>`;
    cuerpo.appendChild(info);

    const monto = campoForm("Monto a cobrar", "number", "");
    monto.input.placeholder = "ej. 50";
    cuerpo.appendChild(monto.wrap);

    acciones.append(
      btnAccion("Cancelar", "secundario", cerrarModal),
      btnAccion("Registrar cobro", "", async () => {
        const valor = Number(monto.input.value);
        if (!(valor > 0)) return toast("Escribe un monto válido", "error");
        try {
          const r = await api(`/api/clientes/${c.id}/pagos`, {
            method: "POST",
            body: JSON.stringify({ monto: valor }),
          });
          cerrarModal();
          toast(`Cobro registrado. Saldo restante: ${fmtPrecio(r.saldo_restante)}`);
          await cargarClientes();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
    monto.input.focus();
  });
}

// ---------- Saldo a favor ----------

function modalCargarSaldo(c) {
  abrirModal(`Cargar saldo a favor: ${c.nombre}`, (cuerpo, acciones) => {
    const info = document.createElement("p");
    info.style.marginTop = "0";
    info.innerHTML = `Saldo actual: <strong class="saldo-ok">${fmtPrecio(c.saldo_favor)}</strong>`;
    cuerpo.appendChild(info);

    const monto = campoForm("Monto a cargar", "number", "");
    monto.input.placeholder = "ej. 100000";
    cuerpo.appendChild(monto.wrap);

    const desc = campoForm("Descripción (opcional)", "text", "", {
      placeholder: "ej. Papá de Juan - mes de julio",
    });
    cuerpo.appendChild(desc.wrap);

    acciones.append(
      btnAccion("Cancelar", "secundario", cerrarModal),
      btnAccion("Cargar saldo", "", async () => {
        const valor = Number(monto.input.value);
        if (!(valor > 0)) return toast("Escribe un monto válido", "error");
        try {
          const r = await api(`/api/clientes/${c.id}/saldo`, {
            method: "POST",
            body: JSON.stringify({ monto: valor, descripcion: desc.input.value.trim() || null }),
          });
          cerrarModal();
          toast(`Saldo cargado. Nuevo saldo: ${fmtPrecio(r.saldo_favor)}`);
          await cargarClientes();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
    monto.input.focus();
  });
}

// ---------- Historial ----------

function modalHistorial(clienteId) {
  abrirModal("Historial", (cuerpo) => {
    cuerpo.innerHTML = `<p class="vacio">Cargando...</p>`;
    (async () => {
      try {
        const [data, saldoData] = await Promise.all([
          api(`/api/clientes/${clienteId}/movimientos`),
          api(`/api/clientes/${clienteId}/saldo`),
        ]);
        const titulo = $modal.querySelector(".modal h3");
        if (titulo) titulo.textContent = `Historial: ${data.cliente.nombre}`;
        cuerpo.innerHTML = "";

        const tieneDeudas = data.movimientos.length > 0;
        const tieneSaldo = saldoData.movimientos.length > 0;
        if (!tieneDeudas && !tieneSaldo) {
          cuerpo.innerHTML = `<p class="vacio">Todavía no tiene movimientos.</p>`;
          return;
        }

        if (tieneSaldo) {
          const h = document.createElement("h4");
          h.textContent = "Saldo a favor";
          h.style.margin = "0 0 8px";
          cuerpo.appendChild(h);
          for (const m of saldoData.movimientos) {
            const box = document.createElement("div");
            box.className = "detalle-mov";
            const fecha = m.creado_en.slice(0, 16).replace("T", " ");
            const esCarga = m.monto >= 0;
            const fila = document.createElement("div");
            fila.className = "fila-mov";
            fila.innerHTML = `<span>${m.descripcion || (esCarga ? "Carga" : "Consumo")} · ${fecha}</span>`;
            const valor = document.createElement("span");
            valor.className = esCarga ? "saldo-ok" : "saldo-debe";
            valor.textContent = `${esCarga ? "+" : ""}${fmtPrecio(m.monto)}`;
            fila.appendChild(valor);
            box.appendChild(fila);
            if (!esCarga) {
              for (const pr of m.productos || []) {
                const sub = document.createElement("div");
                sub.className = "fila-mov";
                sub.style.color = "var(--muted)";
                sub.style.fontSize = "0.85rem";
                sub.innerHTML = `<span>${pr.cantidad}× ${pr.nombre_producto}</span><span>${fmtPrecio(pr.subtotal)}</span>`;
                box.appendChild(sub);
              }
            }
            cuerpo.appendChild(box);
          }
        }

        if (tieneDeudas) {
          const h = document.createElement("h4");
          h.textContent = "Fiado";
          h.style.margin = "14px 0 8px";
          cuerpo.appendChild(h);
          for (const d of data.movimientos.slice().reverse()) {
            const box = document.createElement("div");
            box.className = "detalle-mov";
            const fecha = d.creado_en.slice(0, 16).replace("T", " ");
            const titulo = document.createElement("div");
            titulo.className = "titulo";
            titulo.textContent = `Deuda #${d.id} · ${fecha}`;
            box.appendChild(titulo);

            const total = document.createElement("div");
            total.className = "fila-mov";
            total.innerHTML = `<span>Dejó fiado</span><span>${fmtPrecio(d.total)}</span>`;
            box.appendChild(total);

            for (const pr of d.productos || []) {
              const fila = document.createElement("div");
              fila.className = "fila-mov";
              fila.style.color = "var(--muted)";
              fila.style.fontSize = "0.85rem";
              fila.innerHTML = `<span>${pr.cantidad}× ${pr.nombre_producto}</span><span>${fmtPrecio(pr.subtotal)}</span>`;
              box.appendChild(fila);
            }

            for (const p of d.pagos) {
              const fila = document.createElement("div");
              fila.className = "fila-mov";
              fila.style.color = "var(--success)";
              const fechaP = p.creado_en.slice(0, 16).replace("T", " ");
              fila.innerHTML = `<span>Pago (${fechaP})</span><span>− ${fmtPrecio(p.monto)}</span>`;
              box.appendChild(fila);
            }

            const estado = document.createElement("div");
            estado.className = "fila-mov";
            estado.style.fontWeight = "600";
            if (d.estado === "pagada") {
              estado.innerHTML = `<span style="color: var(--success)">Pagada</span>`;
            } else {
              estado.innerHTML = `<span>Saldo</span><span class="saldo-debe">${fmtPrecio(d.saldo)}</span>`;
            }
            box.appendChild(estado);
            cuerpo.appendChild(box);
          }
        }
      } catch (e) {
        cuerpo.innerHTML = `<p class="vacio">No se pudo cargar el historial: ${e.message}</p>`;
        toast(e.message, "error");
      }
    })();
  });
}

// ---------- Activar / eliminar ----------

async function cambiarActivo(id, activo) {
  try {
    await api(`/api/clientes/${id}/activo?activo=${activo}`, { method: "PUT" });
    toast(activo ? "Cliente reactivado" : "Cliente desactivado");
    await cargarClientes();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function eliminar(c) {
  if (!confirm(`¿Eliminar el cliente "${c.nombre}"?`)) return;
  try {
    await api(`/api/clientes/${c.id}`, { method: "DELETE" });
    toast("Cliente eliminado");
    await cargarClientes();
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- Búsqueda ----------

let debounce;
$buscador.addEventListener("input", (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    textoBusqueda = e.target.value.trim();
    limiteClientes = POR_PAGINA_CLI;
    cargarClientes();
  }, 200);
});

$chkInactivos.addEventListener("change", () => {
  limiteClientes = POR_PAGINA_CLI;
  cargarClientes();
});

// ---------- Init ----------

cargarClientes();
