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

  // ═══ Session Management (IPC → SQLite, same as chapter AI) ═══
  const currentSessionId = ref('')
  const sessions = ref<Array<{ id: string; title: string; created_at: string; updated_at: string }>>([])

  function currentProjectId(): string {
    return store.selectedProjectId || store.currentProject?.id || ''
  }

  function generateSessionId(): string {
    return `gai-session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  function deriveTitle(): string {
    const firstUser = messages.value.find(m => m.role === 'user')
    if (!firstUser) return '新对话'
    return firstUser.content.slice(0, 30) || '新对话'
  }

  function newSession(): void {
    currentSessionId.value = generateSessionId()
    messages.value = []
    for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
  }

  async function refreshSessions(): Promise<void> {
    const pid = currentProjectId()
    if (!pid) return
    try {
      const res = await window.characterArc.listSessions(pid)
      if (res.success && res.result) {
        // Only show global AI sessions (not chapter assistant sessions)
        sessions.value = res.result.filter(s => s.id.startsWith('gai-session-'))
      }
    } catch { /* ignore */ }
  }

  async function loadSession(sessionId?: string): Promise<void> {
    const sid = sessionId || currentSessionId.value
    if (!sid) { newSession(); return }
    try {
      const res = await window.characterArc.loadSession(sid)
      if (res.success && res.result?.messages) {
        messages.value = res.result.messages as GlobalAiMessage[]
        currentSessionId.value = sid
        restoreChangeStatuses()
        return
      }
    } catch { /* ignore */ }
    newSession()
  }

  async function switchToSession(sessionId: string): Promise<void> {
    try {
      const res = await window.characterArc.loadSession(sessionId)
      if (res.success && res.result?.messages) {
        messages.value = res.result.messages as GlobalAiMessage[]
        currentSessionId.value = sessionId
        for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
        restoreChangeStatuses()
      }
    } catch { /* ignore */ }
  }

  // Persist confirm/reject status inside proposedChanges
  function restoreChangeStatuses(): void {
    for (const key of Object.keys(changeStatuses)) delete changeStatuses[key]
    for (const msg of messages.value) {
      if (msg.proposedChanges) {
        for (const pc of msg.proposedChanges) {
          const status = (pc as any)._status as ChangeStatus | undefined
          if (status && status !== 'pending') changeStatuses[pc.entityId] = status
        }
      }
    }
  }

  async function saveCurrentSession(): Promise<void> {
    const pid = currentProjectId()
    const sid = currentSessionId.value
    if (!pid || !sid || messages.value.length === 0) return
    // JSON round-trip to strip Vue proxies before IPC
    // Also embed confirm status so it survives save/load
    const clipped = JSON.parse(JSON.stringify(
      messages.value.slice(-MAX_MESSAGES).map(m => ({
        id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
        isError: m.isError, toolCalls: m.toolCalls,
        proposedChanges: m.proposedChanges?.map(pc => ({
          ...pc, _status: changeStatuses[pc.entityId] || 'pending'
        }))
      }))
    ))
    try {
      const res = await window.characterArc.saveSession({
        id: sid,
        projectId: pid,
        title: deriveTitle(),
        messages: clipped
      })
      if (!res.success) console.error('[GlobalAI] save failed:', res.error)
      await refreshSessions()
    } catch (e) {
      console.error('[GlobalAI] save exception:', e)
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    try {
      await window.characterArc.deleteSession(sessionId)
      await refreshSessions()
      if (currentSessionId.value === sessionId) newSession()
    } catch { /* ignore */ }
  }

  // ═══ Persistence (debounced save to SQLite via IPC) ═══
  let saveTimeout: number | null = null
  function scheduleSave(): void {
    if (saveTimeout !== null) clearTimeout(saveTimeout)
    saveTimeout = window.setTimeout(() => { saveCurrentSession() }, 500)
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

    if (payload.type === 'tool_use_start') {
      // Show tool call card immediately in the streaming message
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg) {
        if (!msg.toolCalls) msg.toolCalls = []
        msg.toolCalls = [...msg.toolCalls, {
          call: { id: payload.toolUseId, name: payload.toolName, args: payload.args },
          result: { callId: payload.toolUseId, success: true, data: '执行中...' }
        }]
      }
      agentStatus.value = `调用工具：${payload.toolName}`
      return
    }

    if (payload.type === 'tool_result') {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg && msg.toolCalls) {
        const idx = msg.toolCalls.findIndex(tc => tc.call.id === payload.toolUseId)
        if (idx >= 0) {
          msg.toolCalls = msg.toolCalls.map(tc =>
            tc.call.id === payload.toolUseId
              ? { ...tc, result: { callId: payload.toolUseId, success: !payload.isError, data: payload.content, error: payload.isError ? payload.content : undefined } }
              : tc
          )
        }
      }
      agentStatus.value = ''
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
    // Save immediately after each AI response (same as chapter AI)
    void saveCurrentSession().catch(() => {})
  }

  // Delegated tool execution
  let removeToolListener: (() => void) | null = null

  function registerStreamListener(): void {
    if (removeListener) return
    removeListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function registerToolListener(): void {
    if (removeToolListener) return
    removeToolListener = window.characterArc.onDelegatedToolCall((payload) => {
      const p = payload as { streamId: string; toolUseId: string; toolName: string; args: Record<string, unknown> }
      if (p.streamId !== streamId) return

      // Show tool call in the UI as "executing..."
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg) {
        if (!msg.toolCalls) msg.toolCalls = []
        msg.toolCalls = [...msg.toolCalls, {
          call: { id: p.toolUseId, name: p.toolName, args: p.args },
          result: { callId: p.toolUseId, success: true, data: '执行中...' }
        }]
      }
      agentStatus.value = `执行工具：${p.toolName}`

      const { execute } = useGlobalAiTools()
      const execResult = execute({ id: p.toolUseId, name: p.toolName, args: p.args })

      // Update the tool call card with the result
      if (msg && msg.toolCalls) {
        msg.toolCalls = msg.toolCalls.map(tc =>
          tc.call.id === p.toolUseId
            ? { ...tc, result: { callId: p.toolUseId, success: execResult.success, data: execResult.data, error: execResult.error } }
            : tc
        )
      }

      // Extract ProposedChange objects for confirm/reject cards
      if (execResult.success && execResult.data && typeof execResult.data === 'object' && 'action' in (execResult.data as object)) {
        const change = execResult.data as ProposedChange
        if (!msg) return  // shouldn't happen
        if (!msg.proposedChanges) msg.proposedChanges = []
        msg.proposedChanges = [...msg.proposedChanges, change]
        changeStatuses[change.entityId] = 'pending'
      }

      agentStatus.value = ''

      // Submit result back to main process in ToolHandlerResult format
      window.characterArc.submitToolResult({
        streamId: p.streamId,
        toolUseId: p.toolUseId,
        result: {
          content: execResult.success ? stringifyToolData(execResult.data) : (execResult.error || '工具执行失败'),
          isError: !execResult.success
        },
        isError: !execResult.success
      })
    })
  }

  function stringifyToolData(data: unknown): string {
    if (typeof data === 'string') return data
    if (data && typeof data === 'object' && 'action' in (data as object)) {
      // ProposedChange - format nicely
      const c = data as ProposedChange
      return `[提议: ${c.action === 'create' ? '创建' : c.action === 'update' ? '修改' : '删除'} ${c.entityType}] ${c.label}\n${JSON.stringify(c.after || c.before, null, 2)}`
    }
    return JSON.stringify(data, null, 2)
  }

  function unregisterStreamListener(): void {
    removeListener?.()
    removeListener = null
    removeToolListener?.()
    removeToolListener = null
  }

  // ═══ Send ═══
  async function send(prompt: string, systemPrompt?: string): Promise<void> {
    if (!prompt.trim() || isResponding.value) return

    registerStreamListener()
    registerToolListener()

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

      const supportsTools = settings.provider !== 'deepseek'  // DeepSeek has limited tool support
      const startFn = supportsTools ? window.characterArc.startAiAgentStream : window.characterArc.startAiStream

      const pid = currentProjectId()
      const result = await startFn(toIpcPayload({
        task: 'global-assistant',
        settings,
        context: {
          projectId: pid,
          systemPrompt: systemPrompt || '',
          userPrompt: prompt.trim(),
          recentMessages,
          projectTitle: store.currentProject?.title || '',
          projectGenre: store.currentProject?.genre || '',
          projectWordCount: store.currentProject?.wordCount || ''
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

  // Cleanup — flush pending save immediately
  onBeforeUnmount(() => {
    if (saveTimeout !== null) clearTimeout(saveTimeout)
    saveCurrentSession()
    unregisterStreamListener()
  })

  return {
    messages, isResponding, agentStatus, send, stop, resetMessages,
    changeStatuses, applyChange, rejectChange, applyAllChanges, getChangeStatus,
    loadSession, newSession, switchToSession, refreshSessions, saveCurrentSession,
    deleteSession, currentSessionId, sessions
  }
}
