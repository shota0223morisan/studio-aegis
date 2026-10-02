import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI is served by the Mac app's local server (desktop/src/server). Build it with
// `npm run build`, then run the app with `npm run desktop`.
export default defineConfig({
  plugins: [react()],
});
