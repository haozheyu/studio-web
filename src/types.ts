export type ModelKey = 'deepseek' | 'flux' | 'minimax'
export type JobStatus = 'waiting' | 'running' | 'done' | 'failed'

export interface Shot {
  id: string
  title: string
  description: string
  shotSize: string
  camera: string
  duration: number
  prompt: string
  status: 'draft' | 'ready' | 'generating' | 'approved'
  locked?: boolean
  model: ModelKey
  image?: string
}

export interface Scene {
  id: string
  title: string
  location: string
  time: string
  synopsis: string
  shots: Shot[]
}

export interface Job {
  id: number
  title: string
  model: ModelKey
  status: JobStatus
  time: string
}

export type H3Mode = 'auto' | 't2va' | 'fl2va' | 'ref2va'

export interface H3VideoRequest {
  prompt: string
  duration: number
  aspectRatio: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  generateSound: boolean
  mode?: H3Mode
  references?: File[]
}

export interface H3VideoJob {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number
  error?: { message?: string } | null
}
