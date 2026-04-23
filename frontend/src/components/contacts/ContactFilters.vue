<template>
  <v-row dense class="mb-2 align-center">
    <!-- Search -->
    <v-col cols="12" sm="4">
      <v-text-field
        v-model="filters.search"
        prepend-inner-icon="mdi-magnify"
        label="Tìm kiếm tên / SĐT / email"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Source filter -->
    <v-col cols="6" sm="4">
      <v-select
        v-model="filters.source"
        :items="sourceOptions"
        item-title="text"
        item-value="value"
        label="Nguồn"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Status filter — hidden on Nhóm tab (groups don't have status pipeline) -->
    <v-col v-if="!hideStatus" cols="6" sm="4">
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        item-title="text"
        item-value="value"
        label="Trạng thái"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ContactFilters } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, GROUP_SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';

const props = defineProps<{
  filters: ContactFilters & { threadType?: string };
  hideStatus?: boolean;
}>();
const emit = defineEmits<{ search: [] }>();

// On the Nhóm tab the Nguồn dropdown shows group-specific sources
// (TLXN / Khóa học / Nội bộ) instead of the individual-lead sources.
const sourceOptions = computed(() =>
  props.filters.threadType === 'group' ? GROUP_SOURCE_OPTIONS : SOURCE_OPTIONS,
);
const statusOptions = STATUS_OPTIONS;
</script>
