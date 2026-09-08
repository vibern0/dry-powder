import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      assert: path.resolve(__dirname, "src/polyfills/assert.ts")
    }
  }
});
