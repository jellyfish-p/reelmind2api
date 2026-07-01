import type { ModelsListResponse } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = query.page ? Number(query.page) : 1
  const limit = query.limit ? Number(query.limit) : 50

  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')

  const result = await nestGet<ModelsListResponse>('/models', {
    page,
    limit,
    source: 'new_arch,byteplus',
    type: 'image-to-video',
  }, token)

  return result
})
