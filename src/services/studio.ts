import type { Capability, Job, StudioProject } from '../types'

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

export function loadProject(id = 'EP001') {
  return request<StudioProject & { jobs: Job[] }>(`/api/projects/${encodeURIComponent(id)}`)
}

export function saveProject(project: StudioProject, jobs: Job[]) {
  return request<StudioProject & { jobs: Job[] }>(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ project, jobs })
  })
}

export function loadCapabilities() {
  return request<Capability[]>('/api/capabilities')
}

export async function checkStudioApi() {
  return request<{ ok: boolean; db: string }>('/health')
}
