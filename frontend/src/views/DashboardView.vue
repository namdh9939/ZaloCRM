<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h4">
        <v-icon class="mr-2" style="color: #00F2FF;">mdi-view-dashboard</v-icon>
        Dashboard
      </h1>
      <v-spacer />
      <v-select
        v-model="zaloAccountId"
        :items="zaloAccountOptions"
        item-title="title"
        item-value="value"
        label="Tài khoản Zalo"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 260px;"
        @update:model-value="refetch"
      />
    </div>

    <!-- 2 tabs: Sale / CSKH -->
    <v-tabs v-model="view" class="mb-3" color="primary" @update:model-value="refetch">
      <v-tab value="sale">
        <v-icon start>mdi-handshake</v-icon>
        Sale
        <span class="text-caption text-grey ml-1">(cá nhân)</span>
      </v-tab>
      <v-tab value="cskh">
        <v-icon start>mdi-account-heart</v-icon>
        CSKH
        <span class="text-caption text-grey ml-1">(nhóm TLXN)</span>
      </v-tab>
    </v-tabs>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <KpiCards :kpi="kpi" class="mb-4" />

    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <MessageVolumeChart :data="messageVolume" />
      </v-col>
      <v-col cols="12" md="4">
        <PipelineChart :data="pipeline" />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <SourceChart :data="sources" />
      </v-col>
      <v-col cols="12" md="6">
        <AppointmentChart :data="appointments" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import KpiCards from '@/components/dashboard/KpiCards.vue';
import MessageVolumeChart from '@/components/dashboard/MessageVolumeChart.vue';
import PipelineChart from '@/components/dashboard/PipelineChart.vue';
import SourceChart from '@/components/dashboard/SourceChart.vue';
import AppointmentChart from '@/components/dashboard/AppointmentChart.vue';
import { useDashboard } from '@/composables/use-dashboard';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';

const {
  kpi, messageVolume, pipeline, sources, appointments,
  loading, fetchAll,
} = useDashboard();

const { accounts, fetchAccounts } = useZaloAccounts();
const zaloAccountId = ref<string>('');
const view = ref<'sale' | 'cskh'>('sale');

const zaloAccountOptions = computed(() => [
  { title: 'Tất cả Zalo', value: '' },
  ...accounts.value.map((a) => ({ title: a.displayName || 'Zalo', value: a.id })),
]);

function refetch() {
  fetchAll(zaloAccountId.value || '', view.value);
}

onMounted(async () => {
  await fetchAccounts();
  refetch();
});
</script>
