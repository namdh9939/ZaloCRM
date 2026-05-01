<template>
  <v-card>
    <v-card-title class="text-body-1">Pipeline khách hàng</v-card-title>
    <v-card-text>
      <Doughnut v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

// Accept any item shape: backend sends { status, count } or older { _count } —
// component is tolerant to either to avoid breaking when API changes.
type RawItem = {
  status: string | null;
  count?: number;
  _count?: { _all: number } | number;
};

const props = defineProps<{
  data: RawItem[];
}>();

const statusColors: Record<string, string> = {
  new: '#9E9E9E',
  consulting: '#42A5F5',
  quoting: '#FFA726',
  nurturing: '#AB47BC',
  converted: '#66BB6A',
  lost: '#EF5350',
};

const statusLabels: Record<string, string> = {
  new: 'Lead mới',
  consulting: 'Đang tư vấn',
  quoting: 'Đang báo giá',
  nurturing: 'Nuôi dưỡng',
  converted: 'Chuyển đổi',
  lost: 'Thất bại',
};

function getCount(item: RawItem): number {
  if (typeof item.count === 'number') return item.count;
  if (typeof item._count === 'number') return item._count;
  if (item._count && typeof item._count === 'object') return item._count._all ?? 0;
  return 0;
}

const chartData = computed(() => {
  if (!Array.isArray(props.data) || !props.data.length) return null;
  const filtered = props.data.filter(d => d.status && getCount(d) > 0);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status || ''] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => statusColors[d.status || ''] || '#BDBDBD'),
    }],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12 } } },
};
</script>
