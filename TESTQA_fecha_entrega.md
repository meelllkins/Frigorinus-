# TESTQA — fecha de entrega por despacho

Guion de prueba manual para la funcionalidad de **despachar en una jornada para dos días de
entrega distintos**. Se corre en la app, con `codigo_cliente = 'TESTQA'`, después de haber
ejecutado `migracion_fecha_entrega.sql` en Supabase.

> **Antes de empezar:** correr la migración. Sin ella el paso 1 falla en el insert
> (`despachos.fecha_entrega` no existe) y el paso 5 falla al guardar el encabezado.

En todo el guion:
- **D** = el día en que se hace la prueba (fecha de despacho / la jornada).
- **D+1** = la entrega normal, la que el selector trae puesta.
- **D+2** = la entrega "del día después del festivo", la que se elige a mano.

---

## A. Que nada cambie cuando no se toca la fecha

El objetivo de este bloque es confirmar que un despacho sin elegir nada se comporta
**exacto** como antes de la migración.

| # | Paso | Esperado |
|---|---|---|
| A1 | Beneficios → registrar 2 reses `TESTQA-901` y `TESTQA-902` | Quedan en la lista, con sus vísceras en cava |
| A2 | Despachar `TESTQA-901` (individual) a **Cimitarra**, sin tocar "Fecha de entrega" | El selector muestra **D+1** ya puesto |
| A3 | En Supabase: `SELECT fecha_despacho, fecha_entrega FROM despachos WHERE registro_id = <id de 901>` | `fecha_despacho = D`, `fecha_entrega = D+1` |
| A4 | Documento de ruta, selector en **D** | Un solo bloque Cimitarra, encabezado "…D+1", **sin** la franja verde de entrega ni el aviso de "2 fechas de entrega" |
| A5 | Exportar a Excel | Un solo libro con **una** hoja, nombrada con el día/mes de **D+1** |

> A4/A5 son la prueba de no-regresión: si aparece la franja o una segunda hoja con un solo
> día de entrega, algo está partiendo de más.

---

## B. Dos entregas en una jornada

| # | Paso | Esperado |
|---|---|---|
| B1 | Despachar `TESTQA-902` (individual) a **Cimitarra**, cambiando "Fecha de entrega" a **D+2** | Aparece el aviso ámbar "Sale en un documento de ruta aparte…" |
| B2 | `SELECT fecha_entrega FROM despachos WHERE registro_id = <id de 902>` | `D+2` |
| B3 | Documento de ruta, selector en **D** | **Dos** grupos, cada uno con su franja verde: "Entrega …D+1" y "Entrega …D+2". `901` en el primero, `902` en el segundo |
| B4 | Arriba aparece el texto "Esta jornada tiene 2 fechas de entrega…" | Sí |
| B5 | Exportar a Excel | **Un** libro con **dos** hojas, nombradas con el día/mes de D+1 y de D+2 |

---

## C. Encabezados independientes (el choque de `documentos_ruta`)

Esto es lo que la migración de `documentos_ruta` viene a resolver: las dos Cimitarra son
dos camiones distintos.

| # | Paso | Esperado |
|---|---|---|
| C1 | En el bloque Cimitarra de **D+1**: conductor `QA UNO`, placa `AAA111` | Se guardan (esperar ~1s o hacer blur) |
| C2 | En el bloque Cimitarra de **D+2**: conductor `QA DOS`, placa `BBB222` | Se guardan |
| C3 | Refrescar con "Actualizar" | `QA UNO`/`AAA111` sigue en el de D+1 y `QA DOS`/`BBB222` en el de D+2; **no se pisan** |
| C4 | `SELECT fecha, fecha_entrega, ruta, carro_id, conductor, placa FROM documentos_ruta WHERE fecha = 'D' AND ruta = 'Cimitarra'` | **Dos** filas, misma `fecha` y mismo `carro_id` (`''`), distinta `fecha_entrega` |
| C5 | En el Excel, cada hoja lleva su propio conductor y placa | Sí |

> Si C3 muestra el mismo conductor en los dos bloques, el `UNIQUE` nuevo no quedó aplicado:
> revisar el paso 3 de la migración.

---

## D. Cimitarra — el maestro por día (el punto delicado)

El maestro de `secuencia_entrega` de Cimitarra tiene filas para `LUNES` y para `JUEVES`, y
esos son días de **entrega**. Antes el día se deducía de `fecha_despacho + 1`; ahora sale de
`fecha_entrega`.

Para que esta prueba diga algo hay que elegir un **D** tal que D+1 y D+2 caigan en dos días
con maestro distinto, o al menos en dos días distintos.

