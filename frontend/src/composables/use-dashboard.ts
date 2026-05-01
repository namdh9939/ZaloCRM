import { ref } from 'vue';
import { api } from '@/api';

export interface KpiData {
  messagesToday: number;
  messagesTodayChange: number | null;
  messagesUnreplied: number;
  messagesUnread: number;
  appointmentsToday: number;
  appointmentsTodayChange: number | null;
  newContactsThisWeek: number;
  newContactsChange: number | null;
  totalContacts: number;
  missed30m: number;
  missed2h: number;
  missed24h: number;
}

export interface MessageVolumeItem {
  date: string;
  sent: number;
  received: number;
}

export interface PipelineItem {
  status: string | null;
  count: number;
}

export interface SourceItem {
  source: string;
  count: number;
  converted: number;
  conversionRate: number;
}

export interface AppointmentStatusItem {
  status: string;
  count: number;
  _count?: number | { _all: number };
}

export function useDashboard() {
  const kpi = ref<KpiData | null>(null);
  const messageVolume = ref<MessageVolumeItem[]>([]);
  const pipeline = ref<PipelineItem[]>([]);
  const sources = ref<SourceItem[]>([]);
  const appointments = ref<AppointmentStatusItem[]>([]);
  const loading = ref(false);

  async function fetchAll(zaloAccountId = '', view = '') {
    loading.value = true;
    const params: Record<string, string> = {};
    if (zaloAccountId) params.zaloAccountId = zaloAccountId;
    if (view) params.view = view;
    try {
      const [kpiRes, volRes, pipRes, srcRes, aptRes] = await Promise.all([
        api.get('/dashboard/kpi', { params }),
        api.get('/dashboard/message-volume', { params }),
        api.get('/dashboard/pipeline', { params }),
        api.get('/dashboard/sources', { params }),
        api.get('/dashboard/appointments', { params }),
      ]);
      kpi.value = kpiRes.data;
      messageVolume.value = volRes.data.data || volRes.data;
      pipeline.value = pipRes.data.data ?? pipRes.data;
      sources.value = srcRes.data.data ?? srcRes.data;
      appointments.value = aptRes.data.data ?? aptRes.data;
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      loading.value = false;
    }
  }

  return {
    kpi, messageVolume, pipeline, sources, appointments,
    loading, fetchAll,
  };
}
