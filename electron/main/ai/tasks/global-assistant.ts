import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult } from '../shared-types'

const GLOBAL_ASSISTANT_SYSTEM = `你是 CharacterArc 的全局 AI 创作助手。你帮助用户在小说创作过程中管理大纲、角色、世界观、灵感、组织关系、剧情线索等创作元素。

你可以：
- 根据用户的描述创建新的创作元素
- 修改和优化已有的设定
- 回答关于创作的问题
- 提供写作建议和灵感
- 分析故事结构和角色动机

请用中文回复。保持简洁，直接回应需求。`

const handler: TaskHandler = {
  name: 'global-assistant',
  outputType: 'text',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const systemPrompt = String(context.systemPrompt ?? '').trim()
    const system = systemPrompt
      ? `${capabilityPreamble.system}\n\n${GLOBAL_ASSISTANT_SYSTEM}\n\n${systemPrompt}`
      : `${capabilityPreamble.system}\n\n${GLOBAL_ASSISTANT_SYSTEM}`
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''

    return {
      system,
      user: `${capabilityPreamble.user}\n\n用户消息：${String(context.userPrompt ?? '')}\n\n${retrievalBlock}\n\n项目技能：${skillsBlock || '无'}`,
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as { content?: string }).content?.trim())
  },
  resolveMaxTokens(): number {
    return 2000
  }
}

export default handler
