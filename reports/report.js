import { DEFAULTS } from '../src/config.js'
import { buildReportMetrics } from './metrics.js'
import { fsPromises, joinPath } from '../utils/platform.js'

export async function exportJsonReport ({ config, metrics, eventLog, payments, directory = DEFAULTS.reportDirectory }) {
  const fs = await fsPromises()
  await fs.mkdir(directory, { recursive: true })
  const report = buildReportMetrics({ config, metrics, eventLog, payments })
  const filename = `zapcast-report-${Date.now()}.json`
  const file = joinPath(directory, filename)
  const content = JSON.stringify(report, null, 2)
  await fs.writeFile(file, content)
  eventLog.add('report_exported', {
    role: metrics.role,
    peerId: metrics.peerId,
    streamId: metrics.snapshot().streamId,
    message: file
  })
  return { filename, path: file, mime: 'application/json', content }
}

export async function exportCsvEvents ({ metrics, eventLog, directory = DEFAULTS.reportDirectory }) {
  const fs = await fsPromises()
  await fs.mkdir(directory, { recursive: true })
  const filename = `zapcast-events-${Date.now()}.csv`
  const file = joinPath(directory, filename)
  const header = 'timestamp,event,role,peerId,streamId,seq,bytes,sourcePeerId,targetPeerId,message'
  const rows = eventLog.list().map(toCsvRow)
  const content = [header, ...rows].join('\n')
  await fs.writeFile(file, content)
  eventLog.add('report_exported', {
    role: metrics.role,
    peerId: metrics.peerId,
    streamId: metrics.snapshot().streamId,
    message: file
  })
  return { filename, path: file, mime: 'text/csv', content }
}

function toCsvRow (event) {
  return [
    event.timestamp,
    event.event,
    event.role,
    event.peerId,
    event.streamId,
    event.seq,
    event.bytes,
    event.sourcePeerId,
    event.targetPeerId,
    event.message
  ].map(csvCell).join(',')
}

function csvCell (value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}
