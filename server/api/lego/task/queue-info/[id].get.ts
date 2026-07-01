import { getBearerToken, nestGet } from '../../../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const result = await nestGet(
    `/lego/task/queue-info/${encodeURIComponent(id)}`,
    undefined,
    getBearerToken(event),
  )
  return result
})
