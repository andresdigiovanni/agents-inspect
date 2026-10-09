import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Raw JSONL log lines have no schema; the parser reads them untyped.
    files: ['server/parse.ts', 'server/trace.ts', 'server/test/parse.test.ts', 'server/copilot/**/*.ts', 'server/test/copilot*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    // Only relevant with the React Compiler, which this app doesn't use.
    rules: { ...reactHooks.configs.flat.recommended.rules, 'react-hooks/incompatible-library': 'off' },
  },
)
