<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom start">
    <template #activator="{ props: menuProps }">
      <v-text-field
        v-bind="menuProps"
        :model-value="displayValue"
        :label="label"
        :placeholder="placeholder"
        prepend-inner-icon="mdi-calendar"
        readonly
        density="compact"
        variant="outlined"
        hide-details
        :clearable="clearable"
        :style="{ maxWidth: maxWidth }"
        @click:clear="clearValue"
      />
    </template>
    <v-date-picker
      v-model="pickerDate"
      :first-day-of-week="1"
      show-adjacent-months
      hide-header
      @update:model-value="onPick"
    />
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { formatDate } from '@/utils/date-format';

const props = withDefaults(defineProps<{
  modelValue: string | null;
  label?: string;
  placeholder?: string;
  clearable?: boolean;
  maxWidth?: string;
}>(), {
  label: '',
  placeholder: 'dd/mm/yyyy',
  clearable: true,
  maxWidth: '180px',
});

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const open = ref(false);

// ISO string (YYYY-MM-DD) ↔ Date for v-date-picker
const pickerDate = computed<Date | null>({
  get: () => (props.modelValue ? new Date(props.modelValue) : null),
  set: () => { /* write handled in onPick */ },
});

const displayValue = computed(() => (props.modelValue ? formatDate(props.modelValue) : ''));

function onPick(v: Date | null) {
  if (!v) { emit('update:modelValue', null); open.value = false; return; }
  const d = new Date(v);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  emit('update:modelValue', iso);
  open.value = false;
}

function clearValue() {
  emit('update:modelValue', null);
}

watch(() => props.modelValue, () => { /* reactive */ });
</script>
