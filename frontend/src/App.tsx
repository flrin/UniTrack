import { useState } from 'react'
import './App.css'
import StudentConfigForm from './components/StudentConfigForm'
import DashboardPage from './pages/DashboardPage'
import { getSavedStudentConfig } from './services/studentService'
import type { StudentConfig } from './types/student'

function App() {
  const [config, setConfig] = useState<StudentConfig | null>(getSavedStudentConfig)

  return config ? (
    <DashboardPage config={config} onEditConfig={() => setConfig(null)} />
  ) : (
    <StudentConfigForm onSaved={setConfig} />
  )
}

export default App
