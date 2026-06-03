import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiTaskPayload, AppSettings, ChapterPostGenerationIssuesPayload, ChapterStateWarningsPayload } from './shared-types'
import { runAiTask, streamAiTask, testAiConnection, fetchModels, fetchImageModels, generateImage } from './runtime'
import { runStreamingAgentTask } from './agent/streaming-orchestrator'
import { runAgent } from './agent/run-agent'
import { providerSupportsTools } from './provider'
import { setChapterPostGenerationIssuesEmitter, setChapterWarningsEmitter } from './runtime/orchestrator'
import { retrieveKnowledgeContext } from './knowledge-retrieval'
import { backfillProjectStateFromChapters } from './state-backfill'
import { buildStoryStateContext } from '../story-state-store'
import { ensureWorkspaceDb } from '../workspace-store'
import { runSpiralBootstrap } from './spiral'
import type { SpiralBootstrapInput } from './spiral'

/**
 * AI IPC 模块的外部依赖注入接口。
 * 由主进程初始化时提供，用于获取工作区快照和广播事件。
 */
type AiIpcDeps = {
  /** 获取最新工作区快照（知识文档、AI 运行记录等） */
  getLatestWorkspaceSnapshot: () => { workspaces?: Record<string, { knowledgeDocuments?: unknown[]; aiRuns?: unknown[] }> } | null
  /** 向 renderer 广播 AI 运行事件 */
  emitAiRunEvent: (payload: { projectId: string; meta: Record<string, unknown> }) => void
  /** 向 renderer 广播章节状态告警事件 */
  emitChapterStateWarnings: (payload: ChapterStateWarningsPayload) => void
  /** 向 renderer 广播章节生成后处理问题事件 */
  emitChapterPostGenerationIssues: (payload: ChapterPostGenerationIssuesPayload) => void
}

/** 注入的外部依赖，registerAiIpcHandlers 调用时初始化 */
let deps: AiIpcDeps | null = null

/** 流式任务的 AbortController（按 streamId 索引） */
const activeAiStreams = new Map<string, AbortController>()

/** 等待渲染侧回传结果的代理工具调用（按 toolUseId 索引） */
const pendingToolCalls = new Map<string, { resolve: (result: unknown) => void; reject: (err: Error) => void }>()

