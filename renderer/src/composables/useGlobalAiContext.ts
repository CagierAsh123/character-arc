import { computed, type ComputedRef } from 'vue'
import { useAppStore } from '@/stores/app'

export interface PanelContext {
  hot: string   // Full data for current panel
  warm: string  // Summary of other panels
}

const PANEL_CONFIG: Record<string, {
  label: string
  hotBuilder: (store: ReturnType<typeof useAppStore>) => string
}> = {
  world: {
    label: '世界观设定',
    hotBuilder: (s) => {
      const items = s.worldviewEntries
      if (!items.length) return '暂无世界观条目。'
      return `【世界观设定】（共 ${items.length} 条）\n` + items.map(e =>
        `- [${e.type}] ${e.title}\n  ${e.content.slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
      ).join('\n')
    }
  },
  outline: {
    label: '剧情大纲',
    hotBuilder: (s) => {
      const vols = s.outlineVolumes
      if (!vols.length) return '暂无大纲分卷。'
      return vols.map(v => {
        const items = s.outlineItems.filter(i => i.volumeId === v.id)
        return `【${v.title}】${v.summary ? ` ${v.summary}` : ''}` +
          (items.length ? '\n' + items.map(i =>
            `  - [${i.status}] ${i.title} | 冲突: ${i.conflict || '无'} | ${i.summary?.slice(0, 100) || ''}`
          ).join('\n') : '\n  (暂无节点)')
      }).join('\n\n')
    }
  },
  characters: {
    label: '角色图鉴',
    hotBuilder: (s) => {
      const chars = s.characters
      if (!chars.length) return '暂无角色。'
      return `【角色图鉴】（共 ${chars.length} 人）\n` + chars.map(c =>
        `- [${c.role}] ${c.name}${c.tags?.length ? ` [${c.tags.map(t => t.label).join(', ')}]` : ''}\n  ${c.description.slice(0, 200)}${c.description.length > 200 ? '...' : ''}`
      ).join('\n')
    }
  },
  relations: {
    label: '关系组织',
    hotBuilder: (s) => {
      const parts: string[] = []
      if (s.organizations.length) {
        parts.push(`【组织】（共 ${s.organizations.length} 个）\n` + s.organizations.map(o =>
          `- [${o.type}] ${o.name}: ${o.description?.slice(0, 150) || ''}`
        ).join('\n'))
      }
      if (s.characterRelationships.length) {
        const charMap = new Map(s.characters.map(c => [c.id, c.name]))
        parts.push(`【角色关系】（共 ${s.characterRelationships.length} 条）\n` + s.characterRelationships.map(r =>
          `- ${charMap.get(r.fromCharacterId) || '?'} → ${charMap.get(r.toCharacterId) || '?'}: ${r.type} (${r.intensity}%)`
        ).join('\n'))
      }
      if (s.organizationMemberships.length) {
        const orgMap = new Map(s.organizations.map(o => [o.id, o.name]))
        const charMap = new Map(s.characters.map(c => [c.id, c.name]))
        parts.push(`【组织归属】（共 ${s.organizationMemberships.length} 条）\n` + s.organizationMemberships.map(m =>
          `- ${charMap.get(m.characterId) || '?'} ∈ ${orgMap.get(m.organizationId) || '?'}: ${m.role}`
        ).join('\n'))
      }
      return parts.join('\n\n') || '暂无关系数据。'
    }
  },
  inspiration: {
    label: '灵感模块',
    hotBuilder: (s) => {
      const items = s.inspirationEntries
      if (!items.length) return '暂无灵感卡片。'
      return `【灵感模块】（共 ${items.length} 条）\n` + items.map(e =>
        `- [${e.type}] ${e.title}${e.tags?.length ? ` [${e.tags.join(', ')}]` : ''}\n  ${e.content.slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
      ).join('\n')
    }
  },
  threads: {
    label: '剧情线索',
    hotBuilder: (s) => {
      const threads = s.plotThreads
      if (!threads.length) return '暂无剧情线索。'
      return `【剧情线索】（共 ${threads.length} 条）\n` + threads.map(t =>
        `- [${t.status}] ${t.title}${t.tags?.length ? ` [${t.tags.join(', ')}]` : ''}\n  ${t.description.slice(0, 200)}${t.description.length > 200 ? '...' : ''}`
      ).join('\n')
    }
  },
  workflow: {
    label: '小说流程',
    hotBuilder: (s) => {
      const vol = s.activeWorkflowVolume
      if (!vol) return '暂无流程数据。'
      const docs = vol.workflowDocuments ?? []
      if (!docs.length) return `当前分卷「${vol.title}」暂无流程文档。`
      return `【${vol.title} · 流程文档】（共 ${docs.length} 篇）\n` + docs.map(d =>
        `- ${d.title}: ${d.content.slice(0, 300)}${d.content.length > 300 ? '...' : ''}`
      ).join('\n\n')
    }
  },
  'project-knowledge': {
    label: '项目知识库',
    hotBuilder: (s) => {
      const docs = s.knowledgeDocuments
      if (!docs.length) return '暂无知识文档。'
      return `【项目知识库】（共 ${docs.length} 篇）\n` + docs.map(d =>
        `- [${d.sourceType}] ${d.title}\n  ${d.summary || d.content.slice(0, 200)}`
      ).join('\n')
    }
  },
  overview: {
    label: '作品概览',
    hotBuilder: (_s) => ''  // Overview uses warm data only
  }
}

const MAX_CONTEXT_LENGTH = 500_000

export function useGlobalAiContext(panelId: ComputedRef<string>) {
  const store = useAppStore()

  /** Build hot context: full dump of the current panel's entities */
  const hotContext = computed(() => {
    const config = PANEL_CONFIG[panelId.value]
    return config ? config.hotBuilder(store) : ''
  })

  /** Build warm context: compact summary of ALL panels for cross-reference */
  const warmContext = computed(() => {
    const parts: string[] = []

    // Project meta
    const p = store.currentProject
    if (p) {
      parts.push(`【项目】${p.title} · ${p.genre} · ${p.novelLength === 'short' ? '短篇' : '长篇'} · ${p.wordCount || '0字'}`)
      if (p.writingStylePrompt) parts.push(`写作风格: ${p.writingStylePrompt}`)
    }

    // Worldview summary
    if (store.worldviewEntries.length) {
      parts.push(`【世界观】（${store.worldviewEntries.length} 条）: ` + store.worldviewEntries.map(e => `${e.title}[${e.type}]`).join(' | '))
    }

    // Outline summary
    if (store.outlineVolumes.length) {
      parts.push(store.outlineVolumes.map(v => {
        const count = store.outlineItems.filter(i => i.volumeId === v.id).length
        return `【分卷: ${v.title}】（${count} 节点）`
      }).join('\n'))
    }

    // Character summary (compact)
    if (store.characters.length) {
      parts.push(`【角色】（${store.characters.length} 人）: ` + store.characters.map(c => `${c.name}[${c.role}]`).join(' | '))
    }

    // Organization summary
    if (store.organizations.length) {
      parts.push(`【组织】（${store.organizations.length} 个）: ` + store.organizations.map(o => o.name).join(' | '))
    }

    // Inspiration summary
    if (store.inspirationEntries.length) {
      parts.push(`【灵感】（${store.inspirationEntries.length} 条）: ` + store.inspirationEntries.map(e => e.title).join(' | '))
    }

    // Plot threads summary
    if (store.plotThreads.length) {
      const open = store.plotThreads.filter(t => t.status === 'open').length
      const resolved = store.plotThreads.length - open
      parts.push(`【线索】${store.plotThreads.length} 条（未收尾: ${open}, 已收尾: ${resolved}）`)
    }

    // Relations summary
    if (store.characterRelationships.length) {
      parts.push(`【关系】${store.characterRelationships.length} 条`)
    }

    // Knowledge docs summary
    if (store.knowledgeDocuments.length) {
      parts.push(`【知识库】${store.knowledgeDocuments.length} 篇: ` + store.knowledgeDocuments.map(d => d.title).join(' | '))
    }

    return parts.join('\n')
  })

  function buildFullContext(panelId: string): PanelContext {
    return {
      hot: PANEL_CONFIG[panelId]?.hotBuilder(store) ?? '',
      warm: warmContext.value
    }
  }

  function buildSystemPrompt(panelId: string): string {
    const ctx = buildFullContext(panelId)
    const parts: string[] = [
      '你是一个小说创作 AI 助手。你可以帮助用户管理大纲、角色、世界观、灵感、组织关系、剧情线索等创作元素。',
      '',
      '== 当前项目数据 ==',
    ]

    // Truncate warm context: keep complete lines under budget
    const warmLines = ctx.warm.split('\n')
    let warmChars = 0
    const warmIncluded: string[] = []
    for (const line of warmLines) {
      if (warmChars + line.length > MAX_CONTEXT_LENGTH * 0.7) {
        warmIncluded.push(`... (上下文已截断，完整数据共 ${ctx.warm.length.toLocaleString()} 字符)`)
        break
      }
      warmIncluded.push(line)
      warmChars += line.length + 1
    }
    parts.push(warmIncluded.join('\n'))

    if (ctx.hot) {
      const remainingBudget = MAX_CONTEXT_LENGTH - warmChars - 500
      if (remainingBudget > 0) {
        const hotText = ctx.hot.length > remainingBudget
          ? ctx.hot.slice(0, remainingBudget) + `\n... (热数据已截断，完整数据共 ${ctx.hot.length.toLocaleString()} 字符)`
          : ctx.hot
        parts.push('', '== 当前面板详情（你可以直接操作这些数据） ==', hotText)
      }
    }
    parts.push('', '请用中文回复。保持简洁，直接回应需求。')
    return parts.join('\n')
  }

  return { hotContext, warmContext, buildSystemPrompt, buildFullContext }
}
