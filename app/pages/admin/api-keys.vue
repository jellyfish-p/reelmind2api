<template>
  <div>
    <div class="row" style="margin-bottom:16px">
      <h1 class="page-title" style="margin:0">API Keys</h1>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openCreate">+ New Key</button>
    </div>

    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <div v-else class="card" style="padding:0">
      <table>
        <thead>
          <tr><th>Name</th><th>Key</th><th>Quota</th><th>Rate Limit</th><th>Enabled</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(k, i) in keys" :key="i">
            <td>{{ k.name }}</td>
            <td class="mono">{{ k.key || '—' }}</td>
            <td>{{ k.quota }}</td>
            <td>{{ k.rate_limit }}</td>
            <td><span class="badge" :class="k.enabled ? 'badge-green' : 'badge-gray'">{{ k.enabled ? 'yes' : 'no' }}</span></td>
            <td>
              <button class="btn btn-sm" @click="openEdit(k)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="confirmDelete(k)">Delete</button>
            </td>
          </tr>
          <tr v-if="!keys.length"><td colspan="6" class="muted">No API keys configured.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Create / Edit modal -->
    <div v-if="modal" class="modal-backdrop" @click.self="modal = false">
      <div class="modal">
        <h3>{{ editMode ? 'Edit API Key' : 'New API Key' }}</h3>
        <div class="form-grid">
          <div class="field full">
            <label>Key {{ editMode ? '(leave blank to keep current)' : '*' }}</label>
            <input v-model="mForm.key" class="input mono" :placeholder="editMode ? '••••***••••' : 'full key string'" />
          </div>
          <div class="field full">
            <label>Name *</label>
            <input v-model="mForm.name" class="input" />
          </div>
          <div class="field"><label>Quota</label><input v-model.number="mForm.quota" type="number" min="0" class="input" /></div>
          <div class="field"><label>Rate Limit</label><input v-model.number="mForm.rate_limit" type="number" min="0" class="input" /></div>
          <div class="field full">
            <label><input type="checkbox" v-model="mForm.enabled" /> Enabled</label>
          </div>
          <template v-if="editMode">
            <div class="field full">
              <label>Original key (required to target this entry) *</label>
              <input v-model="targetKey" class="input mono" placeholder="paste the unmasked key to apply changes" />
              <small class="muted">List only shows a masked preview; enter the full original key to update or identify it.</small>
            </div>
          </template>
        </div>
        <p v-if="mError" class="error-text">{{ mError }}</p>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button class="btn" @click="modal = false">Cancel</button>
          <button class="btn btn-primary" :disabled="mSaving" @click="submit">{{ mSaving ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="delModal" class="modal-backdrop" @click.self="delModal = false">
      <div class="modal">
        <h3>Delete API Key</h3>
        <p>The list only shows a masked key preview. Enter the full original key to delete this entry.</p>
        <div class="field">
          <label>{{ delTarget?.name }} — preview: <span class="mono">{{ delTarget?.key }}</span></label>
          <input v-model="delKeyInput" class="input mono" placeholder="full original key" />
        </div>
        <p v-if="dError" class="error-text">{{ dError }}</p>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button class="btn" @click="delModal = false">Cancel</button>
          <button class="btn btn-danger" :disabled="dSaving" @click="doDelete">{{ dSaving ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth', layout: 'admin' })
const api = useAdminApi()
const keys = ref<SanitizedApiKeyConfig[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    keys.value = (await api.listApiKeys()).data
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

// modal
const modal = ref(false)
const editMode = ref(false)
const mSaving = ref(false)
const mError = ref('')
const targetKey = ref('')
const mForm = ref({ key: '', name: '', quota: 1000, rate_limit: 60, enabled: true })

function openCreate() {
  editMode.value = false
  mForm.value = { key: '', name: '', quota: 1000, rate_limit: 60, enabled: true }
  targetKey.value = ''
  mError.value = ''
  modal.value = true
}
function openEdit(k: SanitizedApiKeyConfig) {
  editMode.value = true
  mForm.value = { key: '', name: k.name, quota: k.quota, rate_limit: k.rate_limit, enabled: k.enabled }
  targetKey.value = ''
  mError.value = ''
  modal.value = true
}

async function submit() {
  mSaving.value = true
  mError.value = ''
  try {
    if (editMode.value) {
      if (!targetKey.value.trim()) throw new Error('Original key is required to target the entry.')
      const patch: any = {
        name: mForm.value.name,
        quota: mForm.value.quota,
        rate_limit: mForm.value.rate_limit,
        enabled: mForm.value.enabled,
      }
      if (mForm.value.key.trim()) patch.key = mForm.value.key.trim()
      await api.updateApiKey(targetKey.value.trim(), patch)
    } else {
      await api.createApiKey({
        key: mForm.value.key.trim(),
        name: mForm.value.name,
        quota: mForm.value.quota,
        rate_limit: mForm.value.rate_limit,
        enabled: mForm.value.enabled,
      })
    }
    modal.value = false
    await load()
  } catch (e: any) {
    mError.value = e.message
  } finally {
    mSaving.value = false
  }
}

// delete
const delModal = ref(false)
const delTarget = ref<SanitizedApiKeyConfig | null>(null)
const delKeyInput = ref('')
const dSaving = ref(false)
const dError = ref('')

function confirmDelete(k: SanitizedApiKeyConfig) {
  delTarget.value = k
  delKeyInput.value = ''
  dError.value = ''
  delModal.value = true
}
async function doDelete() {
  if (!delTarget.value) return
  dSaving.value = true
  dError.value = ''
  try {
    await api.deleteApiKey(delKeyInput.value.trim())
    delModal.value = false
    await load()
  } catch (e: any) {
    dError.value = e.message
  } finally {
    dSaving.value = false
  }
}
</script>
