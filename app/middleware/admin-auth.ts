export default defineNuxtRouteMiddleware((to) => {
  const { key } = useAdminKey()
  if (to.path === '/admin/login') return
  if (!key.value) {
    return navigateTo('/admin/login')
  }
})
