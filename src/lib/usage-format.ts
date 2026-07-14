import type { UsageAggregateMetricDto } from '../../shared/companion-contract'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatUsageMetric(metric: UsageAggregateMetricDto, compactValue = false): string {
  if (metric.value === null) return 'Unknown'
  const formatted = (compactValue ? compact : number).format(metric.value)
  if (metric.value === 0 && metric.state === 'complete') return '0 reported'
  return metric.state === 'partial' ? `${formatted} known (incomplete)` : formatted
}

export function formatEstimatedCost(metric: UsageAggregateMetricDto, currency: string | undefined): string {
  if (metric.value === null) return 'Unknown estimated cost'
  const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(metric.value)
  return `${amount} estimated${metric.state === 'partial' ? ' (incomplete)' : ''}`
}
