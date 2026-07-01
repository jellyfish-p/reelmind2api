import type { LegoModelResponse } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')

  const result = await nestGet<LegoModelResponse[]>('/lego/models', undefined, token)
  return result
})
