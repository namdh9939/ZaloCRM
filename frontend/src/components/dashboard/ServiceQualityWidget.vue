<template>
  <v-card variant="outlined" class="pa-4">
    <!-- Header -->
    <div class="d-flex align-center mb-3">
      <v-icon class="mr-2" color="primary">mdi-shield-star</v-icon>
      <span class="text-subtitle-1 font-weight-bold">Chất lượng Phục Vụ</span>
      <v-spacer />
      <v-btn
        :loading="scoring"
        size="small"
        variant="tonal"
        color="primary"
        prepend-icon="mdi-robot"
        @click="runBatchScore"
      >
        Chấm điểm ngay
      </v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <!-- Điểm trung bình + tổng hội thoại -->
    <div v-if="data" class="mb-4">
      <div class="d-flex align-center gap-4 flex-wrap">
        <div class="text-center">
          <div class="text-h4 font-weight-bold" :class="avgScoreClass">
            {{ data.avgScore ?? '—' }}
          </div>
          <div class="text-caption text-grey">Điểm TB</div>
        </div>
        <div class="text-center">
          <div class="text-h5 font-weight-medium text-primary">{{ data.totalScored }}</div>
          <div class="text-caption text-grey">Đã chấm</div>
        </div>
        <v-divider vertical class="mx-2" />
        <!-- Distribution badges -->
        <div class="d-flex flex-wrap gap-2">
          <v-chip color="success" variant="tonal" size="small">
            <v-icon start size="14">mdi-star</v-icon>
            Xuất sắc: {{ data.distribution.success }}
          </v-chip>
          <v-chip color="info" variant="tonal" size="small">
            <v-icon start size="14">mdi-check-circle</v-icon>
            Đạt: {{ data.distribution.info }}
          </v-chip>
          <v-chip color="warning" variant="tonal" size="small">
            <v-icon start size="14">mdi-alert</v-icon>
            Nhắc nhở: {{ data.distribution.warning }}
          </v-chip>
          <v-chip color="error" variant="tonal" size="small">
            <v-icon start size="14">mdi-alert-octagon</v-icon>
            Báo động: {{ data.distribution.error }}
          </v-chip>
        </div>
      </div>
    </div>

    <!-- Cần action ngay -->
    <div v-if="data && data.actionRequired.length > 0" class="mb-4">
      <div class="d-flex align-center mb-2">
        <v-icon color="error" size="18" class="mr-1">mdi-bell-alert</v-icon>
        <span class="text-body-2 font-weight-bold text-error">
          Cần xem ngay ({{ data.actionRequired.length }})
        </span>
      </div>
      <v-list density="compact" class="pa-0">
        <v-list-item
          v-for="item in data.actionRequired.slice(0, 5)"
          :key="item.conversationId"
          class="px-0"
          rounded="lg"
        >
          <template #prepend>
            <v-avatar size="28" color="error" variant="tonal" class="mr-2">
              <v-icon size="14">mdi-account</v-icon>
            </v-avatar>
          </template>
          <v-list-item-title class="text-body-2">
            {{ item.contact?.crmName || item.contact?.fullName || 'Khách hàng' }}
          </v-list-item-title>
          <v-list-item-subtitle class="text-caption">
            {{ item.summary || 'Vi phạm thái độ nghiêm trọng' }}
          </v-list-item-subtitle>
          <template #append>
            <v-chip
              :color="item.serviceLabel ?? 'error'"
              size="x-small"
              variant="tonal"
            >
              {{ item.serviceScore }}đ
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
      <div v-if="data.actionRequired.length > 5" class="text-caption text-grey mt-1">
        + {{ data.actionRequired.length - 5 }} hội thoại khác cần kiểm tra
      </div>
    </div>

    <v-divider v-if="data && data.staffSummary.length > 0" class="mb-3" />

    <!-- Bảng nhân viên -->
    <div v-if="data && data.staffSummary.length > 0">
      <div class="text-body-2 font-weight-bold mb-2">Theo nhân viên</div>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Nhân viên</th>
            <th class="text-center">Điểm TB</th>
            <th class="text-center">Đã chấm</th>
            <th class="text-left">Phân bố</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="staff in data.staffSummary" :key="staff.userId">
            <td class="text-body-2">{{ staff.fullName }}</td>
            <td class="text-center">
              <v-chip
                :color="staffScoreColor(staff.avgScore)"
                size="x-small"
                variant="tonal"
                class="font-weight-bold"
              >
                {{ staff.avgScore }}
              </v-chip>
            </td>
            <td class="text-center text-caption text-grey">{{ staff.totalScored }}</td>
            <td>
              <div class="d-flex gap-1">
                <v-tooltip text="Xuất sắc" location="top">
                  <template #activator="{ props }">
                    <v-chip v-bind="props" v-if="staff.labels.success" color="success" size="x-small" variant="tonal">{{ staff.labels.success }}</v-chip>
                  </template>
                </v-tooltip>
                <v-tooltip text="Đạt yêu cầu" location="top">
                  <template #activator="{ props }">
                    <v-chip v-bind="props" v-if="staff.labels.info" color="info" size="x-small" variant="tonal">{{ staff.labels.info }}</v-chip>
                  </template>
                </v-tooltip>
                <v-tooltip text="Cần nhắc nhở" location="top">
                  <template #activator="{ props }">
                    <v-chip v-bind="props" v-if="staff.labels.warning" color="warning" size="x-small" variant="tonal">{{ staff.labels.warning }}</v-chip>
                  </template>
                </v-tooltip>
                <v-tooltip text="Báo động đỏ" location="top">
                  <template #activator="{ props }">
                    <v-chip v-bind="props" v-if="staff.labels.error" color="error" size="x-small" variant="tonal">{{ staff.labels.error }}</v-chip>
                  </template>
                </v-tooltip>
              </div>
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && !data" class="text-center py-6 text-grey">
      <v-icon size="40" class="mb-2">mdi-shield-off</v-icon>
      <div class="text-body-2">Chưa có dữ liệu chất lượng phục vụ</div>
      <div class="text-caption mt-1">Nhấn "Chấm điểm ngay" để bắt đầu</div>
    </div>

    <!-- Snackbar feedback -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000" location="top">
      {{ snackbar.message }}
    </v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api/index';

