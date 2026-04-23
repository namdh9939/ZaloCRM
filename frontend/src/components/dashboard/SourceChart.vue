<template>
  <v-card>
    <v-card-title class="d-flex align-center text-body-1">
      Nguồn khách hàng
      <v-spacer />
      <v-btn-toggle v-model="mode" mandatory density="compact" variant="outlined" color="primary">
        <v-btn value="count" size="x-small">Số lượng</v-btn>
        <v-btn value="rate" size="x-small">% Chốt</v-btn>
      </v-btn-toggle>
    </v-card-title>
    <v-card-text>
      <div v-if="chartData" style="height: 250px;">
        <Pie v-if="mode === 'count'" :data="chartData" :options="chartOptions" />
        <Bar v-else :data="rateChartData!" :options="rateChartOptions" />
      </div>
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>

      <!-- Stat rows -->
      <div v-if="rows.length" class="mt-2">
        <div
          v-for="row in rows"
          :key="row.source"
          class="d-flex align-center py-1"
          style="border-top: 1px solid rgba(255,255,255,0.06);"
        >
          <div class="source-dot mr-2" :style="{ background: colorOf(row.source) }" />
          <div class="flex-grow-1 text-body-2">{{ sourceLabel(row.source) }}</div>
          <div class="text-caption text-grey mr-3">{{ row.count }} KH</div>
          <div class="text-caption font-weight-medium" :style="{ color: rateColor(row.conversionRate) }">
            {{ row.conversionRate }}% chốt
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pie, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  BarElement, CategoryScale, LinearScale,
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

interface SourceRow {
  source: string;
  count: number;
  converted: number;
  conversionRate: number;
}

// Backend may return either the new shape or the legacy { _count: N } shape.
const props = defineProps<{
  data: Array<SourceRow | { source: string; _count: { _all: number } | number }>;
}>();

const mode = ref<'count' | 'rate'>('count');

const sourceColors: Record<string, string> = {
  KH_TKSXN: '#1877F2',
  FP_NAM: '#E91E63',
  FP_NCM: '#9C27B0',
  KH_XNLD: '#FF9800',
  TU_TIM: '#4CAF50',
  HOTLINE_NCM: '#00BCD4',
  // Group sources (CSKH dashboard)
  TLXN: '#00F2FF',
  KHOA_HOC: '#FFC107',
  NOI_BO: '#9E9E9E',
  // legacy keys kept so old rows still show a colour
  FB: '#1877F2',
  TT: '#000000',
  GT: '#FF6F00',
  CN: '#4CAF50',
};
const SOURCE_LABELS: Record<string, string> = {
  KH_TKSXN: 'Khóa học TKSXN',
  FP_NAM: 'Fanpage anh Nam',
  FP_NCM: 'Fanpage NCM',
  KH_XNLD: 'Khóa học XNLĐ',
  TU_TIM: 'Tự tìm',
  HOTLINE_NCM: 'Hotline NCM',
  TLXN: 'TLXN',
  KHOA_HOC: 'Khóa học',
  NOI_BO: 'Nội bộ',
  FB: 'Facebook (cũ)',
  TT: 'TikTok (cũ)',
  GT: 'Giới thiệu (cũ)',
  CN: 'Cá nhân (cũ)',
};
function sourceLabel(s: string): string { return SOURCE_LABELS[s] ?? s; }
function colorOf(s: string): string { return sourceColors[s] ?? '#BDBDBD'; }
function rateColor(rate: number): string {
  if (rate >= 30) return '#4CAF50';
  if (rate >= 10) return '#FFB74D';
  return '#EF5350';
}

const rows = computed<SourceRow[]>(() => {
  if (!props.data?.length) return [];
  return props.data.map((d: any) => {
    if (typeof d.count === 'number') return d as SourceRow;
    const count = typeof d._count === 'number' ? d._count : d._count?._all ?? 0;
    return { source: d.source, count, converted: 0, conversionRate: 0 };
  });
});

const chartData = computed(() => {
  if (!rows.value.length) return null;
  return {
    labels: rows.value.map(r => sourceLabel(r.source)),
    datasets: [{
      data: rows.value.map(r => r.count),
      backgroundColor: rows.value.map(r => colorOf(r.source)),
    }],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12 } } },
};

const rateChartData = computed(() => {
  if (!rows.value.length) return null;
  return {
    labels: rows.value.map(r => sourceLabel(r.source)),
    datasets: [{
      label: '% chốt đơn',
      data: rows.value.map(r => r.conversionRate),
      backgroundColor: rows.value.map(r => colorOf(r.source)),
    }],
  };
});

const rateChartOptions: any = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: {
      beginAtZero: true,
      max: 100,
      ticks: { callback: (v: string | number) => v + '%' },
    },
  },
};
</script>

<style scoped>
.source-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
</style>
