export default function AppHeader({
  group,
  onEditConfig,
  onLogout,
}: {
  group: string
  onEditConfig: () => void
  onLogout: () => void
}) {
  return (
    <header className="dashboard-header">
      <div>
        <div className="eyebrow">UniTrack</div>
        <h1>Your schedule</h1>
        <p>Group {group}</p>
      </div>
      <div className="header-actions">
        <button className="secondary-button" onClick={onEditConfig} type="button">
          Edit configuration
        </button>
        <button className="secondary-button" onClick={onLogout} type="button">
          Log out
        </button>
      </div>
    </header>
  )
}
