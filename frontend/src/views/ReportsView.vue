<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h4">
        <v-icon class="mr-2" style="color: #00F2FF;">mdi-clipboard-text-clock</v-icon>
        Báo cáo quản lý
      </h1>
      <v-spacer />
      <template v-if="tab === 'weekly'">
        <DatePicker v-model="weekOf" label="Chọn tuần (bất kỳ ngày)" class="mr-2" />
      </template>
      <template v-else>
        <v-text-field
          v-model="monthOf"
          label="Tháng"
          type="month"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 180px;"
          class="mr-2"
        />
      </template>
      <v-btn color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="fetchReport">Làm mới</v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-3" color="primary" @update:model-value="fetchReport">
      <v-tab value="weekly"><v-icon start>mdi-calendar-week</v-icon>Báo cáo tuần</v-tab>
      <v-tab value="monthly"><v-icon start>mdi-calendar-month</v-icon>Báo cáo tháng</v-tab>
    </v-tabs>

    <div class="text-body-2 text-grey mb-3" v-if="periodLabel">
      Dữ liệu từ <strong>{{ periodLabel }}</strong>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Weekly trend chart — only for monthly report -->
    <v-card v-if="tab === 'monthly' && weeklyTrend.length" class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-chart-line</v-icon>
        Xu hướng theo tuần
      </v-card-title>
      <v-card-subtitle>Số lead mới vs chốt đơn mỗi tuần trong tháng</v-card-subtitle>
      <v-card-text>
        <div style="height: 220px;">
          <Line :data="trendChartData" :options="trendChartOptions" />
        </div>
      </v-card-text>
    </v-card>

    <!-- Section 1 — Team conversion -->
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-account-tie</v-icon>
        1. Hiệu suất chuyển đổi theo nhân viên
      </v-card-title>
      <v-card-subtitle>
        Tỉ lệ <strong>tiếp cận</strong> phản ánh tốc độ xử lý lead mới. Tỉ lệ <strong>chuyển đổi</strong>
        phản ánh chất lượng tư vấn và mức phù hợp của sản phẩm.
      </v-card-subtitle>
      <v-card-text>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Nhân viên</th>
              <th class="text-center">Lead tiếp nhận</th>
              <th class="text-center">Đã tư vấn</th>
              <th class="text-center">Chốt đơn</th>
              <th class="text-center">Tỉ lệ tiếp cận</th>
              <th class="text-center">Tỉ lệ chuyển đổi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in teamConversion" :key="row.userId">
              <td>
                {{ row.fullName }}
                <v-chip v-if="row.role !== 'member'" size="x-small" class="ml-1" variant="tonal" color="primary">
                  {{ roleLabel(row.role) }}
                </v-chip>
              </td>
              <td class="text-center">{{ row.leadsReceived }}</td>
              <td class="text-center">{{ row.leadsAdvised }}</td>
              <td class="text-center font-weight-bold">{{ row.leadsConverted }}</td>
              <td class="text-center">
                <span v-if="row.reachRate === null" class="text-grey">—</span>
                <span v-else :style="{ color: rateColor(row.reachRate, 50, 80) }" class="font-weight-medium">
                  {{ row.reachRate }}%
                  <v-icon v-if="row.reachRate < 50" size="14">mdi-alert</v-icon>
                </span>
              </td>
              <td class="text-center">
                <span v-if="row.closeRate === null" class="text-grey">—</span>
                <span v-else :style="{ color: rateColor(row.closeRate, 20, 40) }" class="font-weight-medium">
                  {{ row.closeRate }}%
                </span>
              </td>
            </tr>
            <tr v-if="!teamConversion.length">
              <td colspan="6" class="text-center text-grey py-4">Chưa ghi nhận lead mới trong kỳ báo cáo</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Section 2 — Pipeline bottleneck -->
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="warning">mdi-timer-sand</v-icon>
        2. Phân tích giai đoạn pipeline
      </v-card-title>
      <v-card-subtitle>
        Giai đoạn có đồng thời <strong>số khách lớn</strong> và <strong>thời gian lưu dài</strong>
        là điểm nghẽn cần ưu tiên rà soát quy trình và can thiệp kịp thời.
      </v-card-subtitle>
      <v-card-text>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Giai đoạn</th>
              <th class="text-center">Số khách hàng</th>
              <th class="text-center">Thời gian lưu TB (ngày)</th>
              <th class="text-center">Lâu nhất (ngày)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stageBottleneck" :key="row.status ?? 'null'">
              <td>
                <v-chip :color="stageColor(row.status)" size="small" variant="tonal">{{ row.label }}</v-chip>
              </td>
              <td class="text-center">{{ row.count }}</td>
              <td class="text-center">
                <span :style="{ color: daysColor(row.avgDaysInStage) }">
                  {{ row.avgDaysInStage ?? '—' }}
                  <v-icon v-if="(row.avgDaysInStage ?? 0) > 5 && row.count > 5" size="14">mdi-alert</v-icon>
                </span>
              </td>
              <td class="text-center text-grey">{{ row.maxDaysInStage ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Section 3 — Lost reasons -->
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="error">mdi-thumb-down-outline</v-icon>
        3. Phân tích lý do khách không chuyển đổi
      </v-card-title>
      <v-card-subtitle>
        Lý do chiếm tỉ trọng <strong>≥ 30%</strong> là dấu hiệu cần điều chỉnh ở
        chính sách giá, kịch bản tư vấn hoặc chương trình đào tạo nhân viên.
      </v-card-subtitle>
      <v-card-text>
        <div v-if="!lostReasons.length" class="text-center text-grey py-4">
          Không ghi nhận khách hàng chuyển sang trạng thái "Mất" trong kỳ báo cáo.
        </div>
        <div v-else>
          <div v-for="r in lostReasons" :key="r.reason" class="mb-3">
            <div class="d-flex align-center mb-1">
              <span class="text-body-1">{{ r.label }}</span>
              <v-spacer />
              <span class="text-body-2 font-weight-medium mr-2">{{ r.count }} KH</span>
              <span class="text-body-2" :style="{ color: r.percent >= 30 ? '#EF5350' : '#00F2FF' }">
                {{ r.percent }}%
              </span>
            </div>
            <v-progress-linear :model-value="r.percent" :color="r.percent >= 30 ? 'error' : 'primary'" height="8" rounded />
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Section 4 — Interaction quality -->
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="info">mdi-chat-processing-outline</v-icon>
        4. Chất lượng chăm sóc khách hàng
      </v-card-title>
      <v-card-subtitle>
        Thời gian phản hồi, hội thoại tồn đọng và mức độ chủ động theo dõi khách hàng
        phản ánh trực tiếp chất lượng dịch vụ của từng nhân viên.
      </v-card-subtitle>
      <v-card-text>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Nhân viên</th>
              <th class="text-center">Thời gian phản hồi TB</th>
              <th class="text-center">Hội thoại tồn đọng (&gt; 24h)</th>
              <th class="text-center">Tỉ lệ chủ động theo dõi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in interactionQuality" :key="row.userId">
              <td>{{ row.fullName }}</td>
              <td class="text-center">
                <span v-if="row.avgReplyMinutes === null" class="text-grey">—</span>
                <span v-else :style="{ color: replyTimeColor(row.avgReplyMinutes) }" class="font-weight-medium">
                  {{ formatMinutes(row.avgReplyMinutes) }}
                  <v-icon v-if="row.avgReplyMinutes > 60" size="14">mdi-alert</v-icon>
                </span>
              </td>
              <td class="text-center">
                <span :style="{ color: row.deadConversations > 5 ? '#EF5350' : row.deadConversations > 0 ? '#FFB74D' : '#4CAF50' }">
                  {{ row.deadConversations }}
                </span>
              </td>
              <td class="text-center">
                <span v-if="row.proactiveRate === null" class="text-grey">—</span>
                <span v-else :style="{ color: rateColor(row.proactiveRate, 30, 50) }" class="font-weight-medium">
                  {{ row.proactiveRate }}%
                </span>
              </td>
            </tr>
            <tr v-if="!interactionQuality.length">
              <td colspan="4" class="text-center text-grey py-4">Chưa ghi nhận hoạt động tương tác trong kỳ báo cáo</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api';
import DatePicker from '@/components/DatePicker.vue';
import { formatDate } from '@/utils/date-format';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface TeamRow {
  userId: string; fullName: string; role: string;
  leadsReceived: number; leadsAdvised: number; leadsConverted: number;
  reachRate: number | null; closeRate: number | null;
}
interface StageRow { status: string | null; label: string; count: number; avgDaysInStage: number | null; maxDaysInStage: number | null; }
interface LostRow { reason: string; label: string; count: number; percent: number; }
interface QualityRow { userId: string; fullName: string; avgReplyMinutes: number | null; deadConversations: number; proactiveRate: number | null; }
interface TrendPoint { weekStart: string; leads: number; converted: number; }

const today = new Date().toISOString().slice(0, 10);
const currentMonth = new Date().toISOString().slice(0, 7);
const tab = ref<'weekly' | 'monthly'>('weekly');
const weekOf = ref(today);
const monthOf = ref(currentMonth);
const loading = ref(false);

const teamConversion = ref<TeamRow[]>([]);
const stageBottleneck = ref<StageRow[]>([]);
const lostReasons = ref<LostRow[]>([]);
const interactionQuality = ref<QualityRow[]>([]);
const weeklyTrend = ref<TrendPoint[]>([]);
const periodLabel = ref('');

async function fetchReport() {
  loading.value = true;
  try {
    if (tab.value === 'weekly') {
      const res = await api.get('/reports/weekly', { params: { weekOf: weekOf.value } });
      const d = res.data;
      periodLabel.value = `${formatDate(d.weekStart)} — ${formatDate(d.weekEnd)}`;
      teamConversion.value = d.teamConversion || [];
      stageBottleneck.value = d.stageBottleneck || [];
      lostReasons.value = d.lostReasons || [];
      interactionQuality.value = d.interactionQuality || [];
      weeklyTrend.value = [];
    } else {
      const res = await api.get('/reports/monthly', { params: { monthOf: monthOf.value } });
      const d = res.data;
      periodLabel.value = `${formatDate(d.monthStart)} — ${formatDate(d.monthEnd)}`;
      teamConversion.value = d.teamConversion || [];
      stageBottleneck.value = d.stageBottleneck || [];
      lostReasons.value = d.lostReasons || [];
      interactionQuality.value = d.interactionQuality || [];
      weeklyTrend.value = d.weeklyTrend || [];
    }
  } catch (err) {
    console.error('Report fetch error:', err);
  } finally {
    loading.value = false;
  }
}

const trendChartData = computed(() => ({
  labels: weeklyTrend.value.map((p) => `Tuần ${formatDate(p.weekStart)}`),
  datasets: [
    {
      label: 'Lead mới',
      data: weeklyTrend.value.map((p) => p.leads),
      borderColor: '#00F2FF',
      backgroundColor: 'rgba(0, 242, 255, 0.1)',
      tension: 0.3,
    },
    {
      label: 'Chốt đơn',
      data: weeklyTrend.value.map((p) => p.converted),
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      tension: 0.3,
    },
  ],
}));

const trendChartOptions: any = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
};

function roleLabel(role: string): string {
  if (role === 'owner') return 'Chủ';
  if (role === 'admin') return 'QT';
  return '';
}
function rateColor(rate: number, redBelow: number, greenAbove: number): string {
  if (rate < redBelow) return '#EF5350';
  if (rate >= greenAbove) return '#4CAF50';
  return '#FFB74D';
}
function daysColor(days: number | null): string {
  if (days === null) return '#9E9E9E';
  if (days > 7) return '#EF5350';
  if (days > 3) return '#FFB74D';
  return '#4CAF50';
}
function replyTimeColor(mins: number): string {
  if (mins <= 30) return '#4CAF50';
  if (mins <= 60) return '#FFB74D';
  return '#EF5350';
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}
function stageColor(status: string | null): string {
  switch (status) {
    case 'new': return 'grey';
    case 'contacted': return 'info';
    case 'interested': return 'warning';
    case 'converted': return 'success';
    case 'lost': return 'error';
    default: return 'default';
  }
}

watch([weekOf, monthOf], () => fetchReport());
onMounted(() => fetchReport());
</script>
