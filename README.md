# CyC - Sistema de Gestión de Cantina

Aplicación web local para administrar una cantina escolar: ventas rápidas, fiado,
inventario con proveedores, caja con cierre diario, reportes con gráficos e historial.

## Funcionalidades

- **Venta**: grilla de productos por categoría, buscador, modo de venta rápida
  (un clic = una venta), carrito, cobro en efectivo, fiado y saldo a favor.
- **Productos**: alta/edición/desactivación de productos y categorías, fotos,
  control de stock opcional (stock actual y mínimo).
- **Clientes / Fiado / Saldo a favor**: clientes con tipo (estudiante/profesor) y
  curso. Fiado con deuda pendiente y cobros parciales (FIFO a las deudas más
  antiguas). Saldo a favor prepago: se carga dinero a un cliente (ej. un padre
  adelanta el mes) y las ventas descuentan de ese saldo.
- **Inventario / Proveedores**: registro de compras (suman stock), asociación de
  productos a proveedores, alertas de stock bajo/agotado y último costo por producto.
- **Caja**: resumen del día, arqueo y cierre diario (fondo inicial, ventas en
  efectivo, cobros de fiado, cargas de saldo, efectivo contado y diferencia).
- **Reportes**: KPIs y gráficos de ventas por día, productos más vendidos,
  ventas por categoría y horas pico (Chart.js local, funciona sin internet).
- **Historial**: listado completo de ventas y compras por rango de fechas, con
  paginación, edición y eliminación de movimientos (revierte stock, deuda y saldo)
  y exportación a CSV.
- **Exportación**: Reportes e Historial se pueden descargar en CSV (abre en Excel).

## Requisitos

- Python 3.11 o superior (probado con 3.13)
- Windows para usar `iniciar.bat` (en otros sistemas correr `python app.py`)

## Instalación

```bash
pip install -r requirements.txt
```

## Uso

En Windows, doble clic en `iniciar.bat` (levanta el servidor y abre el navegador).

O manualmente:

```bash
python app.py
```

Luego abrir en el navegador: http://localhost:8000

## Estructura

```
app.py                  API y servidor (FastAPI)
database.py             Esquema SQLite, migraciones y conexión
iniciar.bat             Arranque en Windows
requirements.txt        Dependencias
static/
  index.html / app.js        Pantalla de venta
  productos.html / .js       Productos y categorías
  clientes.html / .js        Clientes y fiado
  inventario.html / .js      Inventario, compras y proveedores
  caja.html / .js            Caja y cierre diario
  reportes.html / .js        Reportes y gráficos
  historial.html / .js       Historial de ventas y compras
  style.css                  Estilos compartidos
  chart.umd.min.js           Chart.js (local, sin internet)
data/
  cantina.db              Base de datos (generada automáticamente)
```

## Datos

La base de datos SQLite se crea sola en `data/cantina.db` al iniciar por primera vez.
No se sube al repositorio (ver `.gitignore`). Para respaldar, copiá ese archivo.

## Notas

- No tiene login: está pensado para un único usuario (uso local).
- La moneda se define con la constante `MONEDA` en cada archivo JS (por defecto `$`).
