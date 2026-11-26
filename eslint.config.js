// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  // web/ holds the static landing page (hand-written browser script, deliberately ES5), not app source.
  { ignores: ['dist/*', 'supabase/functions/*', '.expo/*', 'web/*'] },
]);
