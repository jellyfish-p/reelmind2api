import type { ModelSpec } from '../../../types/reelmind'
import { getBearerToken, nestGet } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const result = await nestGet<ModelSpec>(
    `/models/${encodeURIComponent(id)}`,
    undefined,
    getBearerToken(event),
  )
  return result
})
