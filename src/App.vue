<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, Aperture, Bot, Check, ChevronDown, CirclePlay, Clapperboard, Database, Film, FolderKanban, Image, LayoutGrid, Lock, MessageSquareText, MoreHorizontal, Plus, RefreshCw, Save, Search, Send, Settings2, Sparkles, Trash2, Unlock, WandSparkles } from '@lucide/vue'
import { askDirector, checkModel, generateFluxImageBlob, getH3VideoJob, h3VideoContentUrl, modelCatalog, resolveH3Task, submitH3Video, validateH3Request } from './services/models'
import { checkStudioApi, createAsset, createProject, deleteAsset, deleteProject, listAssets, listProjects, loadCapabilities, loadProject, retryJob, saveProject, uploadAssetBlob } from './services/studio'
import type { Asset, AssetType, Capability, Job, ModelKey, ProjectSummary, Scene, Shot, StudioProject } from './types'

const project = ref<StudioProject>({ id: 'EP001', title: '雨夜重逢', episode: 'EP001', status: 'active', script: { source: '', generated: '' }, scenes: [] })
const projects = ref<ProjectSummary[]>([])
const jobs = ref<Job[]>([])
const assets = ref<Asset[]>([])
const capabilities = ref<Capability[]>([])
const selectedSceneId = ref('')
const selectedShotId = ref('')
const activeNav = ref('项目概览')
const assetFilter = ref<'all' | AssetType>('all')
const statusFilter = ref<'all' | Shot['status']>('all')
const query = ref('')
const prompt = ref('把这一场改得更克制一些，并规划下一组反应镜头。')
const directorReply = ref('导演 Agent 已就绪。可以从故事梗概开始生成剧本，也可以针对当前场次规划镜头。')
const sending = ref(false)
const converting = ref(false)
const generating = ref(false)
const generatingImage = ref(false)
const h3References = ref<File[]>([])
const h3Mode = ref<'auto' | 't2va' | 'fl2va' | 'ref2va'>('auto')
const h3Ratio = ref<'21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'>('9:16')
const h3Sound = ref(true)
const generatedVideoUrl = ref('')
const generatedImageUrl = ref('')
const generationError = ref('')
const modelHealth = ref<Record<ModelKey, boolean | null>>({ deepseek: null, flux: null, minimax: null })
const dbOnline = ref<boolean | null>(null)
const saveState = ref<'loading' | 'saved' | 'saving' | 'error'>('loading')
const hydrated = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined

const scenes = computed(() => project.value.scenes)
const selectedScene = computed(() => scenes.value.find(s => s.id === selectedSceneId.value) ?? scenes.value[0])
const selectedShot = computed(() => selectedScene.value?.shots.find(s => s.id === selectedShotId.value))
const scriptSource = computed({
  get: () => project.value.script?.source || '',
  set: value => { project.value.script = { source: value, generated: project.value.script?.generated || '' } }
})
const scriptGenerated = computed({
  get: () => project.value.script?.generated || '',
  set: value => { project.value.script = { source: project.value.script?.source || '', generated: value } }
})
const filteredShots = computed(() => (selectedScene.value?.shots || []).filter(s => {
  const textOk = `${s.title}${s.description}${s.prompt}`.toLowerCase().includes(query.value.toLowerCase())
  const statusOk = statusFilter.value === 'all' || s.status === statusFilter.value
  return textOk && statusOk
}))
const filteredAssets = computed(() => assetFilter.value === 'all' ? assets.value : assets.value.filter(a => a.type === assetFilter.value))
const totalDuration = computed(() => scenes.value.flatMap(s => s.shots).reduce((sum, shot) => sum + shot.duration, 0))
const totalShots = computed(() => scenes.value.reduce((sum, scene) => sum + scene.shots.length, 0))
const completedJobs = computed(() => jobs.value.filter(job => job.status === 'done').length)

function findShot(id?: string) {
  if (!id) return undefined
  for (const scene of scenes.value) {
    const shot = scene.shots.find(item => item.id === id)
    if (shot) return { scene, shot }
  }
}
function locateJob(job: Job) {
  const found = findShot(job.shotId)
  if (!found) return window.alert('找不到该任务对应的镜头。')
  selectShot(found.scene.id, found.shot.id)
}
function handleProjectChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (id) void openProject(id)
}
function setAssetFilter(value: string) {
  if (['all', 'character', 'location', 'image', 'video'].includes(value)) assetFilter.value = value as 'all' | AssetType
}
function showSettings() { window.alert('模型与数据库地址由 .env.local / Vite Proxy 管理。') }
function showProfile() { window.alert('导演工作台 · 本地单用户模式') }

