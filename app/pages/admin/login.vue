<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <h1>Admin Login</h1>
      <p class="hint">Enter the admin key to access the management console.</p>
      <input
        v-model="input"
        type="password"
        placeholder="Admin key"
        class="input"
        autofocus
      />
      <button class="btn btn-primary" type="submit" :disabled="loading">
        {{ loading ? 'Verifying…' : 'Login' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
const { setKey, key } = useAdminKey()
const input = ref('')
const loading = ref(false)
const error = ref('')

onMounted(() => {
  if (key.value) navigateTo('/admin')
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    setKey(input.value.trim())
    await useAdminApi().getStats()
    navigateTo('/admin')
  } catch (e: any) {
    error.value = e.message || 'Invalid admin key'
    setKey('')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1f2430; }
.login-card { background: #fff; padding: 32px; border-radius: 10px; width: 360px; display: flex; flex-direction: column; gap: 12px; }
.login-card h1 { margin: 0; font-size: 20px; }
.hint { margin: 0; color: #6b7280; font-size: 13px; }
.input { padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.error { color: #dc2626; margin: 0; font-size: 13px; }
</style>
