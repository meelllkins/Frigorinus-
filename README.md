<div align="center">

# 🥩 Frigorinus

### Logística de planta frigorífica — PWA

*Control de beneficio, despacho, inventario de vísceras y documentos de ruta, en una sola app instalable.*

[![Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB%20%2B%20RLS%20por%20rol-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-autoUpdate-5A0FC8?logo=pwa&logoColor=white)](https://vite-pwa-org.netlify.app)
[![Deploy](https://img.shields.io/badge/Vercel-live-000000?logo=vercel&logoColor=white)](https://frigorinus.vercel.app)

**🌐 [frigorinus.vercel.app](https://frigorinus.vercel.app)** &nbsp;·&nbsp; **📦 `meelllkins/Frigorinus-`**

</div>

---

> [!NOTE]
> Este README refleja el estado del proyecto tras la incorporación de **Remisiones** (digitalización del formato de papel, con folio por hoja física), el **sistema de roles y RLS por comando** (`admin`/`remisiones`), la restauración del **logo con la paleta de marca** (verde lima, teal, dorado) sobre encabezado claro, la tipografía **Inter**, y el fix de la **fila fantasma del adelanto puro de vísceras**. Algunos nombres exactos de columnas/funciones provienen de las notas de desarrollo y conviene confirmarlos contra el código antes de tratarlos como contrato estable.

---

## Tabla de contenidos

- [¿Qué resuelve Frigorinus?](#qué-resuelve-frigorinus)
- [Conceptos del negocio](#conceptos-del-negocio)
- [Módulos y navegación](#módulos-y-navegación)
- [El flujo, de principio a fin](#el-flujo-de-principio-a-fin)
- [Funcionalidades destacadas](#funcionalidades-destacadas)
  - [Media canal (0.5)](#media-canal-05)
  - [Secuencia de entrega en el documento de ruta](#secuencia-de-entrega-en-el-documento-de-ruta)
  - [Carros externos independientes](#carros-externos-independientes)
  - [Direcciones de despacho nacional](#direcciones-de-despacho-nacional)
  - [Adelanto de vísceras](#adelanto-de-vísceras)
  - [Remisiones](#remisiones)
- [Arquitectura](#arquitectura)
- [Modelo de datos](#modelo-de-datos)
- [Instalación y uso](#instalación-y-uso)
- [Variables de entorno](#variables-de-entorno)
- [Scripts](#scripts)
- [Migraciones SQL](#migraciones-sql)
- [Convenciones de desarrollo](#convenciones-de-desarrollo)
- [PWA](#pwa)
- [Reset de datos](#reset-de-datos-acción-destructiva)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Pendientes y hoja de ruta](#pendientes-y-hoja-de-ruta)

---

## ¿Qué resuelve Frigorinus?

Frigorinus acompaña el trabajo diario de una planta frigorífica desde que el animal se beneficia hasta que sale despachado en un carro con su documento de ruta. Reemplaza el trabajo manual en Excel por un flujo donde el operario registra el beneficio, despacha canales (enteras o media), adelanta vísceras, y la app arma sola el documento de ruta — ya ordenado por la secuencia de entrega de cada región y con las direcciones de los despachos nacionales incluidas.

El objetivo de diseño es que lo que antes se copiaba y ordenaba a mano en varias hojas de cálculo, ahora salga generado y consistente: un solo lugar donde despachar, y el documento de ruta como resultado automático.

---

## Conceptos del negocio

Entender estos términos hace que el resto del README (y el código) tenga sentido:

| Término | Qué significa |
|---|---|
| **Canal** | El cuerpo del animal beneficiado. Se despacha entero (`1`) o en **media canal** (`0.5`). |
| **Raya** | Cada animal individual dentro de un código. En el sistema, una fila de `despachos` = una raya = un animal (`numero_animal`). |
| **Código (cliente)** | Identificador del cliente/destino. Un código puede llevar varias rayas, y puede repartirse entre rutas o direcciones. |
| **Ruta** | El recorrido de entrega. Hay rutas **regionales con secuencia**, rutas **sin secuencia** (las ordena el cliente), **Nacional** y **Externo**. |
| **Secuencia** | El orden de entrega dentro de una ruta regional. Cada código tiene una posición fija; el documento se ordena de menor a mayor. |
| **Carro externo** | Cuando un cliente manda su propio camión. Cada acto de despacho a Externo es un carro independiente. |
| **Adelanto de vísceras** | Las vísceras (roja, blanca, cabeza, patas) se pueden despachar antes que la canal, para que no se dañen. Por eso el conteo de vísceras puede superar al de canales. |

---

## Módulos y navegación

| Ruta | Módulo | Rol |
|---|---|---|
| `/login` | **Acceso** | Autenticación Supabase (email/contraseña). |
| `/` | **Inventario Actual** *(Beneficios)* | Pantalla principal: registro de beneficio y despacho de canales. |
| `/cobros` | **Cobros de Frío** | Cobro por permanencia en cava. |
| `/inventario` | **Vísceras** | Inventario y adelanto de vísceras. |
| `/despachos` | **Despachos** | Historial, revert y archivado de despachos. |
| `/notas` | **Notas** | Anotaciones libres. |
| `/documento` | **Documento de ruta** | Documento generado: tablas por ruta, ya ordenadas por secuencia, con direcciones nacionales y bloques de carro externo. Exportable a Excel. |
| `/remisiones` | **Remisiones** | Digitaliza el formato de papel "REMISIÓN DE SALIDA DE DESPACHOS", con folio por hoja física. Accesible por **ambos roles** (`admin` y `remisiones`) — ver [Remisiones](#remisiones). |

Navegación por barra superior tipo *tab bar*; el `Layout` es el shell con header (Resetear · Instalar app · Salir) y `<Outlet />`. Fuera de `/remisiones`, el rol `remisiones` ve las demás pantallas normalmente pero no puede escribir en ellas: al primer clic dentro del contenido aparece un aviso "Solo lectura" (ver [Remisiones](#remisiones)).

---

## El flujo, de principio a fin

```
  ┌──────────────┐     ┌──────────────┐     ┌────────────────────┐
  │  BENEFICIO   │────▶│   DESPACHO   │────▶│  DOCUMENTO DE RUTA │
  │              │     │              │     │                    │
  │ registrar    │     │ canal 1/0.5  │     │ ordenado por       │
  │ animal       │     │ víscera      │     │ secuencia          │
  │ (raya)       │     │ ruta/destino │     │ + direcciones nac. │
  └──────────────┘     │ dirección    │     │ + carros externos  │
                       └──────────────┘     └─────────┬──────────┘
                                                       │
                                                       ▼
                                              ┌────────────────┐
                                              │  EXPORTAR XLSX │
                                              └────────────────┘
```

1. **Beneficio** — se registra cada animal (raya) en `registros_beneficio`.
2. **Despacho** — el operario despacha canal entera o media, elige ruta y, si es Nacional, la dirección; puede adelantar vísceras. Cada raya genera una fila en `despachos`.
3. **Documento de ruta** — la app agrupa por ruta y código, ordena las rutas regionales por su secuencia de menor a mayor, incrusta las direcciones de los despachos nacionales, y separa cada carro externo en su propio bloque.
4. **Exportar** — el documento sale a Excel respetando la geometría (bloques lado a lado, columnas de cantidad, direcciones al costado del código).

---

## Funcionalidades destacadas

### Media canal (0.5)

Un canal ya no es todo-o-nada. Se puede despachar **la mitad** y que la otra quede en cava.

- La cantidad se registra como **`0.5`**, no como `1` con nota.
- Cada mitad lleva su **propia ruta y código destino** — la segunda mitad puede salir otro día, a otro cliente.
- El inventario muestra un **badge naranja "Media canal (0.5)"** mientras al animal le quede mitad pendiente.
- Dos acumuladores lo respaldan: `despachos.fraccion` (lo que salió en ese despacho) y `registros_beneficio.fraccion_despachada` (lo acumulado del animal). El segundo **sobrevive al archivado**, así que un animal partido no “vuelve a verse entero” cuando su primer despacho se archiva a los 15 días.
- Fracciones binarias exactas: `0.5 + 0.5 === 1`, sin deriva de coma flotante.

> En el documento, una media canal aparece como `155-2 MEDIA CANAL DE RES`, con `PARA COD X` si va a otro código — idéntico al Excel original de planta.

### Secuencia de entrega en el documento de ruta

Cada ruta regional tiene un **orden de entrega fijo**. El documento se ordena solo, de menor a mayor, sin pasos manuales.

- Rutas **con secuencia** (las 10 regionales, `RUTAS_CON_SECUENCIA` en `secuenciaEntrega.ts`): Remedios/Segovia, Cimitarra, Yalí/Vegachí, San José/Maceo, Caracolí/Cristales, Yolombó, Puerto Berrío, Cisneros/San Roque, Don Matías, Gómez Plata.
- Rutas **sin secuencia por diseño** (nunca avisan ni preguntan por un orden): **Nacional**, **Barbosa**, **Externo**.
- **Cimitarra** es especial: lleva **doble secuencia**, una para entrega de **lunes** y otra para **jueves** — resuelta contra `fecha_entrega`, no contra la fecha de despacho (Rafa puede corregir el día de entrega con el selector si el `+1` por defecto no aplica, p. ej. víspera de festivo).
- La lógica replica en código el `VLOOKUP + ordenar` que antes se hacía en Excel, contra una tabla maestra persistida (`secuencia_entrega`). El matcheo de códigos es tolerante a ceros a la izquierda (`'04'` = `'4'`).
- El ordenamiento se aplica **dentro de las tablas del documento**; si el código lleva `PARA COD X`, se ordena por el **destino**, no por el código de origen.

### Carros externos independientes

Cuando un cliente manda su propio camión, cada despacho a **Externo** es un **carro aparte**.

- Un bloque "EXTERNO" **por acto de despacho** — no se agrupan por cliente ni por destino. Dos externos al mismo destino siguen siendo dos carros.
- El carro se identifica por un `carro_id` explícito (`despachos.carro_id`, UUID generado por el frontend); los despachos viejos sin esa columna se infieren por `created_at` de siempre (un despacho múltiple de 50 cerdos es un solo carro; dos despachos separados del mismo código son dos carros).
- Las vísceras heredan el carro de su canal, así no se parte un carro en varias cajas.
- Conductor · Auxiliar · Placa · Hora ya son **independientes por carro**: `documentos_ruta` tiene su propio `carro_id` (TEXT, `''` para rutas con nombre) y el `UNIQUE` es `(fecha, ruta, carro_id)` — la limitación de compartir encabezado entre carros externos del mismo día quedó resuelta (`migracion_externo_por_carro.sql`).

### Direcciones de despacho nacional

Solo en la ruta **Nacional**, cada raya puede llevar su **dirección de entrega**, elegida de un catálogo que se llena solo.

- Al despachar nacional, la app ofrece las direcciones ya guardadas del código; se confirma o se edita, sin reescribir cada vez.
- **Reparto por raya**: un código con varias direcciones (el caso real es el **355**, en res) puede repartir sus rayas entre distintas direcciones en un mismo despacho — raya 1 a una dirección, raya 2 a otra. Aparece un check *"Repartir entre varias direcciones"* solo cuando el código tiene ≥2 direcciones y ≥2 rayas.
- Se guarda el **texto** de la dirección en el despacho (no un FK), para que un documento viejo siga diciendo lo que decía ese día aunque el catálogo cambie — y para que sobreviva al archivado.
- En el documento, un código repartido en 3 direcciones sale como **3 líneas** (`código — dirección — cantidad`); en el Excel, la dirección va al costado del código.
- Las vísceras **heredan la dirección** de la canal de su animal, para no separarse de su raya.

### Adelanto de vísceras

Las vísceras se pueden despachar **antes** que la canal. Esto hace que, en el documento:

- **COD** y **CANT** cuentan **solo canales** (una raya sin canal no aparece en COD).
- **V/B, V/R, CABEZA, PATAS** suman **todas** las vísceras del grupo, incluidas las de animales que aún no despacharon canal — siempre que el grupo tenga al menos una canal para fusionarse (ver el punto siguiente).
- **Adelanto puro** (un código sin NINGUNA canal despachada ese día, o cuyas vísceras no logran fusionarse con la fila de su canal): **no genera fila en la tabla principal**, ni con `CANT = 0` ni con el código pelado. Se comunica **solo** por una línea de observación al pie del bloque de ruta ("ENVIAR N PAQ DE VISCERAS DE ADELANTO COD X-1-2 PARA COD Y"), armada por `lineasDeAdelanto()` (`adelantoVisceras.ts`) y persistida por el RPC `documento_ruta_agregar_observacion` (`migracion_observacion_adelanto.sql`). Filtro en `armarDocumento()`: un grupo con `despachoIdsCanal` vacío se descarta antes de convertirse en fila.
- La fusión con la fila del canal depende de que el destino, el desposte, la media canal, la dirección (Nacional) y el carro (Externo) coincidan — todo eso se hereda por `registro_id` desde el canal del mismo animal. Si la canal de ese código lleva desposte, es media canal, tiene dirección o va por Externo, y el animal adelantado no tiene canal propia, no hay de quién heredar y el grupo queda separado (se suprime, no aparece como fantasma). Es la extensión del fix original, que solo cubría el destino ambiguo dentro de un mismo grupo.
- ⚠️ **Trade-off abierto:** cuando el grupo de adelanto puro se suprime, sus V/B y V/R **no se suman en ninguna fila** de la tabla (si la fusión funciona, sí se cuentan, como manda la regla). Sigue sin decidirse si conviene heredar también desposte/media canal/dirección/carro por código para forzar siempre la fusión y no perder ese conteo — ver [Pendientes](#pendientes-y-hoja-de-ruta).

> Las cinco columnas de cantidad, en orden: **canal · víscera roja · víscera blanca · cabeza · patas**. (Patas ≈ 4× canales por res.)

### Remisiones

Digitaliza el formato de papel **"REMISIÓN DE SALIDA DE DESPACHOS"** que Rafa llena a mano por cada camión: cliente, producto, Und/Kg, canastillas, destino, firma de recibido por fila, fila TOTAL (Und/Kg se suma solo; canastillas es texto libre) y las dos firmas (responsable de planta / conductor). Toda celda es texto libre — nada se parsea como número — y el módulo (`src/lib/remisiones.ts`, `src/pages/Remisiones.tsx`) no lee ni escribe `despachos` ni `documentos_ruta`: es una sección aparte, sin auto-llenado.

- **Folio por hoja física, reservado al CREAR (no al imprimir).** Cada hoja que Rafa arranca del talonario es un folio distinto. El RPC `remision_crear_con_folio` (`SQL's/migracion_folios_remision.sql`) calcula cuántas hojas necesita la remisión y avanza un contador único (`contador_folios`, fila singleton con `FOR UPDATE` para serializar creaciones simultáneas) esa misma cantidad, todo en una transacción junto con el insert del encabezado y las filas. El rango `[folio_inicio, folio_inicio + hojas_reservadas - 1]` queda fijo en `remisiones.hojas_reservadas` y **no se recalcula nunca** — ni al editar ni al reimprimir.
- **Editar sin cambiar el folio.** `remision_reemplazar_filas` (RPC, `SQL's/migracion_remisiones_reemplazar_filas.sql`) borra e inserta las filas en una sola transacción. Si la edición necesitaría **más hojas que las reservadas**, se rechaza por completo (no se reasigna el rango: los folios siguientes ya se los llevó otra remisión) con el aviso "ya tiene N hojas reservadas — para más filas, creá una remisión nueva". Quitar filas sí se permite y deja hojas reservadas sin usar.
- **Candado por fecha:** solo se puede editar o borrar la remisión del **mismo día** en que se creó (`puedeEditarse()`); pasado ese día queda archivada tal cual, igual que el papel no se reescribe una semana después.
- **Impresión vertical**, carta (`size: letter portrait`, margen 0.6cm) — antes era apaisada. `FILAS_POR_HOJA = 8` (`src/lib/remisiones.ts`), medido imprimiendo la plantilla real a PDF headless con el peor caso (las 6 columnas envueltas a dos líneas en todas las filas): 8 filas entran con margen, la 9ª se pasa. El mismo número vive **duplicado** en el RPC de arriba — si vuelve a cambiar, hay que tocar los dos lados o la reserva de folios deja de coincidir con lo que sale en papel. El documento arma cada hoja completa a mano (encabezado + hasta 8 filas + TOTAL + firmas, con salto de página forzado entre bloques): Chromium deja de repetir un `<thead>`/`<tfoot>` cuando el grupo repetido supera ~4cm, y el encabezado completo mide ~7,6cm.
- **Roles:** `admin` (Rafa) tiene acceso total a toda la app. `remisiones` (la cuenta operativa de despacho) solo puede crear/editar/borrar remisiones — las policies de RLS de `remisiones` y `remisiones_filas` son las únicas que aceptan `rol_actual() IN ('admin', 'remisiones')` para escribir; el resto de las tablas solo aceptan `'admin'`. Fuera de `/remisiones`, el rol `remisiones` ve las pantallas normalmente (el `SELECT` queda abierto para cualquier autenticado) pero al primer clic dentro del contenido aparece blur + el modal "Solo lectura. Tienes que ser usuario principal (Rafa) para modificar este espacio." (`ContenidoBloqueado` en `Layout.tsx`). El rol se resuelve una vez por sesión vía RPC `mi_rol()` y es *fail-open* a `admin` si la llamada falla — el candado real vive en las policies, no en el frontend.

---

## Arquitectura

**Entry point** — `src/main.tsx`: monta React con `createRoot`, envuelve en `BrowserRouter`, carga `index.css`.

**Sesión y ruteo** — `src/App.tsx`: consulta `supabase.auth.getSession()`, se suscribe a `onAuthStateChange`. Sin sesión → `/login`; con sesión → `Layout` + rutas internas.

**Shell** — `src/components/Layout.tsx`: header (Resetear · Instalar/Añadir a inicio · Salir), barra de módulos, detección iOS/Android + `beforeinstallprompt`, render por `<Outlet />`.

**Supabase** — `src/lib/supabase.ts`: cliente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

**Roles** — `src/lib/rol.tsx`: `RolProvider`/`useRol()`, resuelve `admin`/`remisiones` una vez por sesión (RPC `mi_rol()`), *fail-open* a `admin`. `Layout.tsx` lo consume para el wrapper de solo-lectura fuera de `/remisiones`.

**Lógica de documento** — el corazón del negocio vive en:

| Archivo | Responsabilidad |
|---|---|
| `src/lib/documentoRuta.ts` | Arma el documento: agrupa por ruta/código, aplica secuencia, separa carros externos, cuenta canales vs vísceras, suprime el adelanto puro. |
| `src/lib/secuenciaEntrega.ts` | Resolver de secuencia (`VLOOKUP` + orden) reutilizado por el documento. |
| `src/lib/exportarDocumentoRuta.ts` | Exportación a Excel (geometría de bloques, columnas, direcciones). |
| `src/lib/direccionesNacional.ts` | Catálogo de direcciones nacionales. |
| `src/lib/adelantoVisceras.ts` | Arma las líneas de observación del adelanto de vísceras por código. |
| `src/lib/remisiones.ts` | Único módulo que habla con `remisiones`/`remisiones_filas`: correlativo de folios, candado de edición por fecha. |
| `src/components/DireccionNacionalField.tsx` | Campo/UI de dirección en el despacho nacional. |
| `src/pages/Beneficios.tsx` | Despacho individual y múltiple, media canal, reparto de direcciones. |
| `src/pages/DocumentoRuta.tsx` | Carga el maestro, arma el resolver, renderiza el documento. |
| `src/pages/Remisiones.tsx` | Formulario + impresión por hoja de la remisión de despachos. |

---

## Modelo de datos

Tablas principales (Supabase):

| Tabla | Campos relevantes | Notas |
|---|---|---|
| `registros_beneficio` | `numero_animal`, `estado`, `fraccion_despachada` | Un registro = un animal. `estado` sigue `activo` mientras `fraccion_despachada < 1`. |
| `despachos` | `registro_id`, `ruta`, `codigo_destino`, `fraccion`, `direccion`, `carro_id`, `fecha_entrega`, `created_at` | Una fila por raya. `fraccion ∈ {0.5, 1}`. `carro_id` (UUID) identifica el carro externo explícito; sin él se cae a `created_at`. `fecha_entrega` puede diferir de la fecha de despacho. |
| `despachos_archivo` | *(espejo de `despachos`)* | Incluye `fraccion` y `direccion` para no perderlas al archivar (~15 días). |
| `inventario_visceras` | — | Vísceras adelantadas; heredan ruta/destino/dirección de su canal. |
| `secuencia_entrega` | `ruta`, `ciudad`, `codigo` (TEXT), `secuencia`, `dia` | Maestro del orden de entrega. `codigo` es TEXT para conservar ceros a la izquierda. `dia` para el doble orden de Cimitarra. |
| `direcciones_nacional` | `codigo`, `direccion` | Catálogo, varias direcciones por código, `UNIQUE` para no duplicar. |
| `documentos_ruta` | `fecha`, `fecha_entrega`, `ruta`, `carro_id`, `conductor`, `auxiliar`, `placa`, `hora_programada`, `observacion` | `UNIQUE(fecha, ruta, carro_id)` — ya permite datos manuales independientes por carro externo. |
| `perfiles` | `id` (PK, FK `auth.users`), `rol` (`CHECK IN ('admin','remisiones')`, `DEFAULT 'admin'`) | Única fuente del rol. `DEFAULT 'admin'` es el *fail-open*: una cuenta sin fila asignada queda con todos los permisos, nunca bloqueada. RLS de solo-`admin`; el propio rol se consulta por RPC (`mi_rol()`), no leyendo la tabla. |
| `remisiones` | `id`, `folio_inicio` (INTEGER, `UNIQUE`, ex `numero`), `hojas_reservadas` (`DEFAULT 1`, `CHECK >= 1`), `fecha`, `conductor`, `cedula`, `placa`, `firma_responsable`, `firma_conductor` | Encabezado de la remisión. El rango de folios que ocupa es `[folio_inicio, folio_inicio + hojas_reservadas - 1]`, fijado al crear y nunca recalculado. |
| `remisiones_filas` | `id`, `remision_id` (FK `ON DELETE CASCADE`), `orden`, `cliente`, `producto`, `und_kg`, `canastillas`, `destino`, `firma_recibido`, `es_total` | Una fila por renglón del cuadro. Toda celda es TEXT (texto libre, como en el papel). `es_total` marca la fila TOTAL del pie. |
| `contador_folios` | `id` (BOOLEAN, `PK`, `CHECK (id)` — fila única), `siguiente_folio`, `actualizado_at` | Contador atómico del folio. Se lee con `FOR UPDATE` dentro de `remision_crear_con_folio` para serializar creaciones simultáneas; nunca retrocede, ni al borrar remisiones de prueba. |

> [!IMPORTANT]
> Orden de limpieza por claves foráneas en pruebas: **`despachos` → `inventario_visceras` → `registros_beneficio`**. Para remisiones: **`remisiones`** (las filas se van por `CASCADE`); el contador de folios no se retrocede a propósito.

> [!NOTE]
> **Patrón de RLS: 4 policies por comando, no `FOR ALL` abierto.** Postgres no permite que una sola policy `FOR ALL` tenga una regla para `SELECT` y otra distinta para el resto — para dejar la lectura abierta a cualquier autenticado y la escritura restringida por rol, cada tabla se parte en 4 policies (`SELECT`/`INSERT`/`UPDATE`/`DELETE`). Por defecto solo `admin` escribe; `remisiones` y `remisiones_filas` son las únicas dos tablas que además aceptan el rol `remisiones`. La función `rol_actual()` (`SECURITY DEFINER`, para poder leer `perfiles` sin recursión ni auto-promoción) es el único lugar que decide el rol (`SQL's/migracion_roles.sql`).

---

## Instalación y uso

```bash
git clone https://github.com/meelllkins/Frigorinus-.git
cd Frigorinus-
npm install
# configurar .env.local (ver abajo)
npm run dev        # desarrollo
npm run build      # tsc -b + build de producción
npm run preview    # previsualizar la build
```

**Requisitos:** Node.js LTS reciente · npm · un proyecto Supabase con Auth y las tablas del modelo.

---

## Variables de entorno

`.env.local` en la raíz:

```bash
VITE_SUPABASE_URL=tu_url_de_supabase
VITE_SUPABASE_ANON_KEY=tu_anon_public_key
```

> [!CAUTION]
> Solo variables `VITE_` se exponen al cliente. **Nunca** pongas la `service_role` key en el frontend. Con la `anon` key, las lecturas/escrituras dependen de que **RLS** esté bien configurado.

---

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite). |
| `npm run build` | Compila TypeScript (`tsc -b`) y construye. |
| `npm run lint` | ESLint. |
| `npm run preview` | Sirve la build para verificación local. |

---

## Migraciones SQL

> [!IMPORTANT]
> Los cambios de esquema salen como archivos `.sql` que se corren **a mano** en Supabase. La app **nunca** ejecuta SQL contra producción. Todos viven en **`SQL's/`** (ya no en la raíz del repo).

| Migración | Obligatoria | Efecto |
|---|---|---|
| `migracion_media_canal.sql` | ✅ ya corrida | Habilita `fraccion` en `despachos` — media canal (0.5). |
| `migracion_direcciones_nacional.sql` | ✅ ya corrida | Catálogo `direcciones_nacional` + columna `despachos.direccion`. |
| `migracion_editar_direccion_nacional.sql` | ✅ ya corrida | RPC `editar_direccion_nacional()` para corregir una dirección y propagarla al histórico. Su guard de autorización lo reemplaza `migracion_roles.sql` (es `SECURITY DEFINER`, se salta el RLS). |
| `migracion_secuencia_entrega.sql` | ✅ ya corrida | Tabla `secuencia_entrega` — maestro del orden de entrega. |
| `migracion_secuencia_escritura.sql` | ⏸ histórica / superada | Dejaba explícita la policy de escritura de `secuencia_entrega`; hoy la gobierna `migracion_roles.sql`. |
| `migracion_gomez_plata.sql` | ✅ ya corrida | Habilita la ruta Gómez Plata en el `CHECK` de `despachos.ruta` + su maestro de secuencia. |
| `migracion_ruta_cisneros.sql` | ✅ ya corrida | Habilita la ruta Cisneros/San Roque en el `CHECK`. |
| `migracion_cerdos_nordeste.sql` | ✅ ya corrida | Habilita la ruta CERDOS NORDESTE en el `CHECK`. |
| `migracion_externo_por_carro.sql` | ✅ ya corrida | `carro_id` (UUID) en `despachos` y (TEXT) en `documentos_ruta`; `UNIQUE(fecha, ruta, carro_id)` — conductor/placa/hora independientes por carro externo. |
| `migracion_fecha_entrega.sql` | ✅ ya corrida | Columna `despachos.fecha_entrega` / `documentos_ruta.fecha_entrega` — permite dos documentos de ruta en una misma jornada. |
| `migracion_orden_documento_ruta.sql` | ✅ ya corrida | Tabla `orden_documento_ruta` — orden manual (arrastrar con el mouse) por cuadrícula. |
| `migracion_observacion_adelanto.sql` | ✅ ya corrida | RPC `documento_ruta_agregar_observacion()` — append atómico de la línea de adelanto a `documentos_ruta.observacion`. |
| `migracion_despachos_archivo.sql` | ✅ ya corrida | Alinea `despachos_archivo` con `despachos` (ruta, cabeza, patas, `codigo_destino`, `es_desposte`, etc.) para no perder datos al archivar. |
| `migracion_visceras_sin_tipo.sql` | 🔧 corrección de datos puntual | Repara vísceras cargadas a mano sin `tipo`; no altera esquema. |
| `migracion_origen_carga.sql` | ⏸ opcional, ya consumida | Columna `registros_beneficio.origen_carga` (`'manual'`/`'pdf'`) — la usa la carga masiva de sacrificio (`sacrificioPdf.ts`). |
| `migracion_remisiones.sql` | 📜 histórica | Esquema original de `remisiones`/`remisiones_filas`. Superada por `migracion_recrear_remisiones.sql`. |
| `migracion_remision_cedula.sql` | 📜 histórica | Agregó `remisiones.cedula`. Ya incluida en `migracion_recrear_remisiones.sql`. |
| `migracion_recrear_remisiones.sql` | ✅ ya corrida | Recrea `remisiones`/`remisiones_filas` (Rafa confirmó que sí se usa, tras un DROP accidental) con el esquema combinado de las dos migraciones anteriores. |
| `migracion_remisiones_reemplazar_filas.sql` | ✅ ya corrida | RPC `remision_reemplazar_filas()` — borrar+insertar filas al editar, en una sola transacción. |
| `migracion_folios_remision.sql` | ✅ ya corrida | Renombra `remisiones.numero` → `folio_inicio`, agrega `hojas_reservadas`, tabla `contador_folios` y RPC `remision_crear_con_folio()`. El divisor de filas-por-hoja que trae (6) quedó **superado** por la migración siguiente. |
| `migracion_filas_por_hoja.sql` | ✅ ya corrida | Actualiza `remision_crear_con_folio()` a 8 filas por hoja (impresión vertical). Reemplaza la función entera; no toca `migracion_folios_remision.sql`. |
| `migracion_roles.sql` | ✅ ya corrida | Tabla `perfiles`, `rol_actual()`/`mi_rol()`, y reemplaza la policy `FOR ALL` de las 13 tablas por 4 policies por comando (ver [Modelo de datos](#modelo-de-datos)). |

**Regla de despliegue:** correr las migraciones **antes** de desplegar. Varias rompen una pantalla entera si la columna no existe cuando el frontend ya la pide. Las marcadas "✅ ya corrida" están aplicadas en producción; se listan por trazabilidad, no como pendientes.

---

## Convenciones de desarrollo

- **SQL a mano.** Los `.sql` los corre el usuario en Supabase; la app no toca producción con DDL.
- **`git add` archivo por archivo**, nunca `git add .`. Revisar `git status` antes de cada commit.
- **Pruebas con `codigo_cliente = 'TESTQA'`** para todo lo que toque despacho o inventario. Limpieza en orden FK.
- **Avisar antes de cada deploy**: cada despliegue puede desloguear al usuario final de la PWA.
- **Verificar `npx tsc -b` en exit 0** antes de commitear.

---

## PWA

Configurada con `vite-plugin-pwa`:

- `registerType: 'autoUpdate'` — actualiza el service worker solo.
- Manifest: `Frigorinus Logística` · `standalone` · tema `#111827` · iconos `192`/`512`.
- **Android (Chrome):** botón "Instalar app" o menú ⋮ → Instalar.
- **iOS (Safari):** compartir ⬆ → "Añadir a pantalla de inicio" (iOS no muestra el prompt estándar; la app da las instrucciones).

---

## Reset de datos (acción destructiva)

Botón **Resetear** en el `Layout`:

- Modal de confirmación que exige escribir exactamente `RESETEAR`.
- Borra registros de `despachos`, `inventario_visceras` y `registros_beneficio`, y recarga.

> [!CAUTION]
> **No se puede deshacer.** Recomendado restringirla por rol o moverla a un panel admin.

---

## Estructura del proyecto

```
.
├─ public/
├─ src/
│  ├─ components/
│  │  ├─ Layout.tsx                      ← shell, nav, wrapper de solo-lectura por rol
│  │  ├─ DireccionNacionalField.tsx      ← campo de dirección nacional
│  │  ├─ ClienteModal.tsx
│  │  ├─ CeldasCliente.tsx
│  │  ├─ GestionarDireccionesModal.tsx
│  │  ├─ ImportarSacrificioModal.tsx
│  │  └─ RutaFields.tsx
│  ├─ lib/
│  │  ├─ supabase.ts
│  │  ├─ rol.tsx                         ← RolProvider/useRol (admin/remisiones)
│  │  ├─ documentoRuta.ts                ← armado del documento
│  │  ├─ secuenciaEntrega.ts             ← resolver de secuencia
│  │  ├─ exportarDocumentoRuta.ts        ← exportación Excel
│  │  ├─ direccionesNacional.ts          ← catálogo de direcciones
│  │  ├─ adelantoVisceras.ts             ← líneas de observación del adelanto
│  │  ├─ remisiones.ts                   ← folios, candado de edición
│  │  ├─ fechaEntrega.ts
│  │  ├─ festivos.ts
│  │  ├─ ordenDocumento.ts
│  │  ├─ codigoDestino.ts
│  │  ├─ clientes.ts
│  │  ├─ rutas.ts
│  │  └─ sacrificioPdf.ts                ← carga masiva desde PDF
│  ├─ pages/
│  │  ├─ Beneficios.tsx                  ← despacho, media canal, reparto
│  │  ├─ CobrosFrio.tsx
│  │  ├─ Despachos.tsx                   ← revert + archivado
│  │  ├─ DocumentoRuta.tsx               ← render del documento
│  │  ├─ Inventario.tsx
│  │  ├─ Login.tsx
│  │  ├─ Notas.tsx
│  │  └─ Remisiones.tsx                  ← formulario + impresión de remisiones
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ index.css
├─ SQL's/                                ← todas las migraciones (ver arriba)
├─ index.html
├─ vite.config.ts
├─ tailwind.config.js
├─ eslint.config.js
├─ package.json
└─ package-lock.json
```

> Los módulos listados son los del árbol real del repo al momento de escribir esto; confírmalos si pasó tiempo.

---

## Pendientes y hoja de ruta

**Decisiones que dependen del usuario final (Rafa):**

- [ ] Validar media canal y secuencia end-to-end con despachos reales.
- [ ] **Código 875 (cerdo)**: hoy se hace manual; confirmar si necesita reparto de direcciones como el 355. El reparto ya es genérico (cualquier código con ≥2 direcciones y ≥2 rayas ofrece el checkbox) — falta solo confirmar/cargar el catálogo del 875, no escribir código nuevo.
- [ ] **Adelanto puro y V/B–V/R** (ver [Adelanto de vísceras](#adelanto-de-vísceras)): cuando un grupo de puro adelanto se suprime de la tabla, sus V/B y V/R no se suman en ninguna fila. Sigue sin decidirse si conviene heredar también desposte/media canal/dirección/carro **por código** (no solo por `registro_id`) para forzar siempre la fusión y no perder ese conteo, a costa de un agrupamiento más permisivo.

**Mejoras técnicas preparadas:**

- [ ] **Control de roles para el botón Resetear.** El botón vive en el header, fuera del wrapper de solo-lectura (`ContenidoBloqueado`) que cubre `<main>`, así que el rol `remisiones` todavía lo ve y puede abrir el modal. La escritura ya está cubierta por RLS (`despachos`/`inventario_visceras`/`registros_beneficio` son de solo-`admin`, así que los `DELETE` no borran nada para ese rol), pero la UI no lo refleja: el modal deja completar "RESETEAR" y confirmar, y como un `DELETE` bloqueado por RLS no tira error (afecta 0 filas y "sale bien"), a ese rol le puede parecer que reseteó cuando no pasó nada. Falta ocultar o deshabilitar el botón para `remisiones`.
- [ ] Observabilidad en producción (p. ej. Sentry).

**Resuelto desde la última revisión de este README** *(por trazabilidad, no como tarea pendiente)*:

- ✅ Rutas que no reordenaban (Puerto Berrío, Cisneros/San Roque, Don Matías, Gómez Plata) ya están en `RUTAS_CON_SECUENCIA`.
- ✅ Día de entrega de Cimitarra: ya no se infiere a ciegas — hay un selector de fecha de entrega que Rafa puede corregir (p. ej. víspera de festivo), y la secuencia lunes/jueves se resuelve contra esa fecha.
- ✅ `carro_id` por carro externo: implementado y consumido (`migracion_externo_por_carro.sql`) — conductor/placa/hora ya son independientes por carro.
- ✅ RLS de `secuencia_entrega` y `direcciones_nacional`: cubiertas por el patrón de 4 policies de `migracion_roles.sql`, igual que el resto de las tablas.

---

<div align="center">

*Frigorinus — de la cava al carro, sin pasar por Excel.*

</div>
