import type { RosterStudent } from '../types/roster'

export const mockRoster: RosterStudent[] = [
  { id: '1', name: 'John Doe', group: '933/1', status: 'Present', override: false },
  { id: '2', name: 'Maria Popescu', group: '933/1', status: 'Pending', override: false },
  { id: '3', name: 'Ioana Marinescu', group: '933/2', status: 'Left Early', override: false },
  { id: '4', name: 'Radu Constantin', group: '933/2', status: 'Pending', override: false },
]
