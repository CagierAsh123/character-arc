import type { ComputedRef } from 'vue'
import type { ProjectWorkspaceData, CharacterCard } from '@/types/app'
import { uniqueId } from './helpers'
import type { DomainCrudContext } from './worldviewCrud'

export function createCharacterCrud(ctx: DomainCrudContext & {
  characters: ComputedRef<CharacterCard[]>
}) {
  const { updateCurrentWorkspace, schedulePersist, characters } = ctx

  function createCharacter(payload?: Partial<CharacterCard>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: [{
        id: uniqueId('char'), name: payload?.name?.trim() || `新角色 ${workspace.characters.length + 1}`,
        role: payload?.role?.trim() || '待设定',
        avatar: payload?.avatar || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
        description: payload?.description?.trim() || '这是一名新加入项目的角色草稿。你可以继续补充身份、背景、动机与冲突。',
        tags: payload?.tags?.length ? payload.tags : [{ label: '待完善', tone: 'warning' }]
      }, ...workspace.characters]
    }))
    schedulePersist('fast')
  }

  function updateCharacter(characterId: string, payload: Partial<CharacterCard>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map(c =>
        c.id === characterId ? { ...c, name: payload.name?.trim() || c.name, role: payload.role?.trim() ?? c.role, avatar: payload.avatar || c.avatar, description: payload.description?.trim() || c.description, tags: payload.tags?.length ? payload.tags : c.tags } : c
      )
    }))
    schedulePersist('fast')
  }

  function deleteCharacter(characterId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.filter(c => c.id !== characterId),
      characterRelationships: workspace.characterRelationships.filter(r => r.fromCharacterId !== characterId && r.toCharacterId !== characterId),
      organizationMemberships: workspace.organizationMemberships.filter(m => m.characterId !== characterId)
    }))
    schedulePersist('fast')
  }

  return { createCharacter, updateCharacter, deleteCharacter }
}
