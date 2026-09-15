import { useSearchParams } from 'react-router-dom'
import { readPagination, type PaginationParams } from '@/shared/lib/pagination'

export function usePagination() {
  const [params, setParams] = useSearchParams()
  const pagination = readPagination(params)

  function setPagination(next: PaginationParams) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('page', String(next.page))
      updated.set('pageSize', String(next.pageSize))
      return updated
    })
  }

  return { pagination, setPagination }
}
