import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar.js'
import { useAuth } from '../../hooks/useAuth.js'

export function AppLayout() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
