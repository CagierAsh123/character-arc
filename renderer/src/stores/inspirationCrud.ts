import type { ProjectWorkspaceData, InspirationEntry } from '@/types/app'
import { uniqueId, toIsoTimestamp, reindexInspirationEntries } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createInspirationCrud(ctx: DomainCrudContext) {
  const { updateCurrentWorkspace, schedulePersist } = ctx

  function createInspirationEntry(payload?: Partial<InspirationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const normalizedTags = Array.isArray(payload?.tags) ? payload.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8) : []
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries([{
        id: uniqueId('inspiration'), type: payload?.type?.trim() || '场景火花',
        title: payload?.title?.trim() || `灵感卡片 ${workspace.inspirationEntries.length + 1}`,
        content: payload?.content?.trim() || '这里记录一个可以继续扩写的灵感片段，你可以补充场景、冲突、情绪或关键台词。',
        tags: normalizedTags, source: payload?.source === 'ai' ? 'ai' : 'manual',
        sortOrder: payload?.sortOrder ?? 0, createdAt, updatedAt
      }, ...workspace.inspirationEntries])
    }))
    schedulePersist('fast')
  }

  function updateInspirationEntry(entryId: string, payload: Partial<InspirationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(workspace.inspirationEntries.map(entry =>
        entry.id === entryId ? { ...entry, type: payload.type?.trim() || entry.type, title: payload.title?.trim() || entry.title, content: payload.content?.trim() || entry.content, tags: Array.isArray(payload.tags) && payload.tags.length ? payload.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8) : entry.tags, source: payload.source ?? entry.source, updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString()) } : entry
      ))
    }))
    schedulePersist('fast')
  }

  function deleteInspirationEntry(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(workspace.inspirationEntries.filter(e => e.id !== entryId))
    }))
    schedulePersist('fast')
  }

  return { createInspirationEntry, updateInspirationEntry, deleteInspirationEntry }
}
