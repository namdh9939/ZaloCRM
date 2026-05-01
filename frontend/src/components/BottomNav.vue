<template>
  <v-bottom-navigation grow :model-value="activeTab" @update:model-value="navigate" style="position: fixed; bottom: 0; left: 0; right: 0; z-index: 100; padding-bottom: env(safe-area-inset-bottom);">
    <v-btn v-for="tab in tabs" :key="tab.path" :value="tab.path">
      <v-icon>{{ activeTab === tab.path ? tab.icon : tab.icon + '-outline' }}</v-icon>
      <span class="text-caption" :class="activeTab === tab.path ? 'font-weight-bold' : ''">{{ tab.title }}</span>
    </v-btn>
  </v-bottom-navigation>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const tabs = [
  { title: 'Chat', icon: 'mdi-message-text', path: '/chat' },
  { title: 'Khách hàng', icon: 'mdi-account-group', path: '/contacts' },
  { title: 'Dashboard', icon: 'mdi-view-dashboard', path: '/' },
  { title: 'Báo cáo', icon: 'mdi-chart-box', path: '/reports' },
  { title: 'Khám phá', icon: 'mdi-widgets', path: '/discovery' },
];

const activeTab = computed(() => {
  return tabs.find(t => t.path === route.path)?.path ?? '/chat';
});

function navigate(path: string) {
  router.push(path);
}
</script>
