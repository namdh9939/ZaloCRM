/**
 * use-push-notifications.ts — Composable quản lý Web Push cho ZaloCRM.
 *
 * Sử dụng:
 *   const { status, enable, disable } = usePushNotifications()
 *
 * status values:
 *   'unsupported'  — trình duyệt không hỗ trợ
 *   'denied'       — user đã từ chối quyền
 *   'enabled'      — đang bật thông báo
 *   'disabled'     — chưa bật hoặc đã tắt
 *   'loading'      — đang xử lý
 */
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';

export type PushStatus = 'unsupported' | 'denied' | 'enabled' | 'disabled' | 'loading';

// Chuyển VAPID public key từ base64url sang Uint8Array (chuẩn Web Push)
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return view;
}

// Chuyển ArrayBuffer sang base64 string để gửi lên server
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function usePushNotifications() {
  const status = ref<PushStatus>('loading');
  const errorMessage = ref<string | null>(null);

  // Kiểm tra trạng thái hiện tại
  async function checkStatus(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      status.value = 'unsupported';
      return;
    }

    const permission = Notification.permission;
    if (permission === 'denied') {
      status.value = 'denied';
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      status.value = sub ? 'enabled' : 'disabled';
    } catch {
      status.value = 'disabled';
    }
  }

  // Bật thông báo
  async function enable(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      errorMessage.value = 'Trình duyệt này không hỗ trợ Web Push';
      return false;
    }

    status.value = 'loading';
    errorMessage.value = null;

    try {
      // 1. Lấy VAPID public key từ server
      const keyRes = await api.get('/push/vapid-key');
      const vapidPublicKey: string = keyRes.data.publicKey;

      // 2. Đăng ký Service Worker
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      // 3. Xin quyền notification
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        status.value = permission === 'denied' ? 'denied' : 'disabled';
        errorMessage.value = permission === 'denied'
          ? 'Bạn đã chặn thông báo. Vào cài đặt trình duyệt để mở lại.'
          : 'Không được cấp quyền thông báo.';
        return false;
      }

      // 4. Subscribe push
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = sub.toJSON();
      const p256dh = subJson.keys?.p256dh || arrayBufferToBase64(sub.getKey('p256dh')!);
      const auth = subJson.keys?.auth || arrayBufferToBase64(sub.getKey('auth')!);

      // 5. Gửi subscription lên server
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        keys: { p256dh, auth },
      });

      status.value = 'enabled';
      return true;
    } catch (err: any) {
      console.error('[push] Enable error:', err);
      errorMessage.value = err?.response?.data?.error || err?.message || 'Không thể bật thông báo';
      status.value = 'disabled';
      return false;
    }
  }

  // Tắt thông báo
  async function disable(): Promise<void> {
    status.value = 'loading';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Thông báo server xoá trước
        try {
          await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } });
        } catch { /* ignore */ }
        await sub.unsubscribe();
      }
      status.value = 'disabled';
    } catch (err) {
      console.error('[push] Disable error:', err);
      status.value = 'disabled';
    }
  }

  // Lắng nghe message từ Service Worker (khi user click notification khi app đang mở)
  function listenForPushClicks(callback: (url: string) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_CLICKED' && event.data?.url) {
        callback(event.data.url);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }

  onMounted(() => {
    checkStatus();
  });

  return {
    status,
    errorMessage,
    enable,
    disable,
    checkStatus,
    listenForPushClicks,
  };
}
