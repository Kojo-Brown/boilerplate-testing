import type { Preview } from '@storybook/react'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    interactions: {
      // Halt story execution on interaction failure so errors are visible
      disable: false,
    },
  },
}

export default preview
