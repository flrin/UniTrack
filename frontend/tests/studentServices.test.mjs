import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createTestViteServer, installWindowStorage } from './helpers/testServer.mjs'

let server
let apiClient
let studentService
let checkInService
let storage
let originalFetch

describe('studentService, auth, and checkInService', () => {
  before(async () => {
    originalFetch = globalThis.fetch
    server = await createTestViteServer()
    apiClient = await server.ssrLoadModule('/src/services/apiClient.ts')
    studentService = await server.ssrLoadModule('/src/services/studentService.ts')
    checkInService = await server.ssrLoadModule('/src/services/checkInService.ts')
  })

  beforeEach(() => {
    storage = installWindowStorage()
  })

  after(async () => {
    globalThis.fetch = originalFetch
    await server.close()
  })

  it('rejects getStudentSchedule with MissingCredentialsError when no auth token exists', async () => {
    let fetchCalled = false
    globalThis.fetch = async () => {
      fetchCalled = true
      return new Response('[]', { status: 200 })
    }

    await assert.rejects(
      () => studentService.getStudentSchedule(),
      (err) => err instanceof apiClient.MissingCredentialsError,
    )
    assert.equal(fetchCalled, false)
  })

  it('sends Bearer authorization and maps schedule timestamps and fields', async () => {
    storage.setItem(apiClient.AUTH_TOKEN_STORAGE_KEY, '  student-uuid-123  ')

    const requests = []
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init })
      return new Response(
        JSON.stringify([
          {
            class_id: 'cls-1',
            subject: 'Interactiunea om-calculator',
            time: '10:00 AM - 12:00 PM',
            building_name: 'Univ Dimitrie Cantemir, etaj 5',
            room: 'DC508',
            class_type: 'Laborator',
            target_lat: 46.5743,
            target_lng: 23.7841,
            start_time: '2026-11-10T10:00:00Z',
            end_time: '2026-11-10T12:00:00Z',
            status: 'Pending',
          },
          {
            class_id: 'cls-2',
            subject: 'Cloud Computing',
            time: '12:00 PM - 2:00 PM',
            building_name: 'Cladirea FSEGA',
            room: '   ',
            class_type: '  ',
            target_lat: 46.7732,
            target_lng: 23.6236,
            start_time: '2026-11-10T12:00:00Z',
            end_time: '2026-11-10T14:00:00Z',
            status: 'Pending',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const items = await studentService.getStudentSchedule()
    assert.equal(requests.length, 1)
    const expectedDate = studentService.formatLocalDateParam()
    assert.equal(
      requests[0].url,
      `/api/student/schedule?date=${expectedDate}&days=7`,
    )
    assert.equal(requests[0].init.method, 'GET')
    assert.equal(requests[0].init.headers.Authorization, 'Bearer student-uuid-123')

    assert.equal(items.length, 2)
    assert.deepEqual(items[0], {
      class_id: 'cls-1',
      subject: 'Interactiunea om-calculator',
      time: '10:00 AM - 12:00 PM',
      building_name: 'Univ Dimitrie Cantemir, etaj 5',
      room: 'DC508',
      class_type: 'Laborator',
      target_lat: 46.5743,
      target_lng: 23.7841,
      start_time: '2026-11-10T10:00:00Z',
      end_time: '2026-11-10T12:00:00Z',
      status: 'Pending',
    })
    assert.equal(items[1].room, null)
    assert.equal(items[1].class_type, null)
  })

  it('surfaces backend error details on unsuccessful schedule responses', async () => {
    storage.setItem(apiClient.AUTH_TOKEN_STORAGE_KEY, 'missing-user')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "User 'missing-user' not found" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })

    await assert.rejects(
      () => studentService.getStudentSchedule(),
      (err) =>
        err instanceof Error &&
        err.message.includes('404') &&
        err.message.includes("User 'missing-user' not found"),
    )
  })

  it('rejects malformed schedule payloads and unparseable timestamps explicitly', async () => {
    storage.setItem(apiClient.AUTH_TOKEN_STORAGE_KEY, 'student-uuid-123')

    // Non-array payload
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    await assert.rejects(
      () => studentService.getStudentSchedule(),
      /expected a list of classes/i,
    )

    // Invalid start_time timestamp
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            class_id: 'cls-1',
            subject: 'AI',
            time: '10:00 AM - 12:00 PM',
            building_name: 'FSEGA',
            target_lat: 46.7732,
            target_lng: 23.6236,
            start_time: 'not-a-timestamp',
            end_time: '2026-11-10T12:00:00Z',
            status: 'Pending',
          },
        ]),
        { status: 200 },
      )
    await assert.rejects(
      () => studentService.getStudentSchedule(),
      /Malformed schedule item/i,
    )
  })

  it('persists auth token and config only after PUT /api/student/config succeeds', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'User not found' }), { status: 404 })

    await assert.rejects(
      () =>
        studentService.saveStudentConfig(
          '/api/student/config',
          { group: '933/1', optionals: ['Cloud Computing'] },
          'bad-id',
        ),
      /User not found/,
    )
    assert.equal(storage.getItem(apiClient.AUTH_TOKEN_STORAGE_KEY), null)
    assert.equal(storage.getItem(studentService.CONFIG_STORAGE_KEY), null)

    const requests = []
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ message: 'Configuration saved' }), {
        status: 200,
      })
    }

    const res = await studentService.saveStudentConfig(
      '/api/student/config',
      { group: '933/1', optionals: ['Cloud Computing'] },
      'student-1',
    )
    assert.equal(res.message, 'Configuration saved')
    assert.equal(requests[0].url, '/api/student/config')
    assert.equal(requests[0].init.method, 'PUT')
    assert.equal(requests[0].init.headers.Authorization, 'Bearer student-1')
    assert.equal(storage.getItem(apiClient.AUTH_TOKEN_STORAGE_KEY), 'student-1')
    assert.deepEqual(studentService.getSavedStudentConfig(), {
      group: '933/1',
      optionals: ['Cloud Computing'],
    })

    studentService.clearStudentConfig()
    assert.equal(storage.getItem(apiClient.AUTH_TOKEN_STORAGE_KEY), null)
    assert.equal(storage.getItem(studentService.CONFIG_STORAGE_KEY), null)
  })

  it('fetches and validates optional courses from GET /api/student/optionals', async () => {
    const requests = []
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init })
      return new Response(
        JSON.stringify(['Criptografie cu cheie publica', 'Roboti inteligenti']),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const courses = await studentService.getOptionalCourses({ group: '933' })
    assert.equal(requests[0].url, '/api/student/optionals?group=933')
    assert.equal(requests[0].init.method, 'GET')
    assert.deepEqual(courses, ['Criptografie cu cheie publica', 'Roboti inteligenti'])

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ wrong: true }), { status: 200 })
    await assert.rejects(
      () => studentService.getOptionalCourses(),
      /expected a list of course names/i,
    )

    assert.equal(studentService.isValidBaseGroup('933'), true)
    assert.equal(studentService.isValidBaseGroup('1021'), true)
    assert.equal(studentService.isValidBaseGroup('1631'), true)
    assert.equal(studentService.isValidBaseGroup(''), false)
    assert.equal(studentService.isValidBaseGroup('93'), false)
    assert.equal(studentService.isValidBaseGroup('102'), false)
    assert.equal(studentService.isValidBaseGroup('999'), false)
    assert.equal(studentService.isValidBaseGroup('1231'), false)
  })

  it('sends real POST /api/student/checkin by default and treats non-2xx as errors', async () => {
    // Missing credentials fails immediately without mock fallback
    await assert.rejects(
      () =>
        checkInService.sendCheckIn({
          class_id: 'cls-1',
          user_lat: 46.5743,
          user_lng: 23.7841,
        }),
      (err) => err instanceof apiClient.MissingCredentialsError,
    )

    storage.setItem(apiClient.AUTH_TOKEN_STORAGE_KEY, 'student-uuid-123')

    // HTTP 200 with Left Early returns attendance state cleanly
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/student/checkin')
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.Authorization, 'Bearer student-uuid-123')
      return new Response(
        JSON.stringify({ status: 'Left Early', distance_meters: 245.5 }),
        { status: 200 },
      )
    }

    const leftEarly = await checkInService.sendCheckIn({
      class_id: 'cls-1',
      user_lat: 46.77,
      user_lng: 23.62,
    })
    assert.deepEqual(leftEarly, { status: 'Left Early', distance_meters: 245.5 })

    // HTTP 401/500 must reject, not turn into an attendance status
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Missing or invalid Authorization header' }), {
        status: 401,
      })

    await assert.rejects(
      () =>
        checkInService.sendCheckIn({
          class_id: 'cls-1',
          user_lat: 46.5743,
          user_lng: 23.7841,
        }),
      (err) =>
        err instanceof Error &&
        err.message.includes('401') &&
        err.message.includes('Missing or invalid Authorization header'),
    )
  })
})
