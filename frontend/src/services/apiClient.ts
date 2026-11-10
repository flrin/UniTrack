import type { AttendanceStatus } from '../types/roster'

// TODO: replace with a real JWT once login exists. FastAPI currently treats
// the raw Bearer token value as the user's UUID.
export const AUTH_TOKEN_STORAGE_KEY = 'unitrack.auth.token'

export class MissingCredentialsError extends Error {
  constructor(
    message = 'Missing student credentials. Enter your student ID token in configuration.',
  ) {
    super(message)
    this.name = 'MissingCredentialsError'
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

export function saveAuthToken(token: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = token.trim()
  if (trimmed) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, trimmed)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}

export function requireAuthToken(explicitToken?: string): string {
  const candidate = (explicitToken ?? getAuthToken() ?? '').trim()
  if (!candidate) {
    throw new MissingCredentialsError()
  }
  return candidate
}

export function buildApiUrl(path: string): string {
  const base = import.meta.env?.VITE_API_BASE_URL?.trim() ?? ''
  if (!base) return path
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export async function readErrorDetail(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown } | null
    if (body && typeof body === 'object') {
      if (typeof body.detail === 'string' && body.detail.trim()) {
        return `${fallbackMessage} (HTTP ${response.status}): ${body.detail.trim()}`
      }
      if (typeof body.message === 'string' && body.message.trim()) {
        return `${fallbackMessage} (HTTP ${response.status}): ${body.message.trim()}`
      }
    }
  } catch {
    // Ignore non-JSON error bodies and fall back to status code.
  }

  return `${fallbackMessage} (HTTP ${response.status})`
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'Pending' || value === 'Present' || value === 'Left Early'
}
