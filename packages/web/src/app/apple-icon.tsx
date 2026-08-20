import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Top-down skillet mark — matches src/app/icon.tsx. Brand purple (#635bff) on navy ink.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: '#0b1220',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 130,
          height: 96,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {/* handle */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 39,
            width: 56,
            height: 18,
            borderRadius: 9,
            background: '#635bff',
          }}
        />
        {/* pan body */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 96,
            height: 96,
            borderRadius: 48,
            background: '#101722',
            border: '13px solid #635bff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: '#635bff',
            }}
          />
        </div>
      </div>
    </div>,
    { width: 180, height: 180 },
  )
}
