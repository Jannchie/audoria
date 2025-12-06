import jannchie from '@jannchie/eslint-config'

export default jannchie({
  unocss: true,
  rules: {
    'node/prefer-global/process': 'off',
  },
  ignores: ['src/api/**/*'],
})
