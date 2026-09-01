<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, Aperture, Bot, Check, ChevronDown, CirclePlay, Clapperboard, Database, Film, Image, LayoutGrid, Lock, MessageSquareText, MoreHorizontal, Plus, RefreshCw, Save, Search, Send, Settings2, Sparkles, WandSparkles } from '@lucide/vue'
import { askDirector, checkModel, generateFluxImage, getH3VideoJob, h3VideoContentUrl, modelCatalog, resolveH3Task, submitH3Video, validateH3Request } from './services/models'
import { checkStudioApi, loadCapabilities, loadProject, saveProject } from './services/studio'
import type { Capability, Job, ModelKey, Scene, Shot, StudioProject } from './types'

const project = ref<StudioProject>({ id: 'EP001', title: '雨夜重逢', episode: 'EP001', status: 'active', scenes: [] })
const jobs = ref<Job[]>([])
const capabilities = ref<Capability[]>([])
const selectedSceneId = ref('')
const selectedShotId = ref('')
const activeNav = ref('项目概览')
const query = ref('')
const prompt = ref('把这一场改得更克制一些，并规划下一组反应镜头。')
const scriptIdea = ref('现代程序员意外穿越到明朝，醒来后发现自己成了皇子。他以为从此能享福，却发现朱元璋比现代老板更会压榨人。')
const directorReply = ref('导演 Agent 已就绪。可以从故事梗概开始生成剧本，也可以针对当前场次规划镜头。')
const sending = ref(false)
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
const filteredShots = computed(() => selectedScene.value?.shots.filter(s => `${s.title}${s.description}`.includes(query.value)) ?? [])
const totalDuration = computed(() => scenes.value.flatMap(s => s.shots).reduce((sum, shot) => sum + shot.duration, 0))
const totalShots = computed(() => scenes.value.reduce((sum, scene) => sum + scene.shots.length, 0))
const completedJobs = computed(() => jobs.value.filter(job => job.status === 'done').length)

function selectScene(id: string) {
  selectedSceneId.value = id
  selectedShotId.value = scenes.value.find(s => s.id === id)?.shots[0]?.id ?? ''
}

function addScene() {
  const index = scenes.value.length + 1
  const id = `S${String(index).padStart(3, '0')}`
  project.value.scenes.push({ id, title: '新场次', location: '待设定', time: '待设定', synopsis: '描述本场次的戏剧目标。', shots: [] })
  selectScene(id)
}

function addShot() {
  if (!selectedScene.value) return
  const index = totalShots.value + 1
  const shot: Shot = { id: `SH${String(index).padStart(3, '0')}`, title: '新镜头', description: '描述这个镜头发生了什么。', shotSize: '中景', camera: '静止', duration: 4, prompt: '', status: 'draft', model: 'flux' }
  selectedScene.value.shots.push(shot)
  selectedShotId.value = shot.id
}

