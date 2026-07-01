export default defineNitroPlugin(async () => {
  const { initializeDatabase } = await import('../db/init')
  const { startTokenPolling } = await import('../utils/token-manager')
  await initializeDatabase()
  await startTokenPolling()
})
