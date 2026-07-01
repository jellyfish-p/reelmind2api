export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/admin.css'],
  runtimeConfig: {
    googleClientId: '',
    public: {
      apiBaseUrl: '/api',
    },
  },
  appConfig: {
    database: {
      path: './data/reelmind.db',
    },
  },
  nitro: {
    experimental: {
      asyncContext: true,
    },
    routeRules: {
      '/api/v1/**': {
        cors: true,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        },
      },
      '/api/**': {
        cors: true,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Admin-Key',
        },
      },
    },
  },
})
