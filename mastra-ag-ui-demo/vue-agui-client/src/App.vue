<script setup lang="ts">
import Chat from './components/Chat.vue'
</script>

<template>
  <main class="app">
    <h1>Mastra AG-UI POC</h1>
    <Chat />
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding-top: 40px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
</style>
