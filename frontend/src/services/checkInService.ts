import type { CheckInPayload, CheckInResponse } from '../types/student'

const CHECKIN_ENDPOINT = '/api/student/checkin'

// TODO: replace with the real auth token once login exists. The backend
// currently treats the raw Bearer token as the user's UUID.
const AUTH_TOKEN_STORAGE_KEY = 'unitrack.auth.token'

/**
 * The backend is not wired up yet, so check-ins are simulated by default.
 * Set `VITE_USE_MOCK_CHECKIN=false` (e.g. in `frontend/.env.local`) to send
 * real requests to `POST /api/student/checkin`.
 */
function shouldUseMockCheckIn(): boolean {
  return import.meta.env.VITE_USE_MOCK_CHECKIN !== 'false'
}

function mockCheckIn(payload: CheckInPayload): Promise<CheckInResponse> {
  console.info('[UniTrack check-in] simulated 200 OK', payload)

  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ status: 'Present', distance_meters: 0 }), 250)
  })
}

/**
 * Sends one GPS heartbeat to `POST /api/student/checkin`.
 * Resolves with the backend's `{ status, distance_meters }`; rejects if the
 * request fails or the server answers with a non-2xx status.
 */
export async function sendCheckIn(payload: CheckInPayload): Promise<CheckInResponse> {
  if (shouldUseMockCheckIn()) return mockCheckIn(payload)

  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  const response = await fetch(CHECKIN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Check-in failed with status ${response.status}`)
  }

  return (await response.json()) as CheckInResponse
}
