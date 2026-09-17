import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { RolProvider } from './lib/rol'
import Login from './pages/Login'
import Layout from './components/Layout'

// Las siete pantallas se bajan CADA UNA en su propio archivo, la primera vez que
// Rafa entra a ella. Antes eran imports estáticos y el bundle inicial —2.19 MB—
// traía todo: el editor de notas, el arrastrar/soltar del documento de ruta y las
// dos librerías de planilla, antes de poder pintar la primera pantalla.
//
// Login y Layout NO van acá a propósito: el Layout se muestra siempre, y Login es
// lo primero que ve alguien deslogueado — diferirlos solo agregaría una espera.
//
// Es el mismo import() dinámico que ya usa sacrificioPdf.ts para no meter pdfjs en
// el bundle; acá envuelto en lazy(), que es lo que React necesita para un componente.
const Beneficio = lazy(() => import('./pages/Beneficios'))
const CobrosFrio = lazy(() => import('./pages/CobrosFrio'))
const Inventario = lazy(() => import('./pages/Inventario'))
const Despachos = lazy(() => import('./pages/Despachos'))
const Notas = lazy(() => import('./pages/Notas'))
const DocumentoRuta = lazy(() => import('./pages/DocumentoRuta'))
const Remisiones = lazy(() => import('./pages/Remisiones'))

/** Lo que se ve mientras baja el archivo de una pantalla. Después de la primera
 *  visita queda en caché del navegador y del service worker, y ya no aparece. */
function CargandoPantalla() {
  return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-gray-500">Cargando...</p>
    </div>
  )
}

/**
 * El Suspense va por pantalla y no arriba de <Routes>: así el que se reemplaza por
 * el "Cargando..." es el contenido, y el header y las pestañas del Layout quedan
 * quietos en su lugar mientras baja el archivo.
 */
function pantalla(Componente: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={<CargandoPantalla />}>
      <Componente />
    </Suspense>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Cargando...</p>
      </div>
    )
  }

  return (
    <RolProvider session={session}>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={session ? <Layout /> : <Navigate to="/login" />}>
          <Route index element={pantalla(Beneficio)} />
          <Route path="cobros" element={pantalla(CobrosFrio)} />
          <Route path="inventario" element={pantalla(Inventario)} />
          <Route path="despachos" element={pantalla(Despachos)} />
          <Route path="notas" element={pantalla(Notas)} />
          <Route path="documento" element={pantalla(DocumentoRuta)} />
          <Route path="remisiones" element={pantalla(Remisiones)} />
        </Route>
      </Routes>
    </RolProvider>
  )
}

export default App