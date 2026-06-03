<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { NSelect } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const appStore = useAppStore()
const isFetchingModels = ref(false)
const fetchedModels = ref<Array<{ id: string }>>([])

const profileOptions = computed(() =>
  appStore.appSettings.aiProfiles.map(p => ({ label: p.name, value: p.id }))
)

const modelOptions = computed(() => {
  if (fetchedModels.value.length > 0) {
    return fetchedModels.value.map(m => ({ label: m.id, value: m.id }))
  }
  const current = appStore.appSettings.model
  return current ? [{ label: current, value: current }] : []
})

const activeProfileId = computed({
  get: () => appStore.appSettings.activeAiProfileId,
  set: (id: string) => appStore.switchAiProfile(id)
})

const activeModel = computed({
  get: () => appStore.appSettings.model,
  set: (model: string) => appStore.updateActiveAiProfileModel(model)
})

const hasProfiles = computed(() => appStore.appSettings.aiProfiles.length > 0)

async function handleFetchModels(): Promise<void> {
  if (isFetchingModels.value) return
  isFetchingModels.value = true
  try {
    const result = await window.characterArc.fetchModels(toIpcPayload({ ...appStore.appSettings }))
    if (result.success && result.result) {
      fetchedModels.value = result.result
    }
  } catch {
    // silent
  } finally {
    isFetchingModels.value = false
  }
}
</script>

<template>
  <div v-if="hasProfiles" class="titlebar-switcher">
    <span class="switcher-label">模型切换:</span>
    <n-select
      :value="activeProfileId"
      :options="profileOptions"
      size="tiny"
      class="switcher-profile"
      :consistent-menu-width="false"
      @update:value="(v: string) => { activeProfileId = v; fetchedModels = [] }"
    />
    <span class="switcher-sep" />
    <n-select
      :value="activeModel"
      :options="modelOptions"
      size="tiny"
      class="switcher-model"
      filterable
      tag
      :consistent-menu-width="false"
      @update:value="(v: string) => { activeModel = v }"
    />
    <button
      class="switcher-refresh"
      title="刷新模型列表"
      :disabled="isFetchingModels"
      @click="handleFetchModels"
    >
      <RefreshCw :size="13" :class="{ spinning: isFetchingModels }" />
    </button>
  </div>
</template>

<style scoped>
.titlebar-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.switcher-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  margin-right: 2px;
  user-select: none;
}

.switcher-profile {
  width: 120px;
}

.switcher-model {
  width: 160px;
}

.switcher-sep {
  width: 1px;
  height: 16px;
  background: var(--arc-border);
  margin: 0 2px;
}

.switcher-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.switcher-refresh:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
}

.switcher-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