const props = defineProps<{
  zaloAccountId?: string;
  view?: string;
}>();

interface StaffSummary {
  userId: string;
  fullName: string;
  avgScore: number;
  totalScored: number;
  labels: { success: number; info: number; warning: number; error: number };
}

interface ActionItem {
  conversationId: string;
  serviceScore: number | null;
  serviceLabel: string | null;
  serviceScoreAt: string | null;
  summary: string | null;
  contact: { id: string; fullName: string | null; crmName: string | null } | null;
}

interface ServiceQualityData {
  avgScore: number | null;
  totalScored: number;
  distribution: { success: number; info: number; warning: number; error: number; total: number };
  actionRequired: ActionItem[];
  staffSummary: StaffSummary[];
}

const data = ref<ServiceQualityData | null>(null);
const loading = ref(false);
const scoring = ref(false);
const snackbar = ref({ show: false, message: '', color: 'success' });

const avgScoreClass = computed(() => {
  if (data.value?.avgScore === null || data.value?.avgScore === undefined) return 'text-grey';
  if (data.value.avgScore >= 85) return 'text-success';
  if (data.value.avgScore >= 70) return 'text-info';
  if (data.value.avgScore >= 50) return 'text-warning';
  return 'text-error';
});

function staffScoreColor(score: number): string {
  if (score >= 85) return 'success';
  if (score >= 70) return 'info';
  if (score >= 50) return 'warning';
  return 'error';
}

async function fetchData() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (props.zaloAccountId) params.set('zaloAccountId', props.zaloAccountId);
    if (props.view) params.set('view', props.view);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const result = await api.get(`/dashboard/service-quality${qs}`);
    data.value = result.data;
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

async function runBatchScore() {
  scoring.value = true;
  try {
    const result = await api.post('/ai/service-score/batch', {
      activeWithinHours: 48,
      batchLimit: 50,
    });
    snackbar.value = {
      show: true,
      message: `Đã chấm ${result.data.processed} hội thoại (${result.data.errors} lỗi)`,
      color: result.data.errors > 0 ? 'warning' : 'success',
    };
    // Reload data sau khi chấm xong
    await fetchData();
  } catch {
    snackbar.value = { show: true, message: 'Không thể chạy chấm điểm. Kiểm tra cấu hình AI.', color: 'error' };
  } finally {
    scoring.value = false;
  }
}

watch(() => [props.zaloAccountId, props.view], () => {
  fetchData();
});

onMounted(() => {
  fetchData();
});

// Expose để parent có thể trigger refetch
defineExpose({ fetchData });
</script>
