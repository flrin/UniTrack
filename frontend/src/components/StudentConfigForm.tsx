import type { FormEvent } from 'react'
import { useState } from 'react'
import { saveStudentConfig } from '../services/studentService'
import type { StudentConfig } from '../types/student'

const OPTIONAL_COURSES = [
  'Cloud Computing',
  'Machine Learning',
  'Arhitectura aplicatiilor cloud',
  'Securitatea informatiei',
]

const STUDENT_CONFIG_ENDPOINT = '/api/student/config'

export default function StudentConfigForm({
  onSaved,
}: {
  onSaved: (config: StudentConfig) => void
}) {
  const [baseGroup, setBaseGroup] = useState('')
  const [semiGroup, setSemiGroup] = useState('')
  const [optionals, setOptionals] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleOptional = (course: string) => {
    setOptionals((current) =>
      current.includes(course)
        ? current.filter((selectedCourse) => selectedCourse !== course)
        : [...current, course],
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!/^\d{3}$/.test(baseGroup)) {
      setError('Enter a three-digit base group, such as 933.')
      return
    }

    if (semiGroup !== '1' && semiGroup !== '2') {
      setError('Choose a semi-group to continue.')
      return
    }

    const studentConfig = {
      group: `${baseGroup}/${semiGroup}`,
      optionals,
    }

    setIsSaving(true)
    try {
      await saveStudentConfig(STUDENT_CONFIG_ENDPOINT, studentConfig)
      onSaved(studentConfig)
    } catch {
      setError('We could not save your configuration. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="config-page">
      <section className="config-card" aria-labelledby="config-title">
        <div className="eyebrow">Student setup</div>
        <h1 id="config-title">Tell us about your schedule</h1>
        <p className="intro">
          Set your exact subgroup and electives so UniTrack can show the right
          classes.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="base-group">Base Group</label>
          <input
            id="base-group"
            inputMode="numeric"
            maxLength={3}
            onChange={(event) => setBaseGroup(event.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 933"
            value={baseGroup}
          />

          <fieldset>
            <legend>Semi-Group</legend>
            <div className="semi-group-options">
              {['1', '2'].map((value) => (
                <label className={`radio-card ${semiGroup === value ? 'selected' : ''}`} key={value}>
                  <input
                    checked={semiGroup === value}
                    name="semi-group"
                    onChange={() => setSemiGroup(value)}
                    type="radio"
                    value={value}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Optional Courses</legend>
            <p className="field-help">Select every elective you attend.</p>
            <div className="course-list">
              {OPTIONAL_COURSES.map((course) => (
                <label className="checkbox-row" key={course}>
                  <input
                    checked={optionals.includes(course)}
                    onChange={() => toggleOptional(course)}
                    type="checkbox"
                  />
                  <span>{course}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? 'Saving…' : 'Save and view my schedule'}
          </button>
        </form>
      </section>
    </main>
  )
}
