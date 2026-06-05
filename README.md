# Frigorinus — Logística de planta (PWA)

**Frigorinus** es una aplicación web (instalable como **PWA**) pensada para el **control de logística de planta**. Incluye autenticación con **Supabase**, navegación por módulos con **React Router**, UI con **Tailwind CSS** (y configuración compatible con **shadcn/ui + Radix**), y está construida con **Vite + React + TypeScript**.

- **Repositorio:** `meelllkins/Frigorinus-`
- **Web (deploy):** https://frigorinus.vercel.app
- **Stack principal:** React + TypeScript + Vite
- **Backend/DB/Auth:** Supabase
- **PWA:** `vite-plugin-pwa` con `autoUpdate` y manifest configurado

---

## Tabla de contenidos

- [Frigorinus — Logística de planta (PWA)](#frigorinus--logística-de-planta-pwa)
  - [Tabla de contenidos](#tabla-de-contenidos)
  - [¿Qué hace este proyecto?](#qué-hace-este-proyecto)
  - [Módulos (pantallas) y navegación](#módulos-pantallas-y-navegación)
  - [Arquitectura y flujo de la app](#arquitectura-y-flujo-de-la-app)
    - [Entry point](#entry-point)
    - [Ruteo + protección por sesión](#ruteo--protección-por-sesión)
    - [Layout principal](#layout-principal)
    - [Cliente de Supabase](#cliente-de-supabase)
  - [Tecnologías](#tecnologías)
  - [Requisitos](#requisitos)
  - [Instalación y uso](#instalación-y-uso)
  - [Variables de entorno](#variables-de-entorno)
  - [Scripts disponibles](#scripts-disponibles)
  - [PWA (instalación, manifest y comportamiento)](#pwa-instalación-manifest-y-comportamiento)
  - [Reset de datos (acción destructiva)](#reset-de-datos-acción-destructiva)
  - [Estructura del proyecto](#estructura-del-proyecto)
  - [Calidad de código (ESLint)](#calidad-de-código-eslint)
  - [Notas y recomendaciones](#notas-y-recomendaciones)

---

## ¿Qué hace este proyecto?

La app está orientada a operaciones internas de planta. En la UI se presenta como un panel con módulos para trabajar diferentes partes del flujo logístico.

A nivel de producto, se aprecian estas características clave:

- **Login** con email/contraseña usando **Supabase Auth**.
- **Secciones por módulos** accesibles desde un menú superior (tipo “tab bar”).
- **Persistencia en base de datos** vía Supabase (lecturas/escrituras en tablas).
- **Capacidad de instalar como aplicación** (PWA) en móviles.
- **Acción de “reset”** que borra datos de tablas críticas (con confirmación explícita).

---

## Módulos (pantallas) y navegación

El ruteo principal define:

- `/login` → Pantalla de acceso
- `/` → **Inventario Actual** (ruta index)
- `/cobros` → **Cobros de Frío**
- `/inventario` → **Vísceras**
- `/despachos` → **Despachos**
- `/notas` → **Notas**

Estas pantallas existen en `src/pages/`:

- `Beneficios.tsx` (pantalla principal/index)
- `CobrosFrio.tsx`
- `Inventario.tsx`
- `Despachos.tsx`
- `Notas.tsx`
- `Login.tsx`

> Nota: El contenido específico de negocio (tablas, cálculos, formularios) vive dentro de cada `*.tsx` en `src/pages/`.

---

## Arquitectura y flujo de la app

### Entry point

La aplicación arranca en `src/main.tsx`:

- Monta React con `createRoot`
- Envuelve la app con `BrowserRouter`
- Carga estilos globales desde `src/index.css`

### Ruteo + protección por sesión

El archivo `src/App.tsx` implementa el control de sesión:

1. Al cargar, consulta `supabase.auth.getSession()`.
2. Se suscribe a cambios con `supabase.auth.onAuthStateChange(...)`.
3. Si no hay sesión, redirige a `/login`.
4. Si hay sesión, renderiza el `Layout` y habilita las rutas internas.

Esto crea una protección simple:
- Sin sesión → solo login
- Con sesión → panel principal

### Layout principal

`src/components/Layout.tsx` es el “shell” de la aplicación:

- Header con el nombre de la app y acciones:
  - **Resetear** (peligroso)
  - **Instalar app** / **Añadir a inicio** (PWA)
  - **Salir** (logout)
- Barra de navegación con módulos:
  - Inventario Actual
  - Cobros de Frío
  - Vísceras
  - Despachos
  - Notas
- Render del contenido mediante `<Outlet />` (React Router)

Además incluye lógica para PWA:
- Detecta iOS/Android, modo standalone y disponibilidad del evento `beforeinstallprompt`.
- Muestra instrucciones manuales (especialmente útil en iOS).

### Cliente de Supabase

`src/lib/supabase.ts` crea el cliente con variables de entorno:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Tecnologías

**Frontend**
- React (con TypeScript)
- React Router (rutas y navegación)
- Tailwind CSS (estilos)
- lucide-react (iconos)
- @tanstack/react-table (tablas)
- TipTap (editor rich-text) — dependencias presentes
- xlsx (exportación/importación Excel) — dependencia presente
- date-fns (fechas)

**Backend / Plataforma**
- Supabase (`@supabase/supabase-js`) para Auth + DB

**Build tooling**
- Vite
- ESLint

**PWA**
- `vite-plugin-pwa` con manifest configurado:
  - `name`: Frigorinus Logística
  - `short_name`: Frigorinus
  - `display`: standalone
  - `start_url`: `/`
  - icons: `icon-192.png`, `icon-512.png`

---

## Requisitos

- Node.js (recomendado usar una versión LTS reciente)
- npm (el repo incluye `package-lock.json`)
- Un proyecto en Supabase con Auth habilitado y las tablas necesarias

---

## Instalación y uso

1) Clona el repo:
```bash
git clone https://github.com/meelllkins/Frigorinus-.git
cd Frigorinus-
```

2) Instala dependencias:
```bash
npm install
```

3) Configura variables de entorno (ver sección siguiente).

4) Ejecuta en desarrollo:
```bash
npm run dev
```

5) Build de producción:
```bash
npm run build
```

6) Previsualizar build:
```bash
npm run preview
```

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto (o `.env.local`) con:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_public_key
```

**Importante**
- En Vite, solo las variables que empiezan con `VITE_` se exponen al cliente.
- No uses claves de servicio (“service_role”) en frontend.

---

## Scripts disponibles

Definidos en `package.json`:

- `npm run dev` → inicia servidor dev Vite
- `npm run build` → compila TypeScript (`tsc -b`) y construye con Vite
- `npm run lint` → ejecuta ESLint
- `npm run preview` → sirve la build para verificación local

---

## PWA (instalación, manifest y comportamiento)

La app está configurada como **PWA** con `vite-plugin-pwa`:

- `registerType: 'autoUpdate'` (intenta actualizar automáticamente el service worker)
- `includeAssets`: favicon e iconos
- Manifest con tema oscuro (`#111827`) y modo `standalone`

### Instalación en Android (Chrome)
- Si aparece el prompt, desde el header puedes usar **“Instalar app”**.
- Si no aparece, menú ⋮ → “Instalar app”.

### Instalación en iOS (Safari)
- iOS no muestra el prompt estándar.
- La app indica instrucciones: botón compartir ⬆ → “Añadir a pantalla de inicio”.

---

## Reset de datos (acción destructiva)

En el `Layout` existe un botón **Resetear** que:

- Abre un modal de confirmación
- Requiere escribir exactamente `RESETEAR`
- Luego ejecuta borrados en Supabase y recarga la página

Por el código actual, se eliminan registros de estas tablas:

- `despachos`
- `inventario_visceras`
- `registros_beneficio`

**Advertencia:** Esta acción **no se puede deshacer**. Recomendación: restringirla por rol/permiso o moverla a un panel admin.

---

## Estructura del proyecto

Vista general (carpetas principales):

```
.
├─ public/
├─ src/
│  ├─ assets/
│  ├─ components/
│  │  └─ Layout.tsx
│  ├─ lib/
│  │  └─ supabase.ts
│  ├─ pages/
│  │  ├─ Beneficios.tsx
│  │  ├─ CobrosFrio.tsx
│  │  ├─ Despachos.tsx
│  │  ├─ Inventario.tsx
│  │  ├─ Login.tsx
│  │  └─ Notas.tsx
│  ├─ types/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ index.css
│  └─ pwa.d.ts
├─ index.html
├─ vite.config.ts
├─ tailwind.config.js
├─ eslint.config.js
├─ components.json
├─ package.json
└─ package-lock.json
```

---

## Calidad de código (ESLint)

El proyecto incluye configuración de ESLint (`eslint.config.js`) y el README original (plantilla) describe cómo ampliar la configuración con reglas type-aware si el objetivo es endurecer la calidad en producción.

---

## Notas y recomendaciones

- **Seguridad:** considera agregar control de roles (por ejemplo, solo admins pueden resetear).
- **Supabase:** valida que RLS (Row Level Security) esté correctamente configurado para evitar accesos no deseados.
- **Variables:** documenta en Supabase qué tablas y columnas requiere cada módulo.
- **Observabilidad:** para producción, agrega logs/telemetría (Sentry u otra opción).
- **UX:** la app ya está muy bien encaminada con el enfoque “panel + módulos + PWA”.

---
