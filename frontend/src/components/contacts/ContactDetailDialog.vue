<template>
  <v-dialog v-model="show" max-width="680" persistent scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ isNew ? 'Thêm khách hàng' : 'Chi tiết khách hàng' }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>

      <v-divider />

      <v-card-text>
        <!-- AI suggested status badge — shown when AI has a pending suggestion -->
        <SuggestedStatusBadge
          v-if="props.contact?.id && props.contact?.suggestedStatus"
          :contact-id="props.contact.id"
          :suggested-status="props.contact.suggestedStatus"
          :suggested-status-reason="props.contact.suggestedStatusReason"
          @applied="onSuggestionApplied"
          @rejected="onSuggestionRejected"
        />

        <v-row dense>
          <!-- CRM name (real name) -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.crmName" label="Tên CRM (tên thật)" hint="Dùng cho automation" persistent-hint />
          </v-col>

          <!-- Full name (Zalo display name) -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.fullName" label="Tên hiển thị Zalo" :rules="[required]" />
          </v-col>

          <!-- Phone -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.phone" label="Số điện thoại" />
          </v-col>



          <!-- Source — use group-specific sources when contact is a Zalo group -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.source"
              :items="sourceOptionsForContact"
              item-title="text"
              item-value="value"
              label="Nguồn"
              clearable
            />
          </v-col>

          <!-- Status -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.status"
              :items="STATUS_OPTIONS"
              item-title="text"
              item-value="value"
              label="Trạng thái"
              clearable
            />
          </v-col>

          <!-- Conversion date — only editable when status is 'converted' -->
          <v-col cols="12" sm="6">
            <DatePicker
              v-model="form.convertedDate"
              label="Ngày chuyển đổi"
              max-width="100%"
              :disabled="form.status !== 'converted'"
            />
          </v-col>

          <!-- Lost reason — required when status is 'lost' -->
          <v-col v-if="form.status === 'lost'" cols="12" sm="6">
            <v-select
              v-model="form.lostReason"
              :items="LOST_REASON_OPTIONS"
              item-title="text"
              item-value="value"
              label="Lý do mất khách"
              hint="Giúp quản lý biết chỗ cần cải thiện"
              persistent-hint
            />
          </v-col>
          <v-col v-if="form.status === 'lost' && form.lostReason === 'other'" cols="12" sm="6">
            <v-text-field v-model="form.lostNote" label="Ghi chú lý do (Khác)" />
          </v-col>

          <!-- First contact date -->
          <v-col cols="12" sm="6">
            <DatePicker v-model="form.firstContactDate" label="Ngày tiếp nhận" max-width="100%" />
          </v-col>

          <!-- Assigned employee (owner/admin only) -->
          <v-col v-if="authStore.isAdmin" cols="12" sm="6">
            <v-select
              v-model="form.assignedUserId"
              :items="assignedUserOptions"
              item-title="label"
              item-value="id"
              label="Gán cho nhân viên"
              clearable
              :disabled="assignLoading"
              :loading="assignLoading"
              hide-details
            />
          </v-col>

          <!-- Tags -->
          <v-col cols="12" sm="6">
            <v-combobox
              v-model="form.tags"
              label="Tags"
              multiple
              chips
              closable-chips
              clearable
              hide-details
            />
          </v-col>

          <!-- Contact Type -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.contactType"
              :items="[
                { title: 'Khách hàng', value: 'customer' },
                { title: 'Nội bộ', value: 'internal' },
                { title: 'Đối tác', value: 'partner' }
              ]"
              label="Loại liên hệ (Ảnh hưởng đến phễu)"
              color="primary"
              hint="Nội bộ và Đối tác sẽ không được tính vào phễu chuyển đổi"
              persistent-hint
              hide-details="auto"
            />
          </v-col>

          <!-- Notes -->
          <v-col cols="12">
            <v-textarea
              v-model="form.notes"
              label="Ghi chú"
              rows="3"
              auto-grow
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn
          v-if="!isNew"
          color="error"
          variant="text"
          :loading="deleting"
          @click="onDelete"
        >
          Xoá
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import type { Contact } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, GROUP_SOURCE_OPTIONS, STATUS_OPTIONS, LOST_REASON_OPTIONS, useContacts } from '@/composables/use-contacts';
import DatePicker from '@/components/DatePicker.vue';
import SuggestedStatusBadge from '@/components/contacts/SuggestedStatusBadge.vue';
import { useAuthStore } from '@/stores/auth';
import { useUsers } from '@/composables/use-users';

const authStore = useAuthStore();
const { users, fetchUsers } = useUsers();
const assignLoading = ref(false);

