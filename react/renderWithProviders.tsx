/**
 * renderWithProviders — Testing Library render helper with all common providers.
 *
 * Usage:
 *   import { renderWithProviders, screen } from '@/react/renderWithProviders'
 *
 *   it('renders with providers', () => {
 *     renderWithProviders(<MyComponent />)
 *     expect(screen.getByRole('button')).toBeInTheDocument()
 *   })
 */

import React from 'react'
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  configureStore,
  type EnhancedStore,
  type Reducer,
  type ReducersMapObject,
} from '@reduxjs/toolkit'
import { Provider as ReduxProvider } from 'react-redux'
import { MemoryRouter, type MemoryRouterProps } from 'react-router'

// ---------------------------------------------------------------------------
// Factory helpers — create fresh instances per test to prevent shared state
// ---------------------------------------------------------------------------

/**
 * Creates a QueryClient with all retries and caching disabled so tests are
 * deterministic and don't leak state between runs.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

/**
 * Creates a Redux store scoped to a test. Pass real reducers and optional
 * preloaded state to hydrate the store before rendering.
 *
 * @example
 *   const store = createTestStore(
 *     { user: userReducer },
 *     { user: { name: 'Alice', role: 'admin' } },
 *   )
 */
export function createTestStore<S extends Record<string, unknown> = Record<string, never>>(
  reducers: ReducersMapObject = {},
  preloadedState?: Partial<S>,
): EnhancedStore {
  return configureStore({
    reducer: reducers as Record<string, Reducer>,
    preloadedState,
  })
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Override MemoryRouter props — e.g. `initialEntries: ['/dashboard']` */
  routerProps?: MemoryRouterProps
  /** Pre-configured Redux store. Defaults to an empty store. */
  store?: EnhancedStore
  /** Pre-configured QueryClient. Defaults to a test-safe client. */
  queryClient?: QueryClient
}

export interface RenderWithProvidersResult extends RenderResult {
  store: EnhancedStore
  queryClient: QueryClient
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Wraps `render` with MemoryRouter, Redux Provider, and QueryClientProvider.
 * Returns the RTL result plus `store` and `queryClient` for direct inspection.
 *
 * @example
 *   const { store, queryClient } = renderWithProviders(<UserProfile />, {
 *     store: createTestStore({ user: userReducer }, { user: mockUser }),
 *     routerProps: { initialEntries: ['/profile/42'] },
 *   })
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const {
    routerProps = { initialEntries: ['/'] },
    store = createTestStore(),
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options

  function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return (
      <ReduxProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter {...routerProps}>{children}</MemoryRouter>
        </QueryClientProvider>
      </ReduxProvider>
    )
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions })
  return { ...result, store, queryClient }
}

// ---------------------------------------------------------------------------
// Convenience re-exports — tests only need one import
// ---------------------------------------------------------------------------

export {
  screen,
  fireEvent,
  waitFor,
  act,
  within,
  cleanup,
  waitForElementToBeRemoved,
} from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
