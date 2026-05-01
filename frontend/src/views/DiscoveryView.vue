<template>
  <div class="discovery-view pa-4">
    <h1 class="text-h5 font-weight-bold mb-6">Khám phá</h1>

    <div class="discovery-grid">
      <v-card
        v-for="item in items"
        :key="item.path"
        variant="flat"
        border
        class="discovery-item"
        @click="router.push(item.path)"
      >
        <v-card-text class="d-flex flex-column align-center justify-center pa-4">
          <div
            class="icon-container mb-2"
            :style="{ background: item.color + '15' }"
          >
            <v-icon :color="item.color" size="32">{{ item.icon }}</v-icon>
          </div>
          <span class="text-caption font-weight-medium text-center line-height-1.2">{{ item.title }}</span>
        </v-card-text>
      </v-card>
    </div>

    <!-- Additional section for AI features -->
    <v-card variant="tonal" color="primary" class="mt-8 overflow-hidden" rounded="xl">
      <v-card-text class="d-flex align-center">
        <v-icon size="40" class="mr-4">mdi-auto-fix</v-icon>
        <div>
          <div class="text-subtitle-1 font-weight-bold">Trợ lý AI Core</div>
          <div class="text-caption">Đang tối ưu hóa quy trình bán hàng của bạn</div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const items = [
  { title: 'Automation', icon: 'mdi-robot', path: '/automation', color: '#00F2FF' },
  { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts', color: '#2196F3' },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock', path: '/appointments', color: '#FF9800' },
  { title: 'Tích hợp', icon: 'mdi-connection', path: '/integrations', color: '#4CAF50' },
  { title: 'Phân tích', icon: 'mdi-chart-timeline-variant', path: '/analytics', color: '#9C27B0' },
  { title: 'Cài đặt hệ thống', icon: 'mdi-cog', path: '/settings', color: '#607D8B' },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings', color: '#E91E63' },
];
</script>

<style scoped>
.discovery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.discovery-item {
  border-radius: 16px;
  border-color: rgba(var(--v-border-color), 0.08);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.discovery-item:active {
  transform: scale(0.95);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.icon-container {
  width: 56px;
  height: 56px;
  display: flex;
  align-center;
  justify-content: center;
  border-radius: 16px;
}

.line-height-1.2 {
  line-height: 1.2;
}
</style>