function nextSceneId() {
  const max = Math.max(0, ...scenes.value.map(s => Number(s.id.replace(/\D/g, '')) || 0))
  return `S${String(max + 1).padStart(3, '0')}`
}
function nextShotId() {
  const all = scenes.value.flatMap(s => s.shots)
  const max = Math.max(0, ...all.map(s => Number(s.id.replace(/\D/g, '')) || 0))
  return `SH${String(max + 1).padStart(3, '0')}`
}

function selectScene(id: string) {
  selectedSceneId.value = id
  selectedShotId.value = scenes.value.find(s => s.id === id)?.shots[0]?.id ?? ''
}
function selectShot(sceneId: string, shotId: string) {
  selectedSceneId.value = sceneId
  selectedShotId.value = shotId
  activeNav.value = '镜头板'
}

async function reloadProjectList() { projects.value = await listProjects().catch(() => []) }
async function reloadAssets() { assets.value = await listAssets(project.value.id).catch(() => []) }
async function openProject(id: string) {
  hydrated.value = false
  const data = await loadProject(id)
  project.value = { id: data.id, title: data.title, episode: data.episode, status: data.status, scenes: data.scenes, script: data.script || { source: '', generated: '' }, createdAt: data.createdAt, updatedAt: data.updatedAt }
  jobs.value = data.jobs || []
  selectedSceneId.value = project.value.scenes[0]?.id || ''
  selectedShotId.value = project.value.scenes[0]?.shots[0]?.id || ''
  await reloadAssets()
  hydrated.value = true
  saveState.value = 'saved'
}

async function addProject() {
  const title = window.prompt('新项目名称', '新影视项目')?.trim()
  if (!title) return
  const created = await createProject(title)
  await reloadProjectList()
  await openProject(created.id)
  activeNav.value = '项目概览'
}
async function renameProject() {
  const title = window.prompt('项目名称', project.value.title)?.trim()
  if (!title) return
  project.value.title = title
  await persistNow()
  await reloadProjectList()
}
async function removeProject() {
  if (!window.confirm(`确定删除项目“${project.value.title}”？项目的场次、镜头和数据库记录会一起删除。`)) return
  try {
    await deleteProject(project.value.id)
    await reloadProjectList()
    if (projects.value[0]) await openProject(projects.value[0].id)
  } catch (error) { window.alert(error instanceof Error ? error.message : '删除失败') }
}

function addScene() {
  const id = nextSceneId()
  project.value.scenes.push({ id, title: '新场次', location: '待设定', time: '待设定', synopsis: '描述本场次的戏剧目标。', shots: [] })
  selectScene(id)
  activeNav.value = '场次结构'
}
function editScene(scene: Scene) {
  scene.title = window.prompt('场次名称', scene.title)?.trim() || scene.title
  scene.location = window.prompt('地点', scene.location)?.trim() || scene.location
  scene.time = window.prompt('时间 / 内外景', scene.time)?.trim() || scene.time
  scene.synopsis = window.prompt('戏剧目标 / 场次概要', scene.synopsis)?.trim() || scene.synopsis
}
function removeScene(scene: Scene) {
  if (!window.confirm(`删除 ${scene.id} · ${scene.title} 及其全部镜头？`)) return
  project.value.scenes = scenes.value.filter(s => s.id !== scene.id)
  selectScene(project.value.scenes[0]?.id || '')
}
function addShot(scene = selectedScene.value) {
  if (!scene) return
  const shot: Shot = { id: nextShotId(), title: '新镜头', description: '描述这个镜头发生了什么。', shotSize: '中景', camera: '静止', duration: 4, prompt: '', status: 'draft', model: 'flux' }
  scene.shots.push(shot)
  selectShot(scene.id, shot.id)
}
function editShot(shot: Shot) {
  shot.title = window.prompt('镜头名称', shot.title)?.trim() || shot.title
  shot.description = window.prompt('镜头描述', shot.description)?.trim() || shot.description
  shot.camera = window.prompt('运镜', shot.camera)?.trim() || shot.camera
}
function removeShot(shot: Shot) {
  const scene = selectedScene.value
  if (!scene || !window.confirm(`删除镜头 ${shot.id} · ${shot.title}？`)) return
  scene.shots = scene.shots.filter(s => s.id !== shot.id)
  selectedShotId.value = scene.shots[0]?.id || ''
}
function toggleShotLock(shot: Shot) {
  shot.locked = !shot.locked
  shot.status = shot.locked ? 'approved' : 'ready'
}
function playShot(shot: Shot) {
  if (shot.outputUrl) window.open(shot.outputUrl, '_blank')
  else window.alert('这个镜头还没有生成视频。')
}

