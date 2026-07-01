import type { ModelConfig } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')
  const body = await readBody(event)

  const result = await nestPost<ModelConfig>('/models/config', body, token)
  return result
})
