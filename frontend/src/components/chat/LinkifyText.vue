<template>
  <span style="white-space: pre-wrap; word-wrap: break-word;">
    <template v-for="(part, i) in parts" :key="i">
      <a
        v-if="part.url"
        :href="part.text"
        target="_blank"
        rel="noopener noreferrer"
        class="chat-link"
        @click.stop
      >{{ part.text }}</a>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text: string | null | undefined }>();

// Split into runs of plain text and URL tokens. Regex is intentionally broad
// to catch http(s)://, www., and bare domains with paths.
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

const parts = computed<Array<{ text: string; url: boolean }>>(() => {
  const src = props.text ?? '';
  if (!src) return [];
  const out: Array<{ text: string; url: boolean }> = [];
  let last = 0;
  for (const m of src.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: src.slice(last, start), url: false });
    let url = m[0];
    // Trim common trailing punctuation that usually isn't part of the URL.
    const trail = url.match(/[),.;:!?]+$/);
    if (trail) {
      out.push({ text: url.slice(0, -trail[0].length), url: true });
      out.push({ text: trail[0], url: false });
    } else {
      out.push({ text: url, url: true });
    }
    last = start + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), url: false });
  return out;
});
</script>

<style scoped>
.chat-link {
  color: #00F2FF;
  text-decoration: underline;
  word-break: break-all;
}
.chat-link:hover { opacity: 0.85; }
</style>
