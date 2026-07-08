import React from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'opacity 150ms ease',
}

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: '#2563eb', color: '#fff', border: 'none' },
  secondary: { background: '#f3f4f6', color: '#111827', border: '1px solid #d1d5db' },
  danger: { background: '#dc2626', color: '#fff', border: 'none' },
}

const SIZES: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '4px 12px', fontSize: '13px' },
  md: { padding: '8px 16px', fontSize: '14px' },
  lg: { padding: '12px 24px', fontSize: '16px' },
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
}: ButtonProps): React.JSX.Element {
  const isInert = disabled || loading

  return (
    <button
      type="button"
      style={{
        ...BASE,
        ...VARIANTS[variant],
        ...SIZES[size],
        cursor: isInert ? 'not-allowed' : 'pointer',
        opacity: isInert ? 0.6 : 1,
      }}
      disabled={isInert}
      onClick={onClick}
      aria-busy={loading}
    >
      {loading ? 'Loading…' : label}
    </button>
  )
}
