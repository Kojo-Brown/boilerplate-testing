import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { useLocation } from 'react-router'
import { createSlice } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux'
import { useQuery } from '@tanstack/react-query'
import {
  renderWithProviders,
  createTestQueryClient,
  createTestStore,
  screen,
  waitFor,
  userEvent,
} from './renderWithProviders'

// ---------------------------------------------------------------------------
// Helper components used across tests
// ---------------------------------------------------------------------------

function LocationDisplay(): React.JSX.Element {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: (state) => { state.value += 1 },
  },
})

function CounterDisplay(): React.JSX.Element {
  const value = useSelector(
    (state: { counter: { value: number } }) => state.counter.value,
  )
  return <div data-testid="counter">{value}</div>
}

function AsyncText(): React.JSX.Element {
  const { data, isPending } = useQuery({
    queryKey: ['greeting'],
    queryFn: async () => 'hello',
  })
  if (isPending) return <span data-testid="loading">…</span>
  return <span data-testid="greeting">{data}</span>
}

// ---------------------------------------------------------------------------
// renderWithProviders
// ---------------------------------------------------------------------------

describe('renderWithProviders', () => {
  it('renders a component', () => {
    renderWithProviders(<div data-testid="root">hi</div>)
    expect(screen.getByTestId('root')).toHaveTextContent('hi')
  })

  it('provides MemoryRouter with / as default route', () => {
    renderWithProviders(<LocationDisplay />)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/')
  })

  it('respects a custom initial route', () => {
    renderWithProviders(<LocationDisplay />, {
      routerProps: { initialEntries: ['/dashboard/settings'] },
    })
    expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard/settings')
  })

  it('provides a Redux store and renders state', () => {
    const store = createTestStore(
      { counter: counterSlice.reducer },
      { counter: { value: 42 } },
    )
    renderWithProviders(<CounterDisplay />, { store })
    expect(screen.getByTestId('counter')).toHaveTextContent('42')
  })

  it('returns the store for post-render dispatch', () => {
    const store = createTestStore({ counter: counterSlice.reducer })
    const { store: returnedStore } = renderWithProviders(<CounterDisplay />, { store })
    expect(returnedStore.getState()).toEqual({ counter: { value: 0 } })

    returnedStore.dispatch(counterSlice.actions.increment())
    expect(returnedStore.getState()).toEqual({ counter: { value: 1 } })
  })

  it('provides a QueryClient for async queries', async () => {
    renderWithProviders(<AsyncText />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('greeting')).toHaveTextContent('hello'))
  })

  it('returns the queryClient for cache seeding', () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['user', 1], { id: 1, name: 'Alice' })

    const { queryClient: returnedClient } = renderWithProviders(<div />, { queryClient })
    expect(returnedClient.getQueryData(['user', 1])).toEqual({ id: 1, name: 'Alice' })
  })

  it('supports user interactions', async () => {
    const user = userEvent.setup()
    let clicked = false
    renderWithProviders(
      <button onClick={() => { clicked = true }}>Click</button>,
    )
    await user.click(screen.getByRole('button'))
    expect(clicked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createTestQueryClient
// ---------------------------------------------------------------------------

describe('createTestQueryClient', () => {
  it('disables retries', () => {
    const qc = createTestQueryClient()
    expect(qc.getDefaultOptions().queries?.retry).toBe(false)
  })

  it('sets gcTime to 0', () => {
    const qc = createTestQueryClient()
    expect(qc.getDefaultOptions().queries?.gcTime).toBe(0)
  })

  it('disables mutation retries', () => {
    const qc = createTestQueryClient()
    expect(qc.getDefaultOptions().mutations?.retry).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createTestStore
// ---------------------------------------------------------------------------

describe('createTestStore', () => {
  it('creates a store with empty state when no reducers given', () => {
    const store = createTestStore()
    expect(store.getState()).toEqual({})
  })

  it('applies preloaded state', () => {
    const store = createTestStore(
      { counter: counterSlice.reducer },
      { counter: { value: 99 } },
    )
    const state = store.getState() as { counter: { value: number } }
    expect(state.counter.value).toBe(99)
  })

  it('dispatches actions', () => {
    const store = createTestStore({ counter: counterSlice.reducer })
    store.dispatch(counterSlice.actions.increment())
    const state = store.getState() as { counter: { value: number } }
    expect(state.counter.value).toBe(1)
  })
})
