<template>
  <div>
    <h1 class="page-title">Configuration</h1>

    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <template v-else-if="config">
      <form @submit.prevent="save">
        <div class="card">
          <h2>Server</h2>
          <div class="form-grid">
            <div class="field"><label>Port</label><input v-model.number="form.server.port" type="number" min="1" max="65535" class="input" /></div>
            <div class="field"><label>Host</label><input v-model="form.server.host" class="input" /></div>
          </div>
        </div>

        <div class="card">
          <h2>Admin Key</h2>
          <div class="row">
            <div class="muted mono">Current: {{ config.admin_key || '—' }}</div>
          </div>
          <div class="field" style="margin-top:8px">
            <label>New admin key (leave blank to keep)</label>
            <input v-model="form.admin_key" class="input" placeholder="new admin key" autocomplete="off" />
          </div>
        </div>

        <div class="card">
          <h2>ReelMind</h2>
          <div class="form-grid">
            <div class="field"><label>API Base</label><input v-model="form.reelmind.api_base" class="input" /></div>
            <div class="field"><label>Web Base</label><input v-model="form.reelmind.web_base" class="input" /></div>
            <div class="field full"><label>Google Client ID</label><input v-model="form.reelmind.google_client_id" class="input" /></div>
          </div>
        </div>

        <div class="card">
          <h2>Database</h2>
          <div class="field"><label>Path</label><input v-model="form.database.path" class="input" /></div>
        </div>

        <div class="card">
          <h2>Polling</h2>
          <div class="form-grid">
            <div class="field"><label>Interval (ms)</label><input v-model.number="form.polling.interval" type="number" min="1" class="input" /></div>
            <div class="field"><label>Max Retries</label><input v-model.number="form.polling.max_retries" type="number" min="1" class="input" /></div>
            <div class="field"><label>Token Refresh Margin (ms)</label><input v-model.number="form.polling.token_refresh_margin" type="number" min="1" class="input" /></div>
          </div>
        </div>

        <div class="row">
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save Changes' }}</button>
          <button class="btn" type="button" @click="reset">Reset</button>
          <span v-if="saveError" class="error-text">{{ saveError }}</span>
          <span v-if="saved" class="ok-text">Saved.</span>
        </div>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth', layout: 'admin' })
const api = useAdminApi()
const config = ref<SanitizedAppConfig | null>(null)
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const saveError = ref('')
const saved = ref(false)

const blank = () => ({
  server: { port: undefined as any, host: '' },
  admin_key: '',
  reelmind: { api_base: '', web_base: '', google_client_id: '' },
  database: { path: '' },
  polling: { interval: undefined as any, max_retries: undefined as any, token_refresh_margin: undefined as any },
})
const form = ref(blank())

function reset() {
  if (!config.value) return
  form.value = JSON.parse(JSON.stringify(config.value))
  form.value.admin_key = ''
  saveError.value = ''
  saved.value = false
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    config.value = await api.getConfig()
    reset()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    const patch: any = { ...form.value }
    if (!patch.admin_key) delete patch.admin_key
    config.value = await api.patchConfig(patch)
    reset()
    saved.value = true
  } catch (e: any) {
    saveError.value = e.message
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
