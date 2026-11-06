export type AttendanceStatus = 'Pending' | 'Present' | 'Left Early'

export interface RosterStudent {
  id: string
  name: string
  group: string
  status: AttendanceStatus
  override: boolean
}
