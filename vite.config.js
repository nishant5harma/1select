import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/** Dev-only: save interview .md files to ./interview-files/ */
function interviewFilesDevPlugin() {
  return {
    name: 'interview-files-dev',
    configureServer(server) {
      server.middlewares.use('/api/dev/save-interview-md', (req, res, next) => {
        if (req.method !== 'POST') return next()

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const { filename, content } = JSON.parse(body)
            if (!filename || typeof content !== 'string') {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'filename and content required' }))
              return
            }

            const safe = path.basename(String(filename).replace(/[^a-zA-Z0-9._-]/g, '_'))
            if (!safe.endsWith('.md')) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'filename must end with .md' }))
              return
            }

            const dir = path.resolve(process.cwd(), 'interview-files')
            fs.mkdirSync(dir, { recursive: true })
            const filePath = path.join(dir, safe)
            fs.writeFileSync(filePath, content, 'utf8')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: `interview-files/${safe}` }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })

      const normalizeJobTitle = (title) => (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const jobTitlesMatch = (a, b) => {
        const na = normalizeJobTitle(a)
        const nb = normalizeJobTitle(b)
        if (!na || !nb) return false
        return na === nb || na.includes(nb) || nb.includes(na)
      }
      const extractRoleFromMarkdown = (content) => {
        const m = content.match(/\*\*Role:\*\*\s*(.+)/)
        return m?.[1]?.trim() ?? ''
      }

      server.middlewares.use('/api/dev/interview-transcript', (req, res, next) => {
        if (req.method !== 'GET') return next()
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const name = url.searchParams.get('name') ?? ''
          const jobTitle = url.searchParams.get('jobTitle') ?? ''
          const slug = name.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()
          if (!slug) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'name required' }))
            return
          }
          if (!jobTitle.trim()) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'jobTitle required' }))
            return
          }
          const dir = path.resolve(process.cwd(), 'interview-files')
          if (!fs.existsSync(dir)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'not found' }))
            return
          }
          const jobSlug = jobTitle.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()
          const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.md') && f.toLowerCase().startsWith(slug))
            .sort()
            .reverse()

          let match = null
          for (const filename of files) {
            const filePath = path.join(dir, filename)
            const content = fs.readFileSync(filePath, 'utf8')
            const role = extractRoleFromMarkdown(content)
            const filenameMatchesJob = jobSlug && filename.toLowerCase().includes(jobSlug)
            if (jobTitlesMatch(role, jobTitle) || filenameMatchesJob) {
              match = { filename, content, role: role || jobTitle }
              break
            }
          }

          if (!match) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'not found for role' }))
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            filename: match.filename,
            path: `interview-files/${match.filename}`,
            role: match.role,
            content: match.content,
          }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), interviewFilesDevPlugin()],
})
