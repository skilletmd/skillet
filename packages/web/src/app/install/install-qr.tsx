// Pre-generated QR code for SKILLET_INSTALL_URL ("https://skillet.md/install").
// Encoded once at build time (qrcode, error-correction level M) and inlined as a
// static path so there is zero runtime dependency and zero external request.
// If SKILLET_INSTALL_URL changes, regenerate the `d` attribute below.
//
// Rendered on a fixed white plate regardless of theme — QR modules must stay
// dark-on-light to scan, so we do not theme the colors.

const QR_PATH =
  'M0 0.5h7m1 0h1m2 0h1m1 0h4m1 0h7M0 1.5h1m5 0h1m2 0h5m2 0h1m1 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m8 0h1m2 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m1 0h1m1 0h1m2 0h1m2 0h1m1 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h2m1 0h2m1 0h3m1 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m1 0h1m2 0h1m6 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M8 7.5h2m1 0h1m2 0h1M0 8.5h1m3 0h1m1 0h4m1 0h1m3 0h1m1 0h5m2 0h1M0 9.5h6m1 0h1m1 0h2m1 0h1m1 0h2m4 0h2m1 0h1M0 10.5h1m3 0h3m3 0h1m4 0h8M2 11.5h2m5 0h1m1 0h1m2 0h2m2 0h1m3 0h2M6 12.5h7m3 0h3m2 0h4M0 13.5h3m1 0h1m4 0h2m1 0h1m1 0h3m3 0h1m2 0h1M2 14.5h3m1 0h1m1 0h2m1 0h1m1 0h3m1 0h6M3 15.5h2m4 0h1m1 0h2m2 0h1m3 0h2m1 0h2M0 16.5h2m1 0h5m1 0h4m3 0h7M8 17.5h4m1 0h1m2 0h1m3 0h1M0 18.5h7m1 0h2m1 0h1m1 0h1m2 0h1m1 0h1m1 0h1M0 19.5h1m5 0h1m3 0h3m1 0h1m1 0h1m3 0h5M0 20.5h1m1 0h3m1 0h1m1 0h1m2 0h2m3 0h7M0 21.5h1m1 0h3m1 0h1m2 0h3m1 0h1m3 0h3m2 0h3M0 22.5h1m1 0h3m1 0h1m2 0h1m1 0h2m1 0h1m2 0h2m2 0h1m1 0h1M0 23.5h1m5 0h1m4 0h1m3 0h1m2 0h6M0 24.5h7m1 0h3m1 0h1m2 0h1m2 0h1m3 0h3'

export function InstallQR({ size = 180 }: { size?: number }) {
  return (
    <div
      className="rounded-xl border border-(--line) bg-white p-3 shadow-sm"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="-1 -1 27 27"
        width="100%"
        height="100%"
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR code linking to skillet.md/install"
      >
        <path stroke="#1a1915" d={QR_PATH} />
      </svg>
    </div>
  )
}
