<template>
  <div
    class="chat-contact-panel d-flex flex-column"
    style="width: 320px; border-left: 1px solid rgba(0,0,0,0.12); height: 100%; overflow-y: auto; flex-shrink: 0;"
  >
    <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid rgba(0,0,0,0.12);">
      <v-icon icon="mdi-account-details" class="mr-2" />
      <span class="font-weight-medium">Thông tin khách hàng</span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <div class="pa-3">
      <!-- Last activity display -->
      <div v-if="props.contact && props.contact.lastActivity" class="d-flex align-center mb-3 ga-2">
        <span class="text-caption text-grey">
          Hoạt động: {{ relativeTime(props.contact.lastActivity) }}
        </span>
      </div>

      <!-- AI suggested status — staff sees this directly while chatting -->
      <SuggestedStatusBadge
        v-if="props.contact?.id && props.contact?.suggestedStatus"
        :contact-id="props.contact.id"
        :suggested-status="props.contact.suggestedStatus"
        :suggested-status-reason="props.contact.suggestedStatusReason"
        @applied="onSuggestionApplied"
        @rejected="onSuggestionRejected"
      />

      <v-text-field v-model="form.crmName" label="Tên CRM (tên thật)" density="compact" variant="outlined" class="mb-2" hide-details
        hint="Tên chuẩn hóa dùng cho automation, VD: Nguyễn Văn Hải" persistent-hint />
      <v-text-field v-model="form.fullName" label="Tên hiển thị Zalo" density="compact" variant="outlined" class="mb-2" hide-details
        hint="Tên gợi nhớ trên Zalo, VD: Hải - Quan tâm 2PN" persistent-hint />
      <v-text-field v-model="form.phone" label="Số điện thoại" density="compact" variant="outlined" class="mb-2" hide-details />

      <v-select v-model="form.source" label="Nguồn" :items="SOURCE_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-select v-model="form.status" label="Trạng thái" :items="STATUS_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-select
        v-model="form.contactType"
        :items="CONTACT_TYPE_OPTIONS"
        item-title="text"
        item-value="value"
        label="Loại liên hệ"
        hint="Nội bộ và Đối tác sẽ không được tính vào phễu chuyển đổi"
        persistent-hint
        density="compact"
        variant="outlined"
        class="mb-2"
      />

      <!-- Assign to employee (owner/admin only) -->
      <v-select
        v-if="authStore.isAdmin"
        v-model="assignedUserId"
        :items="assignedUserOptions"
        item-title="label"
        item-value="id"
        label="Phụ trách bởi"
        density="compact"
        variant="outlined"
        clearable
        class="mb-2"
        hide-details
        :loading="assignSaving"
        @update:model-value="handleAssignChange"
      />

      <DatePicker v-model="form.firstContactDate" label="Ngày tiếp nhận" max-width="100%" class="mb-2" />

      <DatePicker
        v-model="form.convertedDate"
        label="Ngày chuyển đổi"
        max-width="100%"
        class="mb-2"
        :disabled="form.status !== 'converted'"
      />

      <v-combobox v-model="form.tags" label="Tags" multiple chips closable-chips
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-textarea v-model="form.notes" label="Ghi chú" rows="2" auto-grow
        density="compact" variant="outlined" class="mb-3" hide-details />

      <v-btn color="primary" block :loading="saving" @click="saveContact">Lưu thông tin</v-btn>

      <v-alert v-if="saveSuccess" type="success" density="compact" class="mt-2" closable @click:close="saveSuccess = false">
        Đã lưu thành công!
      </v-alert>
      <v-alert v-if="saveError" type="error" density="compact" class="mt-2" closable @click:close="saveError = false">
        Lưu thất bại, thử lại!
      </v-alert>

      <AiSummaryCard :summary="aiSummary" :loading="aiSummaryLoading" @refresh="$emit('refresh-ai-summary')" />

      <v-card variant="outlined" class="mb-3">
        <v-card-title class="d-flex align-center text-body-1">
          <v-icon class="mr-2">mdi-chart-bell-curve-cumulative</v-icon>
          Cảm xúc khách hàng
          <v-spacer />
          <v-btn size="small" variant="text" :loading="aiSentimentLoading" @click="$emit('refresh-ai-sentiment')">Làm mới</v-btn>
        </v-card-title>
        <v-card-text>
          <AiSentimentBadge :sentiment="aiSentiment" />
          <div v-if="aiSentiment?.reason" class="text-body-2 mt-2">{{ aiSentiment.reason }}</div>
        </v-card-text>
      </v-card>

      <ChatAppointments
        v-if="props.contactId"
        :contact-id="props.contactId"
        :appointments="contactAppointments"
        @refresh="reloadAppointments"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { SOURCE_OPTIONS, STATUS_OPTIONS, useContacts } from '@/composables/use-contacts';

const CONTACT_TYPE_OPTIONS = [
  { text: 'Khách hàng', value: 'customer' },
  { text: 'Nội bộ', value: 'internal' },
  { text: 'Đối tác', value: 'partner' },
];
import type { Contact } from '@/composables/use-contacts';
import type { AiSentiment } from '@/composables/use-chat';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';
import AiSummaryCard from '@/components/ai/ai-summary-card.vue';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import DatePicker from '@/components/DatePicker.vue';
import SuggestedStatusBadge from '@/components/contacts/SuggestedStatusBadge.vue';
import { useAuthStore } from '@/stores/auth';
import { useUsers } from '@/composables/use-users';

const authStore = useAuthStore();
const { users, fetchUsers } = useUsers();
const { assignContact } = useContacts();
const assignedUserId = ref<string | null>(null);
const assignSaving = ref(false);

const assignedUserOptions = computed(() =>
  users.value
    .filter((u) => u.isActive !== false)
    .map((u) => ({ id: u.id, label: `${u.fullName} (${roleLabel(u.role)})` })),
);
function roleLabel(role: string): string {
  if (role === 'owner') return 'Chủ sở hữu';
  if (role === 'admin') return 'Quản trị';
  return 'Nhân viên';
}

async function handleAssignChange(userId: string | null) {
  if (!props.contactId) return;
  assignSaving.value = true;
  const result = await assignContact(props.contactId, userId);
  assignSaving.value = false;
  if (result) emit('saved');
}

onMounted(() => {
  if (authStore.isAdmin) fetchUsers();
});

watch(() => props.contact?.assignedUserId, (v) => {
  assignedUserId.value = v ?? null;
}, { immediate: true });

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  aiSummary: string;
  aiSummaryLoading: boolean;
  aiSentiment: AiSentiment | null;
  aiSentimentLoading: boolean;
}>();

const emit = defineEmits<{ close: []; saved: []; 'refresh-ai-summary': []; 'refresh-ai-sentiment': [] }>();

const {
  form, saving, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${days} ngày trước`;
}

function onSuggestionApplied(newStatus: string) {
  // Form's status is bound separately by useChatContactPanel — sync it manually.
  // form is from reactive() so no .value accessor.
  form.status = newStatus;
  if (props.contact) {
    props.contact.status = newStatus;
    props.contact.suggestedStatus = null;
    props.contact.suggestedStatusReason = null;
    props.contact.suggestedStatusAt = null;
  }
  emit('saved');
}

function onSuggestionRejected() {
  if (props.contact) {
    props.contact.suggestedStatus = null;
    props.contact.suggestedStatusReason = null;
    props.contact.suggestedStatusAt = null;
  }
}
</script>
