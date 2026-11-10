export type ClassOption = {
  id: string
  subject: string
  time: string
  group: string
}

export const teacherClasses: ClassOption[] = [
  { id: '1', subject: 'Interactiunea om-calculator', time: '08:00 - 10:00', group: '933' },
  { id: '2', subject: 'Programare web', time: '10:00 - 12:00', group: '933/1' },
  { id: '3', subject: 'Baze de date', time: '12:00 - 14:00', group: '933/2' },
  { id: '4', subject: 'Inteligenta artificiala', time: '14:00 - 16:00', group: 'IE3' },
]
