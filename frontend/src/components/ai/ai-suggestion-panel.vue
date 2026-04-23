<template>
  <div class="ai-panel mb-2">
    <div class="ai-panel-bar d-flex align-center px-3 py-1">
      <v-icon size="16" class="mr-1" color="primary">mdi-robot-outline</v-icon>
      <span class="text-caption font-weight-medium">Gợi ý AI</span>
      <span v-if="!expanded && suggestion" class="text-caption text-grey ml-2 text-truncate" style="max-width: 240px;">
        — {{ suggestion }}
      </span>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="primary" :loading="loading" @click="onAsk">Ask AI</v-btn>
      <v-btn
        size="x-small"
        variant="text"
        :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-up'"
        :aria-label="expanded ? 'Thu gọn' : 'Mở rộng'"
        @click="expanded = !expanded"
      />
    </div>
    <v-expand-transition>
      <div v-if="expanded" class="ai-panel-body pa-3">
        <v-alert v-if="error" type="error" density="compact" class="mb-2">{{ error }}</v-alert>
        <div v-if="suggestion" class="text-body-2 mb-2" style="white-space: pre-wrap;">{{ suggestion }}</div>
        <div v-else-if="!loading && !error" class="text-body-2 text-grey mb-2">Chưa có gợi ý.</div>
        <div class="d-flex justify-end">
          <v-btn size="small" color="primary" variant="tonal" :disabled="!suggestion" @click="$emit('apply')">
            Chèn vào ô nhập
          </v-btn>
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ suggestion: string; loading: boolean; error: string }>();
const emit = defineEmits<{ generate: []; apply: [] }>();

const expanded = ref(false);

watch(
  () => [props.suggestion, props.loading, props.error] as const,
  ([s, l, e]) => { if (s || l || e) expanded.value = true; },
);

function onAsk() {
  expanded.value = true;
  emit('generate');
}
</script>

<style scoped>
.ai-panel {
  border: 1px solid rgba(0, 242, 255, 0.15);
  border-radius: 8px;
  background: rgba(0, 242, 255, 0.03);
}
.ai-panel-bar { min-height: 32px; }
.ai-panel-body { border-top: 1px solid rgba(0, 242, 255, 0.1); }
</style>
