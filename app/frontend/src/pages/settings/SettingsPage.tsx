import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { useAuth } from '../../hooks/useAuth.js'
import type { SettingsPayload } from './types.js'

export function SettingsPage() {
  const { isSuperAdmin } = useAuth()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ settings: SettingsPayload; versionId: string | null }>({
    queryKey: ['settings'],
    queryFn:  () => api.get('/settings').then(r => r.data),
    enabled:  isSuperAdmin,
  })

  const [form, setForm] = useState<SettingsPayload | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data?.settings) setForm(JSON.parse(JSON.stringify(data.settings)))
  }, [data])

  if (!isSuperAdmin) return <Navigate to="/" replace />

  const saveMutation = useMutation({
    mutationFn: (payload: SettingsPayload) => api.post('/settings', payload).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setSaved(true); setTimeout(() => setSaved(false), 3000) },
  })

  if (isLoading || !form) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  function updateDiscount(tier: string, field: string, value: string) {
    setForm(f => f ? { ...f, discountTiers: { ...f.discountTiers, [tier]: { ...(f.discountTiers as any)[tier], [field]: parseFloat(value) || 0 } } } : f)
  }

  function updatePoints(tier: string, field: string, value: string) {
    setForm(f => f ? { ...f, pointsTiers: { ...f.pointsTiers, [tier]: { ...(f.pointsTiers as any)[tier], [field]: parseFloat(value) || 0 } } } : f)
  }

  function updateMilestone(idx: number, field: string, value: string) {
    setForm(f => {
      if (!f) return f
      const milestones = [...f.milestones]
      milestones[idx] = { ...milestones[idx], [field]: parseFloat(value) || 0 }
      return { ...f, milestones }
    })
  }

  const tiers = ['gold', 'platinum', 'diamond'] as const

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#111827]">Programme Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">Changes create a new version — historical records are unaffected</p>
      </div>

      {/* Unified Tier Configuration */}
      <section className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-4">
        <h2 className="text-base font-semibold text-[#111827] mb-4">Tier Configuration</h2>
        <div className="grid grid-cols-3 gap-6">
          {tiers.map(tier => (
            <div key={tier} className="space-y-3">
              <p className="text-sm font-semibold text-[#374151] capitalize border-b border-[#E5E7EB] pb-2">{tier}</p>
              <div>
                <label className="text-xs text-[#6B7280]">Threshold (₹)</label>
                <input type="number" value={form.discountTiers[tier].threshold}
                  onChange={e => updateDiscount(tier, 'threshold', e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
              <div>
                <label className="text-xs text-[#6B7280]">Discount Rate (%)</label>
                <input type="number" step="0.1" value={(form.discountTiers[tier].discountRate * 100).toFixed(1)}
                  onChange={e => updateDiscount(tier, 'discountRate', String(parseFloat(e.target.value) / 100))}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
              <div>
                <label className="text-xs text-[#6B7280]">Points Multiplier</label>
                <input type="number" step="0.1" value={form.pointsTiers[tier].multiplier}
                  onChange={e => updatePoints(tier, 'multiplier', e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
              <div>
                <label className="text-xs text-[#6B7280]">Redemption Rate (₹/pt)</label>
                <input type="number" step="0.01" value={form.pointsTiers[tier].redemptionRate}
                  onChange={e => updatePoints(tier, 'redemptionRate', e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Milestones */}
      <section className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <h2 className="text-base font-semibold text-[#111827] mb-4">Milestone Bonuses</h2>
        <div className="space-y-4">
          {form.milestones.map((m, i) => (
            <div key={i} className="grid grid-cols-3 gap-4 p-3 bg-[#F9FAFB] rounded-lg">
              <div>
                <label className="text-xs text-[#6B7280]">Milestone {m.number} — Threshold (pts)</label>
                <input type="number" value={m.threshold}
                  onChange={e => updateMilestone(i, 'threshold', e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] bg-white" />
              </div>
              <div>
                <label className="text-xs text-[#6B7280]">Lump Sum (pts)</label>
                <input type="number" value={m.lumpSum}
                  onChange={e => updateMilestone(i, 'lumpSum', e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] bg-white" />
              </div>
              <div>
                <label className="text-xs text-[#6B7280]">Band Boost (%)</label>
                <input type="number" step="0.1" value={(m.boostRate * 100).toFixed(1)}
                  onChange={e => updateMilestone(i, 'boostRate', String(parseFloat(e.target.value) / 100))}
                  className="w-full mt-1 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] bg-white" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {saveMutation.isError && (
        <p className="text-sm text-[#BE123C] mb-4">{(saveMutation.error as any)?.response?.data?.error ?? 'Failed to save'}</p>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="px-6 py-2.5 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save New Version'}
        </button>
        {saved && <p className="text-sm text-green-600">Settings saved — new version created</p>}
      </div>
    </div>
  )
}
