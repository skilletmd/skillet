export const contentType = 'image/svg+xml'

// The Skillet mark (chevron · open-ring eye · smile) on a rounded badge. Off-white in
// prod; orange in dev so a localhost tab is unmistakable next to a prod one.
// The desktop tray uses the same convention (see src-tauri lib.rs setup).
export default function Icon() {
  const badge = process.env.NODE_ENV === 'production' ? '#fafaf8' : '#fb923c'
  const svg = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .mark {
      stroke: #171512;
    }
  </style>
  <rect x="1" y="1" width="30" height="30" rx="7" fill="${badge}" />
  <g transform="translate(2 2)">
    <path
      class="mark"
      d="M6.2 10.3 13.2 15.2 6.2 20.1"
      stroke-width="2.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle class="mark" cx="21.8" cy="15.2" r="2.5" stroke-width="1.7" />
    <path
      class="mark"
      d="M12.2 21.2c2 2.3 5.2 2.3 7.2 0"
      stroke-width="2.4"
      stroke-linecap="round"
    />
  </g>
</svg>
`
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml' },
  })
}
