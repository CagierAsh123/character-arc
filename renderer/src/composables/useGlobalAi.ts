import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { useGlobalAiTools, type ToolCall, type ToolResult, type ProposedChange } from './useGlobalAiTools'

export interface GlobalAiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  isError?: boolean
  toolCalls?: Array<{ call: ToolCall; result: ToolResult }>
  proposedChanges?: ProposedChange[]
}

export type ChangeStatus = 'pending' | 'accepted' | 'rejected'

const MAX_MESSAGES = 200

let msgSeq = 0
function nextId(): string { return `gai-${Date.now().toString(36)}-${++msgSeq}` }

export function useGlobalAi() {
  const store = useAppStore()
  const messages = ref<GlobalAiMessage[]>([])
  const isResponding = ref(false)
  const agentStatus = ref('')
  const changeStatuses = reactive<Record<string, ChangeStatus>>({})
  const { getTools } = useGlobalAiTools()

  // Stream management
  let streamId: string | null = null
  let streamingMsgId: string | null = null
  let removeListener: (() => void) | null = null

  // ═══ Session Management ═══
  const currentSessionId = ref('')

  function currentProjectId(): string {
    return store.selectedProjectId || store.currentProject?.id || ''
  }

  function generateSessionId(): string {
    return `gai-session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  function newSession(): void {
    currentSessionId.value = generateSessionId()
    messages.value = []
    for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
  }

  function loadSession(sessionId?: string): void {
    const pid = currentProjectId()
    if (!pid) return
    const sid = sessionId || currentSessionId.value
    if (!sid) { newSession(); return }
    const saved = store.loadGlobalAiSession(pid, sid)
    if (saved) {
      try {
        messages.value = JSON.parse(saved) as GlobalAiMessage[]
        currentSessionId.value = sid
      } catch { newSession() }
    } else {
      newSession()
    }
  }

  function switchToSession(sessionId: string): void {
    const pid = currentProjectId()
    if (!pid) return
    const saved = store.loadGlobalAiSession(pid, sessionId)
    if (saved) {
      try {
        messages.value = JSON.parse(saved) as GlobalAiMessage[]
        currentSessionId.value = sessionId
        for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
      } catch { /* ignore */ }
    }
  }

  function listSessions(): Array<{ id: string; title: string; updatedAt: string }> {
    return store.listGlobalAiSessions(currentProjectId())
  }

  function deleteSession(sessionId: string): void {
    store.deleteGlobalAiSession(currentProjectId(), sessionId)
    if (currentSessionId.value === sessionId) newSession()
  }

  // ═══ Persistence ═══
  let saveTimeout: number | null = null
  function scheduleSave(): void {
    if (saveTimeout !== null) clearTimeout(saveTimeout)
    saveTimeout = window.setTimeout(() => {
      const pid = currentProjectId()
      const sid = currentSessionId.value
      if (!pid || !sid) return
      const clipped = messages.value.slice(-MAX_MESSAGES)
      store.saveGlobalAiSession(pid, sid, JSON.stringify(clipped))
    }, 500)
  }

  watch(messages, () => scheduleSave(), { deep: true })

  // ═══ Stream Event Handler ═══
  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId) return

    if (payload.type === 'chunk') {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg) msg.content += payload.delta
      return
    }

    if (payload.type === 'agent_status') {
      agentStatus.value = payload.message
      return
    }

    if (payload.type === 'done') {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg && payload.content && !msg.content) msg.content = payload.content
      finalizeStream()
      return
    }

    if (payload.type === 'canceled') {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg && !msg.content.trim()) msg.content = '已停止生成'
      finalizeStream()
      return
    }

    if (payload.type === 'error') {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg) {
        if (!msg.content.trim()) msg.content = `生成失败：${payload.error || '未知错误'}`
        msg.isError = true
      }
      finalizeStream()
    }
  }

  function finalizeStream(): void {
    isResponding.value = false
    agentStatus.value = ''
    streamId = null
    streamingMsgId = null
  }

  function registerStreamListener(): void {
    if (removeListener) return
    removeListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function unregisterStreamListener(): void {
    removeListener?.()
    removeListener = null
  }

  // ═══ Send ═══
  async function send(prompt: string, systemPrompt?: string): Promise<void> {
    if (!prompt.trim() || isResponding.value) return

    registerStreamListener()

    // Add user message
    messages.value = [...messages.value, {
      id: nextId(), role: 'user', content: prompt.trim(), createdAt: Date.now()
    }]

    // Add placeholder assistant message
    const assistantId = nextId()
    messages.value = [...messages.value, {
      id: assistantId, role: 'assistant', content: '', createdAt: Date.now()
    }]
    streamingMsgId = assistantId
    isResponding.value = true

    try {
      const settings = store.appSettings
      if (!settings.apiKey?.trim()) {
        throw new Error('请先在设置中配置 AI API Key')
      }

      const recentMessages = messages.value.slice(-20, -1)
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }))

      const result = await window.characterArc.startAiStream(toIpcPayload({
        task: 'global-assistant',
        settings,
        context: {
          systemPrompt: systemPrompt || '',
          userPrompt: prompt.trim(),
          recentMessages
        }
      }))

      if (!result.success || !result.result?.streamId) {
        throw new Error(result.error ?? 'AI 对话启动失败')
      }
      streamId = result.result.streamId
    } catch (error) {
      const msg = messages.value.find(m => m.id === assistantId)
      if (msg) {
        msg.content = `生成失败：${error instanceof Error ? error.message : '未知错误'}`
        msg.isError = true
      }
      finalizeStream()
    }
  }

  function stop(): void {
    if (streamId) {
      window.characterArc.stopAiStream(streamId).catch(() => {})
    }
    finalizeStream()
  }

  function resetMessages(): void {
    messages.value = []
    for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
  }

  // ═══ Change Confirmation ═══
  function applyChange(change: ProposedChange): void {
    const { action, entityType, entityId, after } = change
    try {
      if (action === 'create') {
        if (entityType === 'character') store.createCharacter(after as Parameters<typeof store.createCharacter>[0])
        else if (entityType === 'worldview') store.createWorldviewEntry(after as Parameters<typeof store.createWorldviewEntry>[0])
        else if (entityType === 'outline') store.createOutlineItem(after as Parameters<typeof store.createOutlineItem>[0])
        else if (entityType === 'inspiration') store.createInspirationEntry(after as Parameters<typeof store.createInspirationEntry>[0])
        else if (entityType === 'thread') store.createPlotThread(after as Parameters<typeof store.createPlotThread>[0])
        else if (entityType === 'organization') store.createOrganization(after as Parameters<typeof store.createOrganization>[0])
        else if (entityType === 'relationship') store.createCharacterRelationship(after as Parameters<typeof store.createCharacterRelationship>[0])
      } else if (action === 'update') {
        if (entityType === 'character') store.updateCharacter(entityId, after as Parameters<typeof store.updateCharacter>[1])
        else if (entityType === 'worldview') store.updateWorldviewEntry(entityId, after as Parameters<typeof store.updateWorldviewEntry>[1])
        else if (entityType === 'outline') store.updateOutlineItem(entityId, after as Parameters<typeof store.updateOutlineItem>[1])
        else if (entityType === 'inspiration') store.updateInspirationEntry(entityId, after as Parameters<typeof store.updateInspirationEntry>[1])
        else if (entityType === 'thread') store.updatePlotThread(entityId, after as Parameters<typeof store.updatePlotThread>[1])
        else if (entityType === 'organization') store.updateOrganization(entityId, after as Parameters<typeof store.updateOrganization>[1])
      } else if (action === 'delete') {
        if (entityType === 'character') store.deleteCharacter(entityId)
        else if (entityType === 'worldview') store.deleteWorldviewEntry(entityId)
        else if (entityType === 'outline') store.deleteOutlineItem(entityId)
        else if (entityType === 'inspiration') store.deleteInspirationEntry(entityId)
        else if (entityType === 'thread') store.deletePlotThread(entityId)
        else if (entityType === 'organization') store.deleteOrganization(entityId)
        else if (entityType === 'relationship') store.deleteCharacterRelationship(entityId)
      }
      changeStatuses[entityId] = 'accepted'
    } catch (e) {
      console.error('[GlobalAI] Failed to apply change:', e)
    }
  }

  function rejectChange(change: ProposedChange): void {
    changeStatuses[change.entityId] = 'rejected'
    messages.value = [...messages.value, {
      id: nextId(), role: 'user',
      content: `[用户拒绝了此变更] ${change.label}`, createdAt: Date.now()
    }]
  }

  function applyAllChanges(msg: GlobalAiMessage): void {
    if (!msg.proposedChanges) return
    for (const change of msg.proposedChanges) {
      if (changeStatuses[change.entityId] === 'pending') applyChange(change)
    }
  }

  function getChangeStatus(entityId: string): ChangeStatus {
    return changeStatuses[entityId] || 'pending'
  }

  // Cleanup
  onBeforeUnmount(() => unregisterStreamListener())

  return {
    messages, isResponding, agentStatus, send, stop, resetMessages,
    changeStatuses, applyChange, rejectChange, applyAllChanges, getChangeStatus,
    loadSession, newSession, switchToSession, listSessions, deleteSession, currentSessionId
  }
}
