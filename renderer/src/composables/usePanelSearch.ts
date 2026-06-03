import { computed, ref } from 'vue'

export function usePanelSearch(props: { searchQuery?: string }) {
  const keyword = ref('')
  const mergedQuery = computed(() =>
    [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  )
  return { keyword, mergedQuery }
}
