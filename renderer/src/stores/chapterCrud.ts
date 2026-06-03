import type { Ref, ComputedRef } from 'vue'
import type { ProjectWorkspaceData, ChapterDraft, ChapterVersion, OutlineItem, ChapterInsertionMode, ChapterInsertionRequest, ChapterSelectionState } from '@/types/app'
import { normalizeChapterDraft, normalizeChapterVersion, getChapterSequenceInVolume, getWorkspacePrimaryVolumeId, insertIntoVolumeSection } from '@/features/workspace/storeHelpers'
import { normalizeChapterWordTarget, DEFAULT_CHAPTER_WORD_TARGET } from '@/features/chapters/wordTarget'
import { uniqueId } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createChapterCrud(ctx: DomainCrudContext & {
  selectedChapterId: Ref<string>
  selectedChapter: ComputedRef<ChapterDraft | undefined>
  chapters: ComputedRef<ChapterDraft[]>
  outlineItems: ComputedRef<OutlineItem[]>
  chapterVersions: ComputedRef<ChapterVersion[]>
  activePanel: Ref<string>
  currentView: Ref<string>
  pendingChapterInsertion: Ref<ChapterInsertionRequest | null>
  currentChapterSelection: Ref<ChapterSelectionState | null>
  hasHydrated: Ref<boolean>
  persistWorkspace: () => Promise<void>
  persistenceError: Ref<string | null>
}) {
  const {
    updateCurrentWorkspace, schedulePersist, selectedChapterId, selectedChapter,
    chapters, chapterVersions, activePanel, currentView,
    pendingChapterInsertion, currentChapterSelection, hasHydrated,
    persistWorkspace, persistenceError, outlineItems
  } = ctx

  function createChapter(volumeId = selectedChapter.value?.volumeId): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getChapterSequenceInVolume(workspace.chapters, targetVolumeId)
      const nextChapter: ChapterDraft = { id: uniqueId('chapter'), outlineItemId: '', volumeId: targetVolumeId, title: `第${nextIndex}章：新章节`, summary: '待补充章节摘要', status: 'draft', wordTarget: DEFAULT_CHAPTER_WORD_TARGET, content: '' }
      nextChapterId = nextChapter.id
      return { ...workspace, chapters: insertIntoVolumeSection(workspace.chapters, nextChapter) }
    })
    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    schedulePersist('fast')
  }

  function createChapterFromOutlineItem(item: Pick<OutlineItem, 'id' | 'volumeId' | 'title' | 'summary' | 'wordTarget'>): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = item.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextChapter: ChapterDraft = { id: uniqueId('chapter'), outlineItemId: item.id, volumeId: targetVolumeId, title: item.title?.trim() || '新章节', summary: item.summary?.trim() || '待补充章节摘要', status: 'draft', wordTarget: normalizeChapterWordTarget(item.wordTarget), content: '' }
      nextChapterId = nextChapter.id
      return { ...workspace, chapters: insertIntoVolumeSection(workspace.chapters, nextChapter) }
    })
    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
    schedulePersist('fast')
  }

  function moveChapter(chapterId: string, targetChapterId: string): void {
    updateCurrentWorkspace((workspace) => {
      const sourceIndex = workspace.chapters.findIndex(c => c.id === chapterId)
      const targetIndex = workspace.chapters.findIndex(c => c.id === targetChapterId)
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return workspace
      const nextChapters = [...workspace.chapters]
      const [moved] = nextChapters.splice(sourceIndex, 1)
      nextChapters.splice(targetIndex, 0, moved)
      return { ...workspace, chapters: nextChapters }
    })
    schedulePersist('fast')
  }

  function deleteChapter(chapterId: string): void {
    if (chapters.value.length <= 1) return
    const targetIndex = chapters.value.findIndex(c => c.id === chapterId)
    if (targetIndex === -1) return
    updateCurrentWorkspace((workspace) => ({ ...workspace, chapters: workspace.chapters.filter(c => c.id !== chapterId), chapterVersions: workspace.chapterVersions.filter(v => v.chapterId !== chapterId) }))
    if (selectedChapterId.value === chapterId) {
      const fallback = chapters.value[Math.max(0, targetIndex - 1)] ?? chapters.value[0]
      selectedChapterId.value = fallback?.id ?? ''
      pendingChapterInsertion.value = null
    }
    schedulePersist('fast')
  }

  function updateChapter(chapterId: string, payload: Partial<ChapterDraft>): void {
    updateCurrentWorkspace((workspace) => ({ ...workspace, chapters: workspace.chapters.map(c => c.id === chapterId ? normalizeChapterDraft({ ...c, outlineItemId: payload.outlineItemId !== undefined ? payload.outlineItemId : c.outlineItemId, volumeId: payload.volumeId || c.volumeId, title: payload.title?.trim() || c.title, summary: payload.summary !== undefined ? payload.summary.trim() || c.summary : c.summary, status: payload.status ?? c.status, wordTarget: payload.wordTarget !== undefined ? normalizeChapterWordTarget(payload.wordTarget) : c.wordTarget, content: payload.content !== undefined ? payload.content : c.content }) : c) }))
  }

  function updateChapterTitle(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) return
    const resolvedOutlineItemId = chapter.outlineItemId || outlineItems.value.find(i => i.volumeId === chapter.volumeId && i.title.trim() === chapter.title.trim())?.id || ''
    updateChapter(chapter.id, { title: value, outlineItemId: resolvedOutlineItemId || chapter.outlineItemId })
    schedulePersist('autosave')
  }

  function updateChapterContent(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) return
    updateChapter(chapter.id, { content: value })
    schedulePersist('autosave')
  }

  function updateChapterSummary(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) return
    updateChapter(chapter.id, { summary: value })
    schedulePersist('autosave')
  }

  async function reloadChapterFromDb(chapterId: string): Promise<void> {
    const res = await window.characterArc.readChapterFromDb((window as any).__currentProjectId || '', chapterId)
    if (!res.success || !res.result) return
    const data = res.result
    updateChapter(chapterId, { title: data.title, summary: data.summary, status: data.status as ChapterDraft['status'], wordTarget: data.wordTarget, content: data.content })
  }

  // Chapter versions
  function getChapterVersions(chapterId: string): ChapterVersion[] {
    return chapterVersions.value.filter(v => v.chapterId === chapterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async function saveCurrentChapterVersion(): Promise<{ success: boolean; version?: ChapterVersion; error?: string }> {
    const chapter = selectedChapter.value
    if (!chapter) return { success: false, error: '当前没有可保存的章节。' }
    const version = normalizeChapterVersion({ id: uniqueId('chapter-version'), chapterId: chapter.id, title: chapter.title, summary: chapter.summary, status: chapter.status, wordTarget: chapter.wordTarget, content: chapter.content, createdAt: new Date().toISOString() })
    updateCurrentWorkspace((workspace) => ({ ...workspace, chapterVersions: [version, ...workspace.chapterVersions] }))
    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) return { success: false, error: persistenceError.value }
    }
    return { success: true, version }
  }

  async function restoreChapterVersion(versionId: string): Promise<{ success: boolean; error?: string }> {
    let version = chapterVersions.value.find(v => v.id === versionId)
    if (!version) {
      const res = await window.characterArc.readChapterVersionFromDb((window as any).__currentProjectId || '', versionId)
      if (res.success && res.result) { version = { id: res.result.id, chapterId: res.result.chapterId, title: res.result.title, summary: res.result.summary, status: res.result.status as ChapterDraft['status'], wordTarget: res.result.wordTarget, content: res.result.content, createdAt: res.result.createdAt } }
    }
    if (!version) return { success: false, error: '未找到对应的历史版本。' }
    updateChapter(version.chapterId, { title: version.title, summary: version.summary, status: version.status, wordTarget: version.wordTarget, content: version.content })
    selectedChapterId.value = version.chapterId
    activePanel.value = 'chapters'
    pendingChapterInsertion.value = null
    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) return { success: false, error: persistenceError.value }
    }
    return { success: true }
  }

  // Chapter content insertion
  function insertIntoChapter(content: string, mode: ChapterInsertionMode = 'cursor'): boolean {
    const chapter = selectedChapter.value
    if (!chapter) return false
    const insertion = content.trim()
    if (!insertion) return false
    pendingChapterInsertion.value = { id: uniqueId('insert'), chapterId: chapter.id, content: insertion, mode }
    return true
  }

  function consumeChapterInsertion(requestId: string): void {
    if (pendingChapterInsertion.value?.id === requestId) { pendingChapterInsertion.value = null }
  }

  function updateChapterSelection(selection: ChapterSelectionState | null): void {
    if (!selection || selection.chapterId !== selectedChapter.value?.id || !selection.text.trim()) { currentChapterSelection.value = null; return }
    currentChapterSelection.value = { chapterId: selection.chapterId, text: selection.text.trim() }
  }

  return {
    createChapter, createChapterFromOutlineItem, moveChapter, deleteChapter,
    updateChapter, updateChapterTitle, updateChapterContent, updateChapterSummary,
    reloadChapterFromDb, getChapterVersions, saveCurrentChapterVersion, restoreChapterVersion,
    insertIntoChapter, consumeChapterInsertion, updateChapterSelection
  }
}
