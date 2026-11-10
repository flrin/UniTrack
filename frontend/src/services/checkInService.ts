import type { CheckInPayload, CheckInResponse } from '../types/student'
import {
  buildApiUrl,
  isAttendanceStatus,
  readErrorDetail,
  requireAuthToken,
} from './apiClient'

export const CHECKIN_ENDPOINT = '/api/student/checkin'

function parseCheckInResponse(raw: unknown): CheckInResponse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Malformed check-in response from server.')
  }

  const candidate = raw as Record<string, unknown>
  if (
    !isAttendanceStatus(candidate.status) ||
    typeof candidate.distance_meters !== 'number' ||
    !Number.isFinite(candidate.distance_meters)
  ) {
    throw new Error('Malformed check-in response from server.')
  }

  return {
    status: candidate.status,
    distance_meters: candidate.distance_meters,
  }
}

/**
 * Sends one GPS heartbeat to `POST /api/student/checkin`.
 * Resolves with the backend's `{ status, distance_meters }`; rejects if
 * credentials are missing, the request fails, or the server answers with a
 * non-2xx status.
 */
export async function sendCheckIn(payload: CheckInPayload): Promise<CheckInResponse> {
  const authToken = requireAuthToken()
  const response = await fetch(buildApiUrl(CHECKIN_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readErrorDetail(response, 'Check-in failed'))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Malformed check-in response: invalid JSON.')
  }

  return parseCheckInResponse(data)
}