| # | Paso | Esperado |
|---|---|---|
| D1 | Elegir D = **domingo** → D+1 = lunes, D+2 = martes | — |
| D2 | Despachar un TESTQA a Cimitarra con entrega **D+1 (lunes)** | En el documento, ese código sale ordenado por el maestro de **LUNES** |
| D3 | Despachar otro TESTQA a Cimitarra con entrega **D+2 (martes)** | Sale en el segundo documento; como no hay maestro de MARTES, cae en "sin orden asignado" y aparece el aviso `[entrega D+2] Cimitarra: el código TESTQA…` |
| D4 | Asignar un orden desde la tabla del documento de **D+1** | `SELECT ruta, dia, codigo, secuencia FROM secuencia_entrega WHERE codigo = 'TESTQA'` → `dia = 'LUNES'` |
| D5 | Asignar un orden desde la tabla del documento de **D+2** | Se inserta una fila aparte con `dia = 'MARTES'`, **no** pisa la de LUNES |

> D4 es la regresión importante: antes de este cambio, editar la secuencia desde el documento
> escribía el día deducido de `fecha_despacho + 1`. Con dos documentos en la jornada, el
> segundo habría escrito la fila en el día del primero.

---

## E. Herencia en vísceras

Las vísceras heredan la `fecha_entrega` de su canal, igual que ya heredaban ruta, destino y
dirección.

| # | Paso | Esperado |
|---|---|---|
| E1 | Individual: despachar `TESTQA-903` con "Despachar selección" (canal + vísceras), entrega **D+2** | — |
| E2 | `SELECT tipo_despacho, fecha_entrega FROM despachos WHERE registro_id = <id de 903>` | **Todas** las filas (canal y vísceras) con `fecha_entrega = D+2` |
| E3 | En el documento, el código sale en **una sola línea** del documento de D+2, con su CANT y sus V/B y V/R | Sí — si la víscera cayera en otro documento, el código saldría partido |
| E4 | Múltiple: seleccionar 2 TESTQA, despachar a **Externo** con entrega **D+2**, y en el modal siguiente marcar sus vísceras | Canal y vísceras del lote, todas con `fecha_entrega = D+2` y el **mismo** `carro_id` |
| E5 | El carro externo sale completo en el documento de D+2 | Sí, un solo bloque |

---

## F. Reset del selector

| # | Paso | Esperado |
|---|---|---|
| F1 | Después de un despacho con entrega D+2, abrir el modal de despacho de otro animal | El selector vuelve a **D+1** (la entrega normal), no arrastra el D+2 |

---

## G. Archivado

| # | Paso | Esperado |
|---|---|---|
| G1 | Con filas TESTQA de más de 15 días (o forzando `fecha_despacho` a una fecha vieja en Supabase), entrar a Despachos para disparar el archivado | Las filas pasan a `despachos_archivo` |
| G2 | `SELECT fecha_despacho, fecha_entrega FROM despachos_archivo WHERE registro_id IN (...)` | `fecha_entrega` conservada, **no** NULL |

---

## Limpieza (orden FK obligatorio)

`despachos` → `inventario_visceras` → `registros_beneficio`. Al revés falla por llave foránea.

```sql
-- 1) Despachos de TESTQA (activos y archivados)
DELETE FROM despachos
 WHERE registro_id IN (SELECT id FROM registros_beneficio WHERE codigo_cliente = 'TESTQA');

DELETE FROM despachos_archivo
 WHERE registro_id IN (SELECT id FROM registros_beneficio WHERE codigo_cliente = 'TESTQA');

-- 2) Vísceras de TESTQA
DELETE FROM inventario_visceras
 WHERE registro_id IN (SELECT id FROM registros_beneficio WHERE codigo_cliente = 'TESTQA');

-- 3) Los animales
DELETE FROM registros_beneficio WHERE codigo_cliente = 'TESTQA';

-- 4) Encabezados de prueba del documento de ruta (poner la fecha D de la prueba)
DELETE FROM documentos_ruta
 WHERE fecha = 'AAAA-MM-DD'
   AND conductor IN ('QA UNO', 'QA DOS');

-- 5) Secuencias de prueba (pasos D4/D5)
DELETE FROM secuencia_entrega WHERE codigo = 'TESTQA';

-- 6) Verificación: las cinco consultas tienen que dar 0
SELECT
  (SELECT COUNT(*) FROM registros_beneficio WHERE codigo_cliente = 'TESTQA')        AS registros,
  (SELECT COUNT(*) FROM inventario_visceras iv
     JOIN registros_beneficio rb ON rb.id = iv.registro_id
    WHERE rb.codigo_cliente = 'TESTQA')                                             AS visceras,
  (SELECT COUNT(*) FROM despachos d
     JOIN registros_beneficio rb ON rb.id = d.registro_id
    WHERE rb.codigo_cliente = 'TESTQA')                                             AS despachos,
  (SELECT COUNT(*) FROM secuencia_entrega WHERE codigo = 'TESTQA')                  AS secuencias,
  (SELECT COUNT(*) FROM documentos_ruta WHERE conductor IN ('QA UNO','QA DOS'))     AS encabezados;
```
