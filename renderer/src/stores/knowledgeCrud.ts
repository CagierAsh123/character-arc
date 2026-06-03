import type { Ref } from 'vue'
import type { ProjectWorkspaceData, KnowledgeDocument, ReferenceWorkItem, AiRunRecord, OutlineVolume } from '@/types/app'
import { normalizeKnowledgeKeywords, uniqueId } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createKnowledgeCrud(ctx: DomainCrudContext & {
  knowledgeDocuments: Ref<KnowledgeDocument[]>
  referenceWorks: Ref<ReferenceWorkItem[]>
  projects: Ref<Array<{ id: string; selectedReferenceWorkIds?: string[] }>>
  updateProject: (projectId: string, payload: any) => void
}) {
  const { updateCurrentWorkspace, schedulePersist, knowledgeDocuments, referenceWorks, projects, updateProject } = ctx

  function updateWorkflowDocument(volumeId: string, documentKey: string, content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map(v => v.id !== volumeId ? v : { ...v, workflowDocuments: (v.workflowDocuments ?? []).map(d => d.key === documentKey ? { ...d, content, updatedAt: new Date().toISOString() } : d) })
    }))
    schedulePersist('fast')
  }

  function updateWorkflowDocuments(volumeId: string, payloads: Array<{ key: string; content: string }>): void {
    if (!payloads.length) return
    const payloadMap = new Map(payloads.map(p => [p.key, p.content]))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map(v => v.id !== volumeId ? v : { ...v, workflowDocuments: (v.workflowDocuments ?? []).map(d => payloadMap.has(d.key) ? { ...d, content: payloadMap.get(d.key) ?? d.content, updatedAt: new Date().toISOString() } : d) })
    }))
    schedulePersist('fast')
  }

  function appendWorkflowDocumentEntry(volumeId: string, documentKey: string, entryTitle: string, body: string): void {
    const normalizedBody = body.trim()
    if (!normalizedBody) return
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map(v => {
        if (v.id !== volumeId) return v
        return { ...v, workflowDocuments: (v.workflowDocuments ?? []).map(d => {
          if (d.key !== documentKey) return d
          const header = d.content.split('\n')[0] || `# ${d.title.replace(/\.md$/i, '')}`
          const isPlaceholder = /待 AI 生成|待补充/.test(d.content) && d.content.trim().split('\n').length <= 3
          const nextContent = isPlaceholder ? `${header}\n\n## ${entryTitle}\n${normalizedBody}\n` : `${d.content.trim()}\n\n## ${entryTitle}\n${normalizedBody}\n`
          return { ...d, content: nextContent, updatedAt: new Date().toISOString() }
        }) }
      })
    }))
    schedulePersist('fast')
  }

  function mergeKnowledgeDocuments(documents: KnowledgeDocument[]): void {
    const normalizedDocuments = documents.filter(d => d && typeof d.id === 'string' && d.id.trim()).map(d => ({
      ...d, keywords: Array.isArray(d.keywords) ? d.keywords.map(k => String(k).trim()).filter(Boolean) : [],
      metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata : {},
      createdAt: d.createdAt || new Date().toISOString(),
      updatedAt: d.updatedAt || d.createdAt || new Date().toISOString()
    }))

    const getSourceKey = (d: KnowledgeDocument): string | null => {
      const sourceTitle = String(d.metadata?.sourceTitle ?? '').trim()
      const fileName = String(d.metadata?.fileName ?? '').trim()
      if (sourceTitle && fileName) return `${sourceTitle}::${fileName}`
      if (sourceTitle) return sourceTitle
      return null
    }

    const incomingSourceKeys = new Set(normalizedDocuments.map(d => getSourceKey(d)).filter(Boolean) as string[])
    const preservedDocuments = incomingSourceKeys.size ? knowledgeDocuments.value.filter(d => { const k = getSourceKey(d); return !k || !incomingSourceKeys.has(k) }) : knowledgeDocuments.value
    knowledgeDocuments.value = [...preservedDocuments, ...normalizedDocuments]
    schedulePersist('fast')
  }

  function removeKnowledgeDocuments(documentIds: string[]): void {
    const idSet = new Set(documentIds.map(id => String(id).trim()).filter(Boolean))
    if (!idSet.size) return
    knowledgeDocuments.value = knowledgeDocuments.value.filter(d => !idSet.has(d.id))
    schedulePersist('fast')
  }

  function upsertReferenceWork(work: ReferenceWorkItem): void {
    const existingIndex = referenceWorks.value.findIndex(item => item.id === work.id)
    if (existingIndex >= 0) {
      const next = [...referenceWorks.value]; next[existingIndex] = work; referenceWorks.value = next
    } else {
      referenceWorks.value = [...referenceWorks.value, work]
    }
    schedulePersist('fast')
  }

  function removeReferenceWork(referenceWorkId: string): void {
    const trimmedId = String(referenceWorkId ?? '').trim()
    if (!trimmedId) return
    referenceWorks.value = referenceWorks.value.filter(item => item.id !== trimmedId)
    for (const project of projects.value) {
      const ids = project.selectedReferenceWorkIds ?? []
      if (ids.includes(trimmedId)) { updateProject(project.id, { selectedReferenceWorkIds: ids.filter(id => id !== trimmedId) }) }
    }
    schedulePersist('fast')
  }

  function appendAiRun(projectId: string, record: Omit<AiRunRecord, 'projectId'>): void {
    if (!projectId.trim()) return
    ctx.updateCurrentWorkspace // use bottom-level to avoid import loop
    schedulePersist('fast')
  }

  return {
    updateWorkflowDocument, updateWorkflowDocuments, appendWorkflowDocumentEntry,
    mergeKnowledgeDocuments, removeKnowledgeDocuments,
    upsertReferenceWork, removeReferenceWork
  }
}