async function sendPrompt() {
  if (!prompt.value.trim() || sending.value) return
  sending.value = true
  try {
    const sceneContext = selectedScene.value ? `当前场次：${selectedScene.value.title}\n场次概要：${selectedScene.value.synopsis}` : '当前未选择场次'
    directorReply.value = await askDirector(`项目：${project.value.title}\n${sceneContext}\n需求：${prompt.value}`)
  } catch (error) { directorReply.value = `连接导演模型失败：${error instanceof Error ? error.message : '未知错误'}` }
  finally { sending.value = false }
}
async function generateScript() {
  const source = scriptSource.value.trim()
  if (!source || sending.value) return
  sending.value = true
  try {
    const result = await askDirector(`根据以下小说/故事梗概生成可拍摄剧本。必须包含：故事核心、人物设定、剧情节拍、场次列表、每场戏剧目标、建议镜头。请使用中文。\n\n原始内容：\n${source}`)
    project.value.script = { source, generated: result }
    directorReply.value = '剧本方案已生成并保存到当前项目。下一步可以点击“剧本 → Scene”。'
  } catch (error) { directorReply.value = `剧本生成失败：${error instanceof Error ? error.message : '未知错误'}` }
  finally { sending.value = false }
}
function extractJson(text: string) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const positions = [clean.indexOf('{'), clean.indexOf('[')].filter(i => i >= 0)
  const start = positions.length ? Math.min(...positions) : -1
  const candidate = start >= 0 ? clean.slice(start) : clean
  try { return JSON.parse(candidate) } catch { throw new Error('DeepSeek 没有返回合法 JSON，请重新转换一次。') }
}
async function scriptToScenes() {
  const script = scriptGenerated.value.trim()
  if (!script || converting.value) return
  converting.value = true
  try {
    const raw = await askDirector(`把下面剧本转换成严格 JSON，只返回 JSON。格式：{"scenes":[{"title":"","location":"","time":"夜/内","synopsis":""}]}。场次按拍摄逻辑拆分，不要返回镜头。\n\n${script}`)
    const data = extractJson(raw)
    const items = Array.isArray(data) ? data : data.scenes
    if (!Array.isArray(items)) throw new Error('返回结果缺少 scenes')
    project.value.scenes = items.map((item: any, index: number) => ({ id: `S${String(index + 1).padStart(3, '0')}`, title: String(item.title || `场次${index + 1}`), location: String(item.location || '待设定'), time: String(item.time || '待设定'), synopsis: String(item.synopsis || ''), shots: [] }))
    selectScene(project.value.scenes[0]?.id || '')
    activeNav.value = '场次结构'
    directorReply.value = `已从剧本建立 ${project.value.scenes.length} 个 Scene。`
  } catch (error) { window.alert(error instanceof Error ? error.message : '转换失败') }
  finally { converting.value = false }
}
async function sceneToShots(scene: Scene) {
  if (converting.value) return
  converting.value = true
  try {
    const raw = await askDirector(`把这个场次规划成可生成的视频镜头。严格只返回 JSON：{"shots":[{"title":"","description":"","shotSize":"中景","camera":"缓慢推进","duration":5,"prompt":"English cinematic generation prompt"}]}。每个镜头 4-15 秒。\n场次：${scene.title}\n地点：${scene.location}\n时间：${scene.time}\n概要：${scene.synopsis}`)
    const data = extractJson(raw)
    const items = Array.isArray(data) ? data : data.shots
    if (!Array.isArray(items)) throw new Error('返回结果缺少 shots')
    const all = scenes.value.flatMap(s => s.shots)
    const base = Math.max(0, ...all.map(s => Number(s.id.replace(/\D/g, '')) || 0))
    scene.shots = items.map((item: any, index: number) => ({ id: `SH${String(base + index + 1).padStart(3, '0')}`, title: String(item.title || '新镜头'), description: String(item.description || ''), shotSize: String(item.shotSize || '中景'), camera: String(item.camera || '静止'), duration: Math.max(4, Math.min(15, Number(item.duration || 5))), prompt: String(item.prompt || ''), status: 'draft', model: 'flux' as ModelKey }))
    selectScene(scene.id)
    activeNav.value = '镜头板'
  } catch (error) { window.alert(error instanceof Error ? error.message : '镜头规划失败') }
  finally { converting.value = false }
}

