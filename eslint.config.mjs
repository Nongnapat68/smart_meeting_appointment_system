import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This new React Compiler-oriented rule flags the standard
      // "fetch-on-mount" pattern (setLoading(true) synchronously at the top
      // of an effect-triggered load()) used throughout this app's client
      // pages. That pattern is safe and correct here (no compiler
      // memoization is in play), so we downgrade it rather than restructure
      // every data-fetching component around it.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
