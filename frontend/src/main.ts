import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import './assets/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// Đăng ký Service Worker cho Web Push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
    console.warn('[sw] Registration failed:', err);
  });

  // Điều hướng khi user click notification và app đang mở
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PUSH_CLICKED' && event.data?.url) {
      router.push(event.data.url);
    }
  });
}
