import React, { useState } from 'react'

export interface LoginFormValues {
  email: string
  password: string
}

export interface LoginFormProps {
  onSubmit: (values: LoginFormValues) => void | Promise<void>
  error?: string
  loading?: boolean
}

export function LoginForm({ onSubmit, error, loading = false }: LoginFormProps): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<LoginFormValues>>({})

  const validate = (): boolean => {
    const errors: Partial<LoginFormValues> = {}
    if (!email) errors.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email'
    if (!password) errors.password = 'Password is required'
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!validate()) return
    await onSubmit({ email, password })
  }

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: '4px',
    color: '#374151',
  }

  const errorStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#dc2626',
    marginTop: '4px',
  }

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e) }}
      noValidate
      style={{ maxWidth: '360px', fontFamily: 'sans-serif' }}
      aria-label="Login form"
    >
      <h2 style={{ marginTop: 0, marginBottom: '24px', fontSize: '20px' }}>Sign in</h2>

      {error && (
        <p role="alert" style={{ ...errorStyle, fontSize: '14px', marginBottom: '16px' }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="email" style={labelStyle}>Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          aria-invalid={Boolean(fieldErrors.email)}
          style={inputStyle}
        />
        {fieldErrors.email && (
          <span id="email-error" style={errorStyle} role="alert">
            {fieldErrors.email}
          </span>
        )}
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="password" style={labelStyle}>Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          aria-invalid={Boolean(fieldErrors.password)}
          style={inputStyle}
        />
        {fieldErrors.password && (
          <span id="password-error" style={errorStyle} role="alert">
            {fieldErrors.password}
          </span>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          fontFamily: 'inherit',
        }}
        aria-busy={loading}
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
