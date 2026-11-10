import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FRONTEND_ROOT = path.resolve(__dirname, '../..')

export function createMemoryStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

export function installWindowStorage() {
  const localStorage = createMemoryStorage()
  globalThis.window = {
    localStorage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  }
  return localStorage
}

export const recordedMapCalls = {
  centerUpdates: [],
  containers: [],
  circles: [],
  markers: [],
  reset() {
    this.centerUpdates.length = 0
    this.containers.length = 0
    this.circles.length = 0
    this.markers.length = 0
  },
}

const VIRTUAL_LEAFLET = '\0virtual:leaflet'
const VIRTUAL_REACT_LEAFLET = '\0virtual:react-leaflet'

function testStubPlugin() {
  return {
    name: 'unitrack-test-stubs',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'leaflet') return VIRTUAL_LEAFLET
      if (id === 'react-leaflet') return VIRTUAL_REACT_LEAFLET
      if (id.endsWith('.css')) return `\0virtual:css:${id}`
      return null
    },
    load(id) {
      if (id.startsWith('\0virtual:css:')) {
        return 'export default {}'
      }
      if (id === VIRTUAL_LEAFLET) {
        return `
          export default {
            divIcon(opts) { return { kind: 'divIcon', ...opts } }
          }
        `
      }
      if (id === VIRTUAL_REACT_LEAFLET) {
        return `
          import React from 'react'
          const calls = globalThis.__UNITRACK_MAP_CALLS__
          export function MapContainer({ center, zoom, children }) {
            calls?.containers.push({ center, zoom })
            return React.createElement('div', { 'data-testid': 'map-container', 'data-center': JSON.stringify(center) }, children)
          }
          export function TileLayer() { return null }
          export function Circle({ center, radius, children }) {
            calls?.circles.push({ center, radius })
            return React.createElement('div', { 'data-testid': 'map-circle', 'data-center': JSON.stringify(center), 'data-radius': radius }, children)
          }
          export function Marker({ position, children }) {
            calls?.markers.push({ position })
            return React.createElement('div', { 'data-testid': 'map-marker', 'data-position': JSON.stringify(position) }, children)
          }
          export function Popup({ children }) {
            return React.createElement('div', { 'data-testid': 'map-popup' }, children)
          }
          export function useMap() {
            return {
              setView(coords) {
                calls?.centerUpdates.push(coords)
              },
            }
          }
        `
      }
      return null
    },
  }
}

export async function createTestViteServer() {
  globalThis.__UNITRACK_MAP_CALLS__ = recordedMapCalls
  return createServer({
    root: FRONTEND_ROOT,
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    ssr: { noExternal: ['leaflet', 'react-leaflet'] },
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    plugins: [testStubPlugin()],
  })
}
