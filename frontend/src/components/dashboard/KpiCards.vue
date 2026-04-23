<template>
  <div>
    <v-row>
      <v-col v-for="card in cards" :key="card.title" cols="6" sm="4" md="2">
        <v-card
          variant="outlined"
          :class="{ 'kpi-clickable': !!card.to }"
          @click="card.to && goTo(card.to)"
        >
          <v-card-text class="text-center pa-3">
            <v-icon :icon="card.icon" :color="card.color" size="32" class="mb-1" />
            <div class="text-h5 font-weight-bold">{{ card.value }}</div>
            <div class="text-caption text-grey">{{ card.title }}</div>
            <div v-if="card.change !== undefined" class="mt-1">
              <span :class="changeClass(card.change)" class="text-caption font-weight-medium">
                <v-icon size="12">{{ changeIcon(card.change) }}</v-icon>
                {{ changeLabel(card.change) }}
                <span class="text-grey ml-1">{{ card.compareLabel }}</span>
              </span>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Missed-reply threshold cards -->
    <v-row class="mt-1">
      <v-col cols="12" sm="4" v-for="m in missedCards" :key="m.key">
        <v-card
          variant="tonal"
          :color="m.value > 0 ? m.color : undefined"
          class="kpi-clickable"
          @click="goTo(m.to)"
        >
          <v-card-text class="d-flex align-center pa-3">
            <v-icon :icon="m.icon" size="24" class="mr-3" />
            <div class="flex-grow-1">
              <div class="text-caption">{{ m.title }}</div>
              <div class="text-h6 font-weight-bold">{{ m.value }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { KpiData } from '@/composables/use-dashboard';

const router = useRouter();

const props = defineProps<{ kpi: KpiData | null }>();

type RouteTarget = { path: string; query?: Record<string, any> };
function goTo(to: RouteTarget) {
  router.push(to as any);
}

function changeIcon(v: number | null | undefined): string {
  if (v == null) return 'mdi-minus';
  if (v > 0) return 'mdi-arrow-up';
  if (v < 0) return 'mdi-arrow-down';
  return 'mdi-equal';
}
function changeClass(v: number | null | undefined): string {
  if (v == null || v === 0) return 'text-grey';
  return v > 0 ? 'text-success' : 'text-error';
}
function changeLabel(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}

interface KpiCard {
  title: string;
  value: number | string;
  icon: string;
  color: string;
  change?: number | null;
  compareLabel?: string;
  to?: RouteTarget;
}

const cards = computed<KpiCard[]>(() => [
  {
    title: 'Tin nhắn hôm nay',
    value: props.kpi?.messagesToday ?? '—',
    icon: 'mdi-chat',
    color: 'primary',
    change: props.kpi?.messagesTodayChange,
    compareLabel: 'vs hôm qua',
    to: { path: '/chat', query: { from: new Date().toISOString().slice(0, 10) } },
  },
  {
    title: 'Chưa trả lời',
    value: props.kpi?.messagesUnreplied ?? '—',
    icon: 'mdi-chat-alert',
    color: 'warning',
    to: { path: '/chat', query: { unreplied: 'true' } },
  },
  {
    title: 'Chưa đọc',
    value: props.kpi?.messagesUnread ?? '—',
    icon: 'mdi-email-outline',
    color: 'orange',
    to: { path: '/chat', query: { unread: 'true' } },
  },
  {
    title: 'Lịch hẹn hôm nay',
    value: props.kpi?.appointmentsToday ?? '—',
    icon: 'mdi-calendar-today',
    color: 'success',
    change: props.kpi?.appointmentsTodayChange,
    compareLabel: 'vs hôm qua',
    to: { path: '/appointments' },
  },
  {
    title: 'KH mới tuần này',
    value: props.kpi?.newContactsThisWeek ?? '—',
    icon: 'mdi-account-plus',
    color: 'info',
    change: props.kpi?.newContactsChange,
    compareLabel: 'vs tuần trước',
    to: { path: '/contacts' },
  },
  {
    title: 'Tổng khách hàng',
    value: props.kpi?.totalContacts ?? '—',
    icon: 'mdi-account-group',
    color: 'secondary',
    to: { path: '/contacts' },
  },
]);

const missedCards = computed(() => [
  {
    key: '30m',
    title: 'Chờ 30 phút – 2 giờ',
    value: props.kpi?.missed30m ?? 0,
    icon: 'mdi-clock-alert-outline',
    color: 'warning',
    to: { path: '/chat', query: { bucket: '30m' } },
  },
  {
    key: '2h',
    title: 'Chờ 2 giờ – 24 giờ',
    value: props.kpi?.missed2h ?? 0,
    icon: 'mdi-alert-circle-outline',
    color: 'orange',
    to: { path: '/chat', query: { bucket: '2h' } },
  },
  {
    key: '24h',
    title: 'Chờ trên 24 giờ',
    value: props.kpi?.missed24h ?? 0,
    icon: 'mdi-alert-octagon-outline',
    color: 'error',
    to: { path: '/chat', query: { bucket: '24h' } },
  },
]);
</script>

<style scoped>
.kpi-clickable { cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
.kpi-clickable:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,242,255,0.15); }
</style>
