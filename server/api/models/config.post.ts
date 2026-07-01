import type { ModelConfig } from '../../../types/reelmind'
import { getBearerToken, nestPost } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const result = await nestPost<ModelConfig>(
    '/models/config',
    body,
    getBearerToken(event),
  )
  return result
})
