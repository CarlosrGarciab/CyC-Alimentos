import time
from pathlib import Path
from typing import Literal, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import get_connection, init_db

UPLOADS_DIR = Path(__file__).parent / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

EXTENSIONES_OK = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

app = FastAPI(title="Cantina CyC")
init_db()


# ---------- Modelos ----------

class CategoriaIn(BaseModel):
    nombre: str


class ProductoIn(BaseModel):
    categoria_id: int
    nombre: str
    precio: float
    stock_actual: Optional[int] = None
    stock_minimo: Optional[int] = None
    proveedor_id: Optional[int] = None


class ProveedorIn(BaseModel):
    nombre: str
    telefono: Optional[str] = None


class CompraItemIn(BaseModel):
    producto_id: int
    cantidad: int
    costo_unitario: float


class CompraIn(BaseModel):
    proveedor_id: Optional[int] = None
    notas: Optional[str] = None
    items: list[CompraItemIn]


class VentaItemIn(BaseModel):
    producto_id: int
    cantidad: int


class VentaIn(BaseModel):
    metodo_pago: Literal["efectivo", "fiado", "saldo"] = "efectivo"
    cliente_id: Optional[int] = None
    items: list[VentaItemIn]


class ClienteIn(BaseModel):
    nombre: str
    tipo: Literal["estudiante", "profesor"] = "estudiante"
    curso: Optional[str] = None
    telefono: Optional[str] = None


class PagoFiadoIn(BaseModel):
    monto: float


class SaldoIn(BaseModel):
    monto: float
    descripcion: Optional[str] = None


class CierreIn(BaseModel):
    fondo_inicial: float = 0
    efectivo_contado: float
    notas: Optional[str] = None
    sobreescribir: bool = False


# ---------- Categorías ----------

@app.get("/api/categorias")
def listar_categorias(incluir_inactivas: bool = False):
    conn = get_connection()
    try:
        sql = "SELECT id, nombre, activo FROM categorias"
        if not incluir_inactivas:
            sql += " WHERE activo = 1"
        sql += " ORDER BY nombre"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


