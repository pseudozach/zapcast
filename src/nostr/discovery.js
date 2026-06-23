import { nostrDiscoveryFilter } from './relays.js'
import { filterLiveZapcastEvents, parseZapcastLiveEvent } from './parser.js'

export { nostrDiscoveryFilter, filterLiveZapcastEvents, parseZapcastLiveEvent }

export function paginateStreams (streams = [], { page = 0, pageSize = 10 } = {}) {
  const safePageSize = Math.max(1, Number(pageSize) || 10)
  const safePage = Math.max(0, Number(page) || 0)
  const start = safePage * safePageSize
  return {
    page: safePage,
    pageSize: safePageSize,
    total: streams.length,
    items: streams.slice(start, start + safePageSize),
    hasPrevious: safePage > 0,
    hasNext: start + safePageSize < streams.length
  }
}
