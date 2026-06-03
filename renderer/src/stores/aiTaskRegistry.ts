import { computed, ref, type Ref } from 'vue'
import { AI_TASK_RETENTION_MS, type AiTaskRun, type AiTaskRunInput } from '@/features/ai/taskRegistry'
import type { AppSettings } from '@/types/app'

export function createAiTaskRegistry(appSettings: Ref<AppSettings>) {
  const aiTaskRuns = ref<Map<string, AiTaskRun>>(new Map())
  let currentClientTaskId: string | null = null

  function replaceTaskRuns(updater: (next: Map<string, AiTaskRun>) => void): void {
    const next = new Map(aiTaskRuns.value); updater(next); aiTaskRuns.value = next
  }

  const runningAiTasks = computed(() =>
    Array.from(aiTaskRuns.value.values()).filter(r => r.stage === 'running').sort((a, b) => a.startedAt - b.startedAt)
  )

  const recentAiTasks = computed(() =>
    Array.from(aiTaskRuns.value.values()).filter(r => r.stage !== 'running').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  )

  function isAiTaskRunning(key: string): boolean {
    return aiTaskRuns.value.get(key)?.stage === 'running'
  }

  function getAiTaskRun(key: string): AiTaskRun | undefined {
    return aiTaskRuns.value.get(key)
  }

  function getClientTaskId(): string | undefined {
    return currentClientTaskId ?? undefined
  }

  function finalizeAiTask(key: string, stage: 'done' | 'error', error?: string): void {
    const existing = aiTaskRuns.value.get(key)
    if (!existing) return
    const finishedAt = Date.now()
    replaceTaskRuns((next) => { next.set(key, { ...existing, stage, finishedAt, error }) })
    window.setTimeout(() => {
      const current = aiTaskRuns.value.get(key)
      if (current && current.startedAt === existing.startedAt && current.stage !== 'running') {
        replaceTaskRuns((next) => { next.delete(key) })
      }
    }, AI_TASK_RETENTION_MS)
  }

  function dismissAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage === 'running') return
    replaceTaskRuns((next) => { next.delete(key) })
  }

  function cancelAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running' || !run.onCancel) return
    try { run.onCancel() } catch (error) { console.error('[aiTasks] cancel handler failed:', error) }
  }

  async function runTrackedAiTask<T>(input: AiTaskRunInput, executor: () => Promise<T>): Promise<T> {
    if (isAiTaskRunning(input.key)) throw new Error(`AI 任务「${input.label}」正在进行中，请稍候。`)
    const clientTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    currentClientTaskId = clientTaskId
    const run: AiTaskRun = { ...input, startedAt: Date.now(), stage: 'running' }
    replaceTaskRuns((next) => { next.set(input.key, run) })
    const timeoutMs = input.timeoutMs ?? (appSettings.value.aiTimeoutSeconds * 1000)
    let timeoutHandle: number | null = null
    let timedOut = false
    const timeoutPromise = timeoutMs > 0 ? new Promise<never>((_, reject) => { timeoutHandle = window.setTimeout(() => { timedOut = true; window.characterArc.cancelAiTask(clientTaskId).catch(() => {}); reject(new Error(`AI 任务超时（${Math.round(timeoutMs / 1000)}s），已自动取消。`)) }, timeoutMs) }) : null
    try {
      const result = timeoutPromise ? await Promise.race([executor(), timeoutPromise]) : await executor()
      finalizeAiTask(input.key, 'done')
      return result
    } catch (error) {
      const msg = timedOut ? `AI 任务超时（${Math.round(timeoutMs / 1000)}s），已自动取消。` : (error instanceof Error ? error.message : String(error))
      finalizeAiTask(input.key, 'error', msg)
      throw error
    } finally {
      if (timeoutHandle !== null) { window.clearTimeout(timeoutHandle) }
      currentClientTaskId = null
    }
  }

  return {
    aiTaskRuns, runningAiTasks, recentAiTasks,
    isAiTaskRunning, getAiTaskRun, getClientTaskId,
    runTrackedAiTask, dismissAiTask, cancelAiTask
  }
}
