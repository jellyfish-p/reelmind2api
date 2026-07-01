import type { LegoModelResponse } from '../../../types/reelmind'
import { getBearerToken, nestGet } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const result = await nestGet<LegoModelResponse[]>(
    '/lego/models',
    undefined,
    getBearerToken(event),
  )
  return result
})
