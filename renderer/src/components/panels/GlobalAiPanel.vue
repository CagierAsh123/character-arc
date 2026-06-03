<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ArrowUp, ChevronDown, History, Loader2, Plus, Sparkles, Square, Trash2, X } from 'lucide-vue-next'
import { NTooltip } from 'naive-ui'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useGlobalAi } from '@/composables/useGlobalAi'
import { useGlobalAiContext } from '@/composables/useGlobalAiContext'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  panelLabel: string
  panelId: string
}>()

defineEmits<{ close: [] }>()

const appStore = useAppStore()
const { messages, isResponding, agentStatus, send, stop, applyChange, rejectChange, applyAllChanges, getChangeStatus, loadSession, newSession, switchToSession, refreshSessions, saveCurrentSession, deleteSession, currentSessionId, sessions } = useGlobalAi()
const { buildSystemPrompt } = useGlobalAiContext(computed(() => props.panelId))

const showSessionList = ref(false)
const expandedTools = reactive<Record<string, boolean>>({})
const showInfo = ref(false)

function toggleTool(id: string): void { expandedTools[id] = !expandedTools[id] }

function renderMarkdown(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }) as string)
}

// Load session on mount and on project switch
onMounted(async () => { await loadSession(); await refreshSessions() })
watch(() => appStore.selectedProjectId, async () => { showSessionList.value = false; await saveCurrentSession(); await loadSession(); await refreshSessions() })

async function handleNewSession(): Promise<void> {
  if (isResponding.value) return
  await saveCurrentSession()
  newSession()
  showSessionList.value = false
}

async function handleLoadSession(sessionId: string): Promise<void> {
  await saveCurrentSession()
  await switchToSession(sessionId)
  showSessionList.value = false
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId)
}

const sessionList = computed(() => sessions.value)
const inputValue = ref('')
const messageListRef = ref<HTMLElement | null>(null)

const quickPrompts = computed(() => {
  const label = props.panelLabel
  if (label.includes('大纲')) return ['帮我梳理一下大纲的矛盾点', '为当前分卷补充 3 个剧情节点', '分析大纲的节奏是否合理']
  if (label.includes('角色')) return ['帮我设计一个反派角色', '检查角色之间的动机冲突', '为现有角色补充成长弧线']
  if (label.includes('世界观')) return ['帮我完善这个世界的魔法体系', '为世界观添加更多细节', '检查世界观设定的一致性']
  if (label.includes('灵感')) return ['给我一些场景灵感', '设计一个剧情反转', '推荐几个高概念的开篇钩子']
  if (label.includes('线索')) return ['找出未收尾的伏笔', '为新章铺设线索', '检查伏笔之间是否存在矛盾']
  if (label.includes('流程')) return ['总结当前分卷的创作进度', '帮我检查流程文档完整性']
  if (label.includes('关系')) return ['梳理角色关系网络', '检查组织中是否有逻辑漏洞']
  if (label.includes('知识')) return ['检查项目知识一致性', '从章节中提取关键知识点']
  return ['帮我梳理一下创作思路', '检查当前内容的一致性', '给我一些写作建议']
})