const assignedUserOptions = computed(() => [
  { id: null as string | null, label: '— Chưa phân công —' },
  ...users.value
    .filter((u) => u.isActive !== false)
    .map((u) => ({ id: u.id, label: `${u.fullName} (${roleLabel(u.role)})` })),
]);

function roleLabel(role: string): string {
  if (role === 'owner') return 'Chủ sở hữu';
  if (role === 'admin') return 'Quản trị';
  return 'Nhân viên';
}

onMounted(() => {
  if (authStore.isAdmin) fetchUsers();
});

const sourceOptionsForContact = computed(() =>
  props.contact?.isGroup ? GROUP_SOURCE_OPTIONS : SOURCE_OPTIONS,
);

const props = defineProps<{
  modelValue: boolean;
  contact: Contact | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [contact: Contact];
  deleted: [id: string];
}>();

const { saving, deleting, createContact, updateContact, deleteContact } = useContacts();

function onSuggestionApplied(newStatus: string) {
  // Server đã commit status — đồng bộ form + emit để parent refresh list.
  form.value.status = newStatus;
  if (props.contact) {
    props.contact.status = newStatus;
    props.contact.suggestedStatus = null;
    props.contact.suggestedStatusReason = null;
    props.contact.suggestedStatusAt = null;
    emit('saved', props.contact);
  }
}

function onSuggestionRejected() {
  if (props.contact) {
    props.contact.suggestedStatus = null;
    props.contact.suggestedStatusReason = null;
    props.contact.suggestedStatusAt = null;
  }
}

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isNew = computed(() => !props.contact?.id);

interface FormState {
  fullName: string;
  crmName: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  convertedDate: string;
  firstContactDate: string;
  notes: string;
  tags: string[];
  assignedUserId: string | null;
  lostReason: string;
  lostNote: string;
  contactType: string;
}

const form = ref<FormState>(emptyForm());

function emptyForm(): FormState {
  return {
    fullName: '',
    crmName: '',
    phone: '',
    email: '',
    source: '',
    status: '',
    convertedDate: '',
    firstContactDate: '',
    notes: '',
    tags: [],
    assignedUserId: null,
    lostReason: '',
    lostNote: '',
    contactType: 'customer',
  };
}

watch(() => props.contact, (c) => {
  if (c) {
    form.value = {
      fullName: c.fullName ?? '',
      crmName: c.crmName ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      source: c.source ?? '',
      status: c.status ?? '',
      convertedDate: c.convertedAt
        ? new Date(c.convertedAt).toISOString().split('T')[0]
        : '',
      firstContactDate: c.firstContactDate
        ? new Date(c.firstContactDate).toISOString().split('T')[0]
        : '',
      notes: c.notes ?? '',
      tags: c.tags ?? [],
      assignedUserId: c.assignedUserId ?? null,
      lostReason: c.lostReason ?? '',
      lostNote: c.lostNote ?? '',
      contactType: (c as any).contactType ?? 'customer',
    };
  } else {
    form.value = emptyForm();
  }
}, { immediate: true, deep: true });

function required(v: string) {
  return !!v || 'Bắt buộc';
}

async function onSave() {
  const payload: Record<string, any> = {
    fullName: form.value.fullName || null,
    crmName: form.value.crmName || null,
    phone: form.value.phone || null,
    email: form.value.email || null,
    source: form.value.source || null,
    status: form.value.status || null,
    // Only send convertedAt when status is 'converted' — backend clears it otherwise
    convertedAt: form.value.status === 'converted' && form.value.convertedDate
      ? new Date(form.value.convertedDate + 'T00:00:00').toISOString()
      : null,
    firstContactDate: form.value.firstContactDate
      ? new Date(form.value.firstContactDate + 'T00:00:00').toISOString()
      : null,
    notes: form.value.notes || null,
    tags: form.value.tags,
  };
  // Only owner/admin can write assignedUserId — backend will ignore otherwise
  if (authStore.isAdmin) {
    (payload as Record<string, any>).assignedUserId = form.value.assignedUserId;
  }
  // Attach lost reason only when status is 'lost' — backend clears otherwise
  if (form.value.status === 'lost') {
    (payload as Record<string, any>).lostReason = form.value.lostReason || null;
    (payload as Record<string, any>).lostNote = form.value.lostNote || null;
  }
  // Contact Type
  (payload as Record<string, any>).contactType = form.value.contactType;

  let result: Contact | null;
  if (isNew.value) {
    result = await createContact(payload);
  } else {
    result = await updateContact(props.contact!.id, payload);
  }
  if (result) {
    emit('saved', result);
    close();
  }
}

async function onDelete() {
  if (!props.contact?.id) return;
  const ok = await deleteContact(props.contact.id);
  if (ok) {
    emit('deleted', props.contact.id);
    close();
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
