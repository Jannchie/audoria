import jannchie from '@jannchie/eslint-config'

export default jannchie({
  vue: true,
  unocss: true,
  rules: {
    'node/prefer-global/process': 'off',
  },
  ignores: ['**/dist/**', '**/node_modules/**', 'web/src/api/**/*'],
})
