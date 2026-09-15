export const defaultPageSize = 30
export const maxPage = 1_000_000

export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PageInfo extends PaginationParams {
  total: number
}

function positiveInteger(value: string | null, fallback: number, max: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 1 && number <= max ? number : fallback
}

export function readPagination(params: URLSearchParams): PaginationParams {
  return {
    page: positiveInteger(params.get('page'), 1, maxPage),
    pageSize: positiveInteger(params.get('pageSize'), defaultPageSize, 100),
  }
}
