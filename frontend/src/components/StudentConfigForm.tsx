import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { getAuthToken } from '../services/apiClient'
import {
  getOptionalCourses,
  getSavedStudentConfig,
  isValidBaseGroup,
  saveStudentConfig,
  STUDENT_CONFIG_ENDPOINT,
} from '../services/studentService'
import type { StudentConfig } from '../types/student'

type OptionalsLoadState = {
  key: string
  courses: string[]
  error: string
}

export default function StudentConfigForm({
  onSaved,
}: {
  onSaved: (config: StudentConfig) => void
}) {
  const [studentToken, setStudentToken] = useState(() => getAuthToken() ?? '')
  const [baseGroup, setBaseGroup] = useState(
    () => getSavedStudentConfig()?.group.split('/')[0] ?? '',
  )
  const [semiGroup, setSemiGroup] = useState(
    () => getSavedStudentConfig()?.group.split('/')[1] ?? '',
  )
  const [optionals, setOptionals] = useState<string[]>(
    () => getSavedStudentConfig()?.optionals ?? [],
  )
  const [retryCount, setRetryCount] = useState(0)
  const [optionalsState, setOptionalsState] = useState<OptionalsLoadState>({
    key: '',
    courses: [],
    error: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const groupQuery = isValidBaseGroup(baseGroup)
    ? semiGroup === '1' || semiGroup === '2'
      ? `${baseGroup}/${semiGroup}`
      : baseGroup
    : undefined
  const [debouncedGroupQuery, setDebouncedGroupQuery] = useState(groupQuery)

  useEffect(() => {
    const delay = groupQuery ? 250 : 0
    const timerId = window.setTimeout(() => setDebouncedGroupQuery(groupQuery), delay)
    return () => window.clearTimeout(timerId)
  }, [groupQuery])

  const isDebouncing = Boolean(groupQuery && debouncedGroupQuery !== groupQuery)
  const effectiveGroupQuery = !isDebouncing ? debouncedGroupQuery : undefined
  const requestKey = effectiveGroupQuery ? `${effectiveGroupQuery}:${retryCount}` : ''
  const hasValidGroup = Boolean(groupQuery)
  const isLoadingOptionals = hasValidGroup && (isDebouncing || optionalsState.key !== requestKey)
  const availableOptionals =
    hasValidGroup && !isDebouncing && optionalsState.key === requestKey
      ? optionalsState.courses
      : []
  const optionalsError =
    hasValidGroup && !isDebouncing && optionalsState.key === requestKey
      ? optionalsState.error
      : ''

  useEffect(() => {
    if (!effectiveGroupQuery) return
    const controller = new AbortController()

    getOptionalCourses({ group: effectiveGroupQuery, signal: controller.signal })
      .then((courses) => {
        if (controller.signal.aborted) return
        setOptionalsState({ key: requestKey, courses, error: '' })
        setOptionals((current) => current.filter((course) => courses.includes(course)))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setOptionalsState({
          key: requestKey,
          courses: [],
          error:
            err instanceof Error ? err.message : 'Could not load optional courses.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [effectiveGroupQuery, requestKey])

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

    const trimmedToken = studentToken.trim()
    if (!trimmedToken) {
      setError('Enter your student ID token to continue.')
      return
    }

    if (!isValidBaseGroup(baseGroup)) {
      setError('Enter a valid 3- or 4-digit base group, such as 933 or 1021.')
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
      await saveStudentConfig(STUDENT_CONFIG_ENDPOINT, studentConfig, trimmedToken)
      onSaved(studentConfig)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'We could not save your configuration. Please try again.',
      )
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
          Set your student ID token, subgroup, and electives so UniTrack can load
          your classes and record attendance.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="student-token">Student ID Token</label>
          <input
            className="text-input"
            id="student-token"
            onChange={(event) => setStudentToken(event.target.value)}
            placeholder="Paste your student UUID"
            type="text"
            value={studentToken}
          />

          <label htmlFor="base-group">Base Group</label>
          <input
            className="text-input"
            id="base-group"
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => setBaseGroup(event.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 933 or 1021"
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
            {!hasValidGroup ? (
              <p className="field-help">
                Enter a valid group (e.g. 933 or 1021) to view optional courses.
              </p>
            ) : isLoadingOptionals ? (
              <p className="field-help">Loading optional courses…</p>
            ) : optionalsError ? (
              <div className="optionals-error">
                <p className="error-message" role="alert">
                  {optionalsError}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setRetryCount((c) => c + 1)}
                  type="button"
                >
                  Retry loading courses
                </button>
              </div>
            ) : availableOptionals.length === 0 ? (
              <p className="field-help">No optional courses available for this group.</p>
            ) : (
              <div className="course-list">
                {availableOptionals.map((course) => (
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
            )}
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
