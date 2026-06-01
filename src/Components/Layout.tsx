import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ClipboardList, AlertTriangle, Package, Truck, LogOut, Thermometer } from 'lucide-react'

export default function Layout() {
  const [showResetModal, setShowResetModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  async function handleReset() {
    setResetting(true)
    await supabase.from('despachos').delete().not('id', 'is', null)
    await supabase.from('inventario_visceras').delete().not('id', 'is', null)
    await supabase.from('registros_beneficio').delete().not('id', 'is', null)
    window.location.reload()
  }

  const canReset = confirmText === 'RESETEAR'

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      {/* Modal de reset */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-gray-900 mb-1">Resetear todos los datos</h3>
            <p className="text-sm text-red-600 font-semibold mb-3">Esta acción no se puede deshacer.</p>
            <p className="text-sm text-gray-600 mb-4">
              Esto borrará <span className="font-semibold text-gray-900">TODOS</span> los registros
              permanentemente: animales, vísceras y despachos.
            </p>
            <p className="text-xs text-gray-500 mb-2">
              Escribe <span className="font-bold text-gray-800">RESETEAR</span> para confirmar:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="RESETEAR"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm mb-5 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 font-mono tracking-widest"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowResetModal(false); setConfirmText('') }}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleReset}
                disabled={!canReset || resetting}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-40"
              >
                {resetting ? 'Borrando...' : 'Confirmar reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-gray-900 px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-green-700 rounded-lg p-2 flex items-center justify-center">
            <Thermometer size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide leading-tight">Frigorinus</h1>
            <p className="text-xs text-gray-400 leading-tight">Logística de planta</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResetModal(true)}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-800"
          >
            Resetear datos
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
          >
            <LogOut size={15} />
            Salir
          </button>
        </div>
      </header>

      <nav className="bg-white shadow-sm border-b border-gray-200 px-6">
        <div className="flex">
          {[
            { to: '/', label: 'Inventario Actual', icon: ClipboardList },
            { to: '/cobros', label: 'Cobros de Frío', icon: AlertTriangle },
            { to: '/inventario', label: 'Inventario Vísceras', icon: Package },
            { to: '/despachos', label: 'Despachos', icon: Truck },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${
                  isActive
                    ? 'border-green-700 text-green-800 bg-green-50'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="p-6 max-w-6xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