async function handleSend(): Promise<void> {
  const text = inputValue.value.trim()
  if (!text || isResponding.value) return
  inputValue.value = ''
  const systemPrompt = buildSystemPrompt(props.panelId)
  send(text, systemPrompt)
  await nextTick()
  scrollToBottom()
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function scrollToBottom(): void {
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}

watch(() => messages.value.length, () => {
  nextTick(() => scrollToBottom())
})

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const READ_TOOLS = new Set(['list_characters', 'list_worldview', 'list_outline', 'list_inspirations', 'list_plot_threads', 'list_organizations', 'list_relationships', 'read_entity'])

function isReadTool(name: string): boolean { return READ_TOOLS.has(name) }

const TOOL_LABELS: Record<string, string> = {
  list_characters: '列出角色', list_worldview: '列出世界观', list_outline: '列出大纲',
  list_inspirations: '列出灵感', list_plot_threads: '列出线索', list_organizations: '列出组织',
  list_relationships: '列出关系', read_entity: '读取详情',
  create_character: '创建角色', update_character: '修改角色', delete_character: '删除角色',
  create_worldview: '创建世界观', update_worldview: '修改世界观', delete_worldview: '删除世界观',
  create_outline: '创建大纲', update_outline: '修改大纲', delete_outline: '删除大纲',
  create_inspiration: '创建灵感', update_inspiration: '修改灵感', delete_inspiration: '删除灵感',
  create_thread: '创建线索', update_thread: '修改线索', resolve_thread: '收尾线索',
  create_organization: '创建组织', update_organization: '修改组织',
  create_relationship: '创建关系',
}

function formatToolName(name: string): string { return TOOL_LABELS[name] || name }
</script>

<template>
  <div class="gai-panel">
    <!-- Header -->
    <header class="gai-header">
      <div class="gai-header-title">
        <Sparkles :size="14" />
        <span>{{ panelLabel }} · AI 助手</span>
      </div>
      <div class="gai-header-actions">
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="gai-header-btn" :disabled="isResponding" @click="handleNewSession">
              <Plus :size="13" />
            </button>
          </template>
          新对话
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="gai-header-btn" :class="{ active: showSessionList }" @click="showSessionList = !showSessionList">
              <History :size="13" />
            </button>
          </template>
          历史会话
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="gai-header-btn" @click="$emit('close')">
              <X :size="13" />
            </button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </header>

    <!-- Session list popover -->
    <div v-if="showSessionList" class="gai-session-list">
      <div v-if="sessionList.length === 0" class="gai-session-empty">暂无历史会话</div>
      <div
        v-for="s in sessionList"
        :key="s.id"
        class="gai-session-item"
        :class="{ active: currentSessionId === s.id }"
        @click="handleLoadSession(s.id)"
      >
        <span class="gai-session-title">{{ s.title }}</span>
        <button class="gai-session-delete" title="删除" @click.stop="handleDeleteSession(s.id)">
          <Trash2 :size="11" />
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div v-if="messages.length > 0" ref="messageListRef" class="gai-messages">
      <div v-for="msg in messages" :key="msg.id" class="gai-message" :class="msg.role">
        <div class="gai-message-avatar">
          <Sparkles v-if="msg.role === 'assistant'" :size="14" />
          <span v-else class="gai-message-avatar-user">U</span>
        </div>
        <div class="gai-message-body">
          <div class="gai-message-meta">
            <span class="gai-message-role">{{ msg.role === 'assistant' ? 'AI 助手' : '你' }}</span>
            <span class="gai-message-time">{{ formatTime(msg.createdAt) }}</span>
          </div>
          <div class="gai-message-content" :class="{ error: msg.isError }" v-html="renderMarkdown(msg.content)"></div>
          <span v-if="isResponding && msg.role === 'assistant' && !msg.content" class="gai-cursor">|</span>
          <!-- Collapsible tool call cards -->
          <div v-if="msg.toolCalls?.length" class="gai-tool-calls">
            <div
              v-for="tc in msg.toolCalls"
              :key="tc.call.id"
              class="gai-tool-card"
              :class="[tc.result.success ? 'success' : 'error', { expanded: expandedTools[tc.call.id] }]"
            >
              <div class="gai-tool-card-header" @click="toggleTool(tc.call.id)">
                <span class="gai-tool-card-name">{{ formatToolName(tc.call.name) }}</span>
                <span class="gai-tool-card-status" :class="{ running: tc.result.data === '执行中...' }">{{ tc.result.data === '执行中...' ? '⟳' : tc.result.success ? '✓' : '✗' }}</span>
                <ChevronDown v-if="tc.result.data" :size="12" class="gai-tool-chevron" />
              </div>
              <div v-if="expandedTools[tc.call.id] && tc.result.success && isReadTool(tc.call.name)" class="gai-tool-card-body">
                <div v-if="Array.isArray(tc.result.data) && tc.result.data.length === 0" class="gai-tool-empty">（空）</div>
                <div v-else-if="Array.isArray(tc.result.data)" class="gai-tool-list">
                  <div v-for="(item, i) in tc.result.data" :key="i" class="gai-tool-list-item">
                    <span v-if="item.name" class="gai-tool-item-name">{{ item.name }}</span>
                    <span v-if="item.role" class="gai-tool-item-role">[{{ item.role }}]</span>
                    <span v-if="item.title" class="gai-tool-item-name">{{ item.title }}</span>
                    <span v-if="item.status" class="gai-tool-item-status">[{{ item.status }}]</span>
                    <span v-if="item.from" class="gai-tool-rel">{{ item.from }} → {{ item.to }}: {{ item.type }}</span>
                  </div>
                </div>
                <pre v-else class="gai-tool-json">{{ JSON.stringify(tc.result.data, null, 2) }}</pre>
              </div>
              <div v-if="tc.result.error" class="gai-tool-card-error">{{ tc.result.error }}</div>
            </div>
          </div>
          <!-- Proposed changes with accept/reject -->
          <div v-if="msg.proposedChanges?.length" class="gai-changes">
            <div class="gai-changes-header">
              <span class="gai-changes-count">{{ msg.proposedChanges.length }} 项变更提议</span>
              <button
                type="button"
                class="gai-apply-all-btn"
                :disabled="!msg.proposedChanges.some(c => getChangeStatus(c.entityId) === 'pending')"
                @click="applyAllChanges(msg)"
              >
                全部接受
              </button>
            </div>
            <div
              v-for="change in msg.proposedChanges"
              :key="change.entityId"
              class="gai-change-card"
              :class="[change.action, getChangeStatus(change.entityId)]"
            >
              <div class="gai-change-header">
                <span class="gai-change-badge">{{ { create: '新建', update: '修改', delete: '删除' }[change.action] }}</span>
                <span class="gai-change-label">{{ change.label }}</span>
                <span v-if="getChangeStatus(change.entityId) === 'accepted'" class="gai-change-status accepted">已接受</span>
                <span v-if="getChangeStatus(change.entityId) === 'rejected'" class="gai-change-status rejected">已拒绝</span>
              </div>
              <div class="gai-change-body">
                <div v-if="change.action === 'create' && change.after" class="gai-change-preview">
                  <div v-for="(v, k) in (change.after as Record<string, unknown>)" :key="k" class="gai-change-field" v-show="v && k !== 'id' && k !== 'volumeId'">
                    <span class="gai-change-field-key">{{ k }}:</span>
                    <span class="gai-change-field-val">{{ typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v) }}</span>
                  </div>
                </div>
                <div v-else-if="change.action === 'delete' && change.before" class="gai-change-preview delete">
                  <span class="gai-change-delete-label">{{ (change.before as Record<string, unknown>).name || (change.before as Record<string, unknown>).title || change.entityId }}</span>
                </div>
                <div v-else-if="change.action === 'update'" class="gai-change-preview">
                  <span class="gai-change-hint">已生成修改方案（正式版将显示 before/after 对比）</span>
                </div>
              </div>
              <div v-if="getChangeStatus(change.entityId) === 'pending'" class="gai-change-actions">
                <button type="button" class="gai-accept-btn" @click="applyChange(change)">接受</button>
                <button type="button" class="gai-reject-btn" @click="rejectChange(change)">拒绝</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isResponding && messages[messages.length - 1]?.content" class="gai-typing-indicator">
        <Loader2 :size="14" class="gai-spinner" />
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="gai-empty">
      <Sparkles :size="28" class="gai-empty-icon" />
      <p class="gai-empty-title">AI 创作助手</p>
      <p class="gai-empty-desc">在这里与 AI 对话，协作管理你的创作内容。AI 可以读取和修改大纲、角色、世界观等数据。</p>
      <div class="gai-quick-prompts">
        <button
          v-for="(prompt, index) in quickPrompts"
          :key="index"
          type="button"
          class="gai-quick-prompt"
          :disabled="isResponding"
          @click="inputValue = prompt; handleSend()"
        >
          {{ prompt }}
        </button>
      </div>
    </div>

    <!-- Agent status bar -->
    <div v-if="agentStatus" class="gai-agent-status">
      <span class="gai-agent-pulse" />
      <span>{{ agentStatus }}</span>
    </div>

    <!-- Input -->
    <div class="gai-input-area">
      <div class="gai-input-wrapper">
        <textarea
          v-model="inputValue"
          class="gai-input"
          :disabled="isResponding"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
          rows="1"
          @keydown="handleKeydown"
          @input="(e: Event) => { const el = (e.target as HTMLTextAreaElement); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }"
        />
        <button
          v-if="!isResponding"
          type="button"
          class="gai-send-btn"
          :disabled="!inputValue.trim()"
          title="发送"
          @click="handleSend"
        >
          <ArrowUp :size="16" />
        </button>
        <button
          v-else
          type="button"
          class="gai-stop-btn"
          title="停止生成"
          @click="stop"
        >
          <Square :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── Header ── */
