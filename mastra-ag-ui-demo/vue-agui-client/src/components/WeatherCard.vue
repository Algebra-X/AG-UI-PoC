<template>
  <div class="card">
    <div class="title">Weather: {{ location }}</div>

    <div class="row">
      <span class="temp">{{ temperature }}</span>
      <span class="status">{{ status }}</span>
    </div>

    <div class="meta">
      <div>Humidity: {{ humidity }}</div>
      <div>Wind: {{ wind }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  location: string;
  temperature: string;
  status: string;
  humidity?: string;
  wind?: string;
}>();
</script>

<style scoped>
.card {
  border: 1px solid var(--wc-border);
  border-radius: 12px;
  padding: 12px;
  margin-top: 8px;

  background: var(--wc-bg);
  color: var(--wc-text);

  box-shadow: 0 6px 18px rgba(0,0,0,0.12);
  backdrop-filter: blur(4px);
}

.title {
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--wc-title);
}

.row {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.temp {
  font-size: 22px;
  font-weight: 700;
}

.status {
  font-size: 14px;
  opacity: 0.85;
}

.meta {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.9;
}

/* -------- Light theme defaults -------- */
:root {
  --wc-bg: #fafafa;
  --wc-text: #111827;
  --wc-title: #0f172a;
  --wc-border: #e5e7eb;
}

/* -------- Dark theme overrides -------- */
@media (prefers-color-scheme: dark) {
  :root {
    --wc-bg: rgba(17, 24, 39, 0.9);   /* тёмный полупрозрачный */
    --wc-text: #e5e7eb;               /* светлый текст */
    --wc-title: #ffffff;
    --wc-border: rgba(255,255,255,0.12);
  }

  .card {
    box-shadow: 0 8px 22px rgba(0,0,0,0.45);
  }
}
</style>
