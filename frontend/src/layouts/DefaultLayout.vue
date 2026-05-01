<template>
  <v-app :class="{ 'liquid-bg': isDark }">
    <!-- Top bar — glass effect -->
    <v-app-bar density="comfortable" flat>
      <v-app-bar-nav-icon @click="drawer = !drawer" />

      <!-- AI Core Orb + Title -->
      <div class="d-flex align-center" style="gap: 12px;">
        <div
          class="ai-core-orb d-flex align-center justify-center"
          style="width: 32px; height: 32px; background: linear-gradient(135deg, #00F2FF, #0077B6);"
        >
          <v-icon size="18" color="white">mdi-robot</v-icon>
        </div>
        <v-app-bar-title>
          <span class="font-weight-bold">Zalo</span><span style="color: #00F2FF;">CRM</span>
        </v-app-bar-title>
      </div>

      <!-- Global search -->
      <GlobalSearch class="mx-2" />

      <v-spacer />

      <!-- Status indicator -->
      <div
        class="d-flex align-center mr-4 px-3 py-1 rounded-pill"
        style="background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.2);"
      >
        <span
          class="status-dot"
          style="width: 8px; height: 8px; border-radius: 50%; background: #4CAF50; display: inline-block; margin-right: 8px;"
        ></span>
        <span class="text-caption font-weight-bold" style="color: #4CAF50; letter-spacing: 1px;">ONLINE</span>
      </div>

      <span class="text-body-2 mr-3" v-if="authStore.user">{{ authStore.user.fullName }}</span>

      <!-- Nút Bật/Tắt Web Push Notification -->
      <v-tooltip :text="pushTooltip" location="bottom">
        <template #activator="{ props: tipProps }">
          <v-btn
            v-bind="tipProps"
            icon
            variant="text"
            :loading="pushStatus === 'loading'"
            :color="pushStatus === 'enabled' ? 'success' : pushStatus === 'denied' ? 'error' : undefined"
            class="mr-1"
            @click="togglePush"
          >
            <v-icon>
              {{ pushStatus === 'enabled' ? 'mdi-bell-ring' : pushStatus === 'denied' ? 'mdi-bell-cancel' : 'mdi-bell-off-outline' }}
            </v-icon>
          </v-btn>
        </template>
      </v-tooltip>

      <NotificationBell />
      <v-btn icon variant="text" @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon variant="text" @click="logout">
        <v-icon>mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar navigation -->
    <v-navigation-drawer v-model="drawer" :rail="rail" permanent @click="rail = false">
      <v-list density="compact" nav class="mt-2">
        <v-list-item
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :prepend-icon="item.icon"
          :title="item.title"
          :value="item.path"
          rounded="xl"
          class="mb-1 mx-2"
        />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-chevron-left"
            title="Thu gọn"
            @click.stop="rail = !rail"
            rounded="xl"
            class="mx-2"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import { usePushNotifications } from '@/composables/use-push-notifications';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();

const { status: pushStatus, enable: enablePush, disable: disablePush } = usePushNotifications();

const pushTooltip = computed(() => {
  const map: Record<string, string> = {
    enabled: 'Thông báo đang bật — nhấn để tắt',
    disabled: 'Bật thông báo tin nhắn mới',
    denied: 'Trình duyệt đang chặn — vào Settings để cấp quyền',
    unsupported: 'Trình duyệt không hỗ trợ thông báo',
    loading: 'Đang xử lý...',
  };
  return map[pushStatus.value] ?? 'Thông báo';
});

async function togglePush() {
  if (pushStatus.value === 'enabled') {
    await disablePush();
  } else if (pushStatus.value === 'disabled') {
    await enablePush();
  }
}

const drawer = ref(true);
const rail = ref(false);
const isDark = ref(localStorage.getItem('theme') !== 'light');

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
});

const menuItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/' },
  { title: 'Tin nhắn', icon: 'mdi-message-text-outline', path: '/chat' },
  { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts' },
  { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts' },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments' },
  { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports' },
  { title: 'Phân tích', icon: 'mdi-chart-timeline-variant-shimmer', path: '/analytics' },
  { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings' },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings' },
  { title: 'Tích hợp', icon: 'mdi-connection', path: '/integrations' },
  { title: 'Automation', icon: 'mdi-robot-outline', path: '/automation' },
];

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>
