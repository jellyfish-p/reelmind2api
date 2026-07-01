<template>
  <div>
    <h1 class="page-title">Task Logs</h1>

    <div class="card">
      <div class="row">
        <div class="field"><label>Status</label>
          <select v-model="filters.status" class="select"><option value="">any</option>
            <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="field"><label>Type</label>
          <select v-model="filters.type" class="select"><option value="">any</option>
            <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="field"><label>Model</label><input v-model="filters.model" class="input" placeholder="model id" /></div>
        <div class="field"><label>Account ID</label><input v-model="filters.account_id" class="input" placeholder="number" /></div>
        <div class="field"><label>API Token ID</label><input v-model="filters.api_token_id" class="input" placeholder="number" /></div>
        <div class="field"><label>Created from</label><input v-model="filters.created_from" class="input" type="datetime-local" /></div>
        <div class="field"><label>Created to</label><input v-model="filters.created_to" class="input" type="datetime-local" /></div>
        <div class="field"><label>Limit</label>
          <select v-model.number="filters.limit" class="select"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select>
        </div>
        <div class="row" style="align-self:flex-end">
          <button class="btn btn-primary" @click="apply">Apply</button>
          <button class="btn" @click="resetFilters">Reset</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <template v-else>
      <div class="card" style="padding:0">
        <table>
          <thead>
            <tr><th>ID</th><th>Task ID</th><th>Type</th><th>Model</th><th>Status</th><th>Progress</th><th>Credits</th><th>Account</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in tasks" :key="t.id" style="cursor:pointer" @click="openDetail(t)">
              <td>{{ t.id }}</td>
              <td class="mono">{{ t.taskId }}</td>
              <td>{{ t.type }}</td>
              <td class="mono">{{ t.model }}</td>
              <td><span class="badge" :class="statusBadge(t.status)">{{ t.status }}</span></td>
              <td>{{ t.progress }}</td>
              <td>{{ t.creditsUsed ?? '—' }}</td>
              <td>{{ t.accountId ?? '—' }}</td>
              <td class="muted mono">{{ fmt(t.createdAt) }}</td>
              <td><button class="btn btn-sm" @click.stop="openDetail(t)">View</button></td>
            </tr>
            <tr v-if="!tasks.length"><td colspan="10" class="muted">No tasks found.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="row" style="margin-top:12px; justify-content:space-between">
        <span class="muted">Total: {{ pagination.total }} · Page {{ pagination.page }} of {{ totalPages }}</span>
        <div class="row">
          <button class="btn btn-sm" :disabled="pagination.page <= 1" @click="goPage(pagination.page - 1)">Prev</button>
          <button class="btn btn-sm" :disabled="pagination.page >= totalPages" @click="goPage(pagination.page + 1)">Next</button>
        </div>
      </div>
    </template>

    <!-- Detail modal -->
    <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
      <div class="modal" style="width:680px">
        <h3>Task #{{ detail.id }} — <span class="mono">{{ detail.taskId }}</span></h3>
        <div class="grid grid-2">
          <div><b>Status:</b> <span class="badge" :class="statusBadge(detail.status)">{{ detail.status }}</span></div>
          <div><b>Progress:</b> {{ detail.progress }}</div>
          <div><b>Type:</b> {{ detail.type }}</div>
          <div><b>Model:</b> <span class="mono">{{ detail.model }}</span></div>
          <div><b>Account ID:</b> {{ detail.accountId ?? '—' }}</div>
          <div><b>API Token ID:</b> {{ detail.apiTokenId ?? '—' }}</div>
          <div><b>Credits used:</b> {{ detail.creditsUsed ?? '—' }}</div>
          <div><b>Poll count:</b> {{ detail.pollCount }}</div>
          <div><b>ReelMind task ID:</b> <span class="mono">{{ detail.reelmindTaskId || '—' }}</span></div>
          <div><b>Completed:</b> {{ detail.completedAt ? fmt(detail.completedAt) : '—' }}</div>
          <div class="full"><b>Created:</b> {{ fmt(detail.createdAt) }} · <b>Updated:</b> {{ fmt(detail.updatedAt) }}</div>
          <div v-if="detail.prompt" class="full"><b>Prompt:</b><div class="mono" style="white-space:pre-wrap">{{ detail.prompt }}</div></div>
          <div v-if="detail.negativePrompt" class="full"><b>Negative prompt:</b><div class="mono" style="white-space:pre-wrap">{{ detail.negativePrompt }}</div></div>
          <div v-if="detail.imageUrl" class="full"><b>Image URL:</b> <span class="mono">{{ detail.imageUrl }}</span></div>
          <div v-if="detail.aspectRatio" class="full"><b>Aspect ratio:</b> {{ detail.aspectRatio }}</div>
          <div v-if="detail.duration != null" class="full"><b>Duration:</b> {{ detail.duration }}</div>
          <div v-if="detail.resolution" class="full"><b>Resolution:</b> {{ detail.resolution }}</div>
          <div v-if="detail.resultUrl" class="full"><b>Result URL:</b> <a :href="detail.resultUrl" target="_blank" class="mono">{{ detail.resultUrl }}</a></div>
          <div v-if="detail.errorMessage" class="full"><b>Error:</b><div class="error-text mono" style="white-space:pre-wrap">{{ detail.errorMessage }}</div></div>
          <div v-if="detail.parameters != null" class="full"><b>Parameters:</b><pre class="json">{{ JSON.stringify(detail.parameters, null, 2) }}</pre></div>
          <div v-if="detail.resultData != null" class="full"><b>Result data:</b><pre class="json">{{ JSON.stringify(detail.resultData, null, 2) }}</pre></div>
        </div>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button class="btn" @click="detail = null">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth', layout: 'admin' })
