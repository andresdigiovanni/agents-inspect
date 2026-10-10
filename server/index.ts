import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.ts'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const app = buildApp({
  projectsDir: join(homedir(), '.claude/projects'),
  copilotDir: join(homedir(), '.copilot/session-state'),
  opencodeDb: join(homedir(), '.local/share/opencode/opencode.db'),
  ...(existsSync(dist) ? { staticDir: dist } : {}),
})
await app.listen({ host: '127.0.0.1', port: 3001 })
console.log('agents-inspect API on http://127.0.0.1:3001')
