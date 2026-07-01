<template>
  <main>
    <h1>ReelMind API Proxy</h1>
    <pre>{{ JSON.stringify(data, null, 2) }}</pre>
  </main>
</template>

<script setup>
const { data } = await useFetch('/api/models/list', {
  query: { page: 1, limit: 5, source: 'new_arch,byteplus' },
})
</script>
