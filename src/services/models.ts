import type { H3VideoJob, H3VideoRequest, ModelKey } from '../types'

export const modelCatalog = {
  deepseek: { name: 'DeepSeek-7B', id: 'deepseek', route: '/api/deepseek', role: '编剧 · 导演 · Agent' },
  flux: { name: 'FLUX.2-klein', id: 'flux2-klein', route: '/api/flux', role: '人物 · 场景 · 分镜 · 首帧' },
  minimax: { name: 'MiniMax-H3', id: 'minimax-h3', route: '/api/minimax', role: '文生视频 · 图生视频 · 音视频' }
} as const

export async function checkModel(key: ModelKey): Promise<boolean> {
  const response = await fetch(`${modelCatalog[key].route}/v1/models`)
  return response.ok
}

export async function askDirector(prompt: string): Promise<string> {
  const response = await fetch('/api/deepseek/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelCatalog.deepseek.id,
      temperature: 0.5,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: '你是影视制作系统中的总导演 Agent。请给出结构化、可执行的剧本、场次、镜头、人物、场景和下一步模型任务。用户要求 JSON 时必须只返回合法 JSON，不要 Markdown 代码块。' },
        { role: 'user', content: prompt }
      ]
    })
  })
  if (!response.ok) throw new Error(`导演模型返回 ${response.status}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '模型未返回文本。'
}

export async function generateFluxImageBlob(prompt: string, size = '1024x1024'): Promise<Blob> {
  const response = await fetch('/api/flux/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, size, seed: Math.floor(Math.random() * 2147483647), response_format: 'file' })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `FLUX 返回 ${response.status}`)
  }
  return response.blob()
}

export async function generateFluxImage(prompt: string, size = '1024x1024'): Promise<string> {
  return URL.createObjectURL(await generateFluxImageBlob(prompt, size))
}

const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

export function resolveH3Task(references: File[], requested: H3VideoRequest['mode'] = 'auto') {
  if (requested !== 'auto') return requested
  if (!references.length) return 't2va'
  const onlyImages = references.every(file => file.type.startsWith('image/'))
  return onlyImages && references.length <= 2 ? 'fl2va' : 'ref2va'
}

export function validateH3Request(request: H3VideoRequest): string[] {
  const errors: string[] = []
  const references = request.references ?? []
  const images = references.filter(file => file.type.startsWith('image/')).length
  const videos = references.filter(file => file.type.startsWith('video/')).length
  const audios = references.filter(file => file.type.startsWith('audio/')).length
  const task = resolveH3Task(references, request.mode)
  if (request.duration < 4 || request.duration > 15) errors.push('输出时长必须为 4–15 秒')
  if (!ratios.includes(request.aspectRatio)) errors.push('不支持该宽高比')
  if (task === 'fl2va' && (videos || audios || images > 2)) errors.push('FL2VA 只接受 0–2 张首尾帧图像')
  if (task === 'ref2va') {
    if (images > 9) errors.push('Ref2VA 最多 9 张图片')
    if (videos > 3) errors.push('Ref2VA 最多 3 段视频')
    if (audios > 3) errors.push('Ref2VA 最多 3 段音频')
    if (references.length > 12) errors.push('Ref2VA 混合输入最多 12 个文件')
    if (audios && !images && !videos) errors.push('Ref2VA 音频不能作为唯一输入')
    if (!images && !videos) errors.push('Ref2VA 至少需要一张图片或一段视频')
  }
  return [...new Set(errors)]
}

export async function submitH3Video(request: H3VideoRequest): Promise<H3VideoJob> {
  const errors = validateH3Request(request)
  if (errors.length) throw new Error(errors.join('；'))
  const references = request.references ?? []
  const task = resolveH3Task(references, request.mode)
  const form = new FormData()
  form.append('model', modelCatalog.minimax.id)
  form.append('prompt', request.prompt)
  form.append('seconds', String(request.duration))
  form.append('aspect_ratio', request.aspectRatio)
  form.append('short_edge', '768')
  form.append('generate_sound', String(request.generateSound))
  form.append('extra_params', JSON.stringify({ task, duration: request.duration, audio_flow_shift: 3.0 }))
  references.forEach(file => form.append('input_references', file, file.name))
  const response = await fetch('/api/minimax/v1/videos', { method: 'POST', body: form })
  const data = await response.json()
  if (!response.ok || !data.id) throw new Error(data.error?.message || data.detail || `视频服务返回 ${response.status}`)
  return data
}

export async function getH3VideoJob(id: string): Promise<H3VideoJob> {
  const response = await fetch(`/api/minimax/v1/videos/${id}`)
  const data = await response.json()
  if (!response.ok) {
    const listResponse = await fetch('/api/minimax/v1/videos')
    const list = await listResponse.json()
    const job = list.data?.find((item: H3VideoJob) => item.id === id)
    if (job) return job
    throw new Error(data.error?.message || `任务查询返回 ${response.status}`)
  }
  return data
}

export function h3VideoContentUrl(id: string) {
  return `/api/minimax/v1/videos/${id}/content`
}
