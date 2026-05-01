<template>
  <MobileContactView v-if="isMobile" />
  <div v-else>
    <!-- Toolbar -->
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h5 mr-4">Khách hàng</h1>
      <v-spacer />
      <v-btn
        variant="outlined"
        prepend-icon="mdi-content-duplicate"
        class="mr-2"
        @click="showDuplicateDialog = true"
      >
        Trùng lặp
        <v-badge
          v-if="duplicateTotal > 0"
          :content="duplicateTotal"
          color="error"
          inline
        />
      </v-btn>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Thêm KH</v-btn>
    </div>

    <!-- Filters — hide status dropdown on Nhóm tab -->
    <ContactFilters :filters="filters" :hide-status="filters.threadType === 'group'" @search="onFilterChange" />

    <!-- Thread-type toggle + Zalo account filter -->
    <div class="d-flex align-center mb-3 flex-wrap gap-2">
      <v-btn-toggle v-model="filters.threadType" mandatory density="comfortable" color="primary" variant="outlined" @update:model-value="onFilterChange">
        <v-btn value="">Tất cả</v-btn>
        <v-btn value="user">Cá nhân</v-btn>
        <v-btn value="group">Nhóm</v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-select
        v-model="filters.zaloAccountId"
        :items="zaloAccountOptions"
        item-title="title"
        item-value="value"
        label="Tài khoản Zalo"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 260px; min-width: 200px;"
        @update:model-value="onFilterChange"
      />
    </div>

    <!-- Data table -->
    <v-data-table-server
      :headers="headers"
      :items="contacts"
      :loading="loading"
      :items-per-page="pagination.limit"
      :items-length="total"
      :items-per-page-options="[20, 50, 100, 200]"
      item-value="id"
      hover
      @click:row="onRowClick"
      @update:options="onOptionsChange"
    >
      <!-- Avatar -->
      <template #item.avatarUrl="{ item }">
        <v-avatar size="32" color="grey-lighten-2">
          <v-img v-if="item.avatarUrl" :src="item.avatarUrl" />
          <v-icon v-else size="18">mdi-account</v-icon>
        </v-avatar>
      </template>

      <!-- Source chip -->
      <template #item.source="{ item }">
        <v-chip v-if="item.source" size="small" variant="tonal">
          {{ sourceLabel(item.source) }}
        </v-chip>
        <span v-else class="text-grey">—</span>
      </template>



      <!-- Status chip -->
      <template #item.status="{ item }">
        <v-chip
          v-if="item.contactType === 'internal'"
          color="warning"
          size="small"
          variant="tonal"
          class="mr-1"
        >
          Nội bộ
        </v-chip>
        <v-chip
          v-else-if="item.contactType === 'partner'"
          color="info"
          size="small"
          variant="tonal"
          class="mr-1"
        >
          Đối tác
        </v-chip>
        <v-chip
          v-else-if="item.status"
          :color="statusColor(item.status)"
          size="small"
          variant="tonal"
        >
          {{ statusLabel(item.status) }}
        </v-chip>
        <span v-else class="text-grey">—</span>
      </template>

      <!-- Converted at — auto-set khi status chuyển sang 'converted' -->
      <template #item.convertedAt="{ item }">
        <span v-if="item.convertedAt" class="text-body-2" style="color: #4CAF50;">
          {{ formatDate(item.convertedAt) }}
        </span>
        <span v-else class="text-grey">—</span>
      </template>

      <!-- First contact date -->
      <template #item.firstContactDate="{ item }">
        {{ item.firstContactDate ? formatDate(item.firstContactDate) : '—' }}
      </template>

      <!-- "Ngày tiếp nhận" for the Nhóm tab: prefer actual Zalo group creation time,
           fall back to CRM record createdAt if we haven't resolved it yet. -->
      <template #item.createdAt="{ item }">
        {{ groupDate(item) }}
      </template>

      <!-- Assigned user -->
      <template #item.assignedUser="{ item }">
        <span class="text-body-2">{{ item.assignedUser?.fullName ?? '—' }}</span>
      </template>

      <!-- Chất lượng CSKH (Service Quality Score) -->
      <template #item.serviceScore="{ item }">
        <v-tooltip
          v-if="item.serviceScore !== null && item.serviceScore !== undefined"
          :text="serviceLabelText(item.serviceLabel)"
          location="top"
        >
          <template #activator="{ props }">
            <v-chip
              v-bind="props"
              :color="item.serviceLabel ?? 'grey'"
              size="small"
              variant="tonal"
              class="font-weight-medium"
            >
              <v-icon start size="12">{{ serviceLabelIcon(item.serviceLabel) }}</v-icon>
              {{ item.serviceScore }}
            </v-chip>
          </template>
        </v-tooltip>
        <span v-else class="text-grey text-caption">—</span>
      </template>

      <!-- Last activity -->
      <template #item.lastActivity="{ item }">
        <span v-if="item.lastActivity" class="text-body-2">{{ relativeTime(item.lastActivity) }}</span>
        <span v-else class="text-grey">—</span>
      </template>
    </v-data-table-server>

    <!-- Contact detail/edit dialog -->
    <ContactDetailDialog
      v-model="showDialog"
      :contact="selectedContact"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <DuplicateReviewDialog
      v-model="showDuplicateDialog"
      @merged="onDuplicateMerged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ContactFilters from '@/components/contacts/ContactFilters.vue';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import { useContacts, useContactIntelligence, SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import MobileContactView from '@/views/MobileContactView.vue';
