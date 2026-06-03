import { useAppStore } from '@/stores/app'
import { uniqueId } from '@/stores/helpers'

// ═══ Types ═══

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean }>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  success: boolean
  data?: unknown
  error?: string
}

export interface ProposedChange {
  action: 'create' | 'update' | 'delete'
  entityType: string
  entityId: string
  label: string
  before: unknown | null
  after: unknown | null
}

export interface GlobalAiTurn {
  text?: string
  toolCalls?: Array<{ call: ToolCall; result: ToolResult }>
}

// ═══ Tool Registry ═══

const ALL_TOOLS: ToolDef[] = [
  // ── Read Tools ──
  { name: 'list_characters', description: '列出所有角色（名称+ID+定位）', parameters: {} },
  { name: 'list_worldview', description: '列出所有世界观条目（标题+类型+ID）', parameters: {} },
  { name: 'list_outline', description: '列出所有大纲节点（标题+ID+所属分卷+状态）', parameters: {} },
  { name: 'list_inspirations', description: '列出所有灵感卡片（标题+类型+ID）', parameters: {} },
  { name: 'list_plot_threads', description: '列出所有剧情线索（标题+状态+ID）', parameters: {} },
  { name: 'list_organizations', description: '列出所有组织（名称+类型+ID）', parameters: {} },
  { name: 'list_relationships', description: '列出所有角色关系', parameters: {} },
  { name: 'read_entity', description: '读取任意实体的完整详情', parameters: { entityType: { type: 'string', description: '实体类型: character/worldview/outline/inspiration/thread/organization/relationship' }, entityId: { type: 'string', description: '实体 ID' } } },

  // ── Write Tools (return ProposedChange) ──
  { name: 'create_character', description: '创建新角色', parameters: { name: { type: 'string', description: '角色名', required: true }, role: { type: 'string', description: '角色定位' }, description: { type: 'string', description: '角色描述' }, tags: { type: 'string', description: '标签，逗号分隔' } } },
  { name: 'update_character', description: '修改角色', parameters: { entityId: { type: 'string', description: '角色ID', required: true }, name: { type: 'string', description: '新名称' }, role: { type: 'string', description: '新定位' }, description: { type: 'string', description: '新描述' } } },
  { name: 'delete_character', description: '删除角色', parameters: { entityId: { type: 'string', description: '角色ID', required: true } } },

  { name: 'create_worldview', description: '创建世界观条目', parameters: { type: { type: 'string', description: '类型: 地理/历史/魔法/科技/文化/生物/政治/宗教/规则/其他' }, title: { type: 'string', description: '标题', required: true }, content: { type: 'string', description: '内容描述' } } },
  { name: 'update_worldview', description: '修改世界观条目', parameters: { entityId: { type: 'string', description: '条目ID', required: true }, type: { type: 'string', description: '新类型' }, title: { type: 'string', description: '新标题' }, content: { type: 'string', description: '新内容' } } },
  { name: 'delete_worldview', description: '删除世界观条目', parameters: { entityId: { type: 'string', description: '条目ID', required: true } } },

  { name: 'create_outline', description: '创建大纲节点', parameters: { volumeId: { type: 'string', description: '所属分卷ID' }, title: { type: 'string', description: '标题', required: true }, conflict: { type: 'string', description: '核心冲突' }, summary: { type: 'string', description: '剧情摘要' }, status: { type: 'string', description: '状态: idea/planned/drafting/done' } } },
  { name: 'update_outline', description: '修改大纲节点', parameters: { entityId: { type: 'string', description: '节点ID', required: true }, title: { type: 'string', description: '新标题' }, conflict: { type: 'string', description: '新冲突' }, summary: { type: 'string', description: '新摘要' } } },
  { name: 'delete_outline', description: '删除大纲节点', parameters: { entityId: { type: 'string', description: '节点ID', required: true } } },

  { name: 'create_inspiration', description: '创建灵感卡片', parameters: { type: { type: 'string', description: '类型: 场景火花/人物动机/剧情反转/关键台词/设定脑洞/开篇钩子' }, title: { type: 'string', description: '标题', required: true }, content: { type: 'string', description: '内容' }, tags: { type: 'string', description: '标签，逗号分隔' } } },
  { name: 'update_inspiration', description: '修改灵感卡片', parameters: { entityId: { type: 'string', description: '卡片ID', required: true }, title: { type: 'string', description: '新标题' }, content: { type: 'string', description: '新内容' } } },
  { name: 'delete_inspiration', description: '删除灵感卡片', parameters: { entityId: { type: 'string', description: '卡片ID', required: true } } },

  { name: 'create_thread', description: '创建剧情线索', parameters: { title: { type: 'string', description: '标题', required: true }, description: { type: 'string', description: '描述' }, tags: { type: 'string', description: '标签，逗号分隔' } } },
  { name: 'update_thread', description: '修改剧情线索', parameters: { entityId: { type: 'string', description: '线索ID', required: true }, title: { type: 'string', description: '新标题' }, status: { type: 'string', description: '状态: open/resolved' } } },

  { name: 'create_organization', description: '创建组织', parameters: { name: { type: 'string', description: '组织名', required: true }, type: { type: 'string', description: '类型: 正派势力/反派势力/中立势力/政府部门/商业组织/地下势力' }, description: { type: 'string', description: '描述' } } },
  { name: 'update_organization', description: '修改组织', parameters: { entityId: { type: 'string', description: '组织ID', required: true }, name: { type: 'string', description: '新名称' }, description: { type: 'string', description: '新描述' } } },

  { name: 'create_relationship', description: '创建角色关系', parameters: { fromCharacterId: { type: 'string', description: '源角色ID', required: true }, toCharacterId: { type: 'string', description: '目标角色ID', required: true }, type: { type: 'string', description: '关系类型' }, description: { type: 'string', description: '关系描述' } } },

  { name: 'resolve_thread', description: '收尾剧情线索', parameters: { entityId: { type: 'string', description: '线索ID', required: true } } },
]

