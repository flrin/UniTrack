import type { RosterStudent } from '../types/roster'
import './StudentRoster.css'

interface Props {
  students: RosterStudent[]
  onOverride?: (studentId: string) => void
}

function StudentRoster({ students, onOverride }: Props) {
  return (
    <div className="roster">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Group</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id}>
              <td>{student.name}</td>
              <td>{student.group}</td>
              <td>
                <span className={student.status === 'Present' ? 'badge present' : student.status === 'Pending' ? 'badge pending' : 'badge left'}>
                  {student.status}
                </span>
              </td>
              <td>
                <button onClick={() => onOverride?.(student.id)}>Manual Override</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default StudentRoster
