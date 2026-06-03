import type { ProjectWorkspaceData, OrganizationEntry } from '@/types/app'
import { uniqueId, toIsoTimestamp, reindexOrganizations } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createOrganizationCrud(ctx: DomainCrudContext) {
  const { updateCurrentWorkspace, schedulePersist } = ctx

  function createOrganization(payload?: Partial<OrganizationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations([{
        id: uniqueId('org'), name: payload?.name?.trim() || `新组织 ${workspace.organizations.length + 1}`,
        type: payload?.type?.trim() || '中立势力',
        description: payload?.description?.trim() || '这里记录组织定位、资源边界和它在故事中的作用，方便后续接入关系图与章节推进。',
        motto: payload?.motto?.trim() || '待补充组织口号',
        color: payload?.color || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
        sortOrder: payload?.sortOrder ?? 0, createdAt, updatedAt
      }, ...workspace.organizations])
    }))
    schedulePersist('fast')
  }

  function updateOrganization(organizationId: string, payload: Partial<OrganizationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(workspace.organizations.map(o =>
        o.id === organizationId ? { ...o, name: payload.name?.trim() || o.name, type: payload.type?.trim() || o.type, description: payload.description?.trim() || o.description, motto: payload.motto?.trim() || o.motto, color: payload.color || o.color, updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString()) } : o
      ))
    }))
    schedulePersist('fast')
  }

  function deleteOrganization(organizationId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(workspace.organizations.filter(o => o.id !== organizationId)),
      organizationMemberships: workspace.organizationMemberships.filter(m => m.organizationId !== organizationId)
    }))
    schedulePersist('fast')
  }

  return { createOrganization, updateOrganization, deleteOrganization }
}
