import { useEffect, useState } from 'react'
import { getRoster } from '../services/teacherService'
import type { RosterStudent } from '../types/roster'

export function useRosterPolling(classId: string | null) {
  const [students, setStudents] = useState<RosterStudent[]>([])

  useEffect(() => {
    if (!classId) return

    let stopped = false
    let timer: number

    async function load() {
      try {
        const roster = await getRoster(classId!)
        if (!stopped) setStudents(roster)
      } catch (error) {
        console.error(error)
      }
      if (!stopped) timer = window.setTimeout(load, 10000)
    }

    load()

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [classId])

  return students
}
