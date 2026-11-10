import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createTestViteServer,
  installWindowStorage,
  recordedMapCalls,
} from './helpers/testServer.mjs'

let server
let heartbeatService
let classTime
let ScheduleList
let MapView
let StudentConfigForm
let DashboardPage

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('heartbeat timing, GPS sharing, and map/schedule rendering', () => {
  before(async () => {
    installWindowStorage()
    server = await createTestViteServer()
    heartbeatService = await server.ssrLoadModule('/src/services/heartbeatService.ts')
    classTime = await server.ssrLoadModule('/src/utils/classTime.ts')
    ScheduleList = (await server.ssrLoadModule('/src/components/ScheduleList.tsx')).default
    MapView = (await server.ssrLoadModule('/src/components/MapView.tsx')).default
    StudentConfigForm = (await server.ssrLoadModule('/src/components/StudentConfigForm.tsx')).default
    DashboardPage = (await server.ssrLoadModule('/src/pages/DashboardPage.tsx')).default
  })

  beforeEach(() => {
    recordedMapCalls.reset()
  })

  after(async () => {
    await server.close()
  })

  it('starts/stops tracking at class boundaries and pings every 60s', async () => {
    mock.timers.enable({ apis: ['setInterval'] })
    try {
      let currentTime = Date.parse('2026-11-10T09:59:59Z')
      const checkIns = []
      const locations = []
      const trackingHistory = []

      const manager = heartbeatService.createHeartbeatManager({
        now: () => currentTime,
        heartbeatIntervalMs: 60_000,
        clockCheckIntervalMs: 1_000,
        getPosition: async () => ({ lat: 46.5743, lng: 23.7841 }),
        sendCheckIn: async (payload) => {
          checkIns.push(payload)
          return { status: 'Present', distance_meters: 5 }
        },
        onLocation: (pos) => locations.push(pos),
        onTrackingChange: (ids) => trackingHistory.push(ids),
      })

      manager.setClasses([
        {
          class_id: 'cls-active',
          start_time: '2026-11-10T10:00:00Z',
          end_time: '2026-11-10T10:03:00Z',
        },
        {
          class_id: 'cls-later',
          start_time: '2026-11-10T12:00:00Z',
          end_time: '2026-11-10T14:00:00Z',
        },
      ])

      manager.start()
      await flushMicrotasks()
      // Before 10:00:00Z nothing is tracked or checked in.
      assert.equal(checkIns.length, 0)

      // Advance clock to 10:00:00Z -> immediate initial check-in for cls-active only.
      currentTime = Date.parse('2026-11-10T10:00:00Z')
      mock.timers.tick(1_000)
      await flushMicrotasks()
      assert.equal(checkIns.length, 1)
      assert.equal(checkIns[0].class_id, 'cls-active')
      assert.deepEqual(locations, [{ lat: 46.5743, lng: 23.7841 }])

      // Advance 60s -> second heartbeat fires.
      currentTime += 60_000
      mock.timers.tick(60_000)
      await flushMicrotasks()
      assert.equal(checkIns.length, 2)

      // Advance to exact end_time (10:03:00Z, exclusive) -> tracking stops and interval clears.
      currentTime = Date.parse('2026-11-10T10:03:00Z')
      mock.timers.tick(1_000)
      await flushMicrotasks()
      assert.deepEqual(trackingHistory.at(-1), [])

      // Further 60s ticks must not fire any more check-ins.
      const countAtEnd = checkIns.length
      currentTime += 60_000
      mock.timers.tick(60_000)
      await flushMicrotasks()
      assert.equal(checkIns.length, countAtEnd)

      manager.stop()
    } finally {
      mock.timers.reset()
    }
  })

  it('updates only the matching class (including Left Early) and keeps failures as errors', async () => {
    const statuses = {}
    const errors = []
    const locations = []
    let shouldFailRequest = false

    const manager = heartbeatService.createHeartbeatManager({
      now: () => Date.parse('2026-11-10T10:30:00Z'),
      heartbeatIntervalMs: 60_000,
      clockCheckIntervalMs: 1_000,
      getPosition: async () => ({ lat: 46.77, lng: 23.62 }),
      sendCheckIn: async (payload) => {
        if (shouldFailRequest) {
          throw new Error('Check-in failed (HTTP 500)')
        }
        return { status: 'Left Early', distance_meters: 420 }
      },
      onLocation: (pos) => locations.push(pos),
      onCheckIn: (classId, resp) => {
        statuses[classId] = resp.status
      },
      onError: (classId, err) => {
        errors.push({ classId, message: err.message })
      },
    })

    const classes = [
      {
        class_id: 'cls-a',
        start_time: '2026-11-10T10:00:00Z',
        end_time: '2026-11-10T12:00:00Z',
      },
      {
        class_id: 'cls-b',
        start_time: '2026-11-10T14:00:00Z',
        end_time: '2026-11-10T16:00:00Z',
      },
    ]

    manager.setClasses(classes)
    manager.start()
    await flushMicrotasks()

    assert.deepEqual(statuses, { 'cls-a': 'Left Early' })
    assert.equal(statuses['cls-b'], undefined)
    assert.equal(errors.length, 0)
    assert.deepEqual(locations, [{ lat: 46.77, lng: 23.62 }])
    manager.stop()

    // Now verify request failure keeps status unchanged and calls onError, while GPS fix still updates.
    shouldFailRequest = true
    const statusesOnFail = {}
    const failManager = heartbeatService.createHeartbeatManager({
      now: () => Date.parse('2026-11-10T10:30:00Z'),
      getPosition: async () => ({ lat: 46.5745, lng: 23.784 }),
      sendCheckIn: async () => {
        throw new Error('Check-in failed (HTTP 401)')
      },
      onLocation: (pos) => locations.push(pos),
      onCheckIn: (classId, resp) => {
        statusesOnFail[classId] = resp.status
      },
      onError: (classId, err) => {
        errors.push({ classId, message: err.message })
      },
    })

    failManager.setClasses(classes)
    failManager.start()
    await flushMicrotasks()

    assert.deepEqual(statusesOnFail, {})
    assert.deepEqual(errors, [{ classId: 'cls-a', message: 'Check-in failed (HTTP 401)' }])
    assert.deepEqual(locations.at(-1), { lat: 46.5745, lng: 23.784 })
    failManager.stop()
  })

  it('selects the relevant class and passes target & GPS coordinates to MapView', () => {
    const dayStart = new Date()
    dayStart.setHours(9, 0, 0, 0)
    const activeStart = new Date(dayStart.getTime() + 60 * 60_000)
    const activeEnd = new Date(dayStart.getTime() + 180 * 60_000)
    const nextStart = new Date(dayStart.getTime() + 240 * 60_000)
    const nextEnd = new Date(dayStart.getTime() + 360 * 60_000)

    const items = [
      {
        class_id: 'cls-next',
        subject: 'Machine Learning',
        time: '1:00 PM - 3:00 PM',
        building_name: 'Cladirea FSEGA',
        target_lat: 46.7732,
        target_lng: 23.6236,
        start_time: nextStart.toISOString(),
        end_time: nextEnd.toISOString(),
        status: 'Pending',
      },
      {
        class_id: 'cls-active',
        subject: 'Cloud Computing',
        time: '10:00 AM - 12:00 PM',
        building_name: 'Univ Dimitrie Cantemir, etaj 5',
        target_lat: 46.5743,
        target_lng: 23.7841,
        start_time: activeStart.toISOString(),
        end_time: activeEnd.toISOString(),
        status: 'Present',
      },
    ]

    // During active window -> active class chosen
    const duringActive = classTime.getRelevantClass(items, activeStart.getTime() + 10_000)
    assert.equal(duringActive?.class_id, 'cls-active')

    // Before active window -> earliest upcoming today chosen
    const beforeActive = classTime.getRelevantClass(items, dayStart.getTime())
    assert.equal(beforeActive?.class_id, 'cls-active')

    // Between active and next -> next upcoming today chosen
    const betweenClasses = classTime.getRelevantClass(items, activeEnd.getTime() + 10_000)
    assert.equal(betweenClasses?.class_id, 'cls-next')

    assert.equal(classTime.getRelevantClass([], Date.now()), null)

    // Render MapView with relevant building coords + user GPS fix
    const mapHtml = renderToStaticMarkup(
      React.createElement(MapView, {
        targetLat: duringActive.target_lat,
        targetLng: duringActive.target_lng,
        userLat: 46.5745,
        userLng: 23.7842,
        buildingName: duringActive.building_name,
      }),
    )
    assert.ok(mapHtml.includes('[46.5743,23.7841]'))
    assert.ok(mapHtml.includes('[46.5745,23.7842]'))
    assert.deepEqual(recordedMapCalls.circles[0].center, [46.5743, 23.7841])
    assert.deepEqual(recordedMapCalls.markers[0].position, [46.5745, 23.7842])

    // Render MapView before a GPS fix arrives -> no user marker rendered
    recordedMapCalls.reset()
    renderToStaticMarkup(
      React.createElement(MapView, {
        targetLat: duringActive.target_lat,
        targetLng: duringActive.target_lng,
        buildingName: duringActive.building_name,
      }),
    )
    assert.equal(recordedMapCalls.circles.length, 1)
    assert.equal(recordedMapCalls.markers.length, 0)
  })

  it('renders Present (green) and Left Early (red) badges in ScheduleList', () => {
    const now = new Date()
    now.setHours(11, 0, 0, 0)
    const start1 = new Date(now.getTime() - 30 * 60_000).toISOString()
    const end1 = new Date(now.getTime() + 30 * 60_000).toISOString()
    const start2 = new Date(now.getTime() + 60 * 60_000).toISOString()
    const end2 = new Date(now.getTime() + 120 * 60_000).toISOString()

    // Mock Date.now briefly so useNow() matches `now`
    const realDateNow = Date.now
    Date.now = () => now.getTime()
    try {
      const htmlPresent = renderToStaticMarkup(
        React.createElement(ScheduleList, {
          items: [
            {
              class_id: 'cls-1',
              subject: 'Cloud Computing',
              time: '10:30 AM - 11:30 AM',
              building_name: 'Cantemir',
              room: 'DC508',
              class_type: 'Laborator',
              target_lat: 46.5743,
              target_lng: 23.7841,
              start_time: start1,
              end_time: end1,
              status: 'Present',
            },
            {
              class_id: 'cls-2',
              subject: 'ML',
              time: '12:00 PM - 1:00 PM',
              building_name: 'FSEGA',
              room: null,
              class_type: 'Curs',
              target_lat: 46.7732,
              target_lng: 23.6236,
              start_time: start2,
              end_time: end2,
              status: 'Pending',
            },
          ],
        }),
      )
      assert.ok(htmlPresent.includes('status-badge status-present'))
      assert.ok(htmlPresent.includes('status-badge status-pending'))
      assert.ok(htmlPresent.includes('Room DC508 · </span>Cantemir'))
      assert.ok(htmlPresent.includes('<div class="schedule-building">FSEGA</div>'))
      assert.ok(htmlPresent.includes('<span class="class-type-tag">Lab</span>'))
      assert.ok(htmlPresent.includes('<span class="class-type-tag">Lecture</span>'))

      const htmlLeftEarly = renderToStaticMarkup(
        React.createElement(ScheduleList, {
          items: [
            {
              class_id: 'cls-1',
              subject: 'Cloud Computing',
              time: '10:30 AM - 11:30 AM',
              building_name: 'Cantemir',
              class_type: null,
              target_lat: 46.5743,
              target_lng: 23.7841,
              start_time: start1,
              end_time: end1,
              status: 'Left Early',
            },
          ],
        }),
      )
      assert.ok(htmlLeftEarly.includes('status-badge status-missed'))
      assert.ok(htmlLeftEarly.includes('Left Early'))
      assert.equal(htmlLeftEarly.includes('class-type-tag'), false)
    } finally {
      Date.now = realDateNow
    }
  })

  it('renders StudentConfigForm with conditional optionals prompt and DashboardPage without fixed mock coordinates', () => {
    // Fresh login without saved group -> prompt to enter valid group, not loading optionals
    installWindowStorage()
    const freshFormHtml = renderToStaticMarkup(
      React.createElement(StudentConfigForm, { onSaved: () => {} }),
    )
    assert.ok(freshFormHtml.includes('Enter a valid group'))
    assert.equal(freshFormHtml.includes('Loading optional courses'), false)

    const storage = installWindowStorage()
    storage.setItem('unitrack.auth.token', 'student-uuid-99')
    storage.setItem(
      'unitrack.student.config',
      JSON.stringify({ group: '933/1', optionals: ['Cloud Computing'] }),
    )

    const formHtml = renderToStaticMarkup(
      React.createElement(StudentConfigForm, { onSaved: () => {} }),
    )
    assert.ok(formHtml.includes('id="student-token"'))
    assert.ok(formHtml.includes('value="student-uuid-99"'))
    assert.ok(formHtml.includes('value="933"'))
    assert.ok(formHtml.includes('maxLength="4"'))
    assert.ok(formHtml.includes('Loading optional courses'))
    assert.equal(formHtml.includes('Securitatea informatiei'), false)

    const dashboardHtml = renderToStaticMarkup(
      React.createElement(DashboardPage, {
        config: { group: '933/1', optionals: ['Cloud Computing'] },
        onEditConfig: () => {},
        onLogout: () => {},
      }),
    )
    assert.ok(dashboardHtml.includes('Loading your schedule'))
    assert.equal(dashboardHtml.includes('45.7489'), false)
    assert.equal(dashboardHtml.includes('45.7495'), false)
  })
})
