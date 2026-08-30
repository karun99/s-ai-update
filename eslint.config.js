export default [
  {
    files: ['bin/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        import: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-throw-literal': 'error'
    }
  },
  {
    ignores: ['node_modules/', 'public/', '*.html', 'test/']
  }
];
