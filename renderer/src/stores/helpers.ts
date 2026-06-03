import type {
  WorldviewEntry,
  InspirationEntry,
  OrganizationEntry,
  OutlineItem,
  KnowledgeDocument
} from '@/types/app'

let nextIdCounter = 0

export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nextIdCounter}`
}

export function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }
  return new Date().toISOString()
}

export function normalizeKnowledgeKeywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : []
}

export function reindexWorldviewEntries(entries: WorldviewEntry[]): WorldviewEntry[] {
  return entries.map((entry, index) => ({ ...entry, sortOrder: index }))
}

export function reindexOutlineItems(items: OutlineItem[]): OutlineItem[] {
  return items.map((item, index) => ({ ...item, sortOrder: index }))
}

export function reindexInspirationEntries(entries: InspirationEntry[]): InspirationEntry[] {
  return entries.map((entry, index) => ({ ...entry, sortOrder: index }))
}

export function reindexOrganizations(entries: OrganizationEntry[]): OrganizationEntry[] {
  return entries.map((entry, index) => ({ ...entry, sortOrder: index }))
}
