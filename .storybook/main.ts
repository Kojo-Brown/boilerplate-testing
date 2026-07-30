import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../storybook/**/*.stories.@(ts|tsx)'],
  // Storybook 9 folded the former `addon-essentials` bundle (controls, actions,
  // viewport, backgrounds, toolbars, measure, outline) and `addon-interactions`
  // into the core `storybook` package, so neither is installed or listed here.
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
}

export default config
