import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/layout/AppLayout.js'
import { LoginPage }     from './pages/login/LoginPage.js'
import { DashboardPage } from './pages/dashboard/DashboardPage.js'
import { MembersPage }      from './pages/members/MembersPage.js'
import { MemberDetailPage } from './pages/members/MemberDetailPage.js'
import { InvoicesPage }  from './pages/invoices/InvoicesPage.js'
import { PayoutsPage }   from './pages/payouts/PayoutsPage.js'
import { SettingsPage }  from './pages/settings/SettingsPage.js'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route index        element={<DashboardPage />} />
            <Route path="members"           element={<MembersPage />} />
            <Route path="members/:id"       element={<MemberDetailPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="payouts"  element={<PayoutsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
