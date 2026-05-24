/* eslint-env node */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    "out/",
    "*.vsix",
    ".claude/",
    "team/",
    "docs/",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  overrides: [
    {
      files: ["*.cjs", "*.mjs"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
    {
      // Layer-3 (@vscode/test-electron) tests use Mocha's TDD globals
      // (suite, test, suiteSetup, suiteTeardown) — declare the env so eslint
      // doesn't flag them as undefined.
      files: ["tests/vscode-integration/**/*.ts"],
      env: {
        mocha: true,
      },
    },
  ],
};
