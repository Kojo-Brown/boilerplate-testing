// Pagination utilities used by MSW handlers — also re-exported for test authors

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface PaginationParams {
  page: number
  limit: number
}

/**
 * Parse `page` and `limit` from a URL's search params, clamping to safe ranges.
 * Defaults: page=1, limit=10, max limit=100.
 */
export function parsePaginationParams(
  url: URL,
  defaults: PaginationParams = { page: 1, limit: 10 },
): PaginationParams {
  const rawPage = url.searchParams.get('page')
  const rawLimit = url.searchParams.get('limit')
  const page = Math.max(1, Number(rawPage ?? defaults.page))
  const limit = Math.min(100, Math.max(1, Number(rawLimit ?? defaults.limit)))
  return { page, limit }
}

/**
 * Slice `items` into a page and wrap with cursor metadata.
 * Returns an empty page (not an error) when page exceeds totalPages.
 */
export function paginateItems<T>(
  items: T[],
  page: number,
  limit: number,
): PaginatedResponse<T> {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = (page - 1) * limit
  const data = items.slice(start, start + limit)

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  }
}
