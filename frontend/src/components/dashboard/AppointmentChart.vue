<template>
  <v-card>
    <v-card-title class="text-body-1">Trạng thái lịch hẹn</v-card-title>
    <v-card-text>
      <Pie v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Pie } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

// Tolerant to both new shape ({status, count}) and legacy ({_count}).
type RawAptItem = { status: string; count?: number; _count?: { _all: number } | number };
const props = defineProps<{
  data: RawAptItem[];
}>();

const statusColors: Record<string, string> = {
  'scheduled': '#42A5F5',
  'completed': '#66BB6A',
  'cancelled': '#9E9E9E',
  'no_show': '#EF5350',
};

const statusLabels: Record<string, string> = {
  'scheduled': 'Đã lên lịch',
  'completed': 'Hoàn thành',
  'cancelled': 'Đã hủy',
  'no_show': 'Vắng mặt',
};

function getCount(item: RawAptItem): number {
  if (typeof item.count === 'number') return item.count;
  if (typeof item._count === 'number') return item._count;
  if (item._count && typeof item._count === 'object') return item._count._all ?? 0;
  return 0;
}

const chartData = computed(() => {
  if (!Array.isArray(props.data) || !props.data.length) return null;
  const filtered = props.data.filter(d => getCount(d) > 0);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => statusColors[d.status] || '#BDBDBD'),
    }],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12 } } },
};
</script>
