import { defineConfig } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import css from '@eslint/css';

// obsidianmd's recommended set scopes its own blocks to these globs; every JS/TS config below is held to them so none of it runs on styles.css.
const scriptAndManifestFiles = [
  '**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}',
  'package.json',
];

export default defineConfig([
  {
    ignores: [
      '**',
      '!src/**',
      '!main.ts',
      '!tests/**',
      '!package.json',
      '!styles.css',
    ],
  },

  {
    files: scriptAndManifestFiles,
    extends: [obsidianmd.configs.recommended],
  },

  {
    files: scriptAndManifestFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_' },
      ],
      'no-undef': 'off',
    },
  },

  // Block eslint-disable for obsidianmd/* rules (bot strips all directives)
  {
    files: scriptAndManifestFiles,
    extends: [comments.recommended],
  },
  {
    files: scriptAndManifestFiles,
    rules: {
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'obsidianmd/*',
        '@eslint-community/eslint-comments/*',
      ],
    },
  },

  // The Obsidian community directory's CSS lint flags every :has() as a warning, so flag it here at the same level before review does.
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    rules: {
      'css/selector-complexity': ['warn', { disallowPseudoClasses: ['has'] }],
    },
  },
]);
