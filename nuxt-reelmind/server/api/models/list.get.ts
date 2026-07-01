import type { ModelsListResponse, ModelsListParams } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const params: ModelsListParams = {
    page: query.page ? Number(query.page) : 1,
    limit: query.limit ? Number(query.limit) : 20,
    source: query.source?.toString(),
    type: query.type?.toString(),
  }

  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')

  const result = await nestGet<ModelsListResponse>('/models', {
    page: params.page,
    limit: params.limit,
    source: params.source,
    type: params.type,
  }, token)

  return result
})