async function refreshHealth() {
  await Promise.all((Object.keys(modelCatalog) as ModelKey[]).map(async key => { modelHealth.value[key] = await checkModel(key).catch(() => false) }))
  dbOnline.value = await checkStudioApi().then(v => v.ok).catch(() => false)
}
function chooseReferences(event: Event) { h3References.value = Array.from((event.target as HTMLInputElement).files ?? []) }

async function generateFirstFrame(target = selectedShot.value) {
  const shot = target
  if (!shot || !shot.prompt || generatingImage.value) return
  generationError.value = ''
  generatingImage.value = true
  const localJob: Job = { id: Date.now(), title: `${selectedScene.value?.id || ''} · ${shot.title} 首帧`, model: 'flux', status: 'running', time: '生成中', action: 'image', shotId: shot.id }
  jobs.value.unshift(localJob)
  try {
    const blob = await generateFluxImageBlob(shot.prompt, '1024x1024')
    const asset = await uploadAssetBlob(project.value.id, blob, 'image', `${shot.id}_${shot.title}_first-frame`, shot.id)
    assets.value.unshift(asset)
    generatedImageUrl.value = asset.url
    shot.image = asset.url
    shot.model = 'flux'
    shot.status = 'ready'
    localJob.status = 'done'; localJob.time = '已完成'
  } catch (error) {
    localJob.status = 'failed'; localJob.time = '失败'; localJob.error = error instanceof Error ? error.message : '首帧生成失败'
    generationError.value = localJob.error
  } finally { generatingImage.value = false }
}
async function generateSelectedShot(target = selectedShot.value) {
  const shot = target
  if (!shot || generating.value) return
  if (shot.locked || shot.status === 'approved') { generationError.value = '该镜头已锁定，请先解锁。'; return }
  const request = { prompt: shot.prompt, duration: shot.duration, aspectRatio: h3Ratio.value, generateSound: h3Sound.value, mode: h3Mode.value, references: h3References.value }
  const errors = validateH3Request(request)
  if (errors.length) { generationError.value = errors.join('；'); return }
  generationError.value = ''; generatedVideoUrl.value = ''; generating.value = true; shot.status = 'generating'
  const localJob: Job = { id: Date.now(), title: `${selectedScene.value?.id || ''} · ${shot.title}`, model: 'minimax', status: 'running', time: resolveH3Task(h3References.value, h3Mode.value).toUpperCase(), action: 'video', shotId: shot.id }
  jobs.value.unshift(localJob)
  try {
    let remote = await submitH3Video(request); localJob.remoteId = remote.id
    while (remote.status === 'queued' || remote.status === 'in_progress') { await new Promise(resolve => setTimeout(resolve, 2500)); remote = await getH3VideoJob(remote.id) }
    if (remote.status === 'failed') throw new Error(remote.error?.message || '生成任务失败')
    const url = h3VideoContentUrl(remote.id)
    localJob.status = 'done'; localJob.time = '已完成'; shot.status = 'ready'; generatedVideoUrl.value = url; shot.outputUrl = url
    const asset = await createAsset(project.value.id, { type: 'video', name: `${shot.id}_${shot.title}`, url, sourceShotId: shot.id, metadata: JSON.stringify({ remoteId: remote.id, mode: resolveH3Task(h3References.value, h3Mode.value) }) })
    assets.value.unshift(asset)
  } catch (error) {
    localJob.status = 'failed'; localJob.time = '失败'; localJob.error = error instanceof Error ? error.message : '生成失败'; shot.status = 'draft'; generationError.value = localJob.error
  } finally { generating.value = false }
}
async function regenerateShot() {
  if (!selectedShot.value) return
  selectedShot.value.locked = false
  selectedShot.value.status = 'draft'
  await generateSelectedShot(selectedShot.value)
}
async function retryJobAction(job: Job) {
  await retryJob(project.value.id, job.id).catch(() => undefined)
  const found = findShot(job.shotId)
  if (!found) return window.alert('找不到该任务对应的镜头。')
  selectShot(found.scene.id, found.shot.id)
  if (job.action === 'image') await generateFirstFrame(found.shot)
  else await generateSelectedShot(found.shot)
}

