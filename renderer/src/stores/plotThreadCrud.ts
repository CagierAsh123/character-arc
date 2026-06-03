import type { ProjectWorkspaceData, PlotThread } from '@/types/app'
import { uniqueId } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createPlotThreadCrud(ctx: DomainCrudContext) {
  const { updateCurrentWorkspace, schedulePersist } = ctx

  function createPlotThread(payload?: Partial<PlotThread>): void {
    const now = new Date().toISOString()
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: [...workspace.plotThreads, {
        id: uniqueId('thread'), title: payload?.title?.trim() || '未命名线索',
        description: payload?.description?.trim() || '',
        openedInChapterId: payload?.openedInChapterId || '',
        status: 'open', closedInChapterId: undefined,
        tags: Array.isArray(payload?.tags) ? payload.tags.map(t => String(t).trim()).filter(Boolean) : [],
        createdAt: now, updatedAt: now
      }]
    }))
    schedulePersist('fast')
  }

  function updatePlotThread(threadId: string, payload: Partial<PlotThread>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.map(t =>
        t.id === threadId ? { ...t, ...payload, title: payload.title?.trim() || t.title, description: payload.description?.trim() ?? t.description, tags: Array.isArray(payload.tags) ? payload.tags.map(x => String(x).trim()).filter(Boolean) : t.tags, updatedAt: new Date().toISOString() } : t
      )
    }))
    schedulePersist('fast')
  }

  function deletePlotThread(threadId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.filter(t => t.id !== threadId)
    }))
    schedulePersist('fast')
  }

  return { createPlotThread, updatePlotThread, deletePlotThread }
}
