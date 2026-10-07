# Attendance, Payroll Sharing, and Advance Highlights

## Goal
Make attendance entry faster for supervisors, add full-batch payroll PDF sharing from the record popup, and make every new advance immediately visible without changing calculations or stored payroll data.

## Attendance entry
- Keep the chosen behavior: only workers selected for the current site batch start as **Present**, with the existing default shift; do not preselect the whole workforce.
- Replace the hard-coded “Set all present 08:00–17:00” action with a compact daily schedule toolbar:
  - editable In and Out time controls for the currently selected workers;
  - quick shift presets and 15-minute earlier/later steppers;
  - one clear Apply action that updates the selected workers for that date, while preserving per-worker overrides.
- Keep each worker row individually editable and enlarge In/Out controls for comfortable touch use.
- Reduce Notes controls to roughly half their current footprint and rebalance the attendance columns around the larger time inputs.
- Improve the monthly attendance popup with larger daily In/Out controls, compact remarks, and touch-friendly day rows so each date can retain its own schedule.
- Preserve validation for invalid shifts, breaks, overtime, duplicate daily assignments, and unsaved changes.

## Payroll PDF and WhatsApp sharing
- Add a prominent **Share payroll** action to the existing payroll record details popup.
- Generate a professional full-batch PDF containing company heading, payroll month, site/project, foreman, employee IDs and payroll lines, highlighted advances, and Gross/Net/Paid/Balance totals.
- On supported mobile devices, open the native share sheet with the PDF attached so WhatsApp can receive it directly.
- When file sharing is unavailable, download the PDF and open WhatsApp with a prepared batch message, clearly notifying the user to attach the downloaded file.
- Keep sharing entirely client-side and reuse the app’s existing PDF/share patterns.

## New advance highlighting
- Detect `new_advance > 0` and render the amount as a bold semantic warning badge; zero values remain visually quiet.
- Apply the same treatment in payroll editing (desktop and mobile), payroll record details, Employee History, and Employee Details.
- Add a compact new-advance count/total indicator to payroll batch summaries when a batch contains new advances.
- Carry the same visual emphasis into the generated full-batch PDF.

## Responsive quality and verification
- Keep the existing charcoal/teal theme, typography, calculations, advance carry-forward, and all desktop/mobile workflows.
- Verify attendance entry, individual and bulk time adjustment, the details popup, PDF generation/share fallback, and advance highlighting on phone and desktop widths.
- Fix the existing Attendance Report type errors found in the current build, then confirm the latest build is clean and run the affected payroll checks.

## Technical notes
- Frontend-only feature work; no database schema or backend changes.
- Add a focused batch-PDF utility and reuse semantic button/input styles.
- Use the Web Share API with a PDF `File`; WhatsApp intent links are fallback messaging only because browsers cannot attach a local PDF through a URL.
