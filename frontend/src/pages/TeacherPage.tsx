import { useState } from 'react'
import ClassSelector from '../components/ClassSelector'
import { teacherClasses } from '../mocks/teacherClasses'

export default function TeacherPage({ onLogout }: { onLogout: () => void }) {
  const [selectedId, setSelectedId] = useState(teacherClasses[0].id)
  const selected = teacherClasses.find((item) => item.id === selectedId)

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">UniTrack</div>
          <h1>Today's classes</h1>
          <p>Select the class you are teaching now.</p>
        </div>
        <button className="secondary-button" onClick={onLogout} type="button">
          Logout
        </button>
      </header>
      <section className="dashboard-card">
        <h2>Schedule</h2>
        <ClassSelector classes={teacherClasses} selectedId={selectedId} onSelect={setSelectedId} />
      </section>
      {selected && (
        <section className="dashboard-card" style={{ marginTop: 24 }}>
          <h2>{selected.subject}</h2>
          <p className="intro">
            {selected.time} · Group {selected.group}
          </p>
        </section>
      )}
    </main>
  )
}
