const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const importPlugin = require("eslint-plugin-import");
const unusedImports = require("eslint-plugin-unused-imports");
const reactPlugin = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const jsxA11y = require("eslint-plugin-jsx-a11y");

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/.turbo/**"
    ]
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      }
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    plugins: {
      import: importPlugin,
      "unused-imports": unusedImports,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y
    },
    rules: {
      "no-console": ["warn", { "allow": ["warn", "error", "info"] }],
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          "alphabetize": { "order": "asc", "caseInsensitive": true }
        }
      ],
      "unused-imports/no-unused-imports": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    files: ["apps/ar-chess-web/src/components/ChessExperience3D.tsx"],
    rules: {
      "react-hooks/rules-of-hooks": "off"
    }
  },
  {
    files: ["packages/modules/src/inclusiveSport/InclusiveSportsCoach.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off"
    }
  },
  {
    files: ["apps/ar-chess-web/src/features/chess/ChessExperience.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off"
    }
  },
  {
    files: ["packages/modules/src/medsyncVision/MedSyncVision.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off"
    }
  },
  {
    files: ["packages/modules/src/secureWatch/SecureWatch.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off"
    }
  }
];