.gai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: calc(var(--arc-titlebar-height) + 10px) 14px 10px;
  border-bottom: 1px solid var(--arc-sidebar-border);
  gap: 8px;
}

.gai-header-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gai-header-title :deep(svg) { color: var(--arc-primary); flex-shrink: 0; }

.gai-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.gai-header-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.gai-header-btn:hover:not(:disabled) { background: var(--arc-bg-surface); color: var(--arc-text-primary); }
.gai-header-btn:disabled { opacity: 0.35; cursor: default; }
.gai-header-btn.active { background: var(--arc-bg-surface); color: var(--arc-primary); }

/* ── Session List ── */
.gai-session-list {
  flex-shrink: 0;
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid var(--arc-sidebar-border);
  padding: 4px 8px;
}

.gai-session-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--arc-text-hint);
}

.gai-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: var(--arc-radius-md);
  cursor: pointer;
  transition: background 0.14s ease;
  gap: 8px;
}

.gai-session-item:hover { background: var(--arc-bg-surface); }
.gai-session-item.active { background: color-mix(in srgb, var(--arc-primary) 8%, transparent); }

.gai-session-title {
  font-size: 12px;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.gai-session-delete {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--arc-radius-sm);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.14s ease, color 0.14s ease;
}

.gai-session-item:hover .gai-session-delete { opacity: 1; }
.gai-session-delete:hover { color: #e5484d; }

/* ── Messages ── */
.gai-messages {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.gai-message {
  display: flex;
  gap: 10px;
  animation: gai-fade-in 0.2s ease;
}

@keyframes gai-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.gai-message-avatar {
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-top: 2px;
}

.gai-message.assistant .gai-message-avatar {
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  color: var(--arc-primary);
}

.gai-message.user .gai-message-avatar {
  background: color-mix(in srgb, var(--arc-text-secondary) 12%, transparent);
}

.gai-message-avatar-user {
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-secondary);
}

.gai-message-body {
  flex: 1;
  min-width: 0;
}

.gai-message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.gai-message-role {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}

.gai-message-time {
  font-size: 10px;
  color: var(--arc-text-hint);
}

.gai-message-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.gai-message-content.error {
  color: #e5484d;
}

.gai-cursor {
  animation: blink 0.8s infinite;
  color: var(--arc-primary);
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.gai-typing-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 38px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.gai-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── Empty State ── */
.gai-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 20px;
  gap: 6px;
}

.gai-empty-icon {
  color: var(--arc-primary);
  opacity: 0.4;
  margin-bottom: 4px;
}

.gai-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--arc-text-primary);
  margin: 0;
}

