import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'

export function LoginPage() {
  const navigate = useNavigate()
  const [step,        setStep]        = useState<'credentials' | '2fa'>('credentials')
  const [preAuthToken, setPreAuth]    = useState('')
  const [username,    setUsername]    = useState('')
  const [password,    setPassword]    = useState('')
  const [totpCode,    setTotpCode]    = useState('')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      if (data.requires2FA) {
        setPreAuth(data.preAuthToken)
        setStep('2fa')
      } else {
        localStorage.setItem('user', JSON.stringify(data.user))
        navigate('/')
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handle2FA(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/verify-2fa', { preAuthToken, totpCode })
      localStorage.setItem('user', JSON.stringify(data.user))
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[#BE123C] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">R</span>
          </div>
          <h1 className="text-2xl font-bold text-[#111827]">RewardHub</h1>
          <p className="text-[#6B7280] text-sm mt-1">Loyalty Programme Management</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-8">

          {step === 'credentials' ? (
            <>
              <h2 className="text-lg font-semibold text-[#111827] mb-6">Sign in to your account</h2>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] focus:border-transparent"
                    placeholder="Enter username"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] focus:border-transparent"
                    placeholder="Enter password"
                  />
                </div>

                {error && (
                  <div className="bg-[#FEF2F2] border border-[#FECDD3] rounded-lg px-3 py-2">
                    <p className="text-sm text-[#BE123C]">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#BE123C] hover:bg-[#9F1239] text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#111827]">Two-factor authentication</h2>
                <p className="text-sm text-[#6B7280] mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <form onSubmit={handle2FA} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Authentication code</label>
                  <input
                    type="text"
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    maxLength={6}
                    className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-[#BE123C] focus:border-transparent"
                    placeholder="000000"
                  />
                </div>

                {error && (
                  <div className="bg-[#FEF2F2] border border-[#FECDD3] rounded-lg px-3 py-2">
                    <p className="text-sm text-[#BE123C]">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="w-full bg-[#BE123C] hover:bg-[#9F1239] text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setError('') }}
                  className="w-full text-sm text-[#6B7280] hover:text-[#BE123C] py-1"
                >
                  Back to login
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
