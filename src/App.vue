<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity, Aperture, Bot, Check, ChevronDown, CirclePlay, Clapperboard, Film, Image, LayoutGrid, Lock, MessageSquareText, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings2, Sparkles, WandSparkles } from '@lucide/vue'
import { askDirector, checkModel, getH3VideoJob, h3VideoContentUrl, modelCatalog, resolveH3Task, submitH3Video, validateH3Request } from './services/models'
import type { Job, ModelKey, Scene, Shot } from './types'

const scenes = ref<Scene[]>([
  { id: 'S001', title: '雨夜重逢', location: '旧城 · 巷口', time: '夜 / 外', synopsis: '林夏在雨里认出了失踪三年的顾川，两人隔街相望。', shots: [
    { id: 'SH001', title: '空镜建立', description: '霓虹在积水中晃动，雨线切过空巷。', shotSize: '大全景', camera: '缓慢推进', duration: 4, prompt: 'cinematic rainy alley at night, wet asphalt, neon reflections, slow push-in, moody teal and amber', status: 'approved', locked: true, model: 'flux', image: 'rain' },
    { id: 'SH002', title: '林夏停步', description: '林夏撑伞骤然停下，视线越过车流。', shotSize: '中景', camera: '手持跟拍', duration: 3.5, prompt: 'young Chinese woman under black umbrella suddenly stops, emotional realization, rain, cinematic medium shot', status: 'ready', model: 'flux', image: 'woman' },
    { id: 'SH003', title: '顾川回望', description: '顾川从街灯阴影中抬眼，克制地看向她。', shotSize: '近景', camera: '静止', duration: 3, prompt: 'Chinese man in dark coat looking up from shadow, restrained emotion, rain beads, close-up, film grain', status: 'draft', model: 'minimax' }
  ]},
  { id: 'S002', title: '沉默的证词', location: '旧公寓 · 客厅', time: '夜 / 内', synopsis: '一张旧照片让两人的说辞出现裂缝。', shots: [
    { id: 'SH004', title: '照片落桌', description: '泛黄照片被推到桌面中央。', shotSize: '特写', camera: '俯拍', duration: 2.5, prompt: 'old faded photo sliding across wooden table, overhead close-up, tense noir lighting', status: 'draft', model: 'flux' }
  ]},
  { id: 'S003', title: '天台抉择', location: '公寓 · 天台', time: '黎明 / 外', synopsis: '城市苏醒之前，顾川必须说出真相。', shots: [] }
])

const selectedSceneId = ref('S001')
const selectedShotId = ref('SH002')
const activeNav = ref('镜头板')
const query = ref('')
const prompt = ref('把这一场改得更克制一些，并规划下一组反应镜头。')
const directorReply = ref('我建议保留雨夜的视觉压力，把对白延后。先用三个无台词反应镜头建立“认出却不敢确认”的情绪，再进入近景。')
const sending = ref(false)
const generating = ref(false)
const h3References = ref<File[]>([])
const h3Mode = ref<'auto' | 't2va' | 'fl2va' | 'ref2va'>('auto')
const h3Ratio = ref<'21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'>('9:16')
const h3Sound = ref(true)
const generatedVideoUrl = ref('')
const generationError = ref('')
const modelHealth = ref<Record<ModelKey, boolean | null>>({ deepseek: null, flux: null, minimax: null })
const jobs = ref<Job[]>([
  { id: 1, title: 'S001 · 空镜建立', model: 'flux', status: 'done', time: '18:42' },
  { id: 2, title: 'S001 · 林夏停步', model: 'flux', status: 'running', time: '18:45' },
  { id: 3, title: 'S001 · 顾川回望', model: 'minimax', status: 'waiting', time: '等待中' }
])

const selectedScene = computed(() => scenes.value.find(s => s.id === selectedSceneId.value) ?? scenes.value[0])
const selectedShot = computed(() => selectedScene.value.shots.find(s => s.id === selectedShotId.value))
const filteredShots = computed(() => selectedScene.value.shots.filter(s => `${s.title}${s.description}`.includes(query.value)))
const totalDuration = computed(() => scenes.value.flatMap(s => s.shots).reduce((sum, shot) => sum + shot.duration, 0))

function selectScene(id: string) {
  selectedSceneId.value = id
  selectedShotId.value = scenes.value.find(s => s.id === id)?.shots[0]?.id ?? ''
}

function addShot() {
  const index = scenes.value.flatMap(s => s.shots).length + 1
  const shot: Shot = { id: `SH${String(index).padStart(3, '0')}`, title: '新镜头', description: '描述这个镜头发生了什么。', shotSize: '中景', camera: '静止', duration: 3, prompt: '', status: 'draft', model: 'flux' }
  selectedScene.value.shots.push(shot)
  selectedShotId.value = shot.id
}

async function sendPrompt() {
  if (!prompt.value.trim() || sending.value) return
  sending.value = true
  try { directorReply.value = await askDirector(`项目：雨夜重逢。当前场次：${selectedScene.value.title}。需求：${prompt.value}`) }
  catch (error) { directorReply.value = `连接导演模型失败：${error instanceof Error ? error.message : '未知错误'}。请确认本地服务和代理。` }
  finally { sending.value = false }
}

