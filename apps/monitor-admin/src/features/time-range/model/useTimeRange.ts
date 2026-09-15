import { useSearchParams } from 'react-router-dom'
import { presetTimeRange, readTimeRange, withTimeRange, type TimeRange } from './timeRange'

export function useTimeRange() {
  const [params, setParams] = useSearchParams()
  const range = readTimeRange(params)

  function setRange(next: TimeRange) {
    setParams((current) => withTimeRange(current, next))
  }

  function refresh(refetch: () => unknown) {
    if (range && range.preset !== 'custom') setRange(presetTimeRange(range.preset))
    else if (range) void refetch()
  }

  return { range, setRange, refresh }
}