async function sendPrompt() {
  if (!prompt.value.trim() || sending.value || !selectedScene.value) return
  sending.value = true
  try {
    directorReply.value = await askDirector(`项目：${project.value.title}\n当前场次：${selectedScene.value.title}\n场次概要：${selectedScene.value.synopsis}\n需求：${prompt.value}`)
  } catch (error) {
    directorReply.value = `连接导演模型失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally { sending.value = false }
}

async function generateScript() {
  if (!scriptIdea.value.trim() || sending.value) return
  sending.value = true
  try {
    directorReply.value = await askDirector(`根据以下故事梗概生成一个可拍摄的短剧方案。输出：1.故事核心；2.人物设定；3.场次列表；4.每场戏剧目标；5.建议镜头数量。故事梗概：${scriptIdea.value}`)
    activeNav.value = '剧本工坊'
  } catch (error) {
    directorReply.value = `剧本生成失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally { sending.value = false }
}

async function refreshHealth() {
  await Promise.all((Object.keys(modelCatalog) as ModelKey[]).map(async key => {
    modelHealth.value[key] = await checkModel(key).catch(() => false)
  }))
  dbOnline.value = await checkStudioApi().then(v => v.ok).catch(() => false)
}

function chooseReferences(event: Event) {
  h3References.value = Array.from((event.target as HTMLInputElement).files ?? [])
}

async function generateFirstFrame() {
  const shot = selectedShot.value
  if (!shot || !shot.prompt || generatingImage.value) return
  generationError.value = ''
  generatingImage.value = true
  try {
    if (generatedImageUrl.value.startsWith('blob:')) URL.revokeObjectURL(generatedImageUrl.value)
    generatedImageUrl.value = await generateFluxImage(shot.prompt, '1024x1024')
    shot.model = 'flux'
    shot.status = 'ready'
    jobs.value.unshift({ id: Date.now(), title: `${selectedScene.value?.id} · ${shot.title} 首帧`, model: 'flux', status: 'done', time: '已完成' })
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : '首帧生成失败'
  } finally { generatingImage.value = false }
}

async function generateSelectedShot() {
  const shot = selectedShot.value
  if (!shot || generating.value) return
  if (shot.locked || shot.status === 'approved') {
    generationError.value = '该镜头已批准或素材已锁定，不能覆盖。'
    return
  }
  generationError.value = ''
  generatedVideoUrl.value = ''
  const request = { prompt: shot.prompt, duration: shot.duration, aspectRatio: h3Ratio.value, generateSound: h3Sound.value, mode: h3Mode.value, references: h3References.value }
  const errors = validateH3Request(request)
  if (errors.length) { generationError.value = errors.join('；'); return }
  generating.value = true
  shot.status = 'generating'
  const localJob: Job = { id: Date.now(), title: `${selectedScene.value?.id} · ${shot.title}`, model: 'minimax', status: 'running', time: resolveH3Task(h3References.value, h3Mode.value).toUpperCase() }
  jobs.value.unshift(localJob)
  try {
    let remote = await submitH3Video(request)
    localJob.remoteId = remote.id
    while (remote.status === 'queued' || remote.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 2500))
      remote = await getH3VideoJob(remote.id)
    }
    if (remote.status === 'failed') throw new Error(remote.error?.message || '生成任务失败')
    localJob.status = 'done'
    localJob.time = '已完成'
    shot.status = 'ready'
    generatedVideoUrl.value = h3VideoContentUrl(remote.id)
    shot.outputUrl = generatedVideoUrl.value
  } catch (error) {
    localJob.status = 'failed'
    localJob.time = '失败'
    shot.status = 'draft'
    generationError.value = error instanceof Error ? error.message : '生成失败'
  } finally { generating.value = false }
}

async function persistNow() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  try {
    await saveProject(project.value, jobs.value)
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
  }
}

function scheduleSave() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 700)
}

watch([project, jobs], scheduleSave, { deep: true })

onMounted(async () => {
  await Promise.all([refreshHealth(), loadCapabilities().then(v => { capabilities.value = v }).catch(() => {})])
  try {
    const data = await loadProject('EP001')
    project.value = { id: data.id, title: data.title, episode: data.episode, status: data.status, scenes: data.scenes, createdAt: data.createdAt, updatedAt: data.updatedAt }
    jobs.value = data.jobs || []
  } catch {
    project.value.scenes = [
      { id: 'S001', title: '雨夜重逢', location: '旧城 · 巷口', time: '夜 / 外', synopsis: '林夏在雨里认出了失踪三年的顾川，两人隔街相望。', shots: [] }
    ]
  }
  selectedSceneId.value = project.value.scenes[0]?.id || ''
  selectedShotId.value = project.value.scenes[0]?.shots[0]?.id || ''
  hydrated.value = true
  saveState.value = 'saved'
})
</script>

