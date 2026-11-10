import type { RosterStudent } from '../types/roster'
import type { TeacherClass } from '../types/teacher'

const API_URL = 'http://localhost:8000'

export async function getTeacherClasses(): Promise<TeacherClass[]> {
  const response = await fetch(`${API_URL}/api/teacher/classes`)
  if (!response.ok) throw new Error('Could not load classes')
  return response.json()
}

export async function getRoster(classId: string): Promise<RosterStudent[]> {
  const response = await fetch(`${API_URL}/api/teacher/roster/${classId}`)
  if (!response.ok) throw new Error('Could not load roster')
  return response.json()
}

export async function overrideAttendance(classId: string, studentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/teacher/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_id: classId, user_id: studentId }),
  })
  if (!response.ok) throw new Error('Could not override attendance')
}