.gai-empty-desc {
  font-size: 12px;
  color: var(--arc-text-hint);
  max-width: 260px;
  line-height: 1.5;
  margin: 0 0 12px;
}

.gai-quick-prompts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 260px;
}

.gai-quick-prompt {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.gai-quick-prompt:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
}

/* ── Input ── */
/* ── Agent Status ── */
.gai-agent-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  border-top: 1px solid var(--arc-sidebar-border);
}

.gai-agent-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: gai-pulse 1.2s ease-in-out infinite;
}

@keyframes gai-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* ── Input ── */
.gai-input-area {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--arc-sidebar-border);
}

.gai-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  padding: 6px 8px 6px 12px;
  transition: border-color 0.14s ease;
}

.gai-input-wrapper:focus-within {
  border-color: var(--arc-primary);
}

.gai-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  min-height: 22px;
  max-height: 120px;
}

.gai-input::placeholder {
  color: var(--arc-text-hint);
}

.gai-input:disabled {
  opacity: 0.5;
}

.gai-send-btn,
.gai-stop-btn {
  display: flex;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.14s ease, opacity 0.14s ease;
}

.gai-send-btn {
  background: var(--arc-primary);
  color: #fff;
}

.gai-send-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.gai-send-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.gai-stop-btn {
  background: #e5484d;
  color: #fff;
}

.gai-stop-btn:hover {
  opacity: 0.85;
}

/* ── Tool Call Cards ── */
.gai-tool-calls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.gai-tool-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  overflow: hidden;
  font-size: 12px;
}

.gai-tool-card.success {
  border-left: 3px solid var(--arc-primary);
}

.gai-tool-card.error {
  border-left: 3px solid #e5484d;
}

.gai-tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--arc-primary) 4%, transparent);
  cursor: pointer;
  user-select: none;
  gap: 6px;
}

