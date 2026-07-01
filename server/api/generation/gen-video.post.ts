import { getBearerToken, nestPost } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const result = await nestPost(
    '/generation/gen-video',
    body,
    getBearerToken(event),
  )
  return result
})
