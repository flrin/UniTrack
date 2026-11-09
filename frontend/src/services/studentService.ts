import type { ScheduleItem, StudentConfig } from '../types/student'

const CONFIG_STORAGE_KEY = 'unitrack.student.config'
const STUDENT_CONFIG_ENDPOINT = '/api/student/config'

export function saveStudentConfig(
  endpoint: string,
  config: StudentConfig,
): Promise<{ message: string }> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (endpoint !== STUDENT_CONFIG_ENDPOINT) {
        reject(new Error(`Unsupported mock endpoint: ${endpoint}`))
        return
      }

      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
      resolve({ message: 'Configuration saved' })
    }, 250)
  })
}

export function getStudentSchedule(): Promise<ScheduleItem[]> {
  return Promise.resolve([])
}

export function getSavedStudentConfig(): StudentConfig | null {
  const savedConfig = window.localStorage.getItem(CONFIG_STORAGE_KEY)
  if (!savedConfig) return null

  try {
    const config = JSON.parse(savedConfig) as StudentConfig
    if (typeof config.group === 'string' && Array.isArray(config.optionals)) {
      return config
    }
  } catch {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY)
  }

  return null
}
