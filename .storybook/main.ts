import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../storybook/**/*.stories.@(ts|tsx)'],
  // Storybook 9 folded addon-essentials (controls, actions, viewport, backgrounds,
  // toolbars, measure, outline, highlight) and addon-interactions into core, so
  // neither package is published for 9.x. Docs is the one former "essential"
  // still shipped as a separate addon.
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
}

export default config
