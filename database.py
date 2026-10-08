import sqlite3
from pathlib import Path

DB_DIR = Path(__file__).parent / "data"
DB_PATH = DB_DIR / "cantina.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    imagen TEXT,
    stock_actual INTEGER,
    stock_minimo INTEGER,
    proveedor_id INTEGER REFERENCES proveedores(id),
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    metodo_pago TEXT NOT NULL DEFAULT 'efectivo',
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS venta_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL REFERENCES ventas(id),
    producto_id INTEGER REFERENCES productos(id),
    nombre_producto TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unitario REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'estudiante',
    curso TEXT,
    telefono TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS deudas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    venta_id INTEGER REFERENCES ventas(id),
    total REAL NOT NULL,
    saldo REAL NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pagos_fiado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deuda_id INTEGER NOT NULL REFERENCES deudas(id),
    monto REAL NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER REFERENCES proveedores(id),
    total REAL NOT NULL,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS compra_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL REFERENCES compras(id),
    producto_id INTEGER REFERENCES productos(id),
    nombre_producto TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    costo_unitario REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cierres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL UNIQUE,
    fondo_inicial REAL NOT NULL DEFAULT 0,
    ventas_efectivo REAL NOT NULL,
    ventas_fiado REAL NOT NULL,
    cobros_fiado REAL NOT NULL,
    total_esperado REAL NOT NULL,
    efectivo_contado REAL NOT NULL,
    diferencia REAL NOT NULL,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SEED_CATEGORIAS = [
    "Bebidas",
    "Snacks",
    "Empanadas",
    "Sándwiches",
]

SEED_PRODUCTOS = [
    (1, "Agua 600ml", 50),
    (1, "Gaseosa 500ml", 100),
    (1, "Jugo natural", 150),
    (2, "Papas fritas", 80),
    (2, "Galletas", 50),
    (2, "Golosinas", 30),
    (3, "Empanada de carne", 120),
    (3, "Empanada de pollo", 120),
    (4, "Sándwich de jamón y queso", 180),
]


def get_connection() -> sqlite3.Connection:
    DB_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        columnas = [r[1] for r in conn.execute("PRAGMA table_info(productos)").fetchall()]
        if "imagen" not in columnas:
            conn.execute("ALTER TABLE productos ADD COLUMN imagen TEXT")
        if "stock_actual" not in columnas:
            conn.execute("ALTER TABLE productos ADD COLUMN stock_actual INTEGER")
        if "stock_minimo" not in columnas:
            conn.execute("ALTER TABLE productos ADD COLUMN stock_minimo INTEGER")
        if "proveedor_id" not in columnas:
            conn.execute("ALTER TABLE productos ADD COLUMN proveedor_id INTEGER REFERENCES proveedores(id)")
        if "costo" in columnas:
            try:
                conn.execute("ALTER TABLE productos DROP COLUMN costo")
            except Exception:
                pass
        conn.commit()
    finally:
        conn.close()
