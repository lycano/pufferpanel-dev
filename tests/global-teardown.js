import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CONSOLE_DIR, RESULTS } from './env.js'

const ORDER = { error: 0, warning: 1, i18n: 2 }

// first line of a message, without the component trace Vue appends, so repeats group together
function key(entry) {
  return `${entry.severity}|${entry.kind}|${String(entry.text).split('\n')[0].trim()}`
}

// Groups the collected console problems per section and writes test-results/console-report.md; prints a summary.
export default async function globalTeardown() {
  if (!existsSync(CONSOLE_DIR)) return
  const lines = ['# Console report', '']
  let total = 0
  for (const file of readdirSync(CONSOLE_DIR).filter(f => f.endsWith('.jsonl')).sort()) {
    const entries = readFileSync(path.join(CONSOLE_DIR, file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const groups = new Map()
    for (const entry of entries) {
      const k = key(entry)
      if (!groups.has(k)) groups.set(k, { entry, count: 0, pages: new Set(), tests: new Set() })
      const g = groups.get(k)
      g.count++
      g.pages.add(entry.url)
      g.tests.add(entry.test)
    }
    const sorted = [...groups.values()].sort((a, b) => ORDER[a.entry.severity] - ORDER[b.entry.severity])
    total += sorted.length
    lines.push(`## ${path.basename(file, '.jsonl')} (${sorted.length})`, '')
    for (const g of sorted) {
      const e = g.entry
      lines.push(`- **${e.severity}** ${e.kind}${g.count > 1 ? ` ×${g.count}` : ''}: ${String(e.text).split('\n')[0].trim()}`)
      lines.push(`  - pages: ${[...g.pages].join(', ')}`)
      lines.push(`  - tests: ${[...g.tests].join('; ')}`)
      const trace = String(e.text).split('\n').slice(1, 4).map(l => l.trim()).filter(Boolean)
      if (trace.length) lines.push(`  - at: ${trace.join(' ')}`)
    }
    lines.push('')
  }
  const report = path.join(RESULTS, 'console-report.md')
  writeFileSync(report, lines.join('\n'))
  console.log(`\nconsole report: ${total} distinct problem(s) -> ${report}`)
}