const api = useAdminApi()
const tasks = ref<TaskSummary[]>([])
const pagination = ref({ page: 1, limit: 20, total: 0 })
const loading = ref(false)
const error = ref('')
const detail = ref<TaskDetail | null>(null)

const statusOptions = ['pending', 'processing', 'succeeded', 'failed', 'queued', 'completed']
const typeOptions = ['text-to-video', 'image-to-video', 'lego', 'image-generation']

const filters = ref({
  status: '', type: '', model: '', account_id: '', api_token_id: '',
  created_from: '', created_to: '', limit: 20,
})
const appliedPage = ref(1)

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.value.total / pagination.value.limit)))

function fmt(ts: number | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}
function statusBadge(s: string) {
  const map: Record<string, string> = {
    succeeded: 'badge-green', completed: 'badge-green', success: 'badge-green',
    failed: 'badge-red', error: 'badge-red',
    pending: 'badge-yellow', queued: 'badge-yellow',
    processing: 'badge-blue', running: 'badge-blue',
  }
  return map[s.toLowerCase()] || 'badge-gray'
}

function toEpoch(v: string): number | undefined {
  if (!v) return undefined
  const n = Date.parse(v)
  return Number.isNaN(n) ? undefined : n
}

function buildQuery(page: number) {
  const q: Record<string, any> = { page, limit: filters.value.limit || 20 }
  if (filters.value.status) q.status = filters.value.status
  if (filters.value.type) q.type = filters.value.type
  if (filters.value.model.trim()) q.model = filters.value.model.trim()
  const aid = Number(filters.value.account_id)
  if (filters.value.account_id && Number.isInteger(aid) && aid > 0) q.account_id = aid
  const tid = Number(filters.value.api_token_id)
  if (filters.value.api_token_id && Number.isInteger(tid) && tid > 0) q.api_token_id = tid
  const from = toEpoch(filters.value.created_from)
  if (from) q.created_from = from
  const to = toEpoch(filters.value.created_to)
  if (to) q.created_to = to
  return q
}

async function load(page: number) {
  loading.value = true
  error.value = ''
  try {
    const res = await api.listTasks(buildQuery(page))
    tasks.value = res.data
    pagination.value = res.pagination
    appliedPage.value = page
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function apply() { load(1) }
function resetFilters() {
  filters.value = { status: '', type: '', model: '', account_id: '', api_token_id: '', created_from: '', created_to: '', limit: 20 }
  load(1)
}
function goPage(p: number) { load(p) }

async function openDetail(t: TaskSummary) {
  detail.value = null
  try {
    detail.value = await api.getTask(t.id)
  } catch (e: any) {
    error.value = e.message
  }
}

onMounted(() => load(1))
</script>