// ═══ Tool Executors ═══

export function useGlobalAiTools() {
  const store = useAppStore()

  function getTools(): ToolDef[] { return ALL_TOOLS }

  function execute(call: ToolCall): ToolResult {
    try {
      const data = executeInternal(call)
      return { callId: call.id, success: true, data }
    } catch (e) {
      return { callId: call.id, success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  function executeInternal(call: ToolCall): unknown {
    const { name, args } = call

    // ── Read tools ──
    if (name === 'list_characters') {
      return store.characters.map(c => ({ id: c.id, name: c.name, role: c.role }))
    }
    if (name === 'list_worldview') {
      return store.worldviewEntries.map(e => ({ id: e.id, title: e.title, type: e.type }))
    }
    if (name === 'list_outline') {
      return store.outlineItems.map(i => ({ id: i.id, title: i.title, volumeId: i.volumeId, status: i.status }))
    }
    if (name === 'list_inspirations') {
      return store.inspirationEntries.map(e => ({ id: e.id, title: e.title, type: e.type }))
    }
    if (name === 'list_plot_threads') {
      return store.plotThreads.map(t => ({ id: t.id, title: t.title, status: t.status }))
    }
    if (name === 'list_organizations') {
      return store.organizations.map(o => ({ id: o.id, name: o.name, type: o.type }))
    }
    if (name === 'list_relationships') {
      const charMap = new Map(store.characters.map(c => [c.id, c.name]))
      return store.characterRelationships.map(r => ({ id: r.id, from: charMap.get(r.fromCharacterId) || '?', to: charMap.get(r.toCharacterId) || '?', type: r.type }))
    }
    if (name === 'read_entity') {
      return readEntity(args.entityType as string, args.entityId as string)
    }

    // ── Write tools (return ProposedChange) ──
    if (name === 'create_character') return createCharacter(args)
    if (name === 'update_character') return updateCharacter(args)
    if (name === 'delete_character') return deleteCharacter(args)
    if (name === 'create_worldview') return createWorldview(args)
    if (name === 'update_worldview') return updateWorldview(args)
    if (name === 'delete_worldview') return deleteWorldview(args)
    if (name === 'create_outline') return createOutline(args)
    if (name === 'update_outline') return updateOutline(args)
    if (name === 'delete_outline') return deleteOutline(args)
    if (name === 'create_inspiration') return createInspiration(args)
    if (name === 'update_inspiration') return updateInspiration(args)
    if (name === 'delete_inspiration') return deleteInspiration(args)
    if (name === 'create_thread') return createThread(args)
    if (name === 'update_thread') return updateThread(args)
    if (name === 'create_organization') return createOrganization(args)
    if (name === 'update_organization') return updateOrganization(args)
    if (name === 'create_relationship') return createRelationship(args)
    if (name === 'resolve_thread') return resolveThread(args)

    throw new Error(`Unknown tool: ${name}`)
  }

  // ── Read helpers ──
  function readEntity(entityType: string, entityId: string): unknown {
    if (entityType === 'character') return store.characters.find(c => c.id === entityId) ?? null
    if (entityType === 'worldview') return store.worldviewEntries.find(e => e.id === entityId) ?? null
    if (entityType === 'outline') return store.outlineItems.find(i => i.id === entityId) ?? null
    if (entityType === 'inspiration') return store.inspirationEntries.find(e => e.id === entityId) ?? null
    if (entityType === 'thread') return store.plotThreads.find(t => t.id === entityId) ?? null
    if (entityType === 'organization') return store.organizations.find(o => o.id === entityId) ?? null
    throw new Error(`Unknown entity type: ${entityType}`)
  }

  // ── Write helpers (return ProposedChange, do NOT mutate store) ──
  function createCharacter(args: Record<string, unknown>): ProposedChange {
    const name = String(args.name || '新角色').trim()
    const role = String(args.role || '待设定').trim()
    const desc = String(args.description || '').trim()
    const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(l => ({ label: l, tone: 'default' as const }))
    return {
      action: 'create', entityType: 'character', entityId: uniqueId('char'),
      label: `创建角色「${name}」`,
      before: null,
      after: { name, role, description: desc, tags: tags.length ? tags : [{ label: 'AI生成', tone: 'info' }] }
    }
  }

  function updateCharacter(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.characters.find(c => c.id === entityId)
    if (!existing) throw new Error(`角色 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.name) after.name = String(args.name).trim()
    if (args.role) after.role = String(args.role).trim()
    if (args.description) after.description = String(args.description).trim()
    return { action: 'update', entityType: 'character', entityId, label: `修改角色「${after.name}」`, before: existing, after }
  }

  function deleteCharacter(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.characters.find(c => c.id === entityId)
    if (!existing) throw new Error(`角色 ${entityId} 不存在`)
    return { action: 'delete', entityType: 'character', entityId, label: `删除角色「${existing.name}」`, before: existing, after: null }
  }

  function createWorldview(args: Record<string, unknown>): ProposedChange {
    return { action: 'create', entityType: 'worldview', entityId: uniqueId('world'), label: `创建世界观「${args.title}」`, before: null, after: { type: args.type || '地理', title: String(args.title || '').trim(), content: args.content || '' } }
  }

  function updateWorldview(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.worldviewEntries.find(e => e.id === entityId)
    if (!existing) throw new Error(`世界观条目 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.type) after.type = String(args.type).trim()
    if (args.title) after.title = String(args.title).trim()
    if (args.content) after.content = String(args.content).trim()
    return { action: 'update', entityType: 'worldview', entityId, label: `修改世界观「${after.title}」`, before: existing, after }
  }

  function deleteWorldview(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.worldviewEntries.find(e => e.id === entityId)
    if (!existing) throw new Error(`世界观条目 ${entityId} 不存在`)
    return { action: 'delete', entityType: 'worldview', entityId, label: `删除世界观「${existing.title}」`, before: existing, after: null }
  }

  function createOutline(args: Record<string, unknown>): ProposedChange {
    const volumeId = String(args.volumeId || store.outlineVolumes[0]?.id || '')
    return { action: 'create', entityType: 'outline', entityId: uniqueId('outline'), label: `创建大纲「${args.title}」`, before: null, after: { volumeId, title: String(args.title || '').trim(), conflict: args.conflict || '', summary: args.summary || '', wordTarget: '3000', status: args.status || 'planned' } }
  }

  function updateOutline(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.outlineItems.find(i => i.id === entityId)
    if (!existing) throw new Error(`大纲节点 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.title) after.title = String(args.title).trim()
    if (args.conflict) after.conflict = String(args.conflict).trim()
    if (args.summary) after.summary = String(args.summary).trim()
    return { action: 'update', entityType: 'outline', entityId, label: `修改大纲「${after.title}」`, before: existing, after }
  }

  function deleteOutline(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.outlineItems.find(i => i.id === entityId)
    if (!existing) throw new Error(`大纲节点 ${entityId} 不存在`)
    return { action: 'delete', entityType: 'outline', entityId, label: `删除大纲「${existing.title}」`, before: existing, after: null }
  }

  function createInspiration(args: Record<string, unknown>): ProposedChange {
    const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    return { action: 'create', entityType: 'inspiration', entityId: uniqueId('inspiration'), label: `创建灵感「${args.title}」`, before: null, after: { type: args.type || '场景火花', title: String(args.title || '').trim(), content: args.content || '', tags, source: 'ai' } }
  }

  function updateInspiration(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.inspirationEntries.find(e => e.id === entityId)
    if (!existing) throw new Error(`灵感卡片 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.title) after.title = String(args.title).trim()
    if (args.content) after.content = String(args.content).trim()
    return { action: 'update', entityType: 'inspiration', entityId, label: `修改灵感「${after.title}」`, before: existing, after }
  }

  function deleteInspiration(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.inspirationEntries.find(e => e.id === entityId)
    if (!existing) throw new Error(`灵感卡片 ${entityId} 不存在`)
    return { action: 'delete', entityType: 'inspiration', entityId, label: `删除灵感「${existing.title}」`, before: existing, after: null }
  }

  function createThread(args: Record<string, unknown>): ProposedChange {
    const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    return { action: 'create', entityType: 'thread', entityId: uniqueId('thread'), label: `创建线索「${args.title}」`, before: null, after: { title: String(args.title || '').trim(), description: args.description || '', tags, status: 'open' } }
  }

  function updateThread(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.plotThreads.find(t => t.id === entityId)
    if (!existing) throw new Error(`线索 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.title) after.title = String(args.title).trim()
    if (args.status) after.status = args.status as 'open' | 'resolved'
    return { action: 'update', entityType: 'thread', entityId, label: `修改线索「${after.title}」`, before: existing, after }
  }

  function createOrganization(args: Record<string, unknown>): ProposedChange {
    return { action: 'create', entityType: 'organization', entityId: uniqueId('org'), label: `创建组织「${args.name}」`, before: null, after: { name: String(args.name || '').trim(), type: args.type || '中立势力', description: args.description || '', motto: '' } }
  }

  function updateOrganization(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.organizations.find(o => o.id === entityId)
    if (!existing) throw new Error(`组织 ${entityId} 不存在`)
    const after = { ...existing }
    if (args.name) after.name = String(args.name).trim()
    if (args.description) after.description = String(args.description).trim()
    return { action: 'update', entityType: 'organization', entityId, label: `修改组织「${after.name}」`, before: existing, after }
  }

  function createRelationship(args: Record<string, unknown>): ProposedChange {
    const fromName = store.characters.find(c => c.id === args.fromCharacterId)?.name || '?'
    const toName = store.characters.find(c => c.id === args.toCharacterId)?.name || '?'
    return { action: 'create', entityType: 'relationship', entityId: uniqueId('relationship'), label: `创建关系「${fromName} → ${toName}」`, before: null, after: { fromCharacterId: args.fromCharacterId, toCharacterId: args.toCharacterId, type: args.type || '关联', description: args.description || '', intensity: 50 } }
  }

  function resolveThread(args: Record<string, unknown>): ProposedChange {
    const entityId = String(args.entityId || '')
    const existing = store.plotThreads.find(t => t.id === entityId)
    if (!existing) throw new Error(`线索 ${entityId} 不存在`)
    return { action: 'update', entityType: 'thread', entityId, label: `收尾线索「${existing.title}」`, before: existing, after: { ...existing, status: 'resolved' } }
  }

  // ═══ Simulated AI dispatcher (keyword matching → tool calls) ═══
  // This will be replaced by real AI agent in the future.
  function simulateToolCalls(userMessage: string): Array<{ call: ToolCall; result: ToolResult }> {
    const results: Array<{ call: ToolCall; result: ToolResult }> = []
    const msg = userMessage.toLowerCase()

    // Create patterns
    if (msg.includes('创建') || msg.includes('新建') || msg.includes('添加')) {
      if (msg.includes('角色') || msg.includes('人物')) {
        const call = buildCall('create_character', extractCreateArgs(msg, ['name', 'role', 'description', 'tags']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('大纲') || msg.includes('节点')) {
        const call = buildCall('create_outline', extractCreateArgs(msg, ['title', 'conflict', 'summary']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('世界观') || msg.includes('设定')) {
        const call = buildCall('create_worldview', extractCreateArgs(msg, ['type', 'title', 'content']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('灵感')) {
        const call = buildCall('create_inspiration', extractCreateArgs(msg, ['type', 'title', 'content', 'tags']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('线索')) {
        const call = buildCall('create_thread', extractCreateArgs(msg, ['title', 'description', 'tags']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('组织') || msg.includes('势力')) {
        const call = buildCall('create_organization', extractCreateArgs(msg, ['name', 'type', 'description']))
        results.push({ call, result: execute(call) })
      }
      if (msg.includes('关系')) {
        const chars = store.characters
        if (chars.length >= 2) {
          const call = buildCall('create_relationship', { fromCharacterId: chars[0].id, toCharacterId: chars[1].id, type: '盟友', description: msg.slice(0, 100) })
          results.push({ call, result: execute(call) })
        }
      }
    }

    // Read patterns
    if (msg.includes('列出') || msg.includes('查看') || msg.includes('显示') || msg.includes('有哪些')) {
      if (msg.includes('角色') || msg.includes('人物')) results.push(run('list_characters'))
      if (msg.includes('大纲')) results.push(run('list_outline'))
      if (msg.includes('世界观')) results.push(run('list_worldview'))
      if (msg.includes('灵感')) results.push(run('list_inspirations'))
      if (msg.includes('线索')) results.push(run('list_plot_threads'))
      if (msg.includes('组织')) results.push(run('list_organizations'))
      if (msg.includes('关系')) results.push(run('list_relationships'))
      if (results.length === 0) {
        // Generic "list everything"
        results.push(run('list_characters'), run('list_outline'))
      }
    }

    // Delete patterns
    if (msg.includes('删除') || msg.includes('移除')) {
      if (msg.includes('角色')) { const c = store.characters[0]; if (c) results.push(runWithArg('delete_character', { entityId: c.id })) }
      if (msg.includes('大纲')) { const o = store.outlineItems[0]; if (o) results.push(runWithArg('delete_outline', { entityId: o.id })) }
    }

    // Update patterns
    if (msg.includes('修改') || msg.includes('更新') || msg.includes('改')) {
      if (msg.includes('角色')) { const c = store.characters[0]; if (c) results.push(runWithArg('update_character', { entityId: c.id, name: c.name + '(已更新)' })) }
    }

    return results
  }

  function run(name: string): { call: ToolCall; result: ToolResult } {
    const call = buildCall(name, {})
    return { call, result: execute(call) }
  }

  function runWithArg(name: string, args: Record<string, unknown>): { call: ToolCall; result: ToolResult } {
    const call = buildCall(name, args)
    return { call, result: execute(call) }
  }

  function buildCall(name: string, args: Record<string, unknown>): ToolCall {
    return { id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, args }
  }

  function extractCreateArgs(msg: string, fields: string[]): Record<string, string> {
    const args: Record<string, string> = {}
    for (const field of fields) {
      const match = msg.match(new RegExp(`${field}[：:]\s*["「](.+?)["」]`)) || msg.match(new RegExp(`${field}[：:]\s*(.+?)(?:[,，]|$)`, 'i'))
      if (match) args[field] = match[1].trim()
    }
    if (!args.name && !args.title) {
      args.name = msg.includes('角色') ? '新角色' : msg.includes('大纲') ? '新剧情节点' : '新条目'
    }
    return args
  }

  return { getTools, execute, simulateToolCalls }
}
