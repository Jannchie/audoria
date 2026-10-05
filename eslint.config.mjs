import jannchie from '@jannchie/eslint-config'

export default jannchie(
  {
    vue: true,
    unocss: true,
    ignores: ['**/dist/**', '**/node_modules/**', 'web/src/api/**/*'],
  },
  {
    rules: {
      'node/prefer-global/process': 'off',
      'style/array-element-newline': 'off',
    },
  },
  {
    // The lyrics packages are styled with plain CSS, not UnoCSS.
    files: ['packages/**', 'apps/**'],
    rules: {
      'unocss/order': 'off',
      'unocss/order-attributify': 'off',
    },
  },
)
