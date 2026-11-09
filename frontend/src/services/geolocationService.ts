export type GeoPoint = {
  lat: number
  lng: number
}

export type GeolocationErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED'

const ERROR_MESSAGES: Record<GeolocationErrorCode, string> = {
  PERMISSION_DENIED:
    'Location access was denied. Allow location for this site in your browser settings so UniTrack can mark your attendance.',
  POSITION_UNAVAILABLE:
    'Your location is unavailable right now. Check that GPS or location services are turned on.',
  TIMEOUT: 'Getting your location took too long. We will try again shortly.',
  UNSUPPORTED: 'This browser does not support geolocation.',
}

export class GeolocationError extends Error {
  code: GeolocationErrorCode

  constructor(code: GeolocationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'GeolocationError'
    this.code = code
  }
}

export type GetPositionOptions = {
  /** Max time to wait for a fix, in milliseconds. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

function toGeolocationError(error: GeolocationPositionError): GeolocationError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return new GeolocationError('PERMISSION_DENIED')
    case error.TIMEOUT:
      return new GeolocationError('TIMEOUT')
    default:
      return new GeolocationError('POSITION_UNAVAILABLE')
  }
}

/**
 * Reads the device position once. The first call is what makes the browser
 * show its location permission prompt (HTML5 has no separate "request
 * permission" API). Rejects with a `GeolocationError` for the three failure
 * modes: permission denied, timeout and position unavailable.
 */
export function getCurrentPosition({
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GetPositionOptions = {}): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeolocationError('UNSUPPORTED'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(toGeolocationError(error)),
      // maximumAge 0: a heartbeat must use a fresh fix, never a cached one.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

export type PermissionResult =
  | { granted: true; position: GeoPoint }
  | { granted: false; error: GeolocationError }

/**
 * Asks for location permission (by reading the position once) and reports the
 * outcome instead of throwing, which suits a one-off "enable location" step.
 */
export async function requestGeolocationPermission(
  options?: GetPositionOptions,
): Promise<PermissionResult> {
  try {
    return { granted: true, position: await getCurrentPosition(options) }
  } catch (error) {
    return {
      granted: false,
      error:
        error instanceof GeolocationError
          ? error
          : new GeolocationError('POSITION_UNAVAILABLE'),
    }
  }
}
