import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './Components/Layout'
import Beneficio from './pages/Beneficios'
import CobrosFrio from './pages/CobrosFrio'
import Inventario from './pages/Inventario'
import Despachos from './pages/Despachos'
import Notas from './pages/Notas'

function App() {
  const [session, setSession] = useState<any>(null)
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
    <Routes>
      <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
      <Route path="/" element={session ? <Layout /> : <Navigate to="/login" />}>
        <Route index element={<Beneficio />} />
        <Route path="cobros" element={<CobrosFrio />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="despachos" element={<Despachos />} />
        <Route path="notas" element={<Notas />} />
      </Route>
    </Routes>
  )
}

export default App