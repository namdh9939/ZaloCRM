<template>
  <v-alert
    v-if="suggestedStatus"
    :color="alertColor"
    variant="tonal"
    density="compact"
    icon="mdi-robot-outline"
    class="mb-3"
  >
    <div class="d-flex align-start ga-2">
      <div class="flex-grow-1">
        <div class="text-body-2 font-weight-medium">
          AI gợi ý chuyển sang: <span class="font-weight-bold">{{ statusLabel }}</span>
        </div>
        <div v-if="reason" class="text-caption text-medium-emphasis mt-1">
          {{ reason }}
        </div>
      </div>
      <div class="d-flex flex-column ga-1">
        <v-btn
          size="x-small"
          color="primary"
          variant="flat"
          :loading="applying"
          :disabled="rejecting"
          prepend-icon="mdi-check"
          @click="onApply"
        >
          Áp dụng
        </v-btn>
        <v-btn
          size="x-small"
          variant="text"
          :loading="rejecting"
          :disabled="applying"
          prepend-icon="mdi-close"
          @click="onReject"
        >
          Bỏ qua
        </v-btn>
      </div>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { STATUS_OPTIONS, useContacts } from '@/composables/use-contacts';

const props = defineProps<{
  contactId: string;
  suggestedStatus: string | null | undefined;
  suggestedStatusReason?: string | null;
}>();

const emit = defineEmits<{
  applied: [newStatus: string];
  rejected: [];
}>();

const { applySuggestedStatus, rejectSuggestedStatus } = useContacts();
const applying = ref(false);
const rejecting = ref(false);

const reason = computed(() => props.suggestedStatusReason || '');

const statusLabel = computed(() => {
  const opt = STATUS_OPTIONS.find((s) => s.value === props.suggestedStatus);
  return opt?.text || props.suggestedStatus;
});

const alertColor = computed(() => {
  if (props.suggestedStatus === 'lost') return 'error';
  if (props.suggestedStatus === 'nurturing') return 'warning';
  return 'info';
});

async function onApply() {
  if (!props.contactId || !props.suggestedStatus) return;
  applying.value = true;
  try {
    const updated = await applySuggestedStatus(props.contactId);
    if (updated) emit('applied', updated.status ?? props.suggestedStatus);
  } finally {
    applying.value = false;
  }
}

async function onReject() {
  if (!props.contactId) return;
  rejecting.value = true;
  try {
    const ok = await rejectSuggestedStatus(props.contactId);
    if (ok) emit('rejected');
  } finally {
    rejecting.value = false;
  }
}
</script>