<template>
  <div class="studio-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark"><Clapperboard :size="19" /></div><span>片场</span><b>DRAMA STUDIO</b></div>
      <div class="project-switch"><span class="project-dot"></span><div><small>当前项目</small><strong>{{ project.episode }} · {{ project.title }}</strong></div><ChevronDown :size="15" /></div>
      <div class="top-actions">
        <span class="save-state"><Database :size="14" /> {{ dbOnline ? 'SQLite 在线' : dbOnline === false ? 'SQLite 离线' : '检测中' }}</span>
        <button class="save-state" @click="persistNow"><Save :size="14" /> {{ saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : '已保存' }}</button>
        <button class="icon-button" aria-label="设置"><Settings2 :size="18" /></button><div class="avatar">导</div>
      </div>
    </header>

    <aside class="sidebar">
      <nav>
        <button v-for="item in ['项目概览','剧本工坊','场次结构','镜头板','素材库']" :key="item" :class="{active: activeNav === item}" @click="activeNav = item">
          <component :is="item === '项目概览' ? LayoutGrid : item === '剧本工坊' ? MessageSquareText : item === '场次结构' ? Film : item === '镜头板' ? Aperture : Image" :size="17" />{{ item }}
        </button>
      </nav>
      <div class="sidebar-section"><p>场次 <span>{{ scenes.length }}</span></p>
        <button v-for="scene in scenes" :key="scene.id" class="scene-link" :class="{active: selectedSceneId === scene.id}" @click="selectScene(scene.id); activeNav='镜头板'">
          <span>{{ scene.id }}</span><div><strong>{{ scene.title }}</strong><small>{{ scene.shots.length }} 镜头 · {{ scene.location }}</small></div>
        </button>
        <button class="new-scene" @click="addScene"><Plus :size="15" /> 添加场次</button>
      </div>
      <div class="model-stack"><div class="stack-title"><span>模型机组</span><button @click="refreshHealth" aria-label="刷新模型"><RefreshCw :size="13" /></button></div>
        <div v-for="(model, key) in modelCatalog" :key="key" class="model-row"><span class="health" :class="modelHealth[key] === true ? 'online' : modelHealth[key] === false ? 'offline' : 'checking'"></span><div><strong>{{ model.name }}</strong><small>{{ model.role }}</small></div></div>
      </div>
    </aside>

    <main>
      <section v-if="activeNav === '项目概览'" class="workspace-page">
        <section class="scene-head"><div><div class="eyebrow"><span>{{ project.episode }}</span>AI CONTENT PRODUCTION</div><h1>{{ project.title }}</h1><p>DeepSeek 负责导演与结构化规划，FLUX 负责视觉资产与首帧，MiniMax-H3 负责动态音视频生成，SQLite 保存项目生产状态。</p></div></section>
        <div class="overview-stats"><div><small>场次</small><b>{{ scenes.length }}</b></div><div><small>镜头</small><b>{{ totalShots }}</b></div><div><small>总时长</small><b>{{ totalDuration.toFixed(1) }}s</b></div><div><small>已完成任务</small><b>{{ completedJobs }}</b></div></div>
        <section class="capability-matrix"><div class="matrix-head"><div><h2>制作能力矩阵</h2><p>能力来自当前三模型组合；成熟度表示当前产品化程度，而不是模型绝对上限。</p></div></div>
          <div class="capability-table"><div class="cap-row cap-header"><span>场景能力</span><span>执行模型</span><span>当前成熟度</span></div>
            <div v-for="item in capabilities" :key="item.capability" class="cap-row"><strong>{{ item.capability }}</strong><span>{{ item.provider }}</span><span class="stars">{{ '★'.repeat(item.maturity) }}{{ '☆'.repeat(5-item.maturity) }}</span></div>
          </div>
        </section>
      </section>

      <section v-else-if="activeNav === '剧本工坊'" class="workspace-page">
        <section class="scene-head"><div><div class="eyebrow"><span>WRITER</span>DeepSeek-7B</div><h1>小说 / 故事 → 剧本</h1><p>先产出结构化剧本与场次，再进入镜头拆解，避免直接从长文本跳到视频生成。</p></div></section>
        <section class="script-workbench"><label>故事梗概<textarea v-model="scriptIdea" rows="8"></textarea></label><button class="primary" :disabled="sending" @click="generateScript"><RefreshCw v-if="sending" class="spin" :size="16" /><Sparkles v-else :size="16" /> 生成剧本方案</button><div class="script-result"><strong>导演输出</strong><pre>{{ directorReply }}</pre></div></section>
      </section>

      <section v-else-if="activeNav === '场次结构'" class="workspace-page">
        <section class="scene-head"><div><div class="eyebrow"><span>STRUCTURE</span>{{ project.episode }}</div><h1>场次结构</h1><p>每个场次保存地点、时间、戏剧目标与镜头集合，全部落库 SQLite。</p></div><button class="primary" @click="addScene"><Plus :size="16" /> 添加场次</button></section>
        <div class="scene-structure"><article v-for="scene in scenes" :key="scene.id" @click="selectScene(scene.id); activeNav='镜头板'"><span>{{ scene.id }}</span><div><h3>{{ scene.title }}</h3><p>{{ scene.time }} · {{ scene.location }}</p><small>{{ scene.synopsis }}</small></div><b>{{ scene.shots.length }} 镜头</b></article></div>
      </section>

      <template v-else-if="activeNav === '镜头板' && selectedScene">
        <section class="scene-head"><div><div class="eyebrow"><span>{{ selectedScene.id }}</span>{{ selectedScene.time }} · {{ selectedScene.location }}</div><h1>{{ selectedScene.title }}</h1><p>{{ selectedScene.synopsis }}</p></div><div class="head-stats"><div><small>镜头</small><b>{{ selectedScene.shots.length }}</b></div><div><small>总时长</small><b>{{ totalDuration.toFixed(1) }}s</b></div><button class="primary" @click="addShot"><Plus :size="16" /> 新建镜头</button></div></section>
        <section class="toolbar"><div class="search"><Search :size="16" /><input v-model="query" placeholder="搜索镜头、描述…" /></div><button><Activity :size="15" /> 状态 <ChevronDown :size="14" /></button></section>
        <section class="shot-grid"><article v-for="(shot, index) in filteredShots" :key="shot.id" class="shot-card" :class="{selected: selectedShotId === shot.id}" @click="selectedShotId = shot.id">
          <div class="frame" :class="shot.image"><span class="shot-number">{{ String(index + 1).padStart(2, '0') }}</span><span v-if="shot.locked" class="lock"><Lock :size="12" /></span><button class="play"><CirclePlay :size="31" /></button><div class="frame-meta"><span>{{ shot.shotSize }}</span><span>{{ shot.duration }}s</span></div></div>
          <div class="card-body"><div class="card-title"><div><small>{{ shot.id }}</small><h3>{{ shot.title }}</h3></div><button><MoreHorizontal :size="18" /></button></div><p>{{ shot.description }}</p><div class="card-foot"><span class="model-chip" :class="shot.model">{{ modelCatalog[shot.model].name }}</span><span class="status" :class="shot.status">{{ shot.status }}</span></div></div>
        </article><button class="add-card" @click="addShot"><span><Plus :size="21" /></span><strong>添加镜头</strong><small>继续铺开这一场</small></button></section>
      </template>

      <section v-else class="placeholder"><WandSparkles :size="34" /><h2>{{ activeNav }}</h2><p>素材库将在下一阶段接入角色、场景、道具、首帧和成片资产索引。</p><button class="primary" @click="activeNav = '项目概览'">返回项目概览</button></section>
    </main>

    <aside class="director-panel">
      <div class="panel-head"><div><span class="agent-icon"><Bot :size="18" /></span><div><strong>导演 Agent</strong><small><i></i> DeepSeek {{ modelHealth.deepseek ? '在线' : '离线' }}</small></div></div><button><MoreHorizontal :size="18" /></button></div>
      <div class="agent-context"><Sparkles :size="15" /><span>当前上下文</span><strong>{{ selectedScene?.id || project.episode }} · {{ selectedScene?.title || project.title }}</strong></div>
      <div class="conversation"><div class="agent-message"><div class="mini-avatar">导</div><div><p>{{ directorReply }}</p><div class="suggestions"><button @click="prompt='为当前场次生成 3 个反应镜头，并给出景别、运镜、时长和英文生成提示词。'">规划反应镜头</button><button @click="prompt='检查当前场次的人物连续性、空间连续性和情绪节奏。'">连续性检查</button></div></div></div></div>
      <form class="composer" @submit.prevent="sendPrompt"><textarea v-model="prompt" rows="3" placeholder="告诉导演你想怎么改…"></textarea><div><span>DeepSeek Director</span><button :disabled="sending"><RefreshCw v-if="sending" class="spin" :size="16" /><Send v-else :size="16" /></button></div></form>
      <div class="queue"><div class="queue-head"><strong>生成队列</strong><span>{{ jobs.filter(j => j.status === 'running').length }} 进行中</span></div><div v-for="job in jobs.slice(0,6)" :key="job.id" class="job"><span class="job-state" :class="job.status"><Check v-if="job.status === 'done'" :size="12" /><span v-else></span></span><div><strong>{{ job.title }}</strong><small>{{ modelCatalog[job.model].name }} · {{ job.time }}</small></div></div></div>
      <div v-if="selectedShot" class="inspector"><div class="queue-head"><strong>镜头参数</strong><span>{{ selectedShot.id }}</span></div><label>生成提示词<textarea v-model="selectedShot.prompt" rows="4"></textarea></label><div class="inspector-row"><label>景别<input v-model="selectedShot.shotSize" /></label><label>时长<input v-model.number="selectedShot.duration" type="number" min="4" max="15" step="1" /></label></div>
        <button class="generate-button" :disabled="generatingImage || !selectedShot.prompt" @click="generateFirstFrame"><RefreshCw v-if="generatingImage" class="spin" :size="15" /><Image v-else :size="16" />{{ generatingImage ? 'FLUX 生成中…' : '生成视频首帧' }}</button>
        <a v-if="generatedImageUrl" class="result-link" :href="generatedImageUrl" target="_blank">打开 FLUX 首帧</a>
        <div class="h3-controls"><div class="inspector-row"><label>H3 模式<select v-model="h3Mode"><option value="auto">自动路由</option><option value="t2va">T2VA</option><option value="fl2va">FL2VA</option><option value="ref2va">Ref2VA</option></select></label><label>画幅<select v-model="h3Ratio"><option v-for="ratio in ['21:9','16:9','4:3','1:1','3:4','9:16']" :key="ratio">{{ ratio }}</option></select></label></div><label class="reference-picker">参考素材<input type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/wav,audio/mpeg" @change="chooseReferences" /><span>{{ h3References.length ? `已选择 ${h3References.length} 个文件 · ${resolveH3Task(h3References, h3Mode).toUpperCase()}` : '选择图片 / 视频 / 音频' }}</span></label><label class="sound-toggle"><input v-model="h3Sound" type="checkbox" /> 生成原生对白与环境声</label><button class="generate-button" :disabled="generating || selectedShot.locked || selectedShot.status === 'approved'" @click="generateSelectedShot"><RefreshCw v-if="generating" class="spin" :size="15" /><CirclePlay v-else :size="16" />{{ generating ? 'H3 生成中…' : '生成当前视频镜头' }}</button><p v-if="generationError" class="generation-error">{{ generationError }}</p><a v-if="generatedVideoUrl" class="result-link" :href="generatedVideoUrl" target="_blank">打开生成视频</a></div>
      </div>
    </aside>
  </div>
</template>
