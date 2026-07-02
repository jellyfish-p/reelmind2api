<template>
  <div>
    <div class="row" style="margin-bottom:16px">
      <h1 class="page-title" style="margin:0">Token Pool</h1>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openCreate">+ New Account</button>
    </div>

    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <div v-else class="card" style="padding:0">
      <table>
        <thead>
          <tr><th>Account</th><th>Tokens</th><th>Credits</th><th>Expires</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.id">
            <td>
              <div>{{ a.email }}</div>
              <div v-if="a.name" class="muted">{{ a.name }}</div>
            </td>
            <td>
              <span class="badge" :class="a.hasAccessToken ? 'badge-green' : 'badge-gray'" title="access token">A:{{ a.hasAccessToken ? 'yes' : 'no' }}</span>
              <span class="badge" :class="a.hasRefreshToken ? 'badge-green' : 'badge-gray'" style="margin-left:4px" title="refresh token">R:{{ a.hasRefreshToken ? 'yes' : 'no' }}</span>
            </td>
            <td>
              <span v-if="a.creditsRemaining !== null" class="badge" :class="a.creditsRemaining > 0 ? 'badge-green' : 'badge-red'">{{ fmtCredits(a.creditsRemaining) }}</span>
              <span v-else class="muted">unknown</span>
            </td>
            <td>
              <template v-if="a.tokenExpiresAt">
                <span class="badge" :class="a.tokenExpired ? 'badge-red' : 'badge-green'">{{ a.tokenExpired ? 'expired' : 'active' }}</span>
                <div class="muted mono">{{ fmt(a.tokenExpiresAt) }}</div>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td class="muted mono">{{ fmt(a.updatedAt) }}</td>
            <td>
              <button class="btn btn-sm" @click="openEdit(a)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="confirmDelete(a)">Delete</button>
            </td>
          </tr>
          <tr v-if="!accounts.length"><td colspan="6" class="muted">No accounts.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Create / Edit modal -->
    <div v-if="modal" class="modal-backdrop" @click.self="modal = false">
      <div class="modal">
        <h3>{{ editMode ? `Edit Account #${mForm.id}` : 'New Account' }}</h3>
        <div class="form-grid">
          <div class="field full"><label>Auth Cookie .0</label>
            <textarea v-model="mForm.cookiePart0" class="input" rows="4" placeholder="sb-...-auth-token.0=..."></textarea>
          </div>
          <div class="field full"><label>Auth Cookie .1</label>
            <textarea v-model="mForm.cookiePart1" class="input" rows="4" placeholder="sb-...-auth-token.1=..."></textarea>
          </div>
          <div class="field full"><label>Bearer Token</label>
            <textarea v-model="mForm.authorizationHeader" class="input" rows="3" placeholder="Bearer ..."></textarea>
          </div>
          <div class="field"><label>Credits Remaining</label>
            <input v-model.number="mForm.creditsRemaining" class="input" type="number" min="0" step="0.01" placeholder="Unknown">
          </div>
        </div>
        <p v-if="mError" class="error-text">{{ mError }}</p>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button class="btn" @click="modal = false">Cancel</button>
          <button class="btn btn-primary" :disabled="mSaving || !canSubmit" @click="submit">{{ mSaving ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="delTarget" class="modal-backdrop" @click.self="delTarget = null">
      <div class="modal">
        <h3>Delete Account #{{ delTarget.id }}</h3>
        <p>Delete <b>{{ delTarget.email }}</b>? Historical tasks are retained but detached from this account.</p>
        <p v-if="dError" class="error-text">{{ dError }}</p>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button class="btn" @click="delTarget = null">Cancel</button>
          <button class="btn btn-danger" :disabled="dSaving" @click="doDelete">{{ dSaving ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth', layout: 'admin' })
const api = useAdminApi()
const accounts = ref<SanitizedAccount[]>([])
const loading = ref(true)
const error = ref('')

function fmt(ts: number | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function fmtCredits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    accounts.value = (await api.listAccounts()).data
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
const mForm = ref({
  id: 0,
  cookiePart0: '',
  cookiePart1: '',
  authorizationHeader: '',
  creditsRemaining: null as number | string | null,
})
const hasTokenInput = computed(
  () => Boolean(
    (mForm.value.cookiePart0.trim() && mForm.value.cookiePart1.trim()) ||
    mForm.value.authorizationHeader.trim(),
  ),
)
const canSubmit = computed(() => editMode.value || hasTokenInput.value)

function openCreate() {
  editMode.value = false
  mForm.value = {
    id: 0,
    cookiePart0: '',
    cookiePart1: '',
    authorizationHeader: '',
    creditsRemaining: null,
  }
  mError.value = ''
  modal.value = true
}
async function openEdit(a: SanitizedAccount) {
  editMode.value = true
  mForm.value = {
    id: a.id,
    cookiePart0: '',
    cookiePart1: '',
    authorizationHeader: '',
    creditsRemaining: null,
  }
  mError.value = ''
  modal.value = true
  try {
    const detail = await api.getAccount(a.id)
    mForm.value = {
      id: a.id,
      cookiePart0: detail.cookiePart0 || '',
      cookiePart1: detail.cookiePart1 || '',
      authorizationHeader: detail.authorizationHeader || '',
      creditsRemaining: detail.creditsRemaining,
    }
  } catch (e: any) {
    mError.value = e.message
  }
}

async function submit() {
  mSaving.value = true
  mError.value = ''
  try {
    const tokenInput: any = {}
    if (mForm.value.cookiePart0.trim()) tokenInput.cookiePart0 = mForm.value.cookiePart0.trim()
    if (mForm.value.cookiePart1.trim()) tokenInput.cookiePart1 = mForm.value.cookiePart1.trim()
    if (mForm.value.authorizationHeader.trim()) tokenInput.authorizationHeader = mForm.value.authorizationHeader.trim()
    const creditsRemaining = normalizeCreditsInput(mForm.value.creditsRemaining)
    if (creditsRemaining !== undefined) tokenInput.creditsRemaining = creditsRemaining

    if (editMode.value) {
      await api.updateAccount(mForm.value.id, tokenInput)
    } else {
      await api.createAccount(tokenInput)
    }
    modal.value = false
    await load()
  } catch (e: any) {
    mError.value = e.message
  } finally {
    mSaving.value = false
  }
}

function normalizeCreditsInput(value: number | string | null): number | null | undefined {
  if (value === null || value === '') return editMode.value ? null : undefined
  const credits = Number(value)
  return Number.isFinite(credits) ? credits : undefined
}

// delete
const delTarget = ref<SanitizedAccount | null>(null)
const dSaving = ref(false)
const dError = ref('')
async function doDelete() {
  if (!delTarget.value) return
  dSaving.value = true
  dError.value = ''
  try {
    await api.deleteAccount(delTarget.value.id)
    delTarget.value = null
    await load()
  } catch (e: any) {
    dError.value = e.message
  } finally {
    dSaving.value = false
  }
}
</script>