/** 创建将工具调用委托给渲染侧的代理工具集 */
export function createDelegatingTools(streamId: string): Array<import('./agent/tools/types').Tool> {
  const TOOL_DEFS: Array<{ name: string; description: string; params: Record<string, { type: string; description: string }> }> = [
    { name: 'list_characters', description: '列出所有角色（名称+ID+定位）', params: {} },
    { name: 'list_worldview', description: '列出所有世界观条目（标题+类型+ID）', params: {} },
    { name: 'list_outline', description: '列出所有大纲节点（标题+ID+所属分卷+状态）', params: {} },
    { name: 'list_inspirations', description: '列出所有灵感卡片（标题+类型+ID）', params: {} },
    { name: 'list_plot_threads', description: '列出所有剧情线索（标题+状态+ID）', params: {} },
    { name: 'list_organizations', description: '列出所有组织（名称+类型+ID）', params: {} },
    { name: 'list_relationships', description: '列出所有角色关系', params: {} },
    { name: 'read_entity', description: '读取任意实体的完整详情', params: { entityType: { type: 'string', description: '实体类型: character/worldview/outline/inspiration/thread/organization/relationship' }, entityId: { type: 'string', description: '实体 ID' } } },
    { name: 'create_character', description: '创建新角色（需用户确认）', params: { name: { type: 'string', description: '角色名' }, role: { type: 'string', description: '角色定位' }, description: { type: 'string', description: '角色描述' }, tags: { type: 'string', description: '标签，逗号分隔' } } },
    { name: 'update_character', description: '修改角色（需用户确认）', params: { entityId: { type: 'string', description: '角色ID' }, name: { type: 'string', description: '新名称' }, role: { type: 'string', description: '新定位' }, description: { type: 'string', description: '新描述' } } },
    { name: 'delete_character', description: '删除角色（需用户确认）', params: { entityId: { type: 'string', description: '角色ID' } } },
    { name: 'create_worldview', description: '创建世界观条目（需用户确认）', params: { type: { type: 'string', description: '类型' }, title: { type: 'string', description: '标题' }, content: { type: 'string', description: '内容' } } },
    { name: 'update_worldview', description: '修改世界观条目（需用户确认）', params: { entityId: { type: 'string', description: '条目ID' }, title: { type: 'string', description: '新标题' }, content: { type: 'string', description: '新内容' } } },
    { name: 'delete_worldview', description: '删除世界观条目（需用户确认）', params: { entityId: { type: 'string', description: '条目ID' } } },
    { name: 'create_outline', description: '创建大纲节点（需用户确认）', params: { volumeId: { type: 'string', description: '分卷ID' }, title: { type: 'string', description: '标题' }, conflict: { type: 'string', description: '冲突' }, summary: { type: 'string', description: '摘要' } } },
    { name: 'update_outline', description: '修改大纲节点（需用户确认）', params: { entityId: { type: 'string', description: '节点ID' }, title: { type: 'string', description: '新标题' }, summary: { type: 'string', description: '新摘要' } } },
    { name: 'delete_outline', description: '删除大纲节点（需用户确认）', params: { entityId: { type: 'string', description: '节点ID' } } },
    { name: 'create_inspiration', description: '创建灵感卡片（需用户确认）', params: { type: { type: 'string', description: '类型' }, title: { type: 'string', description: '标题' }, content: { type: 'string', description: '内容' } } },
    { name: 'create_thread', description: '创建剧情线索（需用户确认）', params: { title: { type: 'string', description: '标题' }, description: { type: 'string', description: '描述' } } },
    { name: 'create_organization', description: '创建组织（需用户确认）', params: { name: { type: 'string', description: '组织名' }, type: { type: 'string', description: '类型' }, description: { type: 'string', description: '描述' } } },
    { name: 'update_organization', description: '修改组织（需用户确认）', params: { entityId: { type: 'string', description: '组织ID' }, name: { type: 'string', description: '新名称' }, type: { type: 'string', description: '新类型' }, description: { type: 'string', description: '新描述' } } },
    { name: 'delete_organization', description: '删除组织（需用户确认）', params: { entityId: { type: 'string', description: '组织ID' } } },
    { name: 'create_relationship', description: '创建角色关系（需用户确认）', params: { fromCharacterId: { type: 'string', description: '源角色ID' }, toCharacterId: { type: 'string', description: '目标角色ID' }, type: { type: 'string', description: '关系类型' }, description: { type: 'string', description: '描述' } } },
    { name: 'update_inspiration', description: '修改灵感卡片（需用户确认）', params: { entityId: { type: 'string', description: '卡片ID' }, title: { type: 'string', description: '新标题' }, content: { type: 'string', description: '新内容' } } },
    { name: 'delete_inspiration', description: '删除灵感卡片（需用户确认）', params: { entityId: { type: 'string', description: '卡片ID' } } },
    { name: 'update_thread', description: '修改剧情线索（需用户确认）', params: { entityId: { type: 'string', description: '线索ID' }, title: { type: 'string', description: '新标题' }, description: { type: 'string', description: '新描述' }, status: { type: 'string', description: '状态: open/resolved' } } },
    { name: 'delete_thread', description: '删除剧情线索（需用户确认）', params: { entityId: { type: 'string', description: '线索ID' } } },
    { name: 'resolve_thread', description: '收尾剧情线索（需用户确认）', params: { entityId: { type: 'string', description: '线索ID' } } },
  ]

  return TOOL_DEFS.map((def) => ({
    definition: {
      name: def.name,
      description: def.description,
      inputSchema: {
        type: 'object' as const,
        properties: def.params as Record<string, unknown>,
        required: Object.keys(def.params)
      }
    },
    handler: async (args: Record<string, unknown>, _ctx: { signal: AbortSignal; projectId: string }) => {
      const toolUseId = `dt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      return new Promise((resolve) => {
        pendingToolCalls.set(toolUseId, {
          resolve: (r) => resolve(r as { content: string; isError?: boolean }),
          reject: (e) => resolve({ content: e.message, isError: true })
        })
        setTimeout(() => {
          if (pendingToolCalls.has(toolUseId)) {
            pendingToolCalls.delete(toolUseId)
            resolve({ content: '工具调用超时（30s），渲染侧未响应', isError: true })
          }
        }, 30000)
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          win.webContents.send('characterarc:ai-delegated-tool-call', { streamId, toolUseId, toolName: def.name, args })
        }
      })
    }
  }))
}

/** 渲染侧回传工具执行结果 */
function handleToolResult(streamId: string, toolUseId: string, result: unknown, isError: boolean): void {
  const pending = pendingToolCalls.get(toolUseId)
  if (!pending) return
  pendingToolCalls.delete(toolUseId)
  if (isError) {
    pending.reject(new Error(typeof result === 'string' ? result : '工具执行失败'))
  } else {
    pending.resolve(result)
  }
}

/**
 * 非流式任务的 AbortController（按 clientTaskId 索引）。
 * 前端 `runTrackedAiTask` 发起请求时带上 `clientTaskId`，
 * 超时或用户手动取消时通过 `characterarc:ai-cancel` 通道 abort。
 */
const activeAiTasks = new Map<string, AbortController>()

/**
 * 注册所有 AI 相关的 IPC handler。
 * 包括非流式生成、流式生成、Agent 生成、连接测试、模型列表、图片生成、
 * 世界状态读取、章节版本读取、螺旋生成、状态补录等。
 *
 * @param injectedDeps - 外部依赖注入
 */
export function registerAiIpcHandlers(injectedDeps: AiIpcDeps): void {
  deps = injectedDeps
  setChapterWarningsEmitter((payload) => deps?.emitChapterStateWarnings(payload))
  setChapterPostGenerationIssuesEmitter((payload) => deps?.emitChapterPostGenerationIssues(payload))

  // ── 非流式 AI 生成（支持 abort） ──
  ipcMain.handle('characterarc:ai-generate', async (_event, payload: AiTaskPayload) => {
    const clientTaskId = payload.clientTaskId || ''
    const controller = new AbortController()
    if (clientTaskId) {
      activeAiTasks.set(clientTaskId, controller)
    }

    const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
    try {
      if (controller.signal.aborted) {
        throw new Error('任务已被取消。')
      }

      const response = await runAiTask(payload, knowledgeContext, controller.signal)

      deps!.emitAiRunEvent({ projectId: response.meta.projectId ?? '', meta: { id: randomUUID(), ...response.meta } })
      return { success: true, result: response.result }
    } catch (error) {
      const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
        ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
      if (aiRunMeta) {
        deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId ?? ''), meta: { id: randomUUID(), ...aiRunMeta } })
      }
      return { success: false, error: error instanceof Error ? error.message : 'AI 调用失败' }
    } finally {
      if (clientTaskId) {
        activeAiTasks.delete(clientTaskId)
      }
    }
  })

  // ── 取消非流式任务 ──
  ipcMain.handle('characterarc:ai-cancel', async (_event, clientTaskId: unknown) => {
    const key = typeof clientTaskId === 'string' ? clientTaskId : ''
    const controller = activeAiTasks.get(key)
    if (!controller) return { success: false, error: '未找到对应的运行中任务' }
    controller.abort()
    return { success: true }
  })

  // ── 流式 AI 生成（支持自动升级到 Agent 路径） ──
  ipcMain.handle('characterarc:ai-stream-start', async (event, payload: AiTaskPayload) => {
    try {
      const streamId = `stream-${randomUUID()}`
      const controller = new AbortController()
      const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
      activeAiStreams.set(streamId, controller)

      const settings = payload.settings as AppSettings
      const useAgentPath = (payload.task === 'chapter-first-draft' || payload.task === 'global-assistant') && providerSupportsTools(settings)
      const isGlobalAssistant = payload.task === 'global-assistant'

      let streamedContent = ''
      void (async () => {
        try {
          if (useAgentPath) {
            const extraTools = isGlobalAssistant ? createDelegatingTools(streamId) : undefined
            const result = await runStreamingAgentTask(
              payload,
              {
                onTextDelta: (delta) => {
                  streamedContent += delta
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                  }
                },
                onToolUseStart: (toolUseId, toolName, args) => {
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_use_start', toolUseId, toolName, args })
                  }
                },
                onToolResult: (toolUseId, toolName, content, isError, durationMs) => {
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_result', toolUseId, toolName, content, isError, durationMs })
                  }
                },
                onAgentStatus: (message, iteration, maxIterations) => {
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'agent_status', message, iteration, maxIterations })
                  }
                },
                onEditApplied: (chapterId, editType, preview, versionId) => {
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_applied', chapterId, editType, preview, versionId })
                  }
                }
              },
              controller.signal,
              knowledgeContext,
              extraTools
            )
            deps!.emitAiRunEvent({ projectId: result.meta.projectId || 'global', meta: { id: randomUUID(), ...result.meta } })
            if (!event.sender.isDestroyed()) {
              event.sender.send('characterarc:ai-stream-event', {
                streamId,
                type: 'done',
                content: (result.result as { content?: string }).content ?? streamedContent,
                result: result.result
              })
            }
          } else {
            const result = await streamAiTask(
              payload,
              {
                onTextDelta: (delta: string) => {
                  streamedContent += delta
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                  }
                }
              },
              controller.signal,
              knowledgeContext
            )
            deps!.emitAiRunEvent({ projectId: result.meta.projectId || 'global', meta: { id: randomUUID(), ...result.meta } })
            if (!event.sender.isDestroyed()) {
              event.sender.send('characterarc:ai-stream-event', {
                streamId,
                type: 'done',
                content: (result.result as { content?: string }).content ?? streamedContent,
                result: result.result
              })
            }
          }
        } catch (error) {
          const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
            ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
          if (aiRunMeta && (aiRunMeta as { projectId?: string }).projectId) {
            deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId), meta: { id: randomUUID(), ...aiRunMeta } })
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
              ? { streamId, type: 'canceled', content: streamedContent }
              : { streamId, type: 'error', error: error instanceof Error ? error.message : 'AI 流式调用失败' }
            )
          }
        } finally {
          activeAiStreams.delete(streamId)
        }
      })()

      return { success: true, result: { streamId } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI 流式调用启动失败' }
    }
  })

  // ── 停止流式任务 ──
  ipcMain.handle('characterarc:ai-stream-stop', async (event, streamId: unknown) => {
    const key = typeof streamId === 'string' ? streamId : ''
    const controller = activeAiStreams.get(key)
    if (!controller) return { success: false, error: '当前没有可停止的生成任务' }
    controller.abort()

    // 发送 canceled 事件给前端，确保用户看到停止反馈
    if (!event.sender.isDestroyed()) {
      event.sender.send('characterarc:ai-stream-event', { streamId: key, type: 'canceled', content: '' })
    }

    return { success: true }
  })

  // ── Agent 流式生成（带工具调用） ──
  ipcMain.handle('characterarc:ai-agent-stream-start', async (event, payload: AiTaskPayload) => {
    try {
      if (!providerSupportsTools(payload.settings as AppSettings)) {
        return { success: false, error: '当前 AI 供应商不支持工具调用，请切换到支持 tool_use 的模型。' }
      }

      const streamId = `agent-${randomUUID()}`
      const controller = new AbortController()
      const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
      activeAiStreams.set(streamId, controller)

      const isGlobalAssistant = payload.task === 'global-assistant'
      const extraTools = isGlobalAssistant ? createDelegatingTools(streamId) : undefined

      let streamedContent = ''
      void (async () => {
        try {
          const result = await runStreamingAgentTask(
            payload,
            {
              onTextDelta: (delta) => {
                streamedContent += delta
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                }
              },
              onToolUseStart: (toolUseId, toolName, args) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_use_start', toolUseId, toolName, args })
                }
              },
              onToolResult: (toolUseId, toolName, content, isError, durationMs) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_result', toolUseId, toolName, content, isError, durationMs })
                }
              },
              onAgentStatus: (message, iteration, maxIterations) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'agent_status', message, iteration, maxIterations })
                }
              },
              onEditApplied: (chapterId, editType, preview, versionId) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_applied', chapterId, editType, preview, versionId })
                }
              }
            },
            controller.signal,
            knowledgeContext,
            extraTools
          )
          deps!.emitAiRunEvent({ projectId: result.meta.projectId || 'global', meta: { id: randomUUID(), ...result.meta } })
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', { streamId, type: 'done', content: streamedContent, result: result.result })
          }
        } catch (error) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
              ? { streamId, type: 'canceled', content: streamedContent }
              : { streamId, type: 'error', error: error instanceof Error ? error.message : 'AI Agent 调用失败' }
            )
          }
        } finally {
          activeAiStreams.delete(streamId)
        }
      })()

      return { success: true, result: { streamId } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI Agent 启动失败' }
    }
  })

  // ── 连接测试 ──
  ipcMain.handle('characterarc:ai-test-connection', async (_event, settings: unknown) => {
    try {
      const result = await testAiConnection(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI 连接测试失败' }
    }
  })

  // ── 模型列表 ──
  ipcMain.handle('characterarc:ai-fetch-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取模型列表失败' }
    }
  })

  ipcMain.handle('characterarc:ai-fetch-image-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchImageModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取图片模型列表失败' }
    }
  })

  // ── 图片生成 ──
  ipcMain.handle('characterarc:ai-generate-image', async (_event, payload: unknown) => {
    try {
      const request = payload as { settings?: AppSettings; prompt?: string }
      const prompt = String(request?.prompt ?? '').trim()
      if (!prompt) {
        throw new Error('图片生成提示词不能为空。')
      }
      const result = await generateImage(request.settings as AppSettings, prompt)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '图片生成失败' }
    }
  })

  // ── 读取当前项目的结构化世界状态（供前端状态面板展示） ──
  ipcMain.handle('characterarc:ai-read-story-state', async (_event, projectId: unknown) => {
    try {
      const id = String(projectId ?? '').trim()
      if (!id) throw new Error('缺少 projectId。')
      const db = await ensureWorkspaceDb()
      const context = buildStoryStateContext(db, id, [])
      return { success: true, result: context }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取世界状态失败' }
    }
  })

  // ── 读取章节版本（供 agent 编辑撤销） ──
  ipcMain.handle('characterarc:ai-read-chapter-version', async (_event, payload: unknown) => {
    try {
      const req = payload as { projectId?: string; versionId?: string }
      const projectId = String(req?.projectId ?? '').trim()
      const versionId = String(req?.versionId ?? '').trim()
      if (!projectId || !versionId) throw new Error('缺少 projectId 或 versionId。')
      const db = await ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, chapter_id, title, summary, status, word_target, content, created_at FROM chapter_versions WHERE id = ? AND project_id = ?'
      ).get(versionId, projectId) as Record<string, unknown> | undefined
      if (!row) throw new Error('版本不存在')
      return { success: true, result: { id: row.id, chapterId: row.chapter_id, title: row.title, summary: row.summary, status: row.status, wordTarget: row.word_target, content: row.content, createdAt: row.created_at } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取版本失败' }
    }
  })

  // ── 读取单个章节内容（供 agent 编辑后前端刷新） ──
  ipcMain.handle('characterarc:ai-read-chapter', async (_event, payload: unknown) => {
    try {
      const req = payload as { projectId?: string; chapterId?: string }
      const projectId = String(req?.projectId ?? '').trim()
      const chapterId = String(req?.chapterId ?? '').trim()
      if (!projectId || !chapterId) throw new Error('缺少 projectId 或 chapterId。')
      const db = await ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, title, summary, status, word_target, content FROM chapters WHERE id = ? AND project_id = ?'
      ).get(chapterId, projectId) as Record<string, unknown> | undefined
      if (!row) throw new Error('章节不存在')
      return { success: true, result: { id: row.id, title: row.title, summary: row.summary, status: row.status, wordTarget: row.word_target, content: row.content } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取章节失败' }
    }
  })

  // ── 螺旋式深度生成 ──
  /** 当前进行中的螺旋生成任务的 AbortController */
  let activeSpiralController: AbortController | null = null

  ipcMain.handle('characterarc:ai-spiral-bootstrap', async (event, payload: unknown) => {
    const controller = new AbortController()
    activeSpiralController = controller
    try {
      const request = payload as Partial<SpiralBootstrapInput>
      if (!request.settings) throw new Error('缺少 AI 设置。')
      if (!request.projectPremise?.trim()) throw new Error('缺少小说简介。')

      const input: SpiralBootstrapInput = {
        settings: request.settings,
        projectTitle: request.projectTitle ?? '',
        projectGenre: request.projectGenre ?? '',
        projectNovelLength: request.projectNovelLength === 'short' ? 'short' : 'long',
        projectPremise: request.projectPremise,
        projectId: request.projectId,
        projectSkills: request.projectSkills
      }

      const result = await runSpiralBootstrap(input, (progressEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-spiral-progress', progressEvent)
        }
      }, controller.signal)

      return { success: true, result }
    } catch (error) {
      if (controller.signal.aborted) {
        return { success: false, error: '螺旋生成已取消' }
      }
      return { success: false, error: error instanceof Error ? error.message : '螺旋生成失败' }
    } finally {
      activeSpiralController = null
    }
  })

  ipcMain.handle('characterarc:ai-spiral-cancel', async () => {
    if (!activeSpiralController) return { success: false, error: '没有正在进行的螺旋生成任务' }
    activeSpiralController.abort()
    return { success: true }
  })

  // ── 已有章节状态补录 ──
  ipcMain.handle('characterarc:ai-backfill-state', async (event, payload: unknown) => {
    try {
      const request = payload as { settings?: AppSettings; projectId?: string }
      const projectId = String(request?.projectId ?? '').trim()
      if (!projectId) throw new Error('缺少 projectId。')
      if (!request?.settings) throw new Error('缺少 AI 设置。')

      const result = await backfillProjectStateFromChapters(request.settings, projectId, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-backfill-state-progress', progress)
        }
      })
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '状态补录失败' }
    }
  })

  // ── 代理工具结果回传（渲染侧 → 主进程）──
  ipcMain.handle('characterarc:ai-submit-tool-result', async (_event, payload: { streamId: string; toolUseId: string; result: unknown; isError: boolean }) => {
    handleToolResult(payload.streamId, payload.toolUseId, payload.result, payload.isError)
  })
}
