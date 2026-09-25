import { rooms } from './world.js'

export const TRAM_LINE_NAME = 'NCART NIGHT LINE'
export const TRAM_FARE_PER_STOP = 18
export const TRAM_MS_PER_STOP = 12000
export const TRAM_ENCOUNTER_CHANCE = 0.32

export const TRAM_STATIONS = [
  { id: 'watson', name: 'Watson Central', roomId: 'watson-transit-concourse' },
  { id: 'westbrook', name: 'Japantown Exchange', roomId: 'japantown' },
  { id: 'citycenter', name: 'Corporate Plaza', roomId: 'citycenter-streets' },
  { id: 'heywood', name: 'The Glen Terminal', roomId: 'the-glen' },
  { id: 'santo', name: 'Santo Domingo Works', roomId: 'santo-streets' },
  { id: 'badlands', name: 'Badlands Gateway', roomId: 'badlands-crossroads' },
  { id: 'pacifica', name: 'Pacifica Promenade', roomId: 'pacifica-streets' }
]

const stationById = new Map(TRAM_STATIONS.map(s => [s.id, s]))

export function tramStationForRoom (roomId) {
  return TRAM_STATIONS.find(s => s.roomId === roomId) ?? null
}

export function tramStationByQuery (query) {
  const q = String(query ?? '').trim().toLowerCase()
  const compact = q.replace(/[^a-z0-9]/g, '')
  if (!compact) return null
  return TRAM_STATIONS.find(s => {
    const id = s.id.toLowerCase()
    const name = s.name.toLowerCase()
    return id === compact || id.startsWith(compact) || name.replace(/[^a-z0-9]/g, '').includes(compact) || name === q
  }) ?? null
}

// The line is a loop, so passengers can choose the shorter direction.
export function tramRoute (fromId, toId) {
  const from = TRAM_STATIONS.findIndex(s => s.id === fromId)
  const to = TRAM_STATIONS.findIndex(s => s.id === toId)
  if (from < 0 || to < 0 || from === to) return null
  const n = TRAM_STATIONS.length
  const forwardCount = (to - from + n) % n
  const backwardCount = (from - to + n) % n
  const direction = forwardCount <= backwardCount ? 1 : -1
  const count = Math.min(forwardCount, backwardCount)
  const route = [TRAM_STATIONS[from].id]
  for (let step = 1; step <= count; step++) route.push(TRAM_STATIONS[(from + direction * step + n) % n].id)
  return { route, direction: direction > 0 ? 'clockwise' : 'counterclockwise', stops: count }
}

export function tramWorldPayload () {
  return {
    line: TRAM_LINE_NAME,
    farePerStop: TRAM_FARE_PER_STOP,
    stations: TRAM_STATIONS.map(s => {
      const room = rooms[s.roomId]
      return { ...s, district: room.district, x: room.x, y: room.y }
    })
  }
}

export function tramPosition (route, progress) {
  if (!route?.length) return null
  if (route.length === 1) {
    const room = rooms[stationById.get(route[0])?.roomId]
    return room ? { x: room.x, y: room.y } : null
  }
  const p = Math.max(0, Math.min(0.999999, progress)) * (route.length - 1)
  const index = Math.floor(p)
  const t = p - index
  const from = rooms[stationById.get(route[index])?.roomId]
  const to = rooms[stationById.get(route[index + 1])?.roomId]
  if (!from || !to) return null
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}