async function refreshHealth() {
  for (const key of Object.keys(modelCatalog) as ModelKey[]) {
    modelHealth.value[key] = await checkModel(key).catch(() => false)
  }
}

function chooseReferences(event: Event) {
  h3References.value = Array.from((event.target as HTMLInputElement).files ?? [])
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
  const localJob: Job = { id: Date.now(), title: `${selectedScene.value.id} · ${shot.title}`, model: 'minimax', status: 'running', time: resolveH3Task(h3References.value, h3Mode.value).toUpperCase() }
  jobs.value.unshift(localJob)
  try {
    let remote = await submitH3Video(request)
    while (remote.status === 'queued' || remote.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 2500))
      remote = await getH3VideoJob(remote.id)
    }
    if (remote.status === 'failed') throw new Error(remote.error?.message || '生成任务失败')
    localJob.status = 'done'
    localJob.time = '已完成'
    shot.status = 'ready'
    generatedVideoUrl.value = h3VideoContentUrl(remote.id)
  } catch (error) {
    localJob.status = 'failed'
    localJob.time = '失败'
    shot.status = 'draft'
    generationError.value = error instanceof Error ? error.message : '生成失败'
  } finally { generating.value = false }
}

onMounted(refreshHealth)
</script>

<template>
  <div class="studio-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark"><Clapperboard :size="19" /></div><span>片场</span><b>DRAMA STUDIO</b></div>
      <div class="project-switch"><span class="project-dot"></span><div><small>当前项目</small><strong>EP001 · 雨夜重逢</strong></div><ChevronDown :size="15" /></div>
      <div class="top-actions"><span class="save-state"><Check :size="14" /> 已保存</span><button class="icon-button" aria-label="设置"><Settings2 :size="18" /></button><div class="avatar">导</div></div>
    </header>

    <aside class="sidebar">
      <nav>
        <button v-for="item in ['项目概览','剧本工坊','场次结构','镜头板','素材库']" :key="item" :class="{active: activeNav === item}" @click="activeNav = item">
          <component :is="item === '项目概览' ? LayoutGrid : item === '剧本工坊' ? MessageSquareText : item === '场次结构' ? Film : item === '镜头板' ? Aperture : Image" :size="17" />{{ item }}
        </button>
      </nav>
      <div class="sidebar-section"><p>场次 <span>{{ scenes.length }}</span></p>
        <button v-for="scene in scenes" :key="scene.id" class="scene-link" :class="{active: selectedSceneId === scene.id}" @click="selectScene(scene.id)">
          <span>{{ scene.id }}</span><div><strong>{{ scene.title }}</strong><small>{{ scene.shots.length }} 镜头 · {{ scene.location }}</small></div>
        </button>
        <button class="new-scene"><Plus :size="15" /> 添加场次</button>
      </div>
      <div class="model-stack"><div class="stack-title"><span>模型机组</span><button @click="refreshHealth" aria-label="刷新模型"><RefreshCw :size="13" /></button></div>
        <div v-for="(model, key) in modelCatalog" :key="key" class="model-row"><span class="health" :class="modelHealth[key] === true ? 'online' : modelHealth[key] === false ? 'offline' : 'checking'"></span><div><strong>{{ model.name }}</strong><small>{{ model.role }}</small></div></div>
      </div>
    </aside>

    <main>
      <section class="scene-head">
        <div><div class="eyebrow"><span>{{ selectedScene.id }}</span>{{ selectedScene.time }} · {{ selectedScene.location }}</div><h1>{{ selectedScene.title }}</h1><p>{{ selectedScene.synopsis }}</p></div>
        <div class="head-stats"><div><small>镜头</small><b>{{ selectedScene.shots.length }}</b></div><div><small>总时长</small><b>{{ totalDuration.toFixed(1) }}s</b></div><button class="primary" @click="addShot"><Plus :size="16" /> 新建镜头</button></div>
      </section>

      <section class="toolbar"><div class="search"><Search :size="16" /><input v-model="query" placeholder="搜索镜头、描述…" /></div><button><Activity :size="15" /> 状态 <ChevronDown :size="14" /></button><div class="view-tabs"><button class="active"><LayoutGrid :size="15" /></button><button><Film :size="15" /></button></div></section>

      <section v-if="activeNav === '镜头板'" class="shot-grid">
        <article v-for="(shot, index) in filteredShots" :key="shot.id" class="shot-card" :class="{selected: selectedShotId === shot.id}" @click="selectedShotId = shot.id">
          <div class="frame" :class="shot.image"><span class="shot-number">{{ String(index + 1).padStart(2, '0') }}</span><span v-if="shot.locked" class="lock"><Lock :size="12" /></span><button class="play" aria-label="预览镜头"><CirclePlay :size="31" /></button><div class="frame-meta"><span>{{ shot.shotSize }}</span><span>{{ shot.duration }}s</span></div></div>
          <div class="card-body"><div class="card-title"><div><small>{{ shot.id }}</small><h3>{{ shot.title }}</h3></div><button aria-label="更多"><MoreHorizontal :size="18" /></button></div><p>{{ shot.description }}</p><div class="card-foot"><span class="model-chip" :class="shot.model">{{ modelCatalog[shot.model].name }}</span><span class="status" :class="shot.status">{{ shot.status === 'approved' ? '已锁定' : shot.status === 'ready' ? '待生成' : '草稿' }}</span></div></div>
        </article>
        <button class="add-card" @click="addShot"><span><Plus :size="21" /></span><strong>添加镜头</strong><small>继续铺开这一场</small></button>
      </section>
      <section v-else class="placeholder"><WandSparkles :size="34" /><h2>{{ activeNav }}</h2><p>该工作区已纳入产品导航，镜头板是当前可交互的核心流程。</p><button class="primary" @click="activeNav = '镜头板'">返回镜头板</button></section>
    </main>

    <aside class="director-panel">
      <div class="panel-head"><div><span class="agent-icon"><Bot :size="18" /></span><div><strong>导演 Agent</strong><small><i></i> DeepSeek 在线</small></div></div><button aria-label="更多"><MoreHorizontal :size="18" /></button></div>
      <div class="agent-context"><Sparkles :size="15" /><span>正在理解</span><strong>{{ selectedScene.id }} · {{ selectedScene.title }}</strong></div>
      <div class="conversation"><div class="agent-message"><div class="mini-avatar">导</div><div><p>{{ directorReply }}</p><div class="suggestions"><button @click="prompt='为当前场次生成 3 个克制的反应镜头，并给出景别、运镜和时长。'">规划反应镜头</button><button @click="prompt='检查当前场次的情绪节奏和镜头连续性。'">检查情绪节奏</button></div></div></div></div>
      <form class="composer" @submit.prevent="sendPrompt"><textarea v-model="prompt" rows="3" placeholder="告诉导演你想怎么改…"></textarea><div><span>@ 可引用场次或素材</span><button :disabled="sending" aria-label="发送"><RefreshCw v-if="sending" class="spin" :size="16" /><Send v-else :size="16" /></button></div></form>
      <div class="queue"><div class="queue-head"><strong>生成队列</strong><span>{{ jobs.filter(j => j.status === 'running').length }} 进行中</span></div>
        <div v-for="job in jobs" :key="job.id" class="job"><span class="job-state" :class="job.status"><Check v-if="job.status === 'done'" :size="12" /><span v-else></span></span><div><strong>{{ job.title }}</strong><small>{{ modelCatalog[job.model].name }} · {{ job.time }}</small></div><button><MoreHorizontal :size="16" /></button></div>
      </div>
      <div v-if="selectedShot" class="inspector"><div class="queue-head"><strong>镜头参数</strong><span>{{ selectedShot.id }}</span></div><label>生成提示词<textarea v-model="selectedShot.prompt" rows="4"></textarea></label><div class="inspector-row"><label>景别<input v-model="selectedShot.shotSize" /></label><label>时长<input v-model.number="selectedShot.duration" type="number" min="4" max="15" step="1" /></label></div>
        <div class="h3-controls"><div class="inspector-row"><label>H3 模式<select v-model="h3Mode"><option value="auto">自动路由</option><option value="t2va">T2VA</option><option value="fl2va">FL2VA</option><option value="ref2va">Ref2VA</option></select></label><label>画幅<select v-model="h3Ratio"><option v-for="ratio in ['21:9','16:9','4:3','1:1','3:4','9:16']" :key="ratio">{{ ratio }}</option></select></label></div>
          <label class="reference-picker">参考素材<input type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/wav,audio/mpeg" @change="chooseReferences" /><span>{{ h3References.length ? `已选择 ${h3References.length} 个文件 · ${resolveH3Task(h3References, h3Mode).toUpperCase()}` : '选择图片 / 视频 / 音频' }}</span></label>
          <label class="sound-toggle"><input v-model="h3Sound" type="checkbox" /> 生成原生对白与环境声</label>
          <button class="generate-button" :disabled="generating || selectedShot.locked || selectedShot.status === 'approved'" @click="generateSelectedShot"><RefreshCw v-if="generating" class="spin" :size="15" /><CirclePlay v-else :size="16" />{{ selectedShot.locked || selectedShot.status === 'approved' ? '镜头已锁定' : generating ? '生成中…' : '生成当前镜头' }}</button>
          <p v-if="generationError" class="generation-error">{{ generationError }}</p><a v-if="generatedVideoUrl" class="result-link" :href="generatedVideoUrl" target="_blank">打开生成视频</a>
        </div>
        <div class="capability-card"><strong>H3 实测能力</strong><div><span>T2VA</span><span>I2VA</span><span>FL2VA</span><span>9 图参考</span><span>3 视频</span><span>3 音频</span><span>12 文件混合</span><span>原生音频</span></div><small>4–15s · 768p 短边 · 24fps · 32kHz stereo</small></div>
      </div>
    </aside>
  </div>
</template>
