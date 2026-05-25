import { defineConfig } from "vitest/config"

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "solid-js",
  },
  test: {
    environment: "node",
  },
})
