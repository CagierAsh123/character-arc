import type { Ref, ComputedRef } from 'vue'
import type {
  ProjectSummary,
  ProjectWorkspaceData,
  ProjectImportPayload,
  NovelLength,
  ImportExportModuleType,
  ImportConflictMode,
  CharacterCard,
  CharacterRelationship,
  OrganizationEntry,
  OrganizationMembership
} from '@/types/app'
import { normalizeProjectSummary, normalizeProjectWorkspaceData, normalizeChapterAssistantTemplates } from '@/features/workspace/storeHelpers'
import { createDefaultNovelWorkflowStages } from '@/features/novelWorkflow/stages'
import { formatProjectWordCount } from '@/features/projects/wordCount'
import { createOutlineVolume } from '@/features/workspace/outlineVolumes'
import { buildStarterChapter } from '@/features/workspace/storeHelpers'
import { uniqueId, reindexInspirationEntries, reindexOutlineItems, reindexOrganizations } from './helpers'

export interface ProjectCrudContext {
  projects: Ref<ProjectSummary[]>
  projectWorkspaces: Ref<Record<string, ProjectWorkspaceData>>
  selectedProjectId: Ref<string>
  currentView: Ref<string>
  activePanel: Ref<string>
  pendingChapterInsertion: Ref<unknown | null>
  updateCurrentWorkspace: (updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData) => void
  updateProjectWorkspace: (projectId: string, updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData) => void
  schedulePersist: (mode: string) => void
  syncProjectWordCount: (projectId: string) => void
  syncSelectedChapter: (projectId?: string) => void
}

