# Storybook 9 Interaction Tests

## Running

```bash
# Start Storybook dev server
pnpm storybook

# Build static Storybook
pnpm storybook:build

# Run all interaction tests headlessly (requires a running Storybook)
pnpm storybook:test
```

## How interaction tests work

Stories with a `play` function are **interaction tests**. Storybook executes
the `play` function after the story renders, simulating real user input and
asserting the outcome. The same tests run in two contexts:

| Context | Tool | When |
|---|---|---|
| Browser (dev) | Storybook Interactions panel | While developing |
| Headless CI | `@storybook/test-runner` (Playwright) | `pnpm storybook:test` |

## API (`@storybook/test`)

```ts
import { expect, fn, userEvent, within } from '@storybook/test'

// userEvent — simulates real browser events (type, click, tab, keyboard)
await userEvent.type(input, 'hello@example.com')
await userEvent.click(button)
await userEvent.tab()
await userEvent.keyboard('{Enter}')

// within — scopes queries to a subtree, preventing false positives
const canvas = within(canvasElement)
const button = canvas.getByRole('button', { name: /submit/i })

// expect — same API as Vitest/Jest
await expect(button).toBeDisabled()
await expect(spy).toHaveBeenCalledWith({ email: '…', password: '…' })

// fn() — creates a spy compatible with expect matchers
args: { onSubmit: fn() }
```

## Key patterns

### Spy on callbacks

```ts
const meta = {
  component: Button,
  args: { onClick: fn() },   // spy injected into all stories
} satisfies Meta<typeof Button>

export const Click: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
```

### Multi-step form flow

```ts
export const Submit: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(canvas.getByLabelText(/password/i), 'secret123')
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))
    await expect(args.onSubmit).toHaveBeenCalledWith({ email: '…', password: '…' })
  },
}
```

### Assert validation errors

```ts
export const EmptySubmit: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))
    await expect(canvas.getByText(/email is required/i)).toBeVisible()
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}
```

## CI integration

Add to your GitHub Actions workflow:

```yaml
- name: Build Storybook
  run: pnpm storybook:build

- name: Run interaction tests
  run: |
    npx serve storybook-static --port 6006 &
    pnpm storybook:test --url http://localhost:6006
```
