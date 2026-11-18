import type { ClassOption } from '../mocks/teacherClasses'
import './ClassSelector.css'

interface Props {
  classes: ClassOption[]
  selectedId: string
  onSelect: (id: string) => void
}

function ClassSelector({ classes, selectedId, onSelect }: Props) {
  return (
    <div className="class-list">
      {classes.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === selectedId ? 'class-item active' : 'class-item'}
          onClick={() => onSelect(item.id)}
        >
          <strong>{item.subject}</strong>
          <span>{item.time} · Group {item.group}</span>
        </button>
      ))}
    </div>
  )
}

export default ClassSelector
