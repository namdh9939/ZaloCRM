<template>
  <div class="mobile-contacts pa-3">
    <!-- Toolbar -->
    <div class="d-flex align-center mb-3">
      <h1 class="text-h6 font-weight-bold">Khách hàng</h1>
      <v-spacer />
      <v-btn
        icon="mdi-content-duplicate"
        variant="text"
        size="small"
        class="mr-1"
        @click="showDuplicateDialog = true"
      >
        <v-icon size="20">mdi-content-duplicate</v-icon>
        <v-badge
          v-if="duplicateTotal > 0"
          :content="duplicateTotal"
          color="error"
          floating
          offset-x="-2"
          offset-y="-2"
        />
      </v-btn>
    </div>

    <!-- Search & Filters -->
    <v-text-field
      v-model="filters.search"
      placeholder="Tìm khách hàng..."
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="compact"
      hide-details
      clearable
      rounded="lg"
      class="mb-3"
      @update:model-value="onSearch"
    />

    <!-- Quick Filter Toggles -->
    <div class="d-flex align-center mb-3" style="gap: 8px;">
      <v-btn-toggle
        v-model="filters.threadType"
        mandatory
        density="compact"
        color="primary"
        variant="outlined"
        rounded="lg"
        @update:model-value="fetchContacts"
      >
        <v-btn value="" size="small">Tất cả</v-btn>
        <v-btn value="user" size="small">Cá nhân</v-btn>
        <v-btn value="group" size="small">Nhóm</v-btn>
      </v-btn-toggle>

      <v-select
        v-model="filters.zaloAccountId"
        :items="zaloAccountOptions"
        item-title="title"
        item-value="value"
        label="Zalo"
        density="compact"
        variant="outlined"
        hide-details
        rounded="lg"
        @update:model-value="fetchContacts"
      />
    </div>

    <!-- Status chips (scrollable) -->
    <div class="d-flex gap-2 mb-4 overflow-x-auto pb-1" style="flex-wrap: nowrap;">
      <v-chip
        v-for="status in STATUS_OPTIONS"
        :key="status.value"
        :color="filters.status === status.value ? statusColor(status.value) : undefined"
        :variant="filters.status === status.value ? 'flat' : 'outlined'"
        size="small"
        class="flex-shrink-0"
        @click="toggleStatus(status.value)"
      >
        {{ status.text }}
      </v-chip>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="d-flex justify-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Contact cards -->
    <div v-else class="d-flex flex-column gap-3">
      <v-card
        v-for="contact in contacts"
        :key="contact.id"
        variant="flat"
        border
        class="contact-card overflow-hidden"
        style="border-radius: 12px; border-color: rgba(var(--v-border-color), 0.12);"
        @click="openContact(contact)"
      >
        <v-card-text class="pa-3">
          <div class="d-flex align-start mb-2">
            <v-avatar size="44" color="grey-lighten-2" class="mr-3 mt-1 shadow-sm">
              <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" />
              <v-icon v-else size="24">mdi-account</v-icon>
            </v-avatar>
            <div style="flex: 1; min-width: 0;">
              <div class="d-flex align-center mb-0.5">
                <span class="text-subtitle-2 font-weight-bold text-truncate mr-2">{{ contact.fullName }}</span>
                <v-chip v-if="contact.status" :color="statusColor(contact.status)" size="x-small" density="compact" variant="flat" style="height: 18px; font-size: 10px;">
                  {{ statusLabel(contact.status) }}
                </v-chip>
              </div>
              <div class="text-caption text-medium-emphasis d-flex align-center">
                <v-icon size="12" class="mr-1">mdi-phone</v-icon>
                {{ contact.phone || '—' }}
                <span class="mx-2 text-grey">|</span>
                <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>
                {{ relativeTime(contact.lastActivity) }}
              </div>
            </div>
            <!-- Service score badge -->
            <div v-if="contact.serviceScore !== null" class="ml-2">
              <v-chip :color="contact.serviceLabel" size="x-small" variant="tonal" class="font-weight-bold">
                {{ contact.serviceScore }}
              </v-chip>
            </div>
          </div>

          <div class="d-flex align-center flex-wrap" style="gap: 8px;">
            <!-- Source -->
            <div v-if="contact.source" class="text-caption d-flex align-center text-grey-darken-1">
              <v-icon size="14" class="mr-1">mdi-origin</v-icon>
              {{ sourceLabel(contact.source) }}
            </div>
            <!-- Converted Date -->
            <div v-if="contact.convertedAt" class="text-caption d-flex align-center" style="color: #4CAF50;">
              <v-icon size="14" class="mr-1">mdi-check-decagram</v-icon>
              {{ formatDate(contact.convertedAt) }}
            </div>
            <!-- Zalo Account Assigned To -->
            <v-spacer />
            <div v-if="contact.assignedUser" class="text-caption text-blue-darken-2 d-flex align-center">
              <v-icon size="14" class="mr-1">mdi-account-tie</v-icon>
              {{ contact.assignedUser.fullName }}
            </div>
          </div>
        </v-card-text>
      </v-card>

      <div v-if="contacts.length === 0" class="text-center py-12 text-medium-emphasis">
        <v-icon size="48" class="mb-2 opacity-20">mdi-account-search</v-icon>
        <div>Không tìm thấy khách hàng</div>
      </div>
    </div>

    <!-- FAB: add contact -->
    <v-btn
      icon="mdi-plus"
      color="primary"
      size="large"
      elevation="4"
      style="position: fixed; bottom: 88px; right: 20px; z-index: 50; border-radius: 16px;"
      @click="openCreate"
    />

    <!-- Detail dialog -->
    <ContactDetailDialog
      v-model="showDialog"
      :contact="selectedContact"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <!-- Duplicate check dialog -->
    <v-dialog v-model="showDuplicateDialog" fullscreen transition="dialog-bottom-transition">
      <DuplicateReviewDialog @close="showDuplicateDialog = false" @merged="onSaved" />
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import { useContacts, STATUS_OPTIONS, SOURCE_OPTIONS } from '@/composables/use-contacts';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { formatDate } from '@/utils/date-format';
import type { Contact } from '@/composables/use-contacts';

