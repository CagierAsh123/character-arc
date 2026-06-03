import type { Ref, ComputedRef } from 'vue'
import type { ProjectWorkspaceData, WorldviewEntry } from '@/types/app'
import { uniqueId, toIsoTimestamp, reindexWorldviewEntries } from './helpers'

export interface DomainCrudContext {
  updateCurrentWorkspace: (updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData) => void
  schedulePersist: (mode: string) => void
}

export function createWorldviewCrud(ctx: DomainCrudContext) {
  const { updateCurrentWorkspace, schedulePersist } = ctx

  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries([{
        id: uniqueId('world'), type: payload?.type?.trim() || '地理',
        title: payload?.title?.trim() || `新设定条目 ${workspace.worldviewEntries.length + 1}`,
        content: payload?.content?.trim() || '这里是新的世界观设定草稿。你可以继续补充时代背景、法则机制或地理环境细节。',
        sortOrder: payload?.sortOrder ?? 0, createdAt, updatedAt
      }, ...workspace.worldviewEntries])
    }))
    schedulePersist('fast')
  }

  function updateWorldviewEntry(entryId: string, payload: Partial<WorldviewEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(workspace.worldviewEntries.map(entry =>
        entry.id === entryId ? { ...entry, type: payload.type?.trim() || entry.type, title: payload.title?.trim() || entry.title, content: payload.content?.trim() || entry.content, updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString()) } : entry
      ))
    }))
    schedulePersist('fast')
  }

  function deleteWorldviewEntry(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(workspace.worldviewEntries.filter(e => e.id !== entryId))
    }))
    schedulePersist('fast')
  }

  return { createWorldviewEntry, updateWorldviewEntry, deleteWorldviewEntry }
}
