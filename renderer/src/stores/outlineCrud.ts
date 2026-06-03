import type { ComputedRef } from 'vue'
import type { ProjectWorkspaceData, OutlineItem, OutlineVolume, ChapterDraft } from '@/types/app'
import { createOutlineVolume as createWorkspaceVolume } from '@/features/workspace/outlineVolumes'
import { normalizeChapterWordTarget, DEFAULT_CHAPTER_WORD_TARGET } from '@/features/chapters/wordTarget'
import { getOutlineSequenceInVolume, getWorkspacePrimaryVolumeId, insertIntoVolumeSection, normalizeChapterDraft } from '@/features/workspace/storeHelpers'
import { uniqueId, reindexOutlineItems } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createOutlineCrud(ctx: DomainCrudContext & {
  outlineVolumes: ComputedRef<OutlineVolume[]>
  selectedChapter: ComputedRef<ChapterDraft | undefined>
}) {
  const { updateCurrentWorkspace, schedulePersist, outlineVolumes, selectedChapter } = ctx

  function createOutlineVolume(payload?: Partial<OutlineVolume>): string {
    const nextVolume = createWorkspaceVolume({
      id: uniqueId('volume'), title: payload?.title?.trim() || `分卷 ${outlineVolumes.value.length + 1}`,
      wordTarget: payload?.wordTarget?.trim(), summary: payload?.summary?.trim()
    })
    updateCurrentWorkspace((workspace) => ({ ...workspace, outlineVolumes: [...workspace.outlineVolumes, nextVolume] }))
    schedulePersist('fast')
    return nextVolume.id
  }

  function updateOutlineVolume(volumeId: string, payload: Partial<OutlineVolume>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map(v =>
        v.id === volumeId ? { ...v, title: payload.title?.trim() || v.title, wordTarget: payload.wordTarget?.trim() || v.wordTarget, summary: payload.summary?.trim() || v.summary } : v
      )
    }))
    schedulePersist('fast')
  }

  function createOutlineItem(payload?: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const requestedVolumeId = payload?.volumeId?.trim()
      const targetVolumeId = requestedVolumeId && workspace.outlineVolumes.some(v => v.id === requestedVolumeId)
        ? requestedVolumeId
        : (selectedChapter.value?.volumeId && workspace.outlineVolumes.some(v => v.id === selectedChapter.value?.volumeId)
            ? selectedChapter.value.volumeId : getWorkspacePrimaryVolumeId(workspace))
      const nextIndex = getOutlineSequenceInVolume(workspace.outlineItems, targetVolumeId)
      return {
        ...workspace,
        outlineItems: reindexOutlineItems(insertIntoVolumeSection(workspace.outlineItems, {
          id: uniqueId('outline'), volumeId: targetVolumeId,
          title: payload?.title?.trim() || `第${nextIndex}章：新剧情节点`,
          wordTarget: payload?.wordTarget?.trim() || '预估 3000字',
          conflict: payload?.conflict?.trim() || '新的冲突正在酝酿。',
          summary: payload?.summary?.trim() || '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
          status: payload?.status || 'planned', sortOrder: payload?.sortOrder ?? workspace.outlineItems.length
        }))
      }
    })
    schedulePersist('fast')
  }

  function createOutlineItemsAfter(anchorOutlineId: string, payloads: Array<Partial<OutlineItem>>): void {
    if (!payloads.length) return
    updateCurrentWorkspace((workspace) => {
      const anchorIndex = workspace.outlineItems.findIndex(item => item.id === anchorOutlineId)
      if (anchorIndex === -1) return workspace
      const anchorItem = workspace.outlineItems[anchorIndex]
      const insertedItems = payloads.map((payload, index) => ({
        id: uniqueId('outline'), volumeId: payload.volumeId || anchorItem.volumeId,
        title: payload.title?.trim() || `第${anchorIndex + index + 2}章：新剧情节点`,
        wordTarget: payload.wordTarget?.trim() || '预估 3000字',
        conflict: payload.conflict?.trim() || '新的冲突正在酝酿。',
        summary: payload.summary?.trim() || '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        status: payload.status || 'planned', sortOrder: anchorIndex + index + 1
      }))
      const nextItems = [...workspace.outlineItems]; nextItems.splice(anchorIndex + 1, 0, ...insertedItems)
      return { ...workspace, outlineItems: reindexOutlineItems(nextItems) }
    })
    schedulePersist('fast')
  }

  function updateOutlineItem(outlineId: string, payload: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const currentItem = workspace.outlineItems.find(item => item.id === outlineId)
      if (!currentItem) return workspace
      const nextItem: OutlineItem = { ...currentItem, volumeId: payload.volumeId || currentItem.volumeId, title: payload.title?.trim() || currentItem.title, wordTarget: payload.wordTarget?.trim() || currentItem.wordTarget, conflict: payload.conflict?.trim() || currentItem.conflict, summary: payload.summary?.trim() || currentItem.summary, status: payload.status || currentItem.status }
      const remainingItems = workspace.outlineItems.filter(item => item.id !== outlineId)
      const nextOutlineItems = nextItem.volumeId === currentItem.volumeId
        ? workspace.outlineItems.map(item => item.id === outlineId ? nextItem : item)
        : insertIntoVolumeSection(remainingItems, nextItem)
      return { ...workspace, outlineItems: reindexOutlineItems(nextOutlineItems) }
    })
    schedulePersist('fast')
  }

  function deleteOutlineItem(outlineId: string): void {
    updateCurrentWorkspace((workspace) => ({ ...workspace, outlineItems: reindexOutlineItems(workspace.outlineItems.filter(item => item.id !== outlineId)) }))
    schedulePersist('fast')
  }

  function moveOutlineItem(outlineId: string, targetOutlineId: string): void {
    updateCurrentWorkspace((workspace) => {
      const sourceIndex = workspace.outlineItems.findIndex(item => item.id === outlineId)
      const targetIndex = workspace.outlineItems.findIndex(item => item.id === targetOutlineId)
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return workspace
      const nextOutlineItems = [...workspace.outlineItems]
      const [movedItem] = nextOutlineItems.splice(sourceIndex, 1)
      const targetItem = workspace.outlineItems[targetIndex]
      nextOutlineItems.splice(targetIndex, 0, { ...movedItem, volumeId: targetItem?.volumeId || movedItem.volumeId })
      return { ...workspace, outlineItems: reindexOutlineItems(nextOutlineItems) }
    })
    schedulePersist('fast')
  }

  return { createOutlineVolume, updateOutlineVolume, createOutlineItem, createOutlineItemsAfter, updateOutlineItem, deleteOutlineItem, moveOutlineItem }
}