async function addManualAsset(type: AssetType) {
  const name = window.prompt(`${type === 'character' ? '角色' : '场景'}名称`)?.trim()
  if (!name) return
  const description = window.prompt('设定说明 / Prompt', '') || ''
  const asset = await createAsset(project.value.id, { type, name, url: `manual://${type}/${encodeURIComponent(name)}`, metadata: description })
  assets.value.unshift(asset)
}
async function removeAsset(asset: Asset) {
  if (!window.confirm(`删除素材“${asset.name}”？`)) return
  await deleteAsset(project.value.id, asset.id)
  assets.value = assets.value.filter(a => a.id !== asset.id)
}

async function persistNow() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  try { await saveProject(project.value, jobs.value); saveState.value = 'saved' }
  catch { saveState.value = 'error' }
}
function scheduleSave() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 700)
}
watch([project, jobs], scheduleSave, { deep: true })

onMounted(async () => {
  await Promise.all([refreshHealth(), loadCapabilities().then(v => capabilities.value = v).catch(() => {}), reloadProjectList()])
  const first = projects.value.find(p => p.id === 'EP001') || projects.value[0]
  if (first) await openProject(first.id)
  else { hydrated.value = true; saveState.value = 'saved' }
})
</script>

<template>
  <div class="studio-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark"><Clapperboard :size="19" /></div><span>片场</span><b>DRAMA STUDIO</b></div>
      <div class="project-switch real-project-switch"><span class="project-dot"></span><div><small>当前项目</small><select :value="project.id" @change="handleProjectChange"><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.episode }} · {{ p.title }}</option></select></div><ChevronDown :size="15" /><button @click="addProject"><Plus :size="14" /> 新建</button><button @click="renameProject">重命名</button><button class="danger-link" @click="removeProject"><Trash2 :size="14" /></button></div>
      <div class="top-actions"><span class="save-state"><Database :size="14" /> {{ dbOnline ? 'SQLite 在线' : dbOnline === false ? 'SQLite 离线' : '检测中' }}</span><button class="save-state" @click="persistNow"><Save :size="14" /> {{ saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : '已保存' }}</button><button class="icon-button" aria-label="设置" @click="showSettings"><Settings2 :size="18" /></button><button class="avatar" @click="showProfile">导</button></div>
    </header>

    <aside class="sidebar">
      <nav><button v-for="item in ['项目概览','剧本工坊','场次结构','镜头板','素材库','任务中心']" :key="item" :class="{active: activeNav === item}" @click="activeNav = item"><component :is="item === '项目概览' ? LayoutGrid : item === '剧本工坊' ? MessageSquareText : item === '场次结构' ? Film : item === '镜头板' ? Aperture : item === '素材库' ? Image : FolderKanban" :size="17" />{{ item }}</button></nav>
      <div class="sidebar-section"><p>场次 <span>{{ scenes.length }}</span></p><button v-for="scene in scenes" :key="scene.id" class="scene-link" :class="{active: selectedSceneId === scene.id}" @click="selectScene(scene.id); activeNav='镜头板'"><span>{{ scene.id }}</span><div><strong>{{ scene.title }}</strong><small>{{ scene.shots.length }} 镜头 · {{ scene.location }}</small></div></button><button class="new-scene" @click="addScene"><Plus :size="15" /> 添加场次</button></div>
      <div class="model-stack"><div class="stack-title"><span>模型机组</span><button @click="refreshHealth"><RefreshCw :size="13" /></button></div><div v-for="(model, key) in modelCatalog" :key="key" class="model-row"><span class="health" :class="modelHealth[key] === true ? 'online' : modelHealth[key] === false ? 'offline' : 'checking'"></span><div><strong>{{ model.name }}</strong><small>{{ model.role }}</small></div></div></div>
    </aside>

    <main>
      <section v-if="activeNav === '项目概览'" class="workspace-page"><section class="scene-head"><div><div class="eyebrow"><span>{{ project.episode }}</span>AI CONTENT PRODUCTION</div><h1>{{ project.title }}</h1><p>Project → Script → Scene → Shot → Assets → Jobs 全流程由 SQLite 保存生产状态。</p></div></section><div class="overview-stats"><div><small>场次</small><b>{{ scenes.length }}</b></div><div><small>镜头</small><b>{{ totalShots }}</b></div><div><small>总时长</small><b>{{ totalDuration.toFixed(1) }}s</b></div><div><small>已完成任务</small><b>{{ completedJobs }}</b></div></div><section class="capability-matrix"><div class="matrix-head"><h2>制作能力矩阵</h2><p>成熟度表示当前产品化程度。</p></div><div class="capability-table"><div class="cap-row cap-header"><span>场景能力</span><span>执行模型</span><span>当前成熟度</span></div><div v-for="item in capabilities" :key="item.capability" class="cap-row"><strong>{{ item.capability }}</strong><span>{{ item.provider }}</span><span class="stars">{{ '★'.repeat(item.maturity) }}{{ '☆'.repeat(5-item.maturity) }}</span></div></div></section></section>

      <section v-else-if="activeNav === '剧本工坊'" class="workspace-page"><section class="scene-head"><div><div class="eyebrow"><span>WRITER</span>DeepSeek-7B</div><h1>小说 / 故事 → 剧本 → Scene</h1><p>原文、AI 剧本和转换后的场次都持久化到当前 Project。</p></div></section><section class="script-workbench"><label>小说 / 故事输入<textarea v-model="scriptSource" rows="7" placeholder="粘贴小说、故事梗概或剧本原文…"></textarea></label><div class="action-row"><button class="primary" :disabled="sending" @click="generateScript"><Sparkles :size="16" />{{ sending ? '生成中…' : 'DeepSeek 生成剧本' }}</button><button :disabled="!scriptGenerated || converting" @click="scriptToScenes"><Film :size="16" />{{ converting ? '转换中…' : '剧本 → Scene' }}</button><button @click="persistNow"><Save :size="16" /> 保存剧本</button></div><label>生成剧本<textarea v-model="scriptGenerated" rows="16" placeholder="DeepSeek 输出会保存到这里，也可以手工修订。"></textarea></label></section></section>

      <section v-else-if="activeNav === '场次结构'" class="workspace-page"><section class="scene-head"><div><div class="eyebrow"><span>STRUCTURE</span>{{ project.episode }}</div><h1>场次结构</h1><p>新建、编辑、删除场次，并可让 DeepSeek 把单场直接拆成镜头。</p></div><button class="primary" @click="addScene"><Plus :size="16" /> 添加场次</button></section><div class="scene-structure"><article v-for="scene in scenes" :key="scene.id"><span @click="selectScene(scene.id); activeNav='镜头板'">{{ scene.id }}</span><div @click="selectScene(scene.id); activeNav='镜头板'"><h3>{{ scene.title }}</h3><p>{{ scene.time }} · {{ scene.location }}</p><small>{{ scene.synopsis }}</small></div><div class="row-actions"><button @click="editScene(scene)">编辑</button><button :disabled="converting" @click="sceneToShots(scene)">Scene → Shot</button><button class="danger-link" @click="removeScene(scene)"><Trash2 :size="14" /></button></div></article></div></section>

      <template v-else-if="activeNav === '镜头板' && selectedScene"><section class="scene-head"><div><div class="eyebrow"><span>{{ selectedScene.id }}</span>{{ selectedScene.time }} · {{ selectedScene.location }}</div><h1>{{ selectedScene.title }}</h1><p>{{ selectedScene.synopsis }}</p></div><div class="head-stats"><div><small>镜头</small><b>{{ selectedScene.shots.length }}</b></div><div><small>项目总时长</small><b>{{ totalDuration.toFixed(1) }}s</b></div><button class="primary" @click="addShot"><Plus :size="16" /> 新建镜头</button></div></section><section class="toolbar"><div class="search"><Search :size="16" /><input v-model="query" placeholder="搜索镜头、描述、Prompt…" /></div><select v-model="statusFilter"><option value="all">全部状态</option><option value="draft">draft</option><option value="ready">ready</option><option value="generating">generating</option><option value="approved">approved</option></select></section><section class="shot-grid"><article v-for="(shot,index) in filteredShots" :key="shot.id" class="shot-card" :class="{selected:selectedShotId===shot.id}" @click="selectedShotId=shot.id"><div class="frame" :style="shot.image?.startsWith('/') ? {backgroundImage:`url(${shot.image})`,backgroundSize:'cover',backgroundPosition:'center'} : {}"><span class="shot-number">{{ String(index+1).padStart(2,'0') }}</span><span v-if="shot.locked" class="lock"><Lock :size="12" /></span><button class="play" @click.stop="playShot(shot)"><CirclePlay :size="31" /></button><div class="frame-meta"><span>{{ shot.shotSize }}</span><span>{{ shot.duration }}s</span></div></div><div class="card-body"><div class="card-title"><div><small>{{ shot.id }}</small><h3>{{ shot.title }}</h3></div><button @click.stop="editShot(shot)"><MoreHorizontal :size="18" /></button></div><p>{{ shot.description }}</p><div class="card-foot"><span class="model-chip" :class="shot.model">{{ modelCatalog[shot.model].name }}</span><span class="status" :class="shot.status">{{ shot.status }}</span></div></div></article><button class="add-card" @click="addShot"><span><Plus :size="21" /></span><strong>添加镜头</strong><small>继续铺开这一场</small></button></section></template>

      <section v-else-if="activeNav === '素材库'" class="workspace-page"><section class="scene-head"><div><div class="eyebrow"><span>ASSETS</span>{{ project.episode }}</div><h1>素材库</h1><p>Character / Location / Image / Video 统一索引；图片文件写入 data/assets，数据库只保存 URI 与元数据。</p></div><div class="head-actions"><button @click="addManualAsset('character')">+ Character</button><button @click="addManualAsset('location')">+ Location</button></div></section><div class="asset-tabs"><button v-for="item in [{k:'all',n:'全部'},{k:'character',n:'Character'},{k:'location',n:'Location'},{k:'image',n:'Image'},{k:'video',n:'Video'}]" :key="item.k" :class="{active:assetFilter===item.k}" @click="setAssetFilter(item.k)">{{ item.n }}</button></div><div class="asset-grid"><article v-for="asset in filteredAssets" :key="asset.id" class="asset-card"><div class="asset-preview"><img v-if="asset.type==='image' && asset.url.startsWith('/')" :src="asset.url" /><video v-else-if="asset.type==='video'" :src="asset.url" controls /><span v-else>{{ asset.type.toUpperCase() }}</span></div><div><small>{{ asset.type }}</small><h3>{{ asset.name }}</h3><p>{{ asset.sourceShotId || '项目资产' }}</p><div class="row-actions"><a v-if="asset.url.startsWith('/')" :href="asset.url" target="_blank">打开</a><button class="danger-link" @click="removeAsset(asset)">删除</button></div></div></article><div v-if="!filteredAssets.length" class="empty-state">暂无该类型素材。FLUX 首帧和 H3 视频生成成功后会自动进入这里。</div></div></section>

      <section v-else-if="activeNav === '任务中心'" class="workspace-page"><section class="scene-head"><div><div class="eyebrow"><span>JOBS</span>PRODUCTION QUEUE</div><h1>任务中心</h1><p>waiting / running / done / failed 统一查看；失败任务可以定位原镜头并重试。</p></div></section><div class="jobs-table"><div class="job-row job-header"><span>任务</span><span>模型</span><span>状态</span><span>动作</span></div><div v-for="job in jobs" :key="job.id" class="job-row"><strong>{{ job.title }}</strong><span>{{ modelCatalog[job.model].name }}</span><span class="status" :class="job.status">{{ job.status }} · {{ job.time }}</span><div class="row-actions"><button v-if="job.shotId" @click="locateJob(job)">定位镜头</button><button v-if="job.status==='failed' || job.status==='waiting'" @click="retryJobAction(job)"><RefreshCw :size="14" /> retry</button></div></div><div v-if="!jobs.length" class="empty-state">暂无生成任务。</div></div></section>

      <section v-else class="placeholder"><WandSparkles :size="34" /><h2>{{ activeNav }}</h2><p>请先创建或选择项目。</p></section>
    </main>

    <aside class="director-panel"><div class="panel-head"><div><span class="agent-icon"><Bot :size="18" /></span><div><strong>导演 Agent</strong><small><i></i> DeepSeek {{ modelHealth.deepseek ? '在线' : '离线' }}</small></div></div><button @click="prompt='检查当前项目的剧本结构、人物一致性、场景连续性和未完成制作任务。'; sendPrompt()"><Activity :size="18" /></button></div><div class="agent-context"><Sparkles :size="15" /><span>当前上下文</span><strong>{{ selectedScene?.id || project.episode }} · {{ selectedScene?.title || project.title }}</strong></div><div class="conversation"><div class="agent-message"><div class="mini-avatar">导</div><div><p>{{ directorReply }}</p><div class="suggestions"><button @click="prompt='为当前场次生成 3 个反应镜头，并给出景别、运镜、时长和英文生成提示词。'">规划反应镜头</button><button @click="prompt='检查当前场次的人物连续性、空间连续性和情绪节奏。'">连续性检查</button></div></div></div></div><form class="composer" @submit.prevent="sendPrompt"><textarea v-model="prompt" rows="3" placeholder="告诉导演你想怎么改…"></textarea><div><span>DeepSeek Director</span><button :disabled="sending"><RefreshCw v-if="sending" class="spin" :size="16" /><Send v-else :size="16" /></button></div></form><div class="queue"><div class="queue-head"><strong>生成队列</strong><span>{{ jobs.filter(j=>j.status==='running').length }} 进行中</span></div><div v-for="job in jobs.slice(0,6)" :key="job.id" class="job"><span class="job-state" :class="job.status"><Check v-if="job.status==='done'" :size="12" /><span v-else></span></span><div><strong>{{ job.title }}</strong><small>{{ modelCatalog[job.model].name }} · {{ job.time }}</small></div><button v-if="job.status==='failed'" @click="retryJobAction(job)"><RefreshCw :size="14" /></button></div></div>
      <div v-if="selectedShot" class="inspector"><div class="queue-head"><strong>镜头参数</strong><span>{{ selectedShot.id }}</span></div><label>镜头名称<input v-model="selectedShot.title" /></label><label>镜头描述<textarea v-model="selectedShot.description" rows="3"></textarea></label><label>生成提示词<textarea v-model="selectedShot.prompt" rows="4"></textarea></label><div class="inspector-row"><label>景别<input v-model="selectedShot.shotSize" /></label><label>时长<input v-model.number="selectedShot.duration" type="number" min="4" max="15" step="1" /></label></div><label>运镜<input v-model="selectedShot.camera" /></label><div class="shot-actions"><button @click="toggleShotLock(selectedShot)"><Unlock v-if="selectedShot.locked" :size="14" /><Lock v-else :size="14" />{{ selectedShot.locked ? '解锁' : '锁定' }}</button><button @click="editShot(selectedShot)">快速编辑</button><button class="danger-link" @click="removeShot(selectedShot)"><Trash2 :size="14" /> 删除</button></div><button class="generate-button" :disabled="generatingImage || !selectedShot.prompt" @click="generateFirstFrame()"><Image :size="16" />{{ generatingImage ? 'FLUX 生成中…' : 'FLUX 生成首帧' }}</button><a v-if="generatedImageUrl" class="result-link" :href="generatedImageUrl" target="_blank">打开 FLUX 首帧</a><div class="h3-controls"><div class="inspector-row"><label>H3 模式<select v-model="h3Mode"><option value="auto">自动路由</option><option value="t2va">T2VA</option><option value="fl2va">FL2VA</option><option value="ref2va">Ref2VA</option></select></label><label>画幅<select v-model="h3Ratio"><option v-for="ratio in ['21:9','16:9','4:3','1:1','3:4','9:16']" :key="ratio">{{ ratio }}</option></select></label></div><label class="reference-picker">参考素材<input type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/wav,audio/mpeg" @change="chooseReferences" /><span>{{ h3References.length ? `已选择 ${h3References.length} 个文件 · ${resolveH3Task(h3References,h3Mode).toUpperCase()}` : '选择图片 / 视频 / 音频' }}</span></label><label class="sound-toggle"><input v-model="h3Sound" type="checkbox" /> 生成原生对白与环境声</label><button class="generate-button" :disabled="generating || selectedShot.locked" @click="generateSelectedShot()"><CirclePlay :size="16" />{{ generating ? 'H3 生成中…' : 'H3 生成视频' }}</button><button class="generate-button secondary" :disabled="generating || selectedShot.locked" @click="regenerateShot"><RefreshCw :size="15" /> 重生成</button><p v-if="generationError" class="generation-error">{{ generationError }}</p><a v-if="generatedVideoUrl" class="result-link" :href="generatedVideoUrl" target="_blank">打开生成视频</a></div></div>
    </aside>
  </div>
</template>
