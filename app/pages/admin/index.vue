<template>
  <div>
    <h1 class="page-title">Dashboard</h1>

    <div v-if="loading" class="muted">Loading stats…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <template v-else-if="stats">
      <div class="grid grid-4">
        <div class="stat">
          <div class="label">Total Tasks</div>
          <div class="value">{{ stats.tasks.total }}</div>
          <div class="muted">{{ stats.tasks.recent }} in last 24h</div>
        </div>
        <div class="stat">
          <div class="label">Credits Used</div>
          <div class="value">{{ stats.tasks.totalCreditsUsed }}</div>
        </div>
        <div class="stat">
          <div class="label">Accounts</div>
          <div class="value">{{ stats.accounts.total }}</div>
          <div class="muted">{{ stats.accounts.expiredTokens }} expired tokens</div>
        </div>
        <div class="stat">
          <div class="label">API Keys</div>
          <div class="value">{{ stats.apiKeys.total }}</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <h2>Tasks by Status</h2>
          <table v-if="statusRows.length">
            <thead><tr><th>Status</th><th style="text-align:right">Count</th></tr></thead>
            <tbody>
              <tr v-for="[k, v] in statusRows" :key="k">
                <td><span class="badge" :class="statusBadge(k)">{{ k }}</span></td>
                <td style="text-align:right">{{ v }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No tasks yet.</p>
        </div>
        <div class="card">
          <h2>Tasks by Type</h2>
          <table v-if="typeRows.length">
            <thead><tr><th>Type</th><th style="text-align:right">Count</th></tr></thead>
            <tbody>
              <tr v-for="[k, v] in typeRows" :key="k">
                <td>{{ k }}</td>
                <td style="text-align:right">{{ v }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No tasks yet.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth', layout: 'admin' })
const api = useAdminApi()
const stats = ref<AdminStats | null>(null)
const loading = ref(true)
const error = ref('')

const statusRows = computed(() => stats.value ? Object.entries(stats.value.tasks.byStatus).sort((a, b) => b[1] - a[1]) : [])
const typeRows = computed(() => stats.value ? Object.entries(stats.value.tasks.byType).sort((a, b) => b[1] - a[1]) : [])

function statusBadge(s: string) {
  const map: Record<string, string> = {
    succeeded: 'badge-green', completed: 'badge-green', success: 'badge-green',
    failed: 'badge-red', error: 'badge-red',
    pending: 'badge-yellow', queued: 'badge-yellow',
    processing: 'badge-blue', running: 'badge-blue',
  }
  return map[s.toLowerCase()] || 'badge-gray'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await api.getStats()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
