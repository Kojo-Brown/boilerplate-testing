import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../storybook/**/*.stories.@(ts|tsx)'],
  // Storybook 9 folded the former `addon-essentials` bundle (controls, actions,
  // viewport, backgrounds, toolbars, measure, outline, highlight) and
  // `addon-interactions` into the core `storybook` package, so neither is
  // installable any more. Docs is the only piece still shipped as an addon.
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // `docs.autodocs` was removed in Storybook 9 — autodocs is opted into per
  // story via `tags: ['autodocs']`, which both story files already declare.
}

export default config