export function createProjectCrud(ctx: ProjectCrudContext) {
  const {
    projects, projectWorkspaces, selectedProjectId, currentView, activePanel,
    pendingChapterInsertion, updateCurrentWorkspace, updateProjectWorkspace,
    schedulePersist, syncProjectWordCount, syncSelectedChapter
  } = ctx

  function createProjectWorkspace(payload: {
    project: {
      title: string; genre: string; novelLength: NovelLength; wordCount?: string
      cover?: string; writingStylePresetId?: string; writingStylePrompt?: string
      chapterAssistantTemplates?: ProjectSummary['chapterAssistantTemplates']
      novelWorkflowStages?: ProjectSummary['novelWorkflowStages']
      projectSkills?: ProjectSummary['projectSkills']
      targetPlatform?: string; selectedReferenceWorkIds?: ProjectSummary['selectedReferenceWorkIds']
      coverHistory?: ProjectSummary['coverHistory']
    }
    worldviewEntries?: any[]; characters?: any[]; organizations?: any[]
    characterRelationships?: any[]; organizationMemberships?: any[]
    inspirationEntries?: any[]; outlineVolumes?: any[]; outlineItems?: any[]
    chapters?: any[]; chapterVersions?: any[]; messages?: any[]
  }): void {
    const projectId = uniqueId('project')
    const nextVolumes = payload.outlineVolumes?.length ? payload.outlineVolumes : [createOutlineVolume()]
    const nextChapters = payload.chapters?.length ? payload.chapters : [buildStarterChapter(nextVolumes[0].id)]
    const computedWordCount = formatProjectWordCount(nextChapters)

    projects.value.unshift(normalizeProjectSummary({
      id: projectId, title: payload.project.title, genre: payload.project.genre,
      novelLength: payload.project.novelLength, wordCount: computedWordCount,
      lastEdited: '刚刚创建', cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
      writingStylePresetId: payload.project.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project.chapterAssistantTemplates),
      novelWorkflowStages: payload.project.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project.projectSkills ?? [],
      targetPlatform: payload.project.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project.coverHistory ?? []
    }))

    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries, characters: payload.characters,
        organizations: payload.organizations, characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        outlineVolumes: nextVolumes, outlineItems: payload.outlineItems,
        chapters: nextChapters, chapterVersions: payload.chapterVersions, messages: payload.messages
      })
    }
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = payload.worldviewEntries?.length || payload.inspirationEntries?.length || payload.outlineItems?.length ? 'overview' : 'chapters'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  function createProject(payload: { title: string; genre: string; novelLength: NovelLength }): void {
    const starterVolume = createOutlineVolume()
    createProjectWorkspace({
      project: payload,
      outlineVolumes: [starterVolume],
      chapters: [buildStarterChapter(starterVolume.id)]
    })
  }

  function deleteProject(projectId: string): void {
    if (!projects.value.some(p => p.id === projectId)) return
    projects.value = projects.value.filter(p => p.id !== projectId)
    const { [projectId]: _, ...remaining } = projectWorkspaces.value
    projectWorkspaces.value = remaining
    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = projects.value[0]?.id ?? ''
      pendingChapterInsertion.value = null
      currentView.value = 'projects'
      syncSelectedChapter()
    }
    schedulePersist('fast')
  }

  function updateProject(projectId: string, payload: Partial<ProjectSummary>): void {
    projects.value = projects.value.map(p =>
      p.id === projectId ? {
        ...p, title: payload.title?.trim() || p.title, genre: payload.genre?.trim() || p.genre,
        novelLength: payload.novelLength !== undefined ? payload.novelLength : p.novelLength,
        lastEdited: payload.lastEdited?.trim() || '刚刚更新', cover: payload.cover || p.cover,
        writingStylePresetId: payload.writingStylePresetId?.trim() || p.writingStylePresetId,
        writingStylePrompt: payload.writingStylePrompt !== undefined ? payload.writingStylePrompt.trim() : p.writingStylePrompt,
        chapterAssistantTemplates: payload.chapterAssistantTemplates !== undefined ? normalizeChapterAssistantTemplates(payload.chapterAssistantTemplates) : p.chapterAssistantTemplates,
        novelWorkflowStages: payload.novelWorkflowStages !== undefined ? payload.novelWorkflowStages : p.novelWorkflowStages,
        projectSkills: payload.projectSkills !== undefined ? payload.projectSkills : p.projectSkills,
        targetPlatform: payload.targetPlatform !== undefined ? payload.targetPlatform.trim() : p.targetPlatform,
        selectedReferenceWorkIds: payload.selectedReferenceWorkIds !== undefined ? payload.selectedReferenceWorkIds : p.selectedReferenceWorkIds,
        coverHistory: payload.coverHistory !== undefined ? payload.coverHistory : p.coverHistory
      } : p
    )
    schedulePersist('fast')
  }

  function importProjectData(payload: ProjectImportPayload): void {
    const projectId = uniqueId('project')
    const importedWorkspace = normalizeProjectWorkspaceData({
      worldviewEntries: payload.worldviewEntries, characters: payload.characters,
      organizations: payload.organizations, characterRelationships: payload.characterRelationships,
      organizationMemberships: payload.organizationMemberships,
      inspirationEntries: payload.inspirationEntries, outlineVolumes: payload.outlineVolumes,
      outlineItems: payload.outlineItems, chapters: payload.chapters, chapterVersions: payload.chapterVersions
    })
    const project: ProjectSummary = {
      id: projectId, title: payload.project?.title?.trim() || '导入项目',
      genre: payload.project?.genre?.trim() || '未分类',
      novelLength: payload.project?.novelLength === 'short' ? 'short' : 'long',
      wordCount: formatProjectWordCount(importedWorkspace.chapters),
      lastEdited: '刚刚导入',
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
      writingStylePresetId: payload.project?.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project?.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project?.chapterAssistantTemplates),
      novelWorkflowStages: payload.project?.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project?.projectSkills ?? [],
      targetPlatform: payload.project?.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project?.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project?.coverHistory ?? []
    }
    projects.value = [normalizeProjectSummary(project), ...projects.value]
    projectWorkspaces.value = { ...projectWorkspaces.value, [projectId]: importedWorkspace }
    selectedProjectId.value = project.id
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'workflow'
    syncSelectedChapter(project.id)
    schedulePersist('fast')
  }

  function buildImportedId(prefix: string, index: number): string {
    return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
  }

  function importModuleData(moduleType: ImportExportModuleType, payload: ProjectImportPayload, mode: ImportConflictMode): void {
    updateCurrentWorkspace((workspace) => {
      const normalizedImport = normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries, characters: payload.characters,
        organizations: payload.organizations, characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries, outlineVolumes: payload.outlineVolumes,
        outlineItems: payload.outlineItems, chapters: payload.chapters, chapterVersions: payload.chapterVersions
      })

      // Characters
      if (moduleType === 'characters') {
        if (mode === 'overwrite') return { ...workspace, characters: normalizedImport.characters }
        return { ...workspace, characters: [...normalizedImport.characters.map((c, i) => ({ ...c, id: buildImportedId('character', i) })), ...workspace.characters] }
      }

      // Inspiration
      if (moduleType === 'inspiration') {
        if (mode === 'overwrite') return { ...workspace, inspirationEntries: reindexInspirationEntries(normalizedImport.inspirationEntries) }
        return { ...workspace, inspirationEntries: reindexInspirationEntries([...normalizedImport.inspirationEntries.map((e, i) => ({ ...e, id: buildImportedId('inspiration', i) })), ...workspace.inspirationEntries]) }
      }

      // Outline
      if (moduleType === 'outline') {
        const volumeIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((v, i) => { const nid = buildImportedId('volume', i); volumeIdMap.set(v.id, nid); return { ...v, id: nid } })
        const importedItems = normalizedImport.outlineItems.map((item, i) => ({ ...item, id: buildImportedId('outline', i), volumeId: volumeIdMap.get(item.volumeId) || item.volumeId }))
        if (mode === 'overwrite') return { ...workspace, outlineVolumes: importedVolumes, outlineItems: reindexOutlineItems(importedItems) }
        return { ...workspace, outlineVolumes: [...workspace.outlineVolumes, ...importedVolumes], outlineItems: reindexOutlineItems([...workspace.outlineItems, ...importedItems]) }
      }

      // Chapters
      if (moduleType === 'chapters') {
        const volumeIdMap = new Map<string, string>()
        const chapterIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((v, i) => { const nid = buildImportedId('volume', i); volumeIdMap.set(v.id, nid); return { ...v, id: nid } })
        const importedChapters = normalizedImport.chapters.map((ch, i) => { const nid = buildImportedId('chapter', i); chapterIdMap.set(ch.id, nid); return { ...ch, id: nid, volumeId: volumeIdMap.get(ch.volumeId) || ch.volumeId } })
        const importedVersions = normalizedImport.chapterVersions.map((ver, i) => ({ ...ver, id: buildImportedId('chapter-version', i), chapterId: chapterIdMap.get(ver.chapterId) || ver.chapterId }))
        if (mode === 'overwrite') return { ...workspace, outlineVolumes: importedVolumes.length ? importedVolumes : workspace.outlineVolumes, chapters: importedChapters, chapterVersions: importedVersions }
        return { ...workspace, outlineVolumes: importedVolumes.length ? [...workspace.outlineVolumes, ...importedVolumes] : workspace.outlineVolumes, chapters: [...workspace.chapters, ...importedChapters], chapterVersions: [...workspace.chapterVersions, ...importedVersions] }
      }

      // Relations
      if (moduleType === 'relations') {
        const characterNameMap = new Map(workspace.characters.map(c => [c.name.trim(), c.id]))
        const importedCharacterIdMap = new Map<string, string>()
        const importedCharacters: CharacterCard[] = []
        normalizedImport.characters.forEach((character, index) => {
          const existingId = characterNameMap.get(character.name.trim())
          if (existingId) { importedCharacterIdMap.set(character.id, existingId); return }
          const nid = buildImportedId('character', index)
          importedCharacterIdMap.set(character.id, nid)
          importedCharacters.push({ ...character, id: nid })
        })
        const orgIdMap = new Map(normalizedImport.organizations.map((o, i) => { const nid = buildImportedId('organization', i); return [o.id, nid] }))
        const importedOrgs = normalizedImport.organizations.map((o, i) => ({ ...o, id: orgIdMap.get(o.id) || buildImportedId('organization', i) }))
        const importedRels = normalizedImport.characterRelationships.map((r, i) => {
          const f = importedCharacterIdMap.get(r.fromCharacterId), t = importedCharacterIdMap.get(r.toCharacterId)
          return f && t ? { ...r, id: buildImportedId('relationship', i), fromCharacterId: f, toCharacterId: t } : null
        }).filter(Boolean) as CharacterRelationship[]
        const importedMems = normalizedImport.organizationMemberships.map((m, i) => {
          const c = importedCharacterIdMap.get(m.characterId), o = orgIdMap.get(m.organizationId)
          return c && o ? { ...m, id: buildImportedId('membership', i), characterId: c, organizationId: o } : null
        }).filter(Boolean) as OrganizationMembership[]
        if (mode === 'overwrite') return { ...workspace, characters: [...importedCharacters, ...workspace.characters], organizations: reindexOrganizations(importedOrgs), characterRelationships: importedRels, organizationMemberships: importedMems }
        return { ...workspace, characters: [...importedCharacters, ...workspace.characters], organizations: reindexOrganizations([...importedOrgs, ...workspace.organizations]), characterRelationships: [...importedRels, ...workspace.characterRelationships], organizationMemberships: [...importedMems, ...workspace.organizationMemberships] }
      }

      return workspace
    })
    schedulePersist('fast')
  }

  return {
    createProjectWorkspace, createProject, deleteProject, updateProject,
    importProjectData, importModuleData
  }
}
