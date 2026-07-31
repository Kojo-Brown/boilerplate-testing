import type { Preview } from '@storybook/react'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    // The interactions panel is part of Storybook 9 core and enabled by default
    // (`features.interactions`), so the old `parameters.interactions` knob from
    // addon-interactions is gone — it would be a silent no-op here.
  },
}

export default preview