const { contacts, total, loading, filters, fetchContacts, duplicateTotal, fetchDuplicates } = useContacts();
const { accounts } = useZaloAccounts();

const showDialog = ref(false);
const showDuplicateDialog = ref(false);
const selectedContact = ref<Contact | null>(null);

const zaloAccountOptions = computed(() => [
  { title: 'Tất cả Zalo', value: '' },
  ...accounts.value.map((a) => ({ title: a.displayName || 'Zalo', value: a.id })),
]);

function statusColor(status: string) {
  const map: Record<string, string> = {
    new: 'grey', consulting: 'blue', quoting: 'orange',
    nurturing: 'purple', converted: 'success', lost: 'error',
  };
  return map[status] ?? 'grey';
}

function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function sourceLabel(value: string) {
  return SOURCE_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function toggleStatus(value: string) {
  filters.status = filters.status === value ? '' : value;
  fetchContacts();
}

let searchTimeout: ReturnType<typeof setTimeout>;
function onSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchContacts(), 300);
}

function openContact(contact: Contact) {
  selectedContact.value = contact;
  showDialog.value = true;
}

function openCreate() {
  selectedContact.value = null;
  showDialog.value = true;
}

function onSaved() { fetchContacts(); fetchDuplicates(); }
function onDeleted() { fetchContacts(); fetchDuplicates(); }

function relativeTime(dateStr?: string | null) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${days} ngày trước`;
}

onMounted(() => {
  fetchContacts();
  fetchDuplicates();
});
onUnmounted(() => clearTimeout(searchTimeout));
</script>

<style scoped>
.contact-card {
  transition: transform 0.1s ease;
}
.contact-card:active {
  transform: scale(0.98);
}
.shadow-sm {
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.overflow-x-auto::-webkit-scrollbar {
  display: none;
}
</style>
