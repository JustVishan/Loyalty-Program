export function formatCurrency(amount: number | string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount))
}

export function formatNumber(n: number | string): string {
  return new Intl.NumberFormat('en-IN').format(Number(n))
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function tierBadgeColor(tier: string): string {
  switch (tier) {
    case 'gold':     return 'bg-yellow-100 text-yellow-800'
    case 'platinum': return 'bg-blue-100 text-blue-800'
    case 'diamond':  return 'bg-purple-100 text-purple-800'
    default:         return 'bg-gray-100 text-gray-800'
  }
}
