import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Context files intentionally co-export a Provider component and a
      // companion hook (e.g. useAuth, useData, useTheme). Fast-refresh
      // handles this correctly; we whitelist the known hook names here so
      // the rule does not fire on those files.
      'react-refresh/only-export-components': [
        'warn',
        { allowExportNames: ['useAuth', 'useData', 'useTheme'] },
      ],
    },
  },
])
