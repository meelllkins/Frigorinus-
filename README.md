<div align="center">

# 🥩 Frigorinus

### Logística de planta frigorífica — PWA

*Control de beneficio, despacho, inventario de vísceras y documentos de ruta, en una sola app instalable.*

[![Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-autoUpdate-5A0FC8?logo=pwa&logoColor=white)](https://vite-pwa-org.netlify.app)
[![Deploy](https://img.shields.io/badge/Vercel-live-000000?logo=vercel&logoColor=white)](https://frigorinus.vercel.app)

**🌐 [frigorinus.vercel.app](https://frigorinus.vercel.app)** &nbsp;·&nbsp; **📦 `meelllkins/Frigorinus-`**

</div>

---

> [!NOTE]
> Este README refleja el estado del proyecto tras la incorporación de **media canal**, **secuencia de entrega en el documento de ruta** y **direcciones de despacho nacional**. Algunos nombres exactos de columnas/funciones provienen de las notas de desarrollo y conviene confirmarlos contra el código antes de tratarlos como contrato estable.

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
| *(vista)* | **Documento de ruta** | Documento generado: tablas por ruta, ya ordenadas por secuencia, con direcciones nacionales y bloques de carro externo. Exportable a Excel. |

Navegación por barra superior tipo *tab bar*; el `Layout` es el shell con header (Resetear · Instalar app · Salir) y `<Outlet />`.

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

- Rutas **con secuencia**: Remedios/Segovia, Cimitarra, Flores-Yalí-Vegachí, San José-Maceo, Caracolí-Cristales, Yolombó.
- Rutas **sin secuencia** (las ordena el cliente): Puerto Berrío, Cisneros/San Roque, Don Matías, Gómez Plata, Nacional.
- **Cimitarra** es especial: lleva **doble secuencia**, una para entrega de **lunes** y otra para **jueves**.
- La lógica replica en código el `VLOOKUP + ordenar` que antes se hacía en Excel, contra una tabla maestra persistida (`secuencia_entrega`). El matcheo de códigos es tolerante a ceros a la izquierda (`'04'` = `'4'`).
- El ordenamiento se aplica **dentro de las tablas del documento**; si el código lleva `PARA COD X`, se ordena por el **destino**, no por el código de origen.

### Carros externos independientes

Cuando un cliente manda su propio camión, cada despacho a **Externo** es un **carro aparte**.

- Un bloque "EXTERNO" **por acto de despacho** — no se agrupan por cliente ni por destino. Dos externos al mismo destino siguen siendo dos carros.
- El carro se identifica por el **acto de despacho**: un despacho múltiple de 50 cerdos es un solo carro; dos despachos separados del mismo código son dos carros.
- Las vísceras heredan el carro de su canal, así no se parte un carro en varias cajas.

> [!WARNING]
> **Limitación conocida:** los campos manuales de encabezado (Conductor · Auxiliar · Placa · Hora) hoy se comparten entre todos los carros externos del mismo día, por el `UNIQUE(fecha, ruta)` de `documentos_ruta`. Un aviso ámbar lo advierte en pantalla. La solución (columna `carro_id` por carro) está preparada, pendiente de implementar.

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
- **V/B, V/R, CABEZA, PATAS** suman **todas** las vísceras, incluidas las de animales que aún no despacharon canal.
- Si un código solo tiene vísceras adelantadas (0 canales), **COD muestra el código pelado** y `CANT = 0`.

> Las cinco columnas de cantidad, en orden: **canal · víscera roja · víscera blanca · cabeza · patas**. (Patas ≈ 4× canales por res.)

---

## Arquitectura

**Entry point** — `src/main.tsx`: monta React con `createRoot`, envuelve en `BrowserRouter`, carga `index.css`.

**Sesión y ruteo** — `src/App.tsx`: consulta `supabase.auth.getSession()`, se suscribe a `onAuthStateChange`. Sin sesión → `/login`; con sesión → `Layout` + rutas internas.

**Shell** — `src/components/Layout.tsx`: header (Resetear · Instalar/Añadir a inicio · Salir), barra de módulos, detección iOS/Android + `beforeinstallprompt`, render por `<Outlet />`.

**Supabase** — `src/lib/supabase.ts`: cliente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

**Lógica de documento** — el corazón del negocio vive en:

| Archivo | Responsabilidad |
|---|---|
| `src/lib/documentoRuta.ts` | Arma el documento: agrupa por ruta/código, aplica secuencia, separa carros externos, cuenta canales vs vísceras. |
| `src/lib/secuenciaEntrega.ts` | Resolver de secuencia (`VLOOKUP` + orden) reutilizado por el documento. |
| `src/lib/exportarDocumentoRuta.ts` | Exportación a Excel (geometría de bloques, columnas, direcciones). |
| `src/lib/direccionesNacional.ts` | Catálogo de direcciones nacionales. |
| `src/components/DireccionNacionalField.tsx` | Campo/UI de dirección en el despacho nacional. |
| `src/pages/Beneficios.tsx` | Despacho individual y múltiple, media canal, reparto de direcciones. |
| `src/pages/DocumentoRuta.tsx` | Carga el maestro, arma el resolver, renderiza el documento. |

---

## Modelo de datos

Tablas principales (Supabase):

| Tabla | Campos relevantes | Notas |
|---|---|---|
| `registros_beneficio` | `numero_animal`, `estado`, `fraccion_despachada` | Un registro = un animal. `estado` sigue `activo` mientras `fraccion_despachada < 1`. |
| `despachos` | `registro_id`, `ruta`, `codigo_destino`, `fraccion`, `direccion`, `created_at` | Una fila por raya. `fraccion ∈ {0.5, 1}`. `created_at` identifica el carro externo. |
| `despachos_archivo` | *(espejo de `despachos`)* | Incluye `fraccion` y `direccion` para no perderlas al archivar (~15 días). |
| `inventario_visceras` | — | Vísceras adelantadas; heredan ruta/destino/dirección de su canal. |
| `secuencia_entrega` | `ruta`, `ciudad`, `codigo` (TEXT), `secuencia`, `dia` | Maestro del orden de entrega. `codigo` es TEXT para conservar ceros a la izquierda. `dia` para el doble orden de Cimitarra. |
| `direcciones_nacional` | `codigo`, `direccion` | Catálogo, varias direcciones por código, `UNIQUE` para no duplicar. |
| `documentos_ruta` | `fecha`, `ruta`, `conductor`, `auxiliar`, `placa`, `hora` | `UNIQUE(fecha, ruta)` — de aquí sale la limitación de los carros externos. |

> [!IMPORTANT]
> Orden de limpieza por claves foráneas en pruebas: **`despachos` → `inventario_visceras` → `registros_beneficio`**.

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
> Los cambios de esquema salen como archivos `.sql` que se corren **a mano** en Supabase. La app **nunca** ejecuta SQL contra producción.

| Migración | Obligatoria | Efecto si falta |
|---|---|---|
| `migracion_media_canal.sql` | ✅ antes de desplegar | El despacho de canal falla (el insert escribe `fraccion`). |
| `migracion_direcciones_nacional.sql` | ✅ antes de desplegar | El despacho a Nacional falla (el insert escribe `direccion`). |
| `migracion_secuencia_entrega.sql` | ✅ para el orden | El documento sale con el orden viejo, sin romperse. |
| `migracion_gomez_plata.sql` | ✅ para esa ruta | Despachar a Gómez Plata falla por el `CHECK` de `ruta`. |
| `migracion_externo_por_carro.sql` | ⏸ opcional / futura | Habilita `carro_id` para conductor/placa por carro. No consumida aún. |
| `migracion_fecha_entrega.sql` | ✅ antes de desplegar | El despacho falla (el insert escribe `fecha_entrega`) y el encabezado del documento no guarda (el `onConflict` nombra `fecha_entrega`). |

**Regla de despliegue:** correr las migraciones **antes** de desplegar. Varias rompen una pantalla entera si la columna no existe cuando el frontend ya la pide.

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
│  │  ├─ Layout.tsx
│  │  └─ DireccionNacionalField.tsx      ← campo de dirección nacional
│  ├─ lib/
│  │  ├─ supabase.ts
│  │  ├─ documentoRuta.ts                ← armado del documento
│  │  ├─ secuenciaEntrega.ts             ← resolver de secuencia
│  │  ├─ exportarDocumentoRuta.ts        ← exportación Excel
│  │  └─ direccionesNacional.ts          ← catálogo de direcciones
│  ├─ pages/
│  │  ├─ Beneficios.tsx                  ← despacho, media canal, reparto
│  │  ├─ CobrosFrio.tsx
│  │  ├─ Despachos.tsx                   ← revert + archivado
│  │  ├─ DocumentoRuta.tsx               ← render del documento
│  │  ├─ Inventario.tsx
│  │  ├─ Login.tsx
│  │  └─ Notas.tsx
│  ├─ types/
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ index.css
├─ migracion_media_canal.sql
├─ migracion_direcciones_nacional.sql
├─ migracion_secuencia_entrega.sql
├─ migracion_gomez_plata.sql
├─ migracion_externo_por_carro.sql       ← futura (carro_id)
├─ index.html
├─ vite.config.ts
├─ tailwind.config.js
├─ eslint.config.js
├─ package.json
└─ package-lock.json
```

> Los nombres de archivos nuevos (`.sql` y módulos de `lib`/`components`) provienen de las notas de desarrollo; confírmalos contra el árbol real del repo.

---

## Pendientes y hoja de ruta

**Decisiones que dependen del usuario final (Rafa):**

- [ ] Validar media canal y secuencia end-to-end con despachos reales.
- [ ] **Día de Cimitarra**: hoy la app **infiere** el día de entrega (despacho + 1) sin preguntar. Falla si se despacha para un día que no mapea a lunes/jueves (p. ej. sábado por feriado). Decidir entre: dejarlo inferido, agregar un selector de día, o bloquear cuando el maestro sale vacío.
- [ ] **Rutas con maestro que no reordenan** (Berrío, Cisneros, Don Matías): confirmar si deben ordenarse o quedan manuales. *(Activar = agregarlas a `RUTAS_CON_SECUENCIA`, sin tocar la base.)*
- [ ] **Código 875 (cerdo)**: hoy se hace manual; confirmar si necesita reparto de direcciones como el 355.

**Mejoras técnicas preparadas:**

- [ ] **`carro_id` por carro externo** (`migracion_externo_por_carro.sql`) — para conductor/placa/hora independientes por carro. Migración escrita, código consumidor pendiente.
- [ ] Control de roles para el botón **Resetear**.
- [ ] Revisar RLS para todas las tablas nuevas (`secuencia_entrega`, `direcciones_nacional`).
- [ ] Observabilidad en producción (p. ej. Sentry).

---

<div align="center">

*Frigorinus — de la cava al carro, sin pasar por Excel.*

</div>