.gai-tool-card-header:hover {
  background: color-mix(in srgb, var(--arc-primary) 8%, transparent);
}

.gai-tool-card .gai-tool-card-status.running {
  color: #f59e0b;
  animation: gai-pulse 1.2s ease-in-out infinite;
}

.gai-tool-chevron {
  flex-shrink: 0;
  color: var(--arc-text-hint);
  transition: transform 0.2s ease;
}

.gai-tool-card.expanded .gai-tool-chevron {
  transform: rotate(180deg);
}

.gai-tool-card-name {
  font-weight: 600;
  color: var(--arc-text-primary);
}

.gai-tool-card-status {
  font-size: 11px;
  font-weight: 700;
}

.gai-tool-card.success .gai-tool-card-status { color: var(--arc-primary); }
.gai-tool-card.error .gai-tool-card-status { color: #e5484d; }

.gai-tool-card-body {
  padding: 8px 10px;
}

.gai-tool-empty {
  color: var(--arc-text-hint);
  font-style: italic;
}

.gai-tool-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gai-tool-list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gai-tool-item-name { font-weight: 500; color: var(--arc-text-primary); }
.gai-tool-item-role { font-size: 11px; color: var(--arc-text-hint); }
.gai-tool-item-status { font-size: 10px; color: var(--arc-primary); padding: 0 4px; border-radius: 3px; background: color-mix(in srgb, var(--arc-primary) 10%, transparent); }
.gai-tool-rel { color: var(--arc-text-secondary); font-size: 11px; }
.gai-tool-json { font-size: 11px; color: var(--arc-text-secondary); white-space: pre-wrap; margin: 0; }
.gai-tool-card-error { padding: 6px 10px; color: #e5484d; font-size: 11px; background: color-mix(in srgb, #e5484d 5%, transparent); }

/* ── Change Proposal Cards ── */
.gai-changes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.gai-change-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  overflow: hidden;
  font-size: 12px;
}

.gai-change-card.create { border-left: 3px solid #10b981; }
.gai-change-card.update { border-left: 3px solid #f59e0b; }
.gai-change-card.delete { border-left: 3px solid #e5484d; }

.gai-change-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}

.gai-change-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.gai-change-card.create .gai-change-badge { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.gai-change-card.update .gai-change-badge { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #b45309; }
.gai-change-card.delete .gai-change-badge { background: color-mix(in srgb, #e5484d 15%, transparent); color: #e5484d; }

.gai-change-label { font-weight: 500; color: var(--arc-text-primary); }

.gai-change-body { padding: 6px 10px 8px; }

.gai-change-preview { display: flex; flex-direction: column; gap: 3px; }
.gai-change-preview.delete { color: #e5484d; }
.gai-change-field { display: flex; gap: 6px; }
.gai-change-field-key { color: var(--arc-text-hint); flex-shrink: 0; }
.gai-change-field-val { color: var(--arc-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gai-change-hint { color: var(--arc-text-hint); font-style: italic; }

.gai-changes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.gai-changes-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}

.gai-apply-all-btn {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border: 1px solid var(--arc-primary);
  border-radius: var(--arc-radius-sm);
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  cursor: pointer;
  transition: opacity 0.14s ease;
}

.gai-apply-all-btn:hover:not(:disabled) { opacity: 0.8; }
.gai-apply-all-btn:disabled { opacity: 0.35; cursor: default; }

.gai-change-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: auto;
}

.gai-change-status.accepted { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.gai-change-status.rejected { background: color-mix(in srgb, #e5484d 15%, transparent); color: #e5484d; }

.gai-change-card.accepted { opacity: 0.6; border-left-color: #10b981; }
.gai-change-card.rejected { opacity: 0.5; border-left-color: #e5484d; }

.gai-change-actions {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--arc-border);
}

.gai-accept-btn, .gai-reject-btn {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 14px;
  border-radius: var(--arc-radius-sm);
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.14s ease;
}

.gai-accept-btn {
  background: #10b981;
  color: #fff;
}

.gai-accept-btn:hover { opacity: 0.85; }

.gai-reject-btn {
  background: transparent;
  color: #e5484d;
  border-color: color-mix(in srgb, #e5484d 30%, transparent);
}

.gai-reject-btn:hover { background: color-mix(in srgb, #e5484d 8%, transparent); }

.gai-change-delete-label {
  color: #e5484d;
  font-weight: 500;
}
</style>
