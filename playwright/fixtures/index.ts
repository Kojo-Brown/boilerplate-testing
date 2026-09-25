export {
  test,
  expect,
  AUTH_DIR,
  AUTH_STORAGE_PATHS,
  AUTH_CREDENTIALS,
} from './auth'

export type { UserRole, AuthUser, AuthFixtures } from './auth'

// The visual-regression fixtures used to live here. They moved to `visual/`,
// which measures what masking and tolerance actually do rather than
// demonstrating the call signatures, and which runs in CI — see
// visual/README.md.
