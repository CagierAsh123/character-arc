import { computed, ref, watch, type Ref } from 'vue'
import { defineStore } from 'pinia'
import { FAST_PERSIST_DELAY_MS, formatAutoSaveIntervalLabel, isLiveAutoSaveInterval, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { createDefaultWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { getThemePreset } from '@/theme/presets'
import { createEmptyWorkspace } from '@/features/workspace/projectWorkspace'
import { createWorkspacePersistence } from '@/features/workspace/persistence'
import {
  buildStarterChapter, buildWorkspaceMapFromLegacy, defaultProjects, loadStoredState,
  normalizeAppSettings, normalizeProjectSummary, normalizeProjectWorkspaceData,
  getWorkspacePrimaryVolumeId, toSerializable,
  type LegacyStoredState, type StoredState
} from '@/features/workspace/storeHelpers'
import { buildVolumeGroups } from '@/features/workspace/outlineVolumes'
import { normalizeChapterWordTarget, DEFAULT_CHAPTER_WORD_TARGET } from '@/features/chapters/wordTarget'
import { formatProjectWordCount } from '@/features/projects/wordCount'
import { uniqueId, normalizeKnowledgeKeywords, toIsoTimestamp } from './helpers'
import { createProjectCrud } from './projectCrud'
import { createWorldviewCrud, type DomainCrudContext } from './worldviewCrud'
import { createCharacterCrud } from './characterCrud'
import { createOrganizationCrud } from './organizationCrud'
import { createRelationCrud } from './relationCrud'
import { createInspirationCrud } from './inspirationCrud'
import { createPlotThreadCrud } from './plotThreadCrud'
import { createOutlineCrud } from './outlineCrud'
import { createChapterCrud } from './chapterCrud'
import { createKnowledgeCrud } from './knowledgeCrud'
import { createAiTaskRegistry } from './aiTaskRegistry'
import type {
  AppSettings, ChapterDraft, ChapterInsertionRequest, ChapterSelectionState, ChapterVersion,
  ChatMessage, CharacterCard, CharacterRelationship, InspirationEntry, KnowledgeDocument,
  NovelLength, OrganizationEntry, OrganizationMembership, OutlineItem, OutlineVolume,
  PanelName, PlotThread, ProjectSummary, ProjectWorkspaceData, ReferenceWorkItem,
  ThemeName, WorldviewEntry
} from '@/types/app'

interface ProjectWorkspacePayload {
  project: {
    title: string; genre: string; novelLength: NovelLength; wordCount?: string
    cover?: string; writingStylePresetId?: string; writingStylePrompt?: string
    chapterAssistantTemplates?: ProjectSummary['chapterAssistantTemplates']
    novelWorkflowStages?: ProjectSummary['novelWorkflowStages']
    projectSkills?: ProjectSummary['projectSkills']
    targetPlatform?: string; selectedReferenceWorkIds?: ProjectSummary['selectedReferenceWorkIds']
    coverHistory?: ProjectSummary['coverHistory']
  }
  worldviewEntries?: WorldviewEntry[]; characters?: CharacterCard[]
  organizations?: OrganizationEntry[]; characterRelationships?: CharacterRelationship[]
  organizationMemberships?: OrganizationMembership[]; inspirationEntries?: InspirationEntry[]
  outlineVolumes?: OutlineVolume[]; outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]; chapterVersions?: ChapterVersion[]; messages?: ChatMessage[]
}

export const useAppStore = defineStore('app', () => {
  // ═══ Core State ═══
  const stored = loadStoredState()
  const hasHydrated = ref(false)
  const currentView = ref<'projects' | 'wizard' | 'workbench' | 'chapter-studio' | 'deconstruction-library' | 'skills' | 'cover-workbench'>('projects')
  const activePanel = ref<PanelName>('workflow')
  const lastWorkbenchPanel = ref<Exclude<PanelName, 'chapters'>>('workflow')
  const theme = ref<ThemeName>(stored.theme)
  const selectedProjectId = ref(stored.selectedProjectId)
  const projects = ref<ProjectSummary[]>(stored.projects)
  const projectWorkspaces = ref<Record<string, ProjectWorkspaceData>>(stored.workspaces)
  const appSettings = ref<AppSettings>(stored.appSettings)
  const coverWorkbenchHistory = ref<import('@/types/app').CoverWorkbenchHistoryItem[]>(stored.coverWorkbenchHistory ?? [])
  const pendingChapterInsertion = ref<ChapterInsertionRequest | null>(null)
  const currentChapterSelection = ref<ChapterSelectionState | null>(null)
  const chapterStateWarnings = ref<Map<string, CharacterArcChapterStateWarningsPayload>>(new Map())
  const chapterPostGenerationIssues = ref<Map<string, CharacterArcChapterPostGenerationIssuesPayload>>(new Map())
  const selectedChapterId = ref(stored.workspaces[stored.selectedProjectId]?.chapters[0]?.id ?? '')
  const activeWorkflowVolumeId = ref<string>('')
  const knowledgeDocuments = ref<KnowledgeDocument[]>(stored.knowledgeDocuments ?? [])
  const referenceWorks = ref<ReferenceWorkItem[]>(stored.referenceWorks ?? [])

  // ═══ Persistence ═══
  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value, selectedProjectId: selectedProjectId.value,
      projects: toSerializable(projects.value), workspaces: toSerializable(projectWorkspaces.value),
      knowledgeDocuments: toSerializable(knowledgeDocuments.value),
      referenceWorks: toSerializable(referenceWorks.value),
      appSettings: toSerializable(appSettings.value),
      coverWorkbenchHistory: toSerializable(coverWorkbenchHistory.value)
    }
  }

  const {
    scheduledPersistAt, persistenceError, scheduleWorkspaceSync,
    flushWorkspaceSync, persistWorkspace, schedulePersist,
    scheduleSettingsPersist, handleRemoteWorkspaceSync
  } = createWorkspacePersistence({
    hasHydrated,
    serializeWorkspaceState: () => serializeWorkspaceState(),
    getSettingsSnapshot: () => ({ theme: theme.value, selectedProjectId: selectedProjectId.value, appSettings: appSettings.value }),
    applyRemoteState: (payload) => applyWorkspaceState(payload)
  })

  // ═══ Workspace Infrastructure ═══
  const currentWorkspace = computed(() => projectWorkspaces.value[selectedProjectId.value] ?? createEmptyWorkspace())

  function ensureProjectWorkspace(projectId: string): void {
    if (projectWorkspaces.value[projectId]) return
    projectWorkspaces.value = { ...projectWorkspaces.value, [projectId]: normalizeProjectWorkspaceData(undefined) }
  }

  function updateProjectWorkspace(projectId: string, updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    const baseWorkspace = normalizeProjectWorkspaceData(projectWorkspaces.value[projectId])
    projectWorkspaces.value = { ...projectWorkspaces.value, [projectId]: normalizeProjectWorkspaceData(updater(baseWorkspace)) }
  }

  function updateCurrentWorkspace(updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    ensureProjectWorkspace(selectedProjectId.value)
    updateProjectWorkspace(selectedProjectId.value, updater)
    syncProjectWordCount(selectedProjectId.value)
    syncSelectedChapter()
    scheduleWorkspaceSync()
  }

  function syncProjectWordCount(projectId: string): void {
    const workspace = projectWorkspaces.value[projectId]
    if (!workspace) return
    const nextWordCount = formatProjectWordCount(workspace.chapters)
    projects.value = projects.value.map(p => p.id === projectId ? { ...p, wordCount: nextWordCount } : p)
  }

  function syncSelectedChapter(projectId = selectedProjectId.value): void {
    const chapterList = projectWorkspaces.value[projectId]?.chapters ?? []
    const hasCurrentChapter = chapterList.some(c => c.id === selectedChapterId.value)
    selectedChapterId.value = hasCurrentChapter ? selectedChapterId.value : (chapterList[0]?.id ?? '')
  }

  function applyWorkspaceState(payload?: Partial<StoredState> | LegacyStoredState | null): void {
    if (!payload) return
    theme.value = payload.theme ?? 'ocean'
    projects.value = Array.isArray(payload.projects) ? payload.projects.map(normalizeProjectSummary) : defaultProjects
    const fallbackProjectId = projects.value[0]?.id ?? ''
    selectedProjectId.value = payload.selectedProjectId ?? fallbackProjectId
    projectWorkspaces.value = 'workspaces' in payload && payload.workspaces
      ? Object.fromEntries(Object.entries(payload.workspaces).map(([id, ws]) => [id, normalizeProjectWorkspaceData(ws)]))
      : buildWorkspaceMapFromLegacy(payload as LegacyStoredState, selectedProjectId.value)
    for (const p of projects.value) ensureProjectWorkspace(p.id)
    appSettings.value = normalizeAppSettings(payload.appSettings)
    coverWorkbenchHistory.value = Array.isArray(payload.coverWorkbenchHistory) ? payload.coverWorkbenchHistory : []
    knowledgeDocuments.value = Array.isArray((payload as Partial<StoredState>).knowledgeDocuments) ? (payload as Partial<StoredState>).knowledgeDocuments! : []
    referenceWorks.value = Array.isArray((payload as Partial<StoredState>).referenceWorks) ? (payload as Partial<StoredState>).referenceWorks! : []
    syncSelectedChapter()
  }

  async function initialize(): Promise<void> {
    const result = await window.characterArc.loadWorkspace()
    if (result.success && result.payload) { applyWorkspaceState(result.payload as Partial<StoredState>); persistenceError.value = null }
    else { const err = result.error ?? null; console.error('[workspace] loadWorkspace failed:', err); persistenceError.value = err }
    hasHydrated.value = true
  }

  // ═══ Computed Properties ═══
  const worldviewEntries = computed(() => currentWorkspace.value.worldviewEntries)
  const characters = computed(() => currentWorkspace.value.characters)
  const organizations = computed(() => currentWorkspace.value.organizations)
  const characterRelationships = computed(() => currentWorkspace.value.characterRelationships)
  const organizationMemberships = computed(() => currentWorkspace.value.organizationMemberships)
  const inspirationEntries = computed(() => currentWorkspace.value.inspirationEntries)
  const outlineItems = computed(() => currentWorkspace.value.outlineItems)
  const chapters = computed(() => currentWorkspace.value.chapters)
  const outlineVolumes = computed(() => currentWorkspace.value.outlineVolumes)
  const chapterVersions = computed(() => currentWorkspace.value.chapterVersions)
  const messages = computed(() => currentWorkspace.value.messages)
  const plotThreads = computed(() => currentWorkspace.value.plotThreads)
  const aiRuns = computed(() => currentWorkspace.value.aiRuns)

  const activeWorkflowVolume = computed(() => outlineVolumes.value.find(v => v.id === activeWorkflowVolumeId.value) ?? outlineVolumes.value[0])
  const workflowDocuments = computed(() => activeWorkflowVolume.value?.workflowDocuments ?? createDefaultWorkflowDocuments())
  const autoSaveIntervalLabel = computed(() => formatAutoSaveIntervalLabel(appSettings.value.autoSaveInterval))
  const isLiveAutoSave = computed(() => isLiveAutoSaveInterval(appSettings.value.autoSaveInterval))
  const isPersistencePending = computed(() => scheduledPersistAt.value !== null)
  const selectedChapter = computed(() => chapters.value.find(c => c.id === selectedChapterId.value) ?? chapters.value[0])
  const selectedChapterVolume = computed(() => outlineVolumes.value.find(v => v.id === selectedChapter.value?.volumeId) ?? outlineVolumes.value[0])
  const outlineVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, outlineItems.value))
  const chapterVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, chapters.value))
  const currentTheme = computed(() => getThemePreset(theme.value))
  const currentProject = computed(() => projects.value.find(p => p.id === selectedProjectId.value) ?? projects.value[0])

  // ═══ Compose Domain Modules ═══
  const domainCtx: DomainCrudContext = { updateCurrentWorkspace, schedulePersist: (mode: string) => schedulePersist(mode as 'fast' | 'autosave') }

  const projectCrud = createProjectCrud({
    projects, projectWorkspaces, selectedProjectId, currentView, activePanel, pendingChapterInsertion: pendingChapterInsertion as Ref<unknown | null>,
    updateCurrentWorkspace, updateProjectWorkspace,
    schedulePersist: (mode: string) => schedulePersist(mode as 'fast' | 'autosave'),
    syncProjectWordCount, syncSelectedChapter
  })

  const worldviewCrud = createWorldviewCrud(domainCtx)
  const characterCrud = createCharacterCrud({ ...domainCtx, characters })
  const organizationCrud = createOrganizationCrud(domainCtx)
  const relationCrud = createRelationCrud({ ...domainCtx, characters })
  const inspirationCrud = createInspirationCrud(domainCtx)
  const plotThreadCrud = createPlotThreadCrud(domainCtx)
  const outlineCrud = createOutlineCrud({ ...domainCtx, outlineVolumes, selectedChapter })
  const chapterCrud = createChapterCrud({
    ...domainCtx, selectedChapterId, selectedChapter, chapters, outlineItems,
    chapterVersions, activePanel, currentView,
    pendingChapterInsertion, currentChapterSelection, hasHydrated, persistWorkspace, persistenceError
  })
  const knowledgeCrud = createKnowledgeCrud({
    ...domainCtx, knowledgeDocuments, referenceWorks,
    projects, updateProject: projectCrud.updateProject
  })
  const aiTasks = createAiTaskRegistry(appSettings)

  // ═══ AI Event Handlers ═══
  function handleAiRunEvent(payload: CharacterArcAiRunEventPayload): void {
    if (!payload?.meta) return
    if (payload.projectId) {
      updateProjectWorkspace(payload.projectId, (workspace) => ({
        ...workspace,
        aiRuns: [...(workspace.aiRuns ?? []), {
          ...payload.meta, projectId: payload.projectId!,
          usage: payload.meta.usage && typeof payload.meta.usage === 'object' ? {
            promptTokens: Number.isFinite(payload.meta.usage.promptTokens) ? Math.max(0, Number(payload.meta.usage.promptTokens)) : undefined,
            completionTokens: Number.isFinite(payload.meta.usage.completionTokens) ? Math.max(0, Number(payload.meta.usage.completionTokens)) : undefined,
            totalTokens: Number.isFinite(payload.meta.usage.totalTokens) ? Math.max(0, Number(payload.meta.usage.totalTokens)) : undefined,
            reasoningTokens: Number.isFinite(payload.meta.usage.reasoningTokens) ? Math.max(0, Number(payload.meta.usage.reasoningTokens)) : undefined,
            cachedInputTokens: Number.isFinite(payload.meta.usage.cachedInputTokens) ? Math.max(0, Number(payload.meta.usage.cachedInputTokens)) : undefined
          } : undefined,
          usedKnowledge: Array.isArray(payload.meta.usedKnowledge) ? payload.meta.usedKnowledge.map((item: any) => ({
            documentId: String(item.documentId ?? '').trim(), title: String(item.title ?? '').trim() || '未命名知识片段',
            sourceType: (item.sourceType === 'reference-summary' || item.sourceType === 'workflow-document' || item.sourceType === 'canon-fact' || item.sourceType === 'chapter-summary') ? item.sourceType : 'reference-chunk',
            sourceLabel: String(item.sourceLabel ?? '').trim(), snippet: String(item.snippet ?? '').trim(),
            keywords: Array.isArray(item.keywords) ? item.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8) : []
          })) : []
        } as any]
      }))
      schedulePersist('fast')
    }
    // Knowledge documents from agent loop
    const produced = (payload.meta as any)?.producedKnowledgeDocuments
    if (Array.isArray(produced) && produced.length > 0) {
      const now = new Date().toISOString()
      const docs = produced.filter((d: any) => d && typeof d.title === 'string' && d.title.trim() && typeof d.content === 'string' && d.content.trim() && typeof d.sourceType === 'string')
        .map<KnowledgeDocument>((d: any) => ({
          id: String(d.id ?? '').trim() || uniqueId('knowledge'), title: String(d.title).trim(),
          sourceType: d.sourceType, sourceLabel: String(d.sourceLabel ?? '').trim(),
          content: String(d.content), summary: String(d.summary ?? '').trim() || String(d.content).slice(0, 220),
          keywords: normalizeKnowledgeKeywords(d.keywords),
          metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata as Record<string, unknown> : {},
          createdAt: String(d.createdAt ?? '').trim() || now, updatedAt: String(d.updatedAt ?? '').trim() || now
        }))
      if (docs.length > 0) knowledgeCrud.mergeKnowledgeDocuments(docs)
    }
  }

  function handleChapterStateWarnings(payload: CharacterArcChapterStateWarningsPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.violations) || !payload.violations.length) return
    const next = new Map(chapterStateWarnings.value); next.set(payload.chapterId, payload); chapterStateWarnings.value = next
  }

  function getChapterStateWarnings(chapterId: string): CharacterArcChapterStateWarningsPayload | null {
    return chapterId ? chapterStateWarnings.value.get(chapterId) ?? null : null
  }

  function dismissChapterStateWarnings(chapterId: string): void {
    if (!chapterId || !chapterStateWarnings.value.has(chapterId)) return
    const next = new Map(chapterStateWarnings.value); next.delete(chapterId); chapterStateWarnings.value = next
  }

  function handleChapterPostGenerationIssues(payload: CharacterArcChapterPostGenerationIssuesPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.issues)) return
    const next = new Map(chapterPostGenerationIssues.value)
    payload.issues.length === 0 ? next.delete(payload.chapterId) : next.set(payload.chapterId, payload)
    chapterPostGenerationIssues.value = next
  }

  function getChapterPostGenerationIssues(chapterId: string): CharacterArcChapterPostGenerationIssuesPayload | null {
    return chapterId ? chapterPostGenerationIssues.value.get(chapterId) ?? null : null
  }

  function dismissChapterPostGenerationIssues(chapterId: string): void {
    if (!chapterId || !chapterPostGenerationIssues.value.has(chapterId)) return
    const next = new Map(chapterPostGenerationIssues.value); next.delete(chapterId); chapterPostGenerationIssues.value = next
  }

  // ═══ View Navigation ═══
  function setTheme(nextTheme: ThemeName): void { theme.value = nextTheme; schedulePersist('fast') }
  function backToProjects(): void { currentView.value = 'projects' }
  function openWizard(): void { currentView.value = 'wizard' }
  function closeWizard(): void { currentView.value = 'projects' }

  function setPanel(panel: PanelName): void {
    if (panel === 'chapters') { openChapterStudio(); return }
    if (panel === 'deconstruction') { openDeconstructionLibrary(); return }
    lastWorkbenchPanel.value = panel; activePanel.value = panel; currentView.value = 'workbench'
  }

  function openChapterStudio(chapterId?: string): void {
    if (chapterId) selectedChapterId.value = chapterId
    else if (!selectedChapterId.value) syncSelectedChapter()
    pendingChapterInsertion.value = null; activePanel.value = 'chapters'; currentView.value = 'chapter-studio'
  }

  function backToWorkbench(): void {
    currentView.value = 'workbench'
    if (activePanel.value === 'chapters') activePanel.value = lastWorkbenchPanel.value
  }

  function selectChapter(chapterId: string): void {
    selectedChapterId.value = chapterId; pendingChapterInsertion.value = null
    currentChapterSelection.value = null; activePanel.value = 'chapters'; currentView.value = 'chapter-studio'
  }

  function openProject(projectId: string): void {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return
    ensureProjectWorkspace(projectId); selectedProjectId.value = projectId
    pendingChapterInsertion.value = null; currentView.value = 'workbench'
    activePanel.value = 'overview'; lastWorkbenchPanel.value = 'overview'
    syncSelectedChapter(projectId); schedulePersist('fast')
  }

  function openDeconstructionLibrary(): void { pendingChapterInsertion.value = null; currentView.value = 'deconstruction-library'; schedulePersist('fast') }

  function openSkillsPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find(p => p.id === resolvedProjectId) ?? projects.value[0]
    if (targetProject) { ensureProjectWorkspace(targetProject.id); selectedProjectId.value = targetProject.id; syncSelectedChapter(targetProject.id) }
    currentView.value = 'skills'; schedulePersist('fast')
  }

  function openCoverWorkbenchPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find(p => p.id === resolvedProjectId) ?? projects.value[0]
    if (targetProject) { ensureProjectWorkspace(targetProject.id); selectedProjectId.value = targetProject.id; syncSelectedChapter(targetProject.id) }
    currentView.value = 'cover-workbench'; schedulePersist('fast')
  }

  function setActiveWorkflowVolumeId(id: string): void { activeWorkflowVolumeId.value = id }

  function resolveWorkflowVolumeId(preferredVolumeId?: string): string {
    const resolved = String(preferredVolumeId ?? '').trim()
    if (resolved) return resolved
    return activeWorkflowVolume.value?.id || selectedChapterVolume.value?.id || outlineVolumes.value[0]?.id || ''
  }

  // ═══ App Settings ═══
  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void { appSettings.value[key] = value; scheduleSettingsPersist() }
  function switchAiProfile(profileId: string): void { const p = appSettings.value.aiProfiles.find(x => x.id === profileId); if (!p) return; appSettings.value.activeAiProfileId = profileId; appSettings.value.provider = p.provider; appSettings.value.model = p.model; appSettings.value.apiKey = p.apiKey; appSettings.value.baseUrl = p.baseUrl; scheduleSettingsPersist() }
  function updateActiveAiProfileModel(model: string): void { appSettings.value.model = model; const p = appSettings.value.aiProfiles.find(x => x.id === appSettings.value.activeAiProfileId); if (p) p.model = model; scheduleSettingsPersist() }
  function addAiProfile(profile: import('@/types/app').AiProfile): void { appSettings.value.aiProfiles.push(profile); scheduleSettingsPersist() }
  function deleteAiProfile(profileId: string): void { if (profileId === appSettings.value.activeAiProfileId) return; appSettings.value.aiProfiles = appSettings.value.aiProfiles.filter(x => x.id !== profileId); scheduleSettingsPersist() }
  function updateAiProfile(profileId: string, updates: Partial<import('@/types/app').AiProfile>): void { const p = appSettings.value.aiProfiles.find(x => x.id === profileId); if (!p) return; Object.assign(p, updates); if (profileId === appSettings.value.activeAiProfileId) { if (updates.provider !== undefined) appSettings.value.provider = updates.provider; if (updates.model !== undefined) appSettings.value.model = updates.model; if (updates.apiKey !== undefined) appSettings.value.apiKey = updates.apiKey; if (updates.baseUrl !== undefined) appSettings.value.baseUrl = updates.baseUrl } scheduleSettingsPersist() }
  function updateCoverWorkbenchHistory(items: import('@/types/app').CoverWorkbenchHistoryItem[]): void { coverWorkbenchHistory.value = items; schedulePersist('fast') }

  // ═══ Chat Messages ═══
  const MAX_CHAT_MESSAGES = 100
  function pushUserMessage(content: string): void {
    updateCurrentWorkspace((workspace) => ({ ...workspace, messages: [...workspace.messages.slice(-MAX_CHAT_MESSAGES + 1), { id: uniqueId('msg'), role: 'user', content }] }))
    schedulePersist('fast')
  }
  function pushAssistantMessage(content: string): void {
    updateCurrentWorkspace((workspace) => ({ ...workspace, messages: [...workspace.messages.slice(-MAX_CHAT_MESSAGES + 1), { id: uniqueId('msg'), role: 'assistant', content }] }))
    schedulePersist('fast')
  }

  // ═══ Event Listeners & Watchers ═══
  window.characterArc.onWorkspaceSync(handleRemoteWorkspaceSync)
  window.characterArc.onAiRunEvent(handleAiRunEvent)
  window.characterArc.onChapterStateWarnings(handleChapterStateWarnings)
  window.characterArc.onChapterPostGenerationIssues(handleChapterPostGenerationIssues)

  watch(() => selectedChapterId.value, () => { currentChapterSelection.value = null })
  watch(() => appSettings.value.autoSaveInterval, () => { if (isPersistencePending.value) schedulePersist('fast') })

  // ═══ Return: Compose Everything ═══
  return {
    // Core state
    activePanel, autoSaveIntervalLabel, aiRuns, appSettings, coverWorkbenchHistory,
    backToProjects, backToWorkbench, chapterVersions, chapters, characterRelationships,
    characters, inspirationEntries, closeWizard,
    // Project CRUD
    ...projectCrud,
    // Worldview
    ...worldviewCrud,
    // Character
    ...characterCrud,
    // Organization
    ...organizationCrud,
    // Relations
    ...relationCrud,
    // Inspiration
    ...inspirationCrud,
    // Plot threads
    ...plotThreadCrud,
    // Outline
    ...outlineCrud,
    // Chapter
    ...chapterCrud,
    // Knowledge
    ...knowledgeCrud,
    // Remaining exports
    chapterVolumeGroups, currentTheme, currentProject, currentChapterSelection,
    currentView, hasHydrated, initialize, isLiveAutoSave, isPersistencePending,
    insertIntoChapter: chapterCrud.insertIntoChapter,
    consumeChapterInsertion: chapterCrud.consumeChapterInsertion,
    importProjectData: projectCrud.importProjectData, importModuleData: projectCrud.importModuleData,
    messages, openChapterStudio, openDeconstructionLibrary, openProject,
    openCoverWorkbenchPage, openSkillsPage, openWizard, outlineItems,
    organizationMemberships, organizations, outlineVolumeGroups, outlineVolumes,
    pendingChapterInsertion, plotThreads, projects, pushAssistantMessage, pushUserMessage,
    restoreChapterVersion: chapterCrud.restoreChapterVersion,
    saveCurrentChapterVersion: chapterCrud.saveCurrentChapterVersion,
    selectChapter, selectedChapter, selectedChapterId, selectedChapterVolume,
    selectedProjectId, setPanel, setTheme, theme,
    updateAppSetting, switchAiProfile, updateActiveAiProfileModel,
    addAiProfile, deleteAiProfile, updateAiProfile, updateCoverWorkbenchHistory,
    updateProject: projectCrud.updateProject,
    activeWorkflowVolumeId, activeWorkflowVolume, setActiveWorkflowVolumeId,
    ...knowledgeCrud,
    knowledgeDocuments, referenceWorks, workflowDocuments, flushWorkspaceSync, persistWorkspace,
    worldviewEntries, persistenceError,
    // AI tasks
    runningAiTasks: aiTasks.runningAiTasks, recentAiTasks: aiTasks.recentAiTasks,
    isAiTaskRunning: aiTasks.isAiTaskRunning, getAiTaskRun: aiTasks.getAiTaskRun,
    runTrackedAiTask: aiTasks.runTrackedAiTask, getClientTaskId: aiTasks.getClientTaskId,
    dismissAiTask: aiTasks.dismissAiTask, cancelAiTask: aiTasks.cancelAiTask,
    getChapterStateWarnings, dismissChapterStateWarnings,
    getChapterPostGenerationIssues, dismissChapterPostGenerationIssues,
    // knowledge is spread via ...knowledgeCrud above
    mergeKnowledgeDocuments: knowledgeCrud.mergeKnowledgeDocuments,
    removeKnowledgeDocuments: knowledgeCrud.removeKnowledgeDocuments,
    upsertReferenceWork: knowledgeCrud.upsertReferenceWork,
    removeReferenceWork: knowledgeCrud.removeReferenceWork,
    updateWorkflowDocument: knowledgeCrud.updateWorkflowDocument,
    updateWorkflowDocuments: knowledgeCrud.updateWorkflowDocuments,
    appendWorkflowDocumentEntry: knowledgeCrud.appendWorkflowDocumentEntry,
  }
})
