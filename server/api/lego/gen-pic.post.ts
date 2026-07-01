import { getBearerToken, nestPost } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const result = await nestPost('/lego/gen-pic', body, getBearerToken(event))
  return result
})
