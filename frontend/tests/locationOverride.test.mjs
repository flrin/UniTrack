import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createTestViteServer,
  installWindowStorage,
  recordedMapCalls,
} from './helpers/testServer.mjs'

let server
let locationOverride
let heartbeatService
let LocationOverridePanel
let MapView

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('location override helpers, heartbeat superseding, and UI rendering', () => {
  before(async () => {
    installWindowStorage()
    server = await createTestViteServer()
    locationOverride = await server.ssrLoadModule('/src/utils/locationOverride.ts')
    heartbeatService = await server.ssrLoadModule('/src/services/heartbeatService.ts')
    LocationOverridePanel = (
      await server.ssrLoadModule('/src/components/LocationOverridePanel.tsx')
    ).default
    MapView = (await server.ssrLoadModule('/src/components/MapView.tsx')).default
  })

  beforeEach(() => {
    recordedMapCalls.reset()
  })

  after(async () => {
    await server.close()
  })

  it('computes distances and merges schedule buildings without duplicating known presets', () => {
    const fsega = { lat: 46.7732, lng: 23.6236 }
    const centrala = { lat: 46.7679, lng: 23.5898 }

    assert.equal(locationOverride.calculateDistanceMeters(fsega, fsega), 0)
    const dist = locationOverride.calculateDistanceMeters(fsega, centrala)
    assert.ok(dist > 2500 && dist < 2800, `Unexpected distance: ${dist}`)

    const presets = locationOverride.buildBuildingPresets([
      {
        class_id: 'cls-1',
        subject: 'Cloud Computing',
        time: '10:00 AM - 12:00 PM',
        building_name: 'Cladirea FSEGA, etaj 4 (str. Teodor Mihali, nr. 58-60)',
        target_lat: 46.7732,
        target_lng: 23.6236,
        start_time: '2026-11-10T08:00:00Z',
        end_time: '2026-11-10T10:00:00Z',
        status: 'Pending',
      },
      {
        class_id: 'cls-2',
        subject: 'AI Lab',
        time: '12:00 PM - 2:00 PM',
        building_name: 'Cladirea FSEGA, etaj 3 (str. Teodor Mihali, nr. 58-60)',
        target_lat: 46.7732,
        target_lng: 23.6236,
        start_time: '2026-11-10T10:00:00Z',
        end_time: '2026-11-10T12:00:00Z',
        status: 'Pending',
      },
      {
        class_id: 'cls-3',
        subject: 'Special Seminar',
        time: '2:00 PM - 4:00 PM',
        building_name: 'Custom Research Hub',
        target_lat: 46.7701,
        target_lng: 23.5951,
        start_time: '2026-11-10T12:00:00Z',
        end_time: '2026-11-10T14:00:00Z',
        status: 'Pending',
      },
    ])

    // Should keep one entry for FSEGA (fromSchedule), one for Custom Research Hub, plus remaining presets.
    const fsegaEntries = presets.filter((p) => p.id === 'fsega')
    assert.equal(fsegaEntries.length, 1)
    assert.equal(fsegaEntries[0].fromSchedule, true)
    assert.equal(presets[0].id, 'fsega')
    assert.equal(presets[1].name, 'Custom Research Hub')
    assert.equal(presets[1].fromSchedule, true)
  })

  it('generates random Cluj coordinates within bounds and outside avoided buildings', () => {
    const avoid = locationOverride.CAMPUS_BUILDING_PRESETS.map((p) => ({
      lat: p.lat,
      lng: p.lng,
    }))

    for (let i = 0; i < 15; i += 1) {
      const point = locationOverride.generateRandomClujLocation(avoid, 200)
      assert.ok(
        point.lat >= locationOverride.CLUJ_BOUNDS.minLat &&
          point.lat <= locationOverride.CLUJ_BOUNDS.maxLat,
      )
      assert.ok(
        point.lng >= locationOverride.CLUJ_BOUNDS.minLng &&
          point.lng <= locationOverride.CLUJ_BOUNDS.maxLng,
      )
      for (const target of avoid) {
        assert.ok(
          locationOverride.calculateDistanceMeters(point, target) >= 200,
          'Random Cluj point should stay outside 200m of avoided campus buildings',
        )
      }
    }
  })

  it('triggerHeartbeat supersedes pending GPS requests and sends overridden coords immediately', async () => {
    let activeOverride = null
    let rejectPendingGps
    const sentPayloads = []
    const statuses = {}
    const errors = []

    const manager = heartbeatService.createHeartbeatManager({
      now: () => Date.parse('2026-11-10T10:30:00Z'),
      getPosition: () => {
        if (activeOverride) return Promise.resolve(activeOverride)
        return new Promise((_resolve, reject) => {
          rejectPendingGps = reject
        })
      },
      sendCheckIn: async (payload) => {
        sentPayloads.push(payload)
        const isInside =
          locationOverride.calculateDistanceMeters(
            { lat: payload.user_lat, lng: payload.user_lng },
            { lat: 46.7732, lng: 23.6236 },
          ) <= 100
        return {
          status: isInside ? 'Present' : 'Left Early',
          distance_meters: isInside ? 0 : 2634.5,
        }
      },
      onCheckIn: (classId, response) => {
        statuses[classId] = response.status
      },
      onError: (_classId, err) => {
        errors.push(err)
      },
    })

    manager.setClasses([
      {
        class_id: 'cls-fsega',
        start_time: '2026-11-10T10:00:00Z',
        end_time: '2026-11-10T12:00:00Z',
      },
    ])

    // Initial beat waits on real GPS.
    manager.start()
    await flushMicrotasks()
    assert.equal(sentPayloads.length, 0)

    // User switches override to FSEGA -> immediate check-in succeeds as Present.
    activeOverride = { lat: 46.7732, lng: 23.6236 }
    manager.triggerHeartbeat()
    await flushMicrotasks()

    assert.equal(sentPayloads.length, 1)
    assert.deepEqual(sentPayloads[0], {
      class_id: 'cls-fsega',
      user_lat: 46.7732,
      user_lng: 23.6236,
    })
    assert.equal(statuses['cls-fsega'], 'Present')

    // Earlier real GPS fails after being superseded -> must be ignored without error.
    rejectPendingGps(new Error('Location permission denied'))
    await flushMicrotasks()
    assert.equal(errors.length, 0)

    // User switches override to random Cluj point -> immediately flips backend status to Left Early.
    activeOverride = { lat: 46.768, lng: 23.5898 }
    manager.triggerHeartbeat()
    await flushMicrotasks()

    assert.equal(sentPayloads.length, 2)
    assert.deepEqual(sentPayloads[1], {
      class_id: 'cls-fsega',
      user_lat: 46.768,
      user_lng: 23.5898,
    })
    assert.equal(statuses['cls-fsega'], 'Left Early')

    manager.stop()
  })

  it('renders LocationOverridePanel and MapView cleanly for inside and outside states', () => {
    const relevantClass = {
      class_id: 'cls-fsega',
      subject: 'Cloud Computing',
      time: '10:00 AM - 12:00 PM',
      building_name: 'Cladirea FSEGA',
      target_lat: 46.7732,
      target_lng: 23.6236,
      start_time: '2026-11-10T10:00:00Z',
      end_time: '2026-11-10T12:00:00Z',
      status: 'Present',
    }
    const presets = locationOverride.buildBuildingPresets([relevantClass])

    const gpsHtml = renderToStaticMarkup(
      React.createElement(LocationOverridePanel, {
        mode: 'gps',
        buildingPresets: presets,
        selectedBuildingId: 'fsega',
        effectiveLocation: null,
        relevantClass,
        lastCheckIn: null,
        hasActiveClass: false,
        onSelectGps: () => {},
        onSelectBuilding: () => {},
        onRandomCluj: () => {},
      }),
    )
    assert.ok(gpsHtml.includes('Real device GPS'))
    assert.ok(gpsHtml.includes('No class is currently active'))

    const insideHtml = renderToStaticMarkup(
      React.createElement(LocationOverridePanel, {
        mode: 'building',
        buildingPresets: presets,
        selectedBuildingId: 'fsega',
        effectiveLocation: { lat: 46.7732, lng: 23.6236 },
        relevantClass,
        lastCheckIn: {
          classId: 'cls-fsega',
          payload: { class_id: 'cls-fsega', user_lat: 46.7732, user_lng: 23.6236 },
          response: { status: 'Present', distance_meters: 0 },
          timestamp: Date.now(),
        },
        hasActiveClass: true,
        onSelectGps: () => {},
        onSelectBuilding: () => {},
        onRandomCluj: () => {},
      }),
    )
    assert.ok(insideHtml.includes('Override active'))
    assert.ok(insideHtml.includes('Cladirea FSEGA (current class)'))
    assert.ok(insideHtml.includes('Inside area (0 m)'))
    assert.ok(insideHtml.includes('Present (0 m)'))
    assert.ok(insideHtml.includes('Reset to device GPS'))

    const outsideHtml = renderToStaticMarkup(
      React.createElement(LocationOverridePanel, {
        mode: 'random-cluj',
        buildingPresets: presets,
        selectedBuildingId: 'fsega',
        effectiveLocation: { lat: 46.7679, lng: 23.5898 },
        relevantClass,
        lastCheckIn: {
          classId: 'cls-fsega',
          payload: { class_id: 'cls-fsega', user_lat: 46.7679, user_lng: 23.5898 },
          response: { status: 'Left Early', distance_meters: 2635 },
          timestamp: Date.now(),
        },
        hasActiveClass: true,
        onSelectGps: () => {},
        onSelectBuilding: () => {},
        onRandomCluj: () => {},
      }),
    )
    assert.ok(outsideHtml.includes('New random location'))
    assert.ok(outsideHtml.includes('Outside area'))
    assert.ok(outsideHtml.includes('Left Early'))

    const mapHtml = renderToStaticMarkup(
      React.createElement(MapView, {
        targetLat: 46.7732,
        targetLng: 23.6236,
        userLat: 46.7679,
        userLng: 23.5898,
        buildingName: 'Cladirea FSEGA',
        isOverridden: true,
      }),
    )
    assert.ok(mapHtml.includes('Overridden location'))
    assert.deepEqual(recordedMapCalls.markers[0].position, [46.7679, 23.5898])
  })
})
