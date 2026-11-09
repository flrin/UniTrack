import './WarningBanner.css'

/** Always-visible reminder; intentionally not dismissible. */
export default function WarningBanner() {
  return (
    <aside className="warning-banner" role="note">
      <span aria-hidden="true" className="warning-banner-icon">
        ⚠
      </span>
      <p>
        <strong>Do not lock your phone or close this tab during active classes</strong>, or
        you will be marked absent.
      </p>
    </aside>
  )
}
