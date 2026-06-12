import { useState } from 'react'
import { api } from '../lib/api.js'
import type { AuthUser } from '../types/index.js'

export function useAuth() {
  const [user] = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') ?? 'null') } catch { return null }
  })

  const isAuthenticated = !!user
  const isSuperAdmin   = user?.role === 'super_admin'
  const isBranchAdmin  = user?.role === 'branch_admin'
  const isAdminOrAbove = isSuperAdmin || isBranchAdmin

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* ignore */ }
    localStorage.removeItem('user')
    window.location.href = '/login'
  }

  return { user, isAuthenticated, isSuperAdmin, isBranchAdmin, isAdminOrAbove, logout }
}
