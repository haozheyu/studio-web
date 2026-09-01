import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const port = Number(process.env.STUDIO_API_PORT || 8787)
const dbPath = resolve(process.env.STUDIO_DB_PATH || './data/studio.db')
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  episode TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  shot_size TEXT NOT NULL DEFAULT '中景',
  camera TEXT NOT NULL DEFAULT '静止',
  duration REAL NOT NULL DEFAULT 4,
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  locked INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'flux',
  image TEXT,
  output_url TEXT,
  FOREIGN KEY(scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  time TEXT NOT NULL,
  remote_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  maturity INTEGER NOT NULL CHECK(maturity BETWEEN 1 AND 5),
  category TEXT NOT NULL DEFAULT 'production'
);
`)

const capabilities = [
  ['小说转剧本', 'DeepSeek', 5], ['分镜规划', 'DeepSeek', 4], ['人物设定', 'DeepSeek + FLUX', 4],
  ['人物定妆图', 'FLUX', 4], ['场景设计', 'FLUX', 5], ['分镜图', 'FLUX', 5], ['视频首帧', 'FLUX', 5],
  ['文生视频', 'H3', 5], ['图生视频', 'FLUX + H3', 5], ['短剧', '三者组合', 4], ['广告', '三者组合', 5],
  ['MV', '三者组合', 4], ['漫剧', '三者组合', 5], ['数字人', 'H3', 3], ['电视剧', '三者 + 制作系统', 3], ['电影', '三者 + 完整生产系统', 3]
]
const insertCapability = db.prepare('INSERT OR IGNORE INTO capabilities(capability, provider, maturity) VALUES (?, ?, ?)')
for (const row of capabilities) insertCapability.run(...row)

const seedProject = {
  id: 'EP001', title: '雨夜重逢', episode: 'EP001', status: 'active',
  scenes: [
    { id: 'S001', title: '雨夜重逢', location: '旧城 · 巷口', time: '夜 / 外', synopsis: '林夏在雨里认出了失踪三年的顾川，两人隔街相望。', shots: [
      { id: 'SH001', title: '空镜建立', description: '霓虹在积水中晃动，雨线切过空巷。', shotSize: '大全景', camera: '缓慢推进', duration: 4, prompt: 'cinematic rainy alley at night, wet asphalt, neon reflections, slow push-in, moody teal and amber', status: 'approved', locked: true, model: 'flux', image: 'rain' },
      { id: 'SH002', title: '林夏停步', description: '林夏撑伞骤然停下，视线越过车流。', shotSize: '中景', camera: '手持跟拍', duration: 4, prompt: 'young Chinese woman under black umbrella suddenly stops, emotional realization, rain, cinematic medium shot', status: 'ready', model: 'flux', image: 'woman' },
      { id: 'SH003', title: '顾川回望', description: '顾川从街灯阴影中抬眼，克制地看向她。', shotSize: '近景', camera: '静止', duration: 4, prompt: 'Chinese man in dark coat looking up from shadow, restrained emotion, rain beads, close-up, film grain', status: 'draft', model: 'minimax' }
    ]},
    { id: 'S002', title: '沉默的证词', location: '旧公寓 · 客厅', time: '夜 / 内', synopsis: '一张旧照片让两人的说辞出现裂缝。', shots: [] }
  ]
}

function saveProject(project, jobs = []) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO projects(id,title,episode,status,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,episode=excluded.episode,status=excluded.status,updated_at=CURRENT_TIMESTAMP`)
      .run(project.id, project.title, project.episode || project.id, project.status || 'active')
    db.prepare('DELETE FROM scenes WHERE project_id=?').run(project.id)
    const sceneStmt = db.prepare('INSERT INTO scenes(id,project_id,sort_order,title,location,time,synopsis) VALUES(?,?,?,?,?,?,?)')
    const shotStmt = db.prepare(`INSERT INTO shots(id,scene_id,sort_order,title,description,shot_size,camera,duration,prompt,status,locked,model,image,output_url)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    project.scenes.forEach((scene, si) => {
      sceneStmt.run(scene.id, project.id, si, scene.title, scene.location || '', scene.time || '', scene.synopsis || '')
      ;(scene.shots || []).forEach((shot, qi) => shotStmt.run(shot.id, scene.id, qi, shot.title, shot.description || '', shot.shotSize || '中景', shot.camera || '静止', Number(shot.duration || 4), shot.prompt || '', shot.status || 'draft', shot.locked ? 1 : 0, shot.model || 'flux', shot.image || null, shot.outputUrl || null))
    })
    db.prepare('DELETE FROM jobs WHERE project_id=?').run(project.id)
    const jobStmt = db.prepare('INSERT INTO jobs(id,project_id,title,model,status,time,remote_id) VALUES(?,?,?,?,?,?,?)')
    jobs.forEach(job => jobStmt.run(Number(job.id), project.id, job.title, job.model, job.status, job.time, job.remoteId || null))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function loadProject(id) {
  const project = db.prepare('SELECT id,title,episode,status,created_at createdAt,updated_at updatedAt FROM projects WHERE id=?').get(id)
  if (!project) return null
  const scenes = db.prepare('SELECT * FROM scenes WHERE project_id=? ORDER BY sort_order').all(id).map(scene => ({
    id: scene.id, title: scene.title, location: scene.location, time: scene.time, synopsis: scene.synopsis,
    shots: db.prepare('SELECT * FROM shots WHERE scene_id=? ORDER BY sort_order').all(scene.id).map(shot => ({
      id: shot.id, title: shot.title, description: shot.description, shotSize: shot.shot_size, camera: shot.camera,
      duration: shot.duration, prompt: shot.prompt, status: shot.status, locked: Boolean(shot.locked), model: shot.model,
      image: shot.image || undefined, outputUrl: shot.output_url || undefined
    }))
  }))
  const jobs = db.prepare('SELECT id,title,model,status,time,remote_id remoteId FROM jobs WHERE project_id=? ORDER BY id DESC').all(id)
  return { ...project, scenes, jobs }
}

if (!loadProject(seedProject.id)) saveProject(seedProject, [])

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, db: dbPath })
    if (req.method === 'GET' && url.pathname === '/api/capabilities') return json(res, 200, db.prepare('SELECT capability,provider,maturity,category FROM capabilities ORDER BY id').all())
    if (req.method === 'GET' && url.pathname === '/api/projects') return json(res, 200, db.prepare('SELECT id,title,episode,status,updated_at updatedAt FROM projects ORDER BY updated_at DESC').all())
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
    if (match && req.method === 'GET') {
      const project = loadProject(decodeURIComponent(match[1]))
      return project ? json(res, 200, project) : json(res, 404, { error: 'project_not_found' })
    }
    if (match && req.method === 'PUT') {
      const body = await readJson(req)
      if (!body.project?.id || !Array.isArray(body.project?.scenes)) return json(res, 400, { error: 'invalid_project' })
      saveProject(body.project, body.jobs || [])
      return json(res, 200, loadProject(body.project.id))
    }
    return json(res, 404, { error: 'not_found' })
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error instanceof Error ? error.message : 'internal_error' })
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`[studio-api] http://0.0.0.0:${port}`)
  console.log(`[studio-api] sqlite ${dbPath}`)
})
