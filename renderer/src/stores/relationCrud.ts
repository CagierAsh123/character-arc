import type { ComputedRef } from 'vue'
import type { ProjectWorkspaceData, CharacterCard, CharacterRelationship, OrganizationMembership } from '@/types/app'
import { uniqueId, toIsoTimestamp } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createRelationCrud(ctx: DomainCrudContext & {
  characters: ComputedRef<CharacterCard[]>
}) {
  const { updateCurrentWorkspace, schedulePersist, characters } = ctx

  function createCharacterRelationship(payload?: Partial<CharacterRelationship>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const fallbackFrom = payload?.fromCharacterId || characters.value[0]?.id || ''
    const fallbackTo = payload?.toCharacterId || characters.value.find(c => c.id !== fallbackFrom)?.id || fallbackFrom
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: [{
        id: uniqueId('relationship'), fromCharacterId: fallbackFrom, toCharacterId: fallbackTo,
        type: payload?.type?.trim() || '待定义关系',
        description: payload?.description?.trim() || '补充两人之间的合作、对立、情感张力或利益绑定，后续可直接服务章节冲突编排。',
        intensity: payload?.intensity !== undefined && Number.isFinite(payload.intensity) ? Math.min(100, Math.max(0, payload.intensity)) : 50,
        createdAt, updatedAt
      }, ...workspace.characterRelationships]
    }))
    schedulePersist('fast')
  }

  function updateCharacterRelationship(relationshipId: string, payload: Partial<CharacterRelationship>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.map(r =>
        r.id === relationshipId ? { ...r, fromCharacterId: payload.fromCharacterId || r.fromCharacterId, toCharacterId: payload.toCharacterId || r.toCharacterId, type: payload.type?.trim() || r.type, description: payload.description?.trim() || r.description, intensity: payload.intensity !== undefined && Number.isFinite(payload.intensity) ? Math.min(100, Math.max(0, payload.intensity)) : r.intensity, updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString()) } : r
      )
    }))
    schedulePersist('fast')
  }

  function deleteCharacterRelationship(relationshipId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.filter(r => r.id !== relationshipId)
    }))
    schedulePersist('fast')
  }

  // Organization memberships
  function createOrganizationMembership(payload?: Partial<OrganizationMembership>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: [{
        id: uniqueId('membership'),
        characterId: payload?.characterId || workspace.characters[0]?.id || '',
        organizationId: payload?.organizationId || workspace.organizations[0]?.id || '',
        role: payload?.role?.trim() || '普通成员', notes: payload?.notes?.trim() || '待补充归属说明',
        createdAt, updatedAt
      }, ...workspace.organizationMemberships]
    }))
    schedulePersist('fast')
  }

  function updateOrganizationMembership(membershipId: string, payload: Partial<OrganizationMembership>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.map(m =>
        m.id === membershipId ? { ...m, characterId: payload.characterId || m.characterId, organizationId: payload.organizationId || m.organizationId, role: payload.role?.trim() || m.role, notes: payload.notes?.trim() || m.notes, updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString()) } : m
      )
    }))
    schedulePersist('fast')
  }

  function deleteOrganizationMembership(membershipId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.filter(m => m.id !== membershipId)
    }))
    schedulePersist('fast')
  }

  return {
    createCharacterRelationship, updateCharacterRelationship, deleteCharacterRelationship,
    createOrganizationMembership, updateOrganizationMembership, deleteOrganizationMembership
  }
}
