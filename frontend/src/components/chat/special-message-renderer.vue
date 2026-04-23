<template>
  <div class="special-message">
    <!-- Bank Transfer -->
    <v-card v-if="type === 'bank_transfer'" variant="tonal" color="success" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-bank-transfer" size="28" class="mr-3" />
        <div>
          <div class="font-weight-bold">{{ bankName || 'Chuyển khoản' }}</div>
          <div v-if="amount" class="text-h6">{{ formatAmount(amount) }}</div>
          <div v-if="description" class="text-caption text-medium-emphasis">{{ description }}</div>
        </div>
      </div>
    </v-card>

    <!-- Call (voice or video) -->
    <v-chip
      v-else-if="type === 'call'"
      variant="tonal"
      :color="isMissed ? 'error' : 'primary'"
      label
    >
      <v-icon :icon="isVideo ? 'mdi-video' : 'mdi-phone'" class="mr-1" />
      {{ callLabel }}
    </v-chip>

    <!-- QR Code -->
    <v-card v-else-if="type === 'qr_code'" variant="outlined" class="pa-3 text-center" rounded="lg" style="max-width: 140px;">
      <v-icon icon="mdi-qrcode" size="48" color="primary" />
      <div class="text-caption mt-1">Mã QR</div>
    </v-card>

    <!-- Reminder / Calendar -->
    <v-card v-else-if="type === 'reminder'" variant="tonal" color="warning" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-calendar-clock" class="mr-2" />
        <span>{{ title || 'Nhắc hẹn' }}</span>
      </div>
    </v-card>

    <!-- Poll / Vote -->
    <v-card v-else-if="type === 'poll'" variant="tonal" color="info" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-poll" class="mr-2" />
        <span>{{ title || 'Bình chọn' }}</span>
      </div>
    </v-card>

    <!-- Note -->
    <v-card v-else-if="type === 'note'" variant="tonal" color="secondary" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-note-text" class="mr-2" />
        <span>{{ title || 'Ghi chú' }}</span>
      </div>
    </v-card>

    <!-- Forwarded -->
    <v-chip v-else-if="type === 'forwarded'" variant="tonal" color="purple" label>
      <v-icon icon="mdi-share" class="mr-1" />
      Tin nhắn chuyển tiếp
    </v-chip>

    <!-- Generic rich / unknown fallback -->
    <div v-else class="generic-special">
      <div v-if="genericText" class="text-body-2 mb-1">
        <LinkifyText :text="genericText" />
      </div>
      <v-chip
        size="small"
        variant="tonal"
        color="grey"
        label
        @click="showDetail = true"
        style="cursor: pointer;"
      >
        <v-icon icon="mdi-message-text" class="mr-1" />
        {{ genericText ? 'Xem chi tiết' : 'Tin nhắn đặc biệt' }}
      </v-chip>
      <v-dialog v-model="showDetail" max-width="560">
        <v-card>
          <v-card-title class="text-body-1 d-flex align-center">
            <v-icon class="mr-2">mdi-message-text</v-icon>
            Nội dung tin nhắn
          </v-card-title>
          <v-card-text>
            <div v-if="genericText" class="mb-3 text-body-2" style="white-space: pre-wrap;">{{ genericText }}</div>
            <div class="text-caption text-grey mb-1">Dữ liệu gốc:</div>
            <pre class="special-raw">{{ formattedRaw }}</pre>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showDetail = false">Đóng</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import LinkifyText from '@/components/chat/LinkifyText.vue';

const props = defineProps<{
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
}>();

const showDetail = ref(false);
const genericText = computed<string>(() => {
  const c = props.content;
  if (c == null) return '';
  if (typeof c === 'string') return c;
  return c.title || c.text || c.description || c.content || c.caption || c.name || '';
});
const formattedRaw = computed<string>(() => {
  if (props.content == null) return '(trống)';
  if (typeof props.content === 'string') return props.content;
  try { return JSON.stringify(props.content, null, 2); } catch { return String(props.content); }
});

// Bank transfer helpers
const bankName = computed<string>(() => props.content?.bankName || props.content?.bankCode || '');
const amount = computed<number | null>(() => {
  const v = props.content?.amount ?? props.content?.transferAmount;
  return v != null ? Number(v) : null;
});
const description = computed<string>(() => props.content?.description || props.content?.content || '');

function formatAmount(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

// Call helpers
const isMissed = computed<boolean>(() => {
  const t = (props.content?.callType || '').toLowerCase();
  return t.includes('miss') || props.content?.duration === 0;
});
const isVideo = computed<boolean>(() => {
  const t = (props.content?.callType || '').toLowerCase();
  return t.includes('video');
});
const callLabel = computed<string>(() => {
  if (isMissed.value) return isVideo.value ? 'Cuộc gọi video nhỡ' : 'Cuộc gọi nhỡ';
  const dur = props.content?.callDuration ?? props.content?.duration;
  if (dur) {
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    const label = mins > 0 ? `${mins}p${secs}s` : `${secs}s`;
    return isVideo.value ? `Gọi video (${label})` : `Cuộc gọi (${label})`;
  }
  return isVideo.value ? 'Cuộc gọi video' : 'Cuộc gọi';
});

// Generic title for reminder/poll/note
const title = computed<string>(() => props.content?.title || props.content?.name || '');
</script>

<style scoped>
.special-message {
  display: inline-block;
  max-width: 100%;
}
.special-raw {
  background: rgba(0,0,0,0.05);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
