<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <div class="brand">ReelMind Admin</div>
      <nav>
        <NuxtLink to="/admin" class="nav-link">Dashboard</NuxtLink>
        <NuxtLink to="/admin/config" class="nav-link">Config</NuxtLink>
        <NuxtLink to="/admin/api-keys" class="nav-link">API Keys</NuxtLink>
        <NuxtLink to="/admin/accounts" class="nav-link">Token Pool</NuxtLink>
        <NuxtLink to="/admin/tasks" class="nav-link">Task Logs</NuxtLink>
      </nav>
      <div class="sidebar-footer">
        <button class="btn btn-ghost" @click="logout">Logout</button>
      </div>
    </aside>
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const { key, clearKey } = useAdminKey()
function logout() {
  clearKey()
  navigateTo('/admin/login')
}
</script>

<style scoped>
.admin-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 220px; flex-shrink: 0; background: #1f2430; color: #cbd2e0;
  display: flex; flex-direction: column; padding: 16px 0;
}
.brand { font-weight: 700; font-size: 16px; padding: 0 16px 16px; color: #fff; }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; }
.nav-link { padding: 10px 16px; color: #cbd2e0; text-decoration: none; font-size: 14px; }
.nav-link:hover { background: #2a3142; color: #fff; }
.nav-link.router-link-active { background: #3b82f6; color: #fff; }
.sidebar-footer { margin-top: auto; padding: 12px 16px; }
.content { flex: 1; padding: 24px; overflow-x: auto; background: #f5f6f8; }
</style>