@app.post("/api/categorias", status_code=201)
def crear_categoria(data: CategoriaIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        existe = conn.execute(
            "SELECT id FROM categorias WHERE LOWER(nombre) = LOWER(?)", (nombre,)
        ).fetchone()
        if existe:
            conn.execute("UPDATE categorias SET activo = 1 WHERE id = ?", (existe["id"],))
            conn.commit()
            return {"id": existe["id"], "nombre": nombre, "activo": 1, "reactivada": True}
        cur = conn.execute("INSERT INTO categorias (nombre) VALUES (?)", (nombre,))
        conn.commit()
        return {"id": cur.lastrowid, "nombre": nombre, "activo": 1}
    finally:
        conn.close()


@app.put("/api/categorias/{categoria_id}")
def editar_categoria(categoria_id: int, data: CategoriaIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE categorias SET nombre = ? WHERE id = ? AND activo = 1",
            (nombre, categoria_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Categoría no encontrada")
        return {"id": categoria_id, "nombre": nombre}
    finally:
        conn.close()


@app.put("/api/categorias/{categoria_id}/activo")
def cambiar_activo_categoria(categoria_id: int, activo: bool):
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE categorias SET activo = ? WHERE id = ?",
            (1 if activo else 0, categoria_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Categoría no encontrada")
        return {"id": categoria_id, "activo": 1 if activo else 0}
    finally:
        conn.close()


@app.delete("/api/categorias/{categoria_id}")
def eliminar_categoria(categoria_id: int):
    conn = get_connection()
    try:
        cat = conn.execute("SELECT id FROM categorias WHERE id = ?", (categoria_id,)).fetchone()
        if not cat:
            raise HTTPException(404, "Categoría no encontrada")
        conProductos = conn.execute(
            "SELECT COUNT(*) FROM productos WHERE categoria_id = ?", (categoria_id,)
        ).fetchone()[0]
        if conProductos > 0:
            raise HTTPException(
                400,
                f"Tiene {conProductos} producto(s) asociado(s). "
                "Muevelos o elimínalos antes de borrar la categoría.",
            )
        conn.execute("DELETE FROM categorias WHERE id = ?", (categoria_id,))
        conn.commit()
        return {"id": categoria_id, "eliminada": True}
    finally:
        conn.close()


# ---------- Productos ----------

@app.get("/api/productos")
def listar_productos(categoria_id: Optional[int] = None, incluir_inactivos: bool = False):
    conn = get_connection()
    try:
        sql = """
            SELECT p.id, p.categoria_id, p.nombre, p.precio, p.activo, p.imagen,
                   p.stock_actual, p.stock_minimo, p.proveedor_id, p.creado_en,
                   c.nombre AS categoria,
                   pr.nombre AS proveedor,
                   (SELECT cu.costo_unitario FROM compra_detalles cu
                    WHERE cu.producto_id = p.id ORDER BY cu.id DESC LIMIT 1) AS ultimo_costo,
                   COALESCE((SELECT SUM(vd.cantidad) FROM venta_detalles vd
                             WHERE vd.producto_id = p.id), 0) AS vendidos
            FROM productos p
            JOIN categorias c ON c.id = p.categoria_id
            LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
            WHERE 1 = 1
        """
        params: list = []
        if not incluir_inactivos:
            sql += " AND p.activo = 1"
        if categoria_id is not None:
            sql += " AND p.categoria_id = ?"
            params.append(categoria_id)
        sql += " ORDER BY c.nombre, p.nombre"
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


@app.post("/api/productos", status_code=201)
def crear_producto(data: ProductoIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    if data.precio < 0:
        raise HTTPException(400, "El precio no puede ser negativo")
    conn = get_connection()
    try:
        cat = conn.execute(
            "SELECT id FROM categorias WHERE id = ? AND activo = 1", (data.categoria_id,)
        ).fetchone()
        if not cat:
            raise HTTPException(400, "La categoría no existe o está inactiva")
        if data.proveedor_id:
            prov = conn.execute(
                "SELECT id FROM proveedores WHERE id = ? AND activo = 1", (data.proveedor_id,)
            ).fetchone()
            if not prov:
                raise HTTPException(400, "El proveedor no existe o está inactivo")
        cur = conn.execute(
            "INSERT INTO productos (categoria_id, nombre, precio, stock_actual, stock_minimo, proveedor_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (data.categoria_id, nombre, data.precio, data.stock_actual, data.stock_minimo,
             data.proveedor_id),
        )
        conn.commit()
        return {"id": cur.lastrowid, "categoria_id": data.categoria_id, "nombre": nombre,
                "precio": data.precio, "stock_actual": data.stock_actual,
                "stock_minimo": data.stock_minimo, "proveedor_id": data.proveedor_id}
    finally:
        conn.close()


@app.put("/api/productos/{producto_id}")
def editar_producto(producto_id: int, data: ProductoIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    if data.precio < 0:
        raise HTTPException(400, "El precio no puede ser negativo")
    conn = get_connection()
    try:
        cat = conn.execute(
            "SELECT id FROM categorias WHERE id = ? AND activo = 1", (data.categoria_id,)
        ).fetchone()
        if not cat:
            raise HTTPException(400, "La categoría no existe o está inactiva")
        if data.proveedor_id:
            prov = conn.execute(
                "SELECT id FROM proveedores WHERE id = ? AND activo = 1", (data.proveedor_id,)
            ).fetchone()
            if not prov:
                raise HTTPException(400, "El proveedor no existe o está inactivo")
        cur = conn.execute(
            "UPDATE productos SET categoria_id = ?, nombre = ?, precio = ?, "
            "stock_minimo = ?, proveedor_id = ?, stock_actual = COALESCE(?, stock_actual) "
            "WHERE id = ? AND activo = 1",
            (data.categoria_id, nombre, data.precio, data.stock_minimo,
             data.proveedor_id, data.stock_actual, producto_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
        return {"id": producto_id, "categoria_id": data.categoria_id, "nombre": nombre,
                "precio": data.precio, "stock_minimo": data.stock_minimo,
                "stock_actual": data.stock_actual, "proveedor_id": data.proveedor_id}
    finally:
        conn.close()


@app.put("/api/productos/{producto_id}/activo")
def cambiar_activo_producto(producto_id: int, activo: bool):
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE productos SET activo = ? WHERE id = ?",
            (1 if activo else 0, producto_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
        return {"id": producto_id, "activo": 1 if activo else 0}
    finally:
        conn.close()


@app.delete("/api/productos/{producto_id}")
def eliminar_producto(producto_id: int):
    conn = get_connection()
    try:
        prod = conn.execute(
            "SELECT id, imagen FROM productos WHERE id = ?", (producto_id,)
        ).fetchone()
        if not prod:
            raise HTTPException(404, "Producto no encontrado")
        conn.execute("DELETE FROM productos WHERE id = ?", (producto_id,))
        conn.commit()
        if prod["imagen"]:
            (UPLOADS_DIR / prod["imagen"]).unlink(missing_ok=True)
        return {"id": producto_id, "eliminado": True}
    finally:
        conn.close()


@app.post("/api/productos/{producto_id}/imagen")
async def subir_imagen_producto(producto_id: int, archivo: UploadFile = File(...)):
    conn = get_connection()
    try:
        prod = conn.execute(
            "SELECT id, imagen FROM productos WHERE id = ?", (producto_id,)
        ).fetchone()
        if not prod:
            raise HTTPException(404, "Producto no encontrado")

        extension = Path(archivo.filename or "").suffix.lower()
        if extension not in EXTENSIONES_OK:
            raise HTTPException(400, "Formato no válido. Usa PNG, JPG, WEBP o GIF")

        contenido = await archivo.read()
        if len(contenido) > 5 * 1024 * 1024:
            raise HTTPException(400, "La imagen no puede superar 5 MB")

        nombre_archivo = f"{producto_id}_{int(time.time())}{extension}"
        (UPLOADS_DIR / nombre_archivo).write_bytes(contenido)

        if prod["imagen"]:
            (UPLOADS_DIR / prod["imagen"]).unlink(missing_ok=True)

        conn.execute(
            "UPDATE productos SET imagen = ? WHERE id = ?", (nombre_archivo, producto_id)
        )
        conn.commit()
        return {"id": producto_id, "imagen": nombre_archivo}
    finally:
        conn.close()


@app.delete("/api/productos/{producto_id}/imagen")
def eliminar_imagen_producto(producto_id: int):
    conn = get_connection()
    try:
        prod = conn.execute(
            "SELECT id, imagen FROM productos WHERE id = ?", (producto_id,)
        ).fetchone()
        if not prod:
            raise HTTPException(404, "Producto no encontrado")
        if prod["imagen"]:
            (UPLOADS_DIR / prod["imagen"]).unlink(missing_ok=True)
            conn.execute("UPDATE productos SET imagen = NULL WHERE id = ?", (producto_id,))
            conn.commit()
        return {"id": producto_id, "imagen": None}
    finally:
        conn.close()


# ---------- Ventas ----------

def _validar_items_venta(conn, data: VentaIn):
    detalles = []
    total = 0.0
    for item in data.items:
        if item.cantidad <= 0:
            raise HTTPException(400, "La cantidad debe ser mayor a cero")
        prod = conn.execute(
            "SELECT id, nombre, precio, stock_actual FROM productos WHERE id = ? AND activo = 1",
            (item.producto_id,),
        ).fetchone()
        if not prod:
            raise HTTPException(400, f"Producto {item.producto_id} no disponible")
        if prod["stock_actual"] is not None and item.cantidad > prod["stock_actual"]:
            raise HTTPException(
                400,
                f"Stock insuficiente de '{prod['nombre']}' "
                f"(disponible: {prod['stock_actual']})",
            )
        subtotal = prod["precio"] * item.cantidad
        total += subtotal
        detalles.append(
            {
                "producto_id": prod["id"],
                "nombre_producto": prod["nombre"],
                "cantidad": item.cantidad,
                "precio_unitario": prod["precio"],
                "stock_actual": prod["stock_actual"],
            }
        )
    return detalles, total


def _descontar_stock(conn, detalles):
    for d in detalles:
        if d.get("stock_actual") is not None:
            conn.execute(
                "UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?",
                (d["cantidad"], d["producto_id"]),
            )


def _revertir_venta(conn, venta_id: int) -> None:
    """Devuelve stock, anula deuda/saldo y borra los detalles de una venta."""
    detalles = conn.execute(
        "SELECT producto_id, cantidad FROM venta_detalles WHERE venta_id = ?",
        (venta_id,),
    ).fetchall()
    for d in detalles:
        if d["producto_id"] is not None:
            conn.execute(
                "UPDATE productos SET stock_actual = stock_actual + ? "
                "WHERE id = ? AND stock_actual IS NOT NULL",
                (d["cantidad"], d["producto_id"]),
            )

    deuda_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM deudas WHERE venta_id = ?", (venta_id,)
    ).fetchall()]
    if deuda_ids:
        ph = ",".join("?" * len(deuda_ids))
        conn.execute(f"DELETE FROM pagos_fiado WHERE deuda_id IN ({ph})", deuda_ids)
        conn.execute(f"DELETE FROM deudas WHERE id IN ({ph})", deuda_ids)

    movs = conn.execute(
        "SELECT cliente_id, monto FROM movimientos_saldo WHERE venta_id = ?",
        (venta_id,),
    ).fetchall()
    for m in movs:
        conn.execute(
            "UPDATE clientes SET saldo_favor = saldo_favor - ? WHERE id = ?",
            (m["monto"], m["cliente_id"]),
        )
    conn.execute("DELETE FROM movimientos_saldo WHERE venta_id = ?", (venta_id,))
    conn.execute("DELETE FROM venta_detalles WHERE venta_id = ?", (venta_id,))


def _insertar_detalles_venta(conn, venta_id: int, detalles: list) -> None:
    conn.executemany(
        """
        INSERT INTO venta_detalles (venta_id, producto_id, nombre_producto, cantidad, precio_unitario)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (venta_id, d["producto_id"], d["nombre_producto"], d["cantidad"], d["precio_unitario"])
            for d in detalles
        ],
    )


def _cobrar_venta(conn, venta_id: int, metodo: str, cliente, total: float):
    """Registra deuda (fiado) o descuenta saldo a favor de la venta."""
    if metodo == "fiado":
        cur = conn.execute(
            "INSERT INTO deudas (cliente_id, venta_id, total, saldo) VALUES (?, ?, ?, ?)",
            (cliente["id"], venta_id, total, total),
        )
        return cur.lastrowid
    if metodo == "saldo":
        conn.execute(
            "UPDATE clientes SET saldo_favor = saldo_favor - ? WHERE id = ?",
            (total, cliente["id"]),
        )
        conn.execute(
            "INSERT INTO movimientos_saldo (cliente_id, venta_id, monto, descripcion) VALUES (?, ?, ?, ?)",
            (cliente["id"], venta_id, -total, f"Venta #{venta_id}"),
        )
    return None


@app.post("/api/ventas", status_code=201)
def crear_venta(data: VentaIn):
    if not data.items:
        raise HTTPException(400, "La venta debe tener al menos un producto")
    conn = get_connection()
    try:
        cliente = None
        if data.metodo_pago in ("fiado", "saldo"):
            if not data.cliente_id:
                raise HTTPException(400, "Debes seleccionar un cliente")
            cliente = conn.execute(
                "SELECT id, nombre, tipo, saldo_favor FROM clientes WHERE id = ? AND activo = 1",
                (data.cliente_id,),
            ).fetchone()
            if not cliente:
                raise HTTPException(400, "El cliente no existe o está inactivo")
            if data.metodo_pago == "saldo" and cliente["tipo"] == "profesor":
                raise HTTPException(400, "Los profesores no pueden usar saldo a favor")

        detalles, total = _validar_items_venta(conn, data)
        if data.metodo_pago == "saldo" and cliente["saldo_favor"] + 0.001 < total:
            raise HTTPException(
                400,
                f"Saldo a favor insuficiente (disponible: {cliente['saldo_favor']:.2f})",
            )

        cur = conn.execute(
            "INSERT INTO ventas (total, metodo_pago, cliente_id) VALUES (?, ?, ?)",
            (total, data.metodo_pago, cliente["id"] if cliente else None),
        )
        venta_id = cur.lastrowid
        _insertar_detalles_venta(conn, venta_id, detalles)

        deuda_id = _cobrar_venta(conn, venta_id, data.metodo_pago, cliente, total)
        _descontar_stock(conn, detalles)
        for d in detalles:
            d.pop("stock_actual", None)

        conn.commit()
        return {
            "id": venta_id,
            "total": total,
            "metodo_pago": data.metodo_pago,
            "cliente": dict(cliente) if cliente else None,
            "deuda_id": deuda_id,
            "detalles": detalles,
        }
    finally:
        conn.close()


@app.put("/api/ventas/{venta_id}")
def editar_venta(venta_id: int, data: VentaIn):
    if not data.items:
        raise HTTPException(400, "La venta debe tener al menos un producto")
    conn = get_connection()
    try:
        venta = conn.execute("SELECT id FROM ventas WHERE id = ?", (venta_id,)).fetchone()
        if not venta:
            raise HTTPException(404, "Venta no encontrada")

        # Revertimos la venta anterior para recalcular stock/deuda/saldo
        _revertir_venta(conn, venta_id)

        cliente = None
        if data.metodo_pago in ("fiado", "saldo"):
            if not data.cliente_id:
                raise HTTPException(400, "Debes seleccionar un cliente")
            cliente = conn.execute(
                "SELECT id, nombre, tipo, saldo_favor FROM clientes WHERE id = ? AND activo = 1",
                (data.cliente_id,),
            ).fetchone()
            if not cliente:
                raise HTTPException(400, "El cliente no existe o está inactivo")
            if data.metodo_pago == "saldo" and cliente["tipo"] == "profesor":
                raise HTTPException(400, "Los profesores no pueden usar saldo a favor")

        detalles, total = _validar_items_venta(conn, data)
        if data.metodo_pago == "saldo" and cliente["saldo_favor"] + 0.001 < total:
            raise HTTPException(
                400,
                f"Saldo a favor insuficiente (disponible: {cliente['saldo_favor']:.2f})",
            )

        conn.execute(
            "UPDATE ventas SET total = ?, metodo_pago = ?, cliente_id = ? WHERE id = ?",
            (total, data.metodo_pago, cliente["id"] if cliente else None, venta_id),
        )
        _insertar_detalles_venta(conn, venta_id, detalles)
        _cobrar_venta(conn, venta_id, data.metodo_pago, cliente, total)
        _descontar_stock(conn, detalles)
        for d in detalles:
            d.pop("stock_actual", None)

        conn.commit()
        return {"id": venta_id, "total": total, "metodo_pago": data.metodo_pago}
    finally:
        conn.close()


@app.delete("/api/ventas/{venta_id}")
def eliminar_venta(venta_id: int):
    conn = get_connection()
    try:
        venta = conn.execute("SELECT id FROM ventas WHERE id = ?", (venta_id,)).fetchone()
        if not venta:
            raise HTTPException(404, "Venta no encontrada")
        _revertir_venta(conn, venta_id)
        conn.execute("DELETE FROM ventas WHERE id = ?", (venta_id,))
        conn.commit()
        return {"id": venta_id, "eliminado": True}
    finally:
        conn.close()


@app.get("/api/ventas")
def listar_ventas(desde: Optional[str] = None, hasta: Optional[str] = None,
                  limite: int = 100, offset: int = 0):
    conn = get_connection()
    try:
        sql = """
            SELECT v.id, v.total, v.metodo_pago, v.creado_en, v.cliente_id,
                   COALESCE(c.nombre, c2.nombre) AS cliente_nombre
            FROM ventas v
            LEFT JOIN clientes c ON c.id = v.cliente_id
            LEFT JOIN deudas d ON d.venta_id = v.id
            LEFT JOIN clientes c2 ON c2.id = d.cliente_id
            WHERE 1 = 1
        """
        params: list = []
        if desde:
            sql += " AND date(v.creado_en) >= ?"
            params.append(desde)
        if hasta:
            sql += " AND date(v.creado_en) <= ?"
            params.append(hasta)
        sql += " ORDER BY v.id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, min(limite, 5000)), max(0, offset)])
        ventas = [dict(r) for r in conn.execute(sql, params).fetchall()]
        for v in ventas:
            v["detalles"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT producto_id, nombre_producto, cantidad, precio_unitario FROM venta_detalles WHERE venta_id = ?",
                    (v["id"],),
                ).fetchall()
            ]
        return ventas
    finally:
        conn.close()


# ---------- Clientes ----------

@app.get("/api/clientes")
def listar_clientes(q: Optional[str] = None, incluir_inactivos: bool = False):
    conn = get_connection()
    try:
        sql = """
            SELECT cl.id, cl.nombre, cl.tipo, cl.curso, cl.telefono, cl.activo, cl.creado_en,
                   cl.saldo_favor,
                   COALESCE((SELECT SUM(d.saldo) FROM deudas d
                             WHERE d.cliente_id = cl.id AND d.estado = 'pendiente'), 0) AS saldo_pendiente
            FROM clientes cl
            WHERE 1 = 1
        """
        params: list = []
        if not incluir_inactivos:
            sql += " AND cl.activo = 1"
        if q:
            sql += " AND (LOWER(cl.nombre) LIKE LOWER(?) OR LOWER(COALESCE(cl.curso, '')) LIKE LOWER(?))"
            like = f"%{q.strip()}%"
            params.extend([like, like])
        sql += " ORDER BY cl.nombre"
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


@app.post("/api/clientes", status_code=201)
def crear_cliente(data: ClienteIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO clientes (nombre, tipo, curso, telefono) VALUES (?, ?, ?, ?)",
            (nombre, data.tipo, data.curso.strip() if data.curso else None,
             data.telefono.strip() if data.telefono else None),
        )
        conn.commit()
        return {"id": cur.lastrowid, "nombre": nombre, "tipo": data.tipo,
                "curso": data.curso, "telefono": data.telefono}
    finally:
        conn.close()


@app.put("/api/clientes/{cliente_id}")
def editar_cliente(cliente_id: int, data: ClienteIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE clientes SET nombre = ?, tipo = ?, curso = ?, telefono = ? "
            "WHERE id = ? AND activo = 1",
            (nombre, data.tipo, data.curso.strip() if data.curso else None,
             data.telefono.strip() if data.telefono else None, cliente_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Cliente no encontrado")
        return {"id": cliente_id, "nombre": nombre}
    finally:
        conn.close()


@app.put("/api/clientes/{cliente_id}/activo")
def cambiar_activo_cliente(cliente_id: int, activo: bool):
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE clientes SET activo = ? WHERE id = ?",
            (1 if activo else 0, cliente_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Cliente no encontrado")
        return {"id": cliente_id, "activo": 1 if activo else 0}
    finally:
        conn.close()


@app.delete("/api/clientes/{cliente_id}")
def eliminar_cliente(cliente_id: int):
    conn = get_connection()
    try:
        cl = conn.execute("SELECT id FROM clientes WHERE id = ?", (cliente_id,)).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente no encontrado")
        conDeuda = conn.execute(
            "SELECT COALESCE(SUM(saldo), 0) FROM deudas WHERE cliente_id = ? AND estado = 'pendiente'",
            (cliente_id,),
        ).fetchone()[0]
        if conDeuda > 0:
            raise HTTPException(400, "El cliente tiene deuda pendiente. Cobra o cancela la deuda antes de eliminarlo.")
        deuda_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM deudas WHERE cliente_id = ?", (cliente_id,)
        ).fetchall()]
        if deuda_ids:
            placeholders = ",".join("?" * len(deuda_ids))
            conn.execute(f"DELETE FROM pagos_fiado WHERE deuda_id IN ({placeholders})", deuda_ids)
            conn.execute(f"DELETE FROM deudas WHERE id IN ({placeholders})", deuda_ids)
        conn.execute("DELETE FROM movimientos_saldo WHERE cliente_id = ?", (cliente_id,))
        conn.execute("DELETE FROM clientes WHERE id = ?", (cliente_id,))
        conn.commit()
        return {"id": cliente_id, "eliminado": True}
    finally:
        conn.close()


# ---------- Saldo a favor ----------

def _productos_venta(conn, venta_id):
    if not venta_id:
        return []
    return [dict(r) for r in conn.execute(
        "SELECT nombre_producto, cantidad, precio_unitario, "
        "(cantidad * precio_unitario) AS subtotal "
        "FROM venta_detalles WHERE venta_id = ? ORDER BY id",
        (venta_id,),
    ).fetchall()]


@app.post("/api/clientes/{cliente_id}/saldo", status_code=201)
def cargar_saldo(cliente_id: int, data: SaldoIn):
    if data.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a cero")
    conn = get_connection()
    try:
        cl = conn.execute("SELECT id, nombre, tipo FROM clientes WHERE id = ?", (cliente_id,)).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente no encontrado")
        if cl["tipo"] == "profesor":
            raise HTTPException(400, "Los profesores no pueden tener saldo a favor")
        conn.execute(
            "UPDATE clientes SET saldo_favor = saldo_favor + ? WHERE id = ?",
            (data.monto, cliente_id),
        )
        conn.execute(
            "INSERT INTO movimientos_saldo (cliente_id, monto, descripcion) VALUES (?, ?, ?)",
            (cliente_id, data.monto, data.descripcion.strip() if data.descripcion else "Carga de saldo"),
        )
        conn.commit()
        nuevo = conn.execute(
            "SELECT saldo_favor FROM clientes WHERE id = ?", (cliente_id,)
        ).fetchone()[0]
        return {"cliente_id": cliente_id, "saldo_favor": nuevo}
    finally:
        conn.close()


@app.get("/api/clientes/{cliente_id}/saldo")
def movimientos_saldo(cliente_id: int):
    conn = get_connection()
    try:
        cl = conn.execute(
            "SELECT id, nombre, saldo_favor FROM clientes WHERE id = ?", (cliente_id,)
        ).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente no encontrado")
        movs = [dict(r) for r in conn.execute(
            "SELECT id, venta_id, monto, descripcion, creado_en FROM movimientos_saldo "
            "WHERE cliente_id = ? ORDER BY id DESC",
            (cliente_id,),
        ).fetchall()]
        for m in movs:
            m["productos"] = _productos_venta(conn, m["venta_id"])
        return {"cliente": dict(cl), "movimientos": movs}
    finally:
        conn.close()


# ---------- Fiado ----------

@app.post("/api/clientes/{cliente_id}/pagos", status_code=201)
def registrar_pago_fiado(cliente_id: int, data: PagoFiadoIn):
    if data.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a cero")
    conn = get_connection()
    try:
        cl = conn.execute(
            "SELECT id, nombre FROM clientes WHERE id = ?", (cliente_id,)
        ).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente no encontrado")

        deudas = conn.execute(
            "SELECT id, saldo FROM deudas WHERE cliente_id = ? AND estado = 'pendiente' ORDER BY id",
            (cliente_id,),
        ).fetchall()
        saldo_total = sum(d["saldo"] for d in deudas)
        if saldo_total == 0:
            raise HTTPException(400, "El cliente no tiene deuda pendiente")
        if data.monto > saldo_total + 0.001:
            raise HTTPException(400, f"El monto supera la deuda (debe {saldo_total:.2f})")

        restante = data.monto
        aplicado = []
        for d in deudas:
            if restante <= 0:
                break
            pago = min(restante, d["saldo"])
            nuevo_saldo = round(d["saldo"] - pago, 2)
            conn.execute(
                "INSERT INTO pagos_fiado (deuda_id, monto) VALUES (?, ?)", (d["id"], pago)
            )
            conn.execute(
                "UPDATE deudas SET saldo = ?, estado = ? WHERE id = ?",
                (nuevo_saldo, "pagada" if nuevo_saldo <= 0.001 else "pendiente", d["id"]),
            )
            aplicado.append({"deuda_id": d["id"], "monto": round(pago, 2)})
            restante = round(restante - pago, 2)

        conn.commit()
        nuevo_saldo_cliente = conn.execute(
            "SELECT COALESCE(SUM(saldo), 0) FROM deudas WHERE cliente_id = ? AND estado = 'pendiente'",
            (cliente_id,),
        ).fetchone()[0]
        return {
            "cliente_id": cliente_id,
            "monto": data.monto,
            "aplicado": aplicado,
            "saldo_restante": nuevo_saldo_cliente,
        }
    finally:
        conn.close()


@app.get("/api/clientes/{cliente_id}/movimientos")
def movimientos_cliente(cliente_id: int):
    conn = get_connection()
    try:
        cl = conn.execute("SELECT id, nombre FROM clientes WHERE id = ?", (cliente_id,)).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente no encontrado")

        deudas = [dict(r) for r in conn.execute(
            """
            SELECT d.id, d.total, d.saldo, d.estado, d.creado_en, v.id AS venta_id
            FROM deudas d
            LEFT JOIN ventas v ON v.id = d.venta_id
            WHERE d.cliente_id = ?
            ORDER BY d.id
            """,
            (cliente_id,),
        ).fetchall()]
        for d in deudas:
            d["pagos"] = [dict(r) for r in conn.execute(
                "SELECT monto, creado_en FROM pagos_fiado WHERE deuda_id = ? ORDER BY id",
                (d["id"],),
            ).fetchall()]
            d["productos"] = _productos_venta(conn, d["venta_id"])

        return {"cliente": dict(cl), "movimientos": deudas}
    finally:
        conn.close()


# ---------- Proveedores ----------

@app.get("/api/proveedores")
def listar_proveedores(incluir_inactivos: bool = False):
    conn = get_connection()
    try:
        sql = "SELECT id, nombre, telefono, activo FROM proveedores"
        if not incluir_inactivos:
            sql += " WHERE activo = 1"
        sql += " ORDER BY nombre"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


@app.post("/api/proveedores", status_code=201)
def crear_proveedor(data: ProveedorIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO proveedores (nombre, telefono) VALUES (?, ?)",
            (nombre, data.telefono.strip() if data.telefono else None),
        )
        conn.commit()
        return {"id": cur.lastrowid, "nombre": nombre}
    finally:
        conn.close()


@app.put("/api/proveedores/{proveedor_id}")
def editar_proveedor(proveedor_id: int, data: ProveedorIn):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre no puede estar vacío")
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE proveedores SET nombre = ?, telefono = ? WHERE id = ? AND activo = 1",
            (nombre, data.telefono.strip() if data.telefono else None, proveedor_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Proveedor no encontrado")
        return {"id": proveedor_id, "nombre": nombre}
    finally:
        conn.close()


@app.put("/api/proveedores/{proveedor_id}/activo")
def cambiar_activo_proveedor(proveedor_id: int, activo: bool):
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE proveedores SET activo = ? WHERE id = ?",
            (1 if activo else 0, proveedor_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Proveedor no encontrado")
        return {"id": proveedor_id, "activo": 1 if activo else 0}
    finally:
        conn.close()


@app.delete("/api/proveedores/{proveedor_id}")
def eliminar_proveedor(proveedor_id: int):
    conn = get_connection()
    try:
        prov = conn.execute("SELECT id FROM proveedores WHERE id = ?", (proveedor_id,)).fetchone()
        if not prov:
            raise HTTPException(404, "Proveedor no encontrado")
        conCompras = conn.execute(
            "SELECT COUNT(*) FROM compras WHERE proveedor_id = ?", (proveedor_id,)
        ).fetchone()[0]
        if conCompras > 0:
            raise HTTPException(
                400,
                f"Tiene {conCompras} compra(s) registradas. "
                "Desactívalo en lugar de eliminarlo para conservar el historial.",
            )
        conn.execute(
            "UPDATE productos SET proveedor_id = NULL WHERE proveedor_id = ?", (proveedor_id,)
        )
        conn.execute("DELETE FROM proveedores WHERE id = ?", (proveedor_id,))
        conn.commit()
        return {"id": proveedor_id, "eliminado": True}
    finally:
        conn.close()


# ---------- Compras e inventario ----------

@app.get("/api/inventario")
def ver_inventario():
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT p.id, p.nombre, p.activo, p.stock_actual, p.stock_minimo, p.precio,
                   c.nombre AS categoria,
                   (SELECT cu.costo_unitario FROM compra_detalles cu
                    WHERE cu.producto_id = p.id ORDER BY cu.id DESC LIMIT 1) AS ultimo_costo,
                   (SELECT cl.nombre FROM compras co
                    JOIN compra_detalles cu ON cu.compra_id = co.id
                    JOIN proveedores cl ON cl.id = co.proveedor_id
                    WHERE cu.producto_id = p.id ORDER BY co.id DESC LIMIT 1) AS ultimo_proveedor
            FROM productos p
            JOIN categorias c ON c.id = p.categoria_id
            WHERE p.activo = 1
            ORDER BY c.nombre, p.nombre
            """
        ).fetchall()
        resultado = []
        for r in rows:
            item = dict(r)
            stock = item["stock_actual"]
            minimo = item["stock_minimo"]
            if stock is None:
                item["estado"] = "sin_control"
            elif stock <= 0:
                item["estado"] = "agotado"
            elif minimo is not None and stock <= minimo:
                item["estado"] = "bajo"
            else:
                item["estado"] = "ok"
            resultado.append(item)
        return resultado
    finally:
        conn.close()


def _validar_items_compra(conn, data: CompraIn):
    detalles = []
    total = 0.0
    for item in data.items:
        if item.cantidad <= 0:
            raise HTTPException(400, "La cantidad debe ser mayor a cero")
        if item.costo_unitario < 0:
            raise HTTPException(400, "El costo no puede ser negativo")
        prod = conn.execute(
            "SELECT id, nombre FROM productos WHERE id = ? AND activo = 1",
            (item.producto_id,),
        ).fetchone()
        if not prod:
            raise HTTPException(400, f"Producto {item.producto_id} no disponible")
        subtotal = item.costo_unitario * item.cantidad
        total += subtotal
        detalles.append(
            {
                "producto_id": prod["id"],
                "nombre_producto": prod["nombre"],
                "cantidad": item.cantidad,
                "costo_unitario": item.costo_unitario,
            }
        )
    return detalles, total


def _revertir_compra(conn, compra_id: int) -> None:
    """Descuenta el stock que había sumado la compra y borra sus detalles."""
    detalles = conn.execute(
        "SELECT producto_id, cantidad FROM compra_detalles WHERE compra_id = ?",
        (compra_id,),
    ).fetchall()
    for d in detalles:
        if d["producto_id"] is not None:
            conn.execute(
                "UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?",
                (d["cantidad"], d["producto_id"]),
            )
    conn.execute("DELETE FROM compra_detalles WHERE compra_id = ?", (compra_id,))


def _insertar_detalles_compra(conn, compra_id: int, detalles: list) -> None:
    conn.executemany(
        """
        INSERT INTO compra_detalles (compra_id, producto_id, nombre_producto, cantidad, costo_unitario)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (compra_id, d["producto_id"], d["nombre_producto"], d["cantidad"], d["costo_unitario"])
            for d in detalles
        ],
    )


def _sumar_stock_compra(conn, detalles: list) -> None:
    for d in detalles:
        conn.execute(
            "UPDATE productos SET stock_actual = COALESCE(stock_actual, 0) + ? WHERE id = ?",
            (d["cantidad"], d["producto_id"]),
        )


@app.post("/api/compras", status_code=201)
def crear_compra(data: CompraIn):
    if not data.items:
        raise HTTPException(400, "La compra debe tener al menos un producto")
    conn = get_connection()
    try:
        proveedor = None
        if data.proveedor_id:
            proveedor = conn.execute(
                "SELECT id, nombre FROM proveedores WHERE id = ? AND activo = 1",
                (data.proveedor_id,),
            ).fetchone()
            if not proveedor:
                raise HTTPException(400, "El proveedor no existe o está inactivo")

        detalles, total = _validar_items_compra(conn, data)
        cur = conn.execute(
            "INSERT INTO compras (proveedor_id, total, notas) VALUES (?, ?, ?)",
            (data.proveedor_id, total, data.notas.strip() if data.notas else None),
        )
        compra_id = cur.lastrowid
        _insertar_detalles_compra(conn, compra_id, detalles)
        _sumar_stock_compra(conn, detalles)
        conn.commit()
        return {
            "id": compra_id,
            "total": total,
            "proveedor": dict(proveedor) if proveedor else None,
            "detalles": detalles,
        }
    finally:
        conn.close()


@app.put("/api/compras/{compra_id}")
def editar_compra(compra_id: int, data: CompraIn):
    if not data.items:
        raise HTTPException(400, "La compra debe tener al menos un producto")
    conn = get_connection()
    try:
        compra = conn.execute("SELECT id FROM compras WHERE id = ?", (compra_id,)).fetchone()
        if not compra:
            raise HTTPException(404, "Compra no encontrada")

        proveedor = None
        if data.proveedor_id:
            proveedor = conn.execute(
                "SELECT id, nombre FROM proveedores WHERE id = ? AND activo = 1",
                (data.proveedor_id,),
            ).fetchone()
            if not proveedor:
                raise HTTPException(400, "El proveedor no existe o está inactivo")

        _revertir_compra(conn, compra_id)
        detalles, total = _validar_items_compra(conn, data)
        conn.execute(
            "UPDATE compras SET proveedor_id = ?, total = ?, notas = ? WHERE id = ?",
            (data.proveedor_id, total, data.notas.strip() if data.notas else None, compra_id),
        )
        _insertar_detalles_compra(conn, compra_id, detalles)
        _sumar_stock_compra(conn, detalles)
        conn.commit()
        return {"id": compra_id, "total": total}
    finally:
        conn.close()


@app.delete("/api/compras/{compra_id}")
def eliminar_compra(compra_id: int):
    conn = get_connection()
    try:
        compra = conn.execute("SELECT id FROM compras WHERE id = ?", (compra_id,)).fetchone()
        if not compra:
            raise HTTPException(404, "Compra no encontrada")
        _revertir_compra(conn, compra_id)
        conn.execute("DELETE FROM compras WHERE id = ?", (compra_id,))
        conn.commit()
        return {"id": compra_id, "eliminado": True}
    finally:
        conn.close()


@app.get("/api/compras")
def listar_compras(desde: Optional[str] = None, hasta: Optional[str] = None,
                   limite: int = 100, offset: int = 0):
    conn = get_connection()
    try:
        sql = """
            SELECT co.id, co.total, co.notas, co.creado_en, co.proveedor_id, pr.nombre AS proveedor
            FROM compras co
            LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
            WHERE 1 = 1
        """
        params: list = []
        if desde:
            sql += " AND date(co.creado_en) >= ?"
            params.append(desde)
        if hasta:
            sql += " AND date(co.creado_en) <= ?"
            params.append(hasta)
        sql += " ORDER BY co.id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, min(limite, 5000)), max(0, offset)])
        compras = [dict(r) for r in conn.execute(sql, params).fetchall()]
        for co in compras:
            co["detalles"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT producto_id, nombre_producto, cantidad, costo_unitario FROM compra_detalles WHERE compra_id = ?",
                    (co["id"],),
                ).fetchall()
            ]
        return compras
    finally:
        conn.close()


# ---------- Caja ----------

def _resumen_caja(conn, fecha: str) -> dict:
    r = {}
    r["ventas_efectivo"] = conn.execute(
        "SELECT COALESCE(SUM(total), 0) FROM ventas "
        "WHERE metodo_pago = 'efectivo' AND date(creado_en) = ?",
        (fecha,),
    ).fetchone()[0]
    r["ventas_fiado"] = conn.execute(
        "SELECT COALESCE(SUM(total), 0) FROM ventas "
        "WHERE metodo_pago = 'fiado' AND date(creado_en) = ?",
        (fecha,),
    ).fetchone()[0]
    r["cobros_fiado"] = conn.execute(
        "SELECT COALESCE(SUM(monto), 0) FROM pagos_fiado "
        "WHERE date(creado_en) = ?",
        (fecha,),
    ).fetchone()[0]
    r["cargas_saldo"] = conn.execute(
        "SELECT COALESCE(SUM(monto), 0) FROM movimientos_saldo "
        "WHERE monto > 0 AND date(creado_en) = ?",
        (fecha,),
    ).fetchone()[0]
    r["cantidad_ventas"] = conn.execute(
        "SELECT COUNT(*) FROM ventas WHERE date(creado_en) = ?", (fecha,)
    ).fetchone()[0]
    r["cantidad_compras"] = conn.execute(
        "SELECT COUNT(*) FROM compras WHERE date(creado_en) = ?", (fecha,)
    ).fetchone()[0]
    r["compras_total"] = conn.execute(
        "SELECT COALESCE(SUM(total), 0) FROM compras WHERE date(creado_en) = ?", (fecha,)
    ).fetchone()[0]
    return r


@app.get("/api/caja/hoy")
def caja_hoy():
    conn = get_connection()
    try:
        fecha = conn.execute("SELECT date('now', 'localtime')").fetchone()[0]
        resumen = _resumen_caja(conn, fecha)
        cierre = conn.execute(
            "SELECT * FROM cierres WHERE fecha = ?", (fecha,)
        ).fetchone()
        return {
            "fecha": fecha,
            **resumen,
            "cierre": dict(cierre) if cierre else None,
        }
    finally:
        conn.close()


@app.post("/api/caja/cierres", status_code=201)
def guardar_cierre(data: CierreIn):
    if data.efectivo_contado < 0:
        raise HTTPException(400, "El efectivo contado no puede ser negativo")
    if data.fondo_inicial < 0:
        raise HTTPException(400, "El fondo inicial no puede ser negativo")
    conn = get_connection()
    try:
        fecha = conn.execute("SELECT date('now', 'localtime')").fetchone()[0]
        existente = conn.execute(
            "SELECT id FROM cierres WHERE fecha = ?", (fecha,)
        ).fetchone()
        if existente and not data.sobreescribir:
            raise HTTPException(
                400, "Ya existe un cierre para hoy. Usa 'sobreescribir' para reemplazarlo."
            )

        resumen = _resumen_caja(conn, fecha)
        esperado = round(
            data.fondo_inicial + resumen["ventas_efectivo"] + resumen["cobros_fiado"]
            + resumen["cargas_saldo"], 2
        )
        diferencia = round(data.efectivo_contado - esperado, 2)

        if existente:
            conn.execute(
                """
                UPDATE cierres SET fondo_inicial = ?, ventas_efectivo = ?, ventas_fiado = ?,
                    cobros_fiado = ?, cargas_saldo = ?, total_esperado = ?, efectivo_contado = ?,
                    diferencia = ?, notas = ?
                WHERE fecha = ?
                """,
                (data.fondo_inicial, resumen["ventas_efectivo"], resumen["ventas_fiado"],
                 resumen["cobros_fiado"], resumen["cargas_saldo"], esperado, data.efectivo_contado,
                 diferencia, data.notas.strip() if data.notas else None, fecha),
            )
        else:
            conn.execute(
                """
                INSERT INTO cierres (fecha, fondo_inicial, ventas_efectivo, ventas_fiado,
                    cobros_fiado, cargas_saldo, total_esperado, efectivo_contado, diferencia, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (fecha, data.fondo_inicial, resumen["ventas_efectivo"], resumen["ventas_fiado"],
                 resumen["cobros_fiado"], resumen["cargas_saldo"], esperado, data.efectivo_contado,
                 diferencia, data.notas.strip() if data.notas else None),
            )
        conn.commit()
        cierre = conn.execute("SELECT * FROM cierres WHERE fecha = ?", (fecha,)).fetchone()
        return dict(cierre)
    finally:
        conn.close()


@app.get("/api/caja/cierres")
def listar_cierres():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM cierres ORDER BY fecha DESC LIMIT 60"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------- Reportes ----------

@app.get("/api/reportes")
def reportes(desde: str, hasta: str):
    conn = get_connection()
    try:
        kpis = dict(conn.execute(
            """
            SELECT COUNT(*) AS cantidad_ventas,
                   COALESCE(SUM(total), 0) AS total_vendido,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'fiado' THEN total ELSE 0 END), 0) AS total_fiado,
                   COUNT(*) FILTER (WHERE metodo_pago = 'fiado') AS ventas_fiado
            FROM ventas WHERE date(creado_en) BETWEEN ? AND ?
            """,
            (desde, hasta),
        ).fetchone())
        kpis["ticket_promedio"] = (
            round(kpis["total_vendido"] / kpis["cantidad_ventas"], 2)
            if kpis["cantidad_ventas"] else 0
        )
        kpis["total_cobros"] = conn.execute(
            "SELECT COALESCE(SUM(monto), 0) FROM pagos_fiado WHERE date(creado_en) BETWEEN ? AND ?",
            (desde, hasta),
        ).fetchone()[0]
        kpis["unidades_vendidas"] = conn.execute(
            """
            SELECT COALESCE(SUM(vd.cantidad), 0) FROM venta_detalles vd
            JOIN ventas v ON v.id = vd.venta_id
            WHERE date(v.creado_en) BETWEEN ? AND ?
            """,
            (desde, hasta),
        ).fetchone()[0]

        por_dia = [dict(r) for r in conn.execute(
            """
            SELECT date(creado_en) AS fecha,
                   SUM(total) AS total,
                   SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END) AS efectivo,
                   SUM(CASE WHEN metodo_pago = 'fiado' THEN total ELSE 0 END) AS fiado
            FROM ventas WHERE date(creado_en) BETWEEN ? AND ?
            GROUP BY date(creado_en) ORDER BY fecha
            """,
            (desde, hasta),
        ).fetchall()]

        top_productos = [dict(r) for r in conn.execute(
            """
            SELECT vd.nombre_producto AS nombre,
                   SUM(vd.cantidad) AS unidades,
                   SUM(vd.cantidad * vd.precio_unitario) AS total
            FROM venta_detalles vd
            JOIN ventas v ON v.id = vd.venta_id
            WHERE date(v.creado_en) BETWEEN ? AND ?
            GROUP BY vd.nombre_producto
            ORDER BY unidades DESC LIMIT 10
            """,
            (desde, hasta),
        ).fetchall()]

        por_categoria = [dict(r) for r in conn.execute(
            """
            SELECT c.nombre AS categoria,
                   SUM(vd.cantidad * vd.precio_unitario) AS total,
                   SUM(vd.cantidad) AS unidades
            FROM venta_detalles vd
            JOIN ventas v ON v.id = vd.venta_id
            JOIN productos p ON p.id = vd.producto_id
            JOIN categorias c ON c.id = p.categoria_id
            WHERE date(v.creado_en) BETWEEN ? AND ?
            GROUP BY c.nombre ORDER BY total DESC
            """,
            (desde, hasta),
        ).fetchall()]

        por_hora = [dict(r) for r in conn.execute(
            """
            SELECT CAST(strftime('%H', creado_en) AS INTEGER) AS hora,
                   COUNT(*) AS cantidad,
                   SUM(total) AS total
            FROM ventas WHERE date(creado_en) BETWEEN ? AND ?
            GROUP BY hora ORDER BY hora
            """,
            (desde, hasta),
        ).fetchall()]

        return {
            "desde": desde,
            "hasta": hasta,
            "kpis": kpis,
            "por_dia": por_dia,
            "top_productos": top_productos,
            "por_categoria": por_categoria,
            "por_hora": por_hora,
        }
    finally:
        conn.close()


# ---------- Estáticos ----------

@app.get("/")
def raiz():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