import { useMobile } from '@/composables/use-mobile';
import { formatDate } from '@/utils/date-format';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { computed } from 'vue';

const { isMobile } = useMobile();

const { contacts, total, loading, filters, pagination, fetchContacts } = useContacts();
const { duplicateTotal, fetchDuplicateGroups } = useContactIntelligence();
const { accounts, fetchAccounts } = useZaloAccounts();

const zaloAccountOptions = computed(() => [
  { title: 'Tất cả Zalo', value: '' },
  ...accounts.value.map((a) => ({ title: a.displayName || 'Zalo', value: a.id })),
]);

const showDialog = ref(false);
const showDuplicateDialog = ref(false);
const selectedContact = ref<Contact | null>(null);

const individualHeaders = [
  { title: '', key: 'avatarUrl', sortable: false, width: '48px' },
  { title: 'Tên Zalo', key: 'fullName', sortable: true },
  { title: 'Tên CRM', key: 'crmName', sortable: true },
  { title: 'SĐT', key: 'phone', sortable: false },
  { title: 'Nguồn', key: 'source', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Chuyển đổi', key: 'convertedAt', sortable: true },
  { title: 'Ngày tiếp nhận', key: 'firstContactDate', sortable: true },
  { title: 'Sale', key: 'assignedUser', sortable: false },
  { title: 'CL Phục Vụ', key: 'serviceScore', sortable: true, width: '110px' },
  { title: 'Hoạt động', key: 'lastActivity', sortable: true },
];

// Group tab — compact: Tên nhóm / Nguồn / Ngày tạo nhóm / Sale / CL Phục Vụ / Hoạt động
const groupHeaders = [
  { title: '', key: 'avatarUrl', sortable: false, width: '48px' },
  { title: 'Tên nhóm', key: 'fullName', sortable: true },
  { title: 'Nguồn', key: 'source', sortable: false },
  { title: 'Ngày tiếp nhận', key: 'createdAt', sortable: true },
  { title: 'Sale', key: 'assignedUser', sortable: false },
  { title: 'CL Phục Vụ', key: 'serviceScore', sortable: true, width: '110px' },
  { title: 'Hoạt động', key: 'lastActivity', sortable: true },
];

const headers = computed(() =>
  filters.threadType === 'group' ? groupHeaders : individualHeaders,
);

function sourceLabel(value: string) {
  return SOURCE_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    new: 'grey',
    consulting: 'blue',
    quoting: 'orange',
    nurturing: 'purple',
    converted: 'success',
    lost: 'error',
  };
  return map[status] ?? 'grey';
}

function serviceLabelText(label: string | null | undefined): string {
  const map: Record<string, string> = {
    success: '✅ Xuất sắc (85-100)',
    info: '🔵 Đạt yêu cầu (70-84)',
    warning: '⚠️ Cần nhắc nhở (50-69)',
    error: '🔴 Báo động đỏ (<50)',
  };
  return map[label ?? ''] ?? 'Chưa chấm điểm';
}

function serviceLabelIcon(label: string | null | undefined): string {
  const map: Record<string, string> = {
    success: 'mdi-star',
    info: 'mdi-check-circle',
    warning: 'mdi-alert',
    error: 'mdi-alert-octagon',
  };
  return map[label ?? ''] ?? 'mdi-help-circle';
}

function groupDate(item: Contact & { metadata?: Record<string, unknown> | null }) {
  const meta = item.metadata as Record<string, unknown> | undefined | null;
  const iso = typeof meta?.groupCreatedAt === 'string' ? (meta.groupCreatedAt as string) : null;
  if (iso) return formatDate(iso);
  return item.createdAt ? formatDate(item.createdAt) : '—';
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${days} ngày trước`;
}

function onFilterChange() {
  pagination.page = 1;
  fetchContacts();
}

function onOptionsChange(opts: { page: number; itemsPerPage: number }) {
  pagination.page = opts.page;
  pagination.limit = opts.itemsPerPage;
  fetchContacts();
}

function openCreate() {
  selectedContact.value = null;
  showDialog.value = true;
}

function onRowClick(_event: Event, row: { item: Contact }) {
  selectedContact.value = row.item;
  showDialog.value = true;
}

function onSaved() {
  fetchContacts();
}

function onDeleted() {
  fetchContacts();
}

function onDuplicateMerged() {
  fetchContacts();
  fetchDuplicateGroups();
}

onMounted(() => {
  // v-data-table-server triggers fetchContacts via @update:options on mount
  fetchDuplicateGroups();
  fetchAccounts();
});
</script>
