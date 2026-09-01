import type { Asset, AssetType, Capability, Job, ProjectSummary, StudioProject } from '../types'

const api = '/studio-api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Studio API ${response.status}`)
  return data as T
}

export function listProjects() {
  return request<ProjectSummary[]>('/api/projects')
}

export function createProject(title: string) {
  return request<StudioProject>('/api/projects', { method: 'POST', body: JSON.stringify({ title }) })
}

export function loadProject(id: string) {
  return request<StudioProject & { jobs: Job[] }>(`/api/projects/${encodeURIComponent(id)}`)
}

export function saveProject(project: StudioProject, jobs: Job[]) {
  return request<StudioProject & { jobs: Job[] }>(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT', body: JSON.stringify({ project, jobs })
  })
}

export function deleteProject(id: string) {
  return request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function loadCapabilities() {
  return request<Capability[]>('/api/capabilities')
}

export function listAssets(projectId: string, type?: AssetType) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : ''
  return request<Asset[]>(`/api/projects/${encodeURIComponent(projectId)}/assets${qs}`)
}

export function createAsset(projectId: string, asset: Omit<Asset, 'id' | 'projectId' | 'createdAt'>) {
  return request<Asset>(`/api/projects/${encodeURIComponent(projectId)}/assets`, {
    method: 'POST', body: JSON.stringify(asset)
  })
}

export async function uploadAssetBlob(projectId: string, blob: Blob, type: AssetType, name: string, sourceShotId?: string) {
  const params = new URLSearchParams({ type, name })
  if (sourceShotId) params.set('sourceShotId', sourceShotId)
  const response = await fetch(`${api}/api/projects/${encodeURIComponent(projectId)}/assets/file?${params}`, {
    method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Asset upload ${response.status}`)
  return data as Asset
}

export function deleteAsset(projectId: string, assetId: number) {
  return request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/assets/${assetId}`, { method: 'DELETE' })
}

export function retryJob(projectId: string, jobId: number) {
  return request<Job>(`/api/projects/${encodeURIComponent(projectId)}/jobs/${jobId}/retry`, { method: 'POST' })
}

export async function checkStudioApi() {
  return request<{ ok: boolean; db: string }>('/health')
}
