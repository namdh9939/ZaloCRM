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

      <!-- Email -->
      <template #item.email="{ item }">
        <span v-if="item.email" class="text-body-2">{{ item.email }}</span>
        <span v-else class="text-grey">—</span>
      </template>

      <!-- Status chip -->
      <template #item.status="{ item }">
        <v-chip
          v-if="item.status"
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

      <!-- Lead score -->
      <template #item.leadScore="{ item }">
        <v-chip
          :color="scoreColor(item.leadScore)"
          size="small"
          variant="tonal"
        >
          {{ item.leadScore ?? 0 }}
        </v-chip>
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
  { title: 'Email', key: 'email', sortable: false },
  { title: 'Nguồn', key: 'source', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Chuyển đổi', key: 'convertedAt', sortable: true },
  { title: 'Ngày tiếp nhận', key: 'firstContactDate', sortable: true },
  { title: 'Sale', key: 'assignedUser', sortable: false },
  { title: 'Điểm', key: 'leadScore', sortable: true, width: '80px' },
  { title: 'Hoạt động', key: 'lastActivity', sortable: true },
];

// Group tab — compact: Tên nhóm / Nguồn / Ngày tạo nhóm / Sale / Điểm / Hoạt động
const groupHeaders = [
  { title: '', key: 'avatarUrl', sortable: false, width: '48px' },
  { title: 'Tên nhóm', key: 'fullName', sortable: true },
  { title: 'Nguồn', key: 'source', sortable: false },
  { title: 'Ngày tiếp nhận', key: 'createdAt', sortable: true },
  { title: 'Sale', key: 'assignedUser', sortable: false },
  { title: 'Điểm', key: 'leadScore', sortable: true, width: '80px' },
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
    contacted: 'blue',
    interested: 'orange',
    converted: 'success',
    lost: 'error',
  };
  return map[status] ?? 'grey';
}

function scoreColor(score: number) {
  if (score >= 70) return 'success';
  if (score >= 40) return 'orange';
  return 'error';
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
