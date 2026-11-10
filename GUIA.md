# Guía de uso: menú principal

El menú superior tiene cuatro botones: **Altas**, **Genesis**, **Comparar con Genesis** y **Subir planilla**.

| Botón | Para qué sirve | Fuente de datos |
|---|---|---|
| Altas | Buscar las instalaciones reportadas por los asesores | Planilla de ventas (.xlsx) |
| Genesis | Buscar las altas realizadas registradas en el sistema Genesis | Archivo Genesis (.mht) |
| Comparar con Genesis | Detectar diferencias entre lo que reportan los asesores y lo que Genesis registra | Ambas |
| Subir planilla | Cargar o actualizar la planilla de ventas | Archivo .xlsx |

---

## 1. Altas

Lista de todas las instalaciones de la planilla de ventas (una fila por cuenta).

**Qué muestra:** cuenta, fecha de instalación, nombre, teléfonos y email, hoja (mes) de origen, cobros por mes y total cobrado.

**Filtros disponibles**
- **Búsqueda libre:** nombre, número de cuenta, teléfono o email. Todas las palabras escritas deben aparecer. No distingue mayúsculas ni tildes.
- **Instalación desde / hasta:** rango de fechas.
- **Hoja:** mes de la planilla (ABRIL, MAYO, etc.).
- **Periodo:** mes de cobro (por ejemplo 2026-09).
- **Cobro:** con cobro / sin cobro (si se elige un periodo, se aplica a ese periodo).
- **Monto ≥ / ≤:** rango de monto de algún cobro.
- **Sin contacto:** clientes sin teléfono ni email.

**Otras acciones:** ordenar haciendo clic en el título de una columna, paginar, **Limpiar** filtros y **Exportar CSV** (descarga el resultado filtrado completo).

**Casos de uso típicos**
- Encontrar un cliente por nombre o teléfono.
- Ver quién instaló en una semana determinada.
- Detectar clientes instalados que aún no tienen cobro en un periodo.
- Sacar un listado de clientes sin datos de contacto.

---

## 2. Genesis

Lista de las altas realizadas según el sistema Genesis. Tiene las mismas funciones de búsqueda que Altas, adaptadas a los datos de Genesis.

**Qué muestra:** cuenta, fecha de alta, nombre, carnet, solicitud, reserva, plan, dirección de referencia y una columna **Planilla** que indica si esa cuenta existe en la planilla de ventas (y en qué hoja).

**Filtros disponibles**
- **Búsqueda libre:** nombre, cuenta, carnet, solicitud, reserva o dirección.
- **Alta desde / hasta:** rango de fechas.
- **Plan:** por ejemplo PX600, PX701 (muestra cuántas altas tiene cada plan).
- **En planilla:** *Sí figura* / *No figura*.

**Otras acciones:** ordenar por columna, paginar, **Limpiar**, **Exportar CSV** y **Subir Genesis (.mht)**.

**Cómo cargar los datos de Genesis**
1. Entra a la página *Altas realizadas* de Genesis.
2. Guarda la página como archivo: Ctrl+S → "Página web, un solo archivo (.mht)".
3. En esta pestaña pulsa **Subir Genesis (.mht)**, elige el archivo y pulsa **Importar**.

Re-subir el mismo archivo, o uno más nuevo, actualiza por número de cuenta y no duplica registros.

**Casos de uso típicos**
- Buscar un cliente por carnet, solicitud o reserva.
- Ver cuántas altas hay por plan.
- Listar las altas de Genesis que no figuran en la planilla.

---

## 3. Comparar con Genesis

Cruza la planilla de ventas con Genesis para encontrar diferencias. Se cruza primero por **número de cuenta**; si no coincide, se busca el **mismo nombre** (las palabras pueden estar en otro orden).

**Estados del resultado**

| Estado | Significado | Qué hacer |
|---|---|---|
| Coinciden | Misma cuenta, fecha y nombre en ambas fuentes | Nada |
| Difiere | Misma cuenta, pero cambia la fecha o el nombre | Revisar cuál dato es el correcto |
| Posible coincidencia | Mismo nombre pero cuenta distinta | Verificar si es la misma venta mal registrada |
| Solo en Genesis | Alta realizada que no figura en la planilla | Alta no reportada por el asesor: completar la planilla |
| Solo en planilla | Venta reportada que no figura en Genesis | Verificar si la instalación realmente se hizo |
| Fuera de rango | Solo existe en una fuente y su fecha cae fuera del periodo que cubre la otra | No es necesariamente un error: falta cargar datos de ese periodo |

**Importante:** en la parte superior se muestra el periodo cubierto por la planilla y por Genesis. Si los periodos no se superponen, casi todo saldrá como "Fuera de rango". Para una comparación útil, carga datos de ambas fuentes para las mismas fechas.

**Filtros:** estado (botones con conteo), búsqueda por cuenta, nombre o carnet, y rango de fechas. También permite **Exportar CSV** del resultado.

---

## 4. Subir planilla

Carga la planilla de ventas de instalaciones (.xlsx) a la base de datos. Solo se muestra en la pestaña **Altas**.

**Cómo funciona**
1. Pulsa **Subir planilla** y elige uno o varios archivos .xlsx.
2. Se muestra una vista previa: cuántas altas se detectaron por hoja.
3. Pulsa **Importar**.

**Formato esperado:** una hoja por mes con las columnas `CTA_CUENTA_DES`, `FECHA_INSTALACION`, `NOMBRE_COMPLETO`, `CL_MEDIO_CONTACTO`, `CL_MEDIO_CONTACTO_2` y luego una columna por cada mes de cobro. Las hojas vacías se ignoran.

**Re-subir es seguro:** si subes de nuevo el mismo archivo (o una versión actualizada), se actualiza por número de cuenta y no se duplican registros. Los cobros nuevos se agregan y los existentes se actualizan.

---

## Flujo de trabajo recomendado

1. **Subir planilla** con las ventas de los asesores.
2. En **Genesis**, subir el .mht más reciente.
3. En **Comparar con Genesis**, revisar primero *Solo en Genesis* y *Solo en planilla*, luego *Difiere* y *Posible coincidencia*.
4. Exportar a CSV lo que haya que corregir o reclamar.
5. Repetir periódicamente; la carga es incremental.

> Los datos incluyen información personal de clientes (nombres, carnets, teléfonos). Mantén el acceso protegido (Cloudflare Access) cuando la app esté publicada.
