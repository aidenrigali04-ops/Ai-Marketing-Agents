/**
 * trigger.config.ts
 * Place this file in the ROOT of your Vantera Next.js project.
 * This is the main Trigger.dev configuration.
 */

import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_cotpwytcllemudkieuyu",  

  runtime: "node",
  logLevel: "log",

  // All agent files live in /trigger/
  dirs: ["./trigger"],

  // Max time any single agent run can take
  // AI tasks (profiling, outreach generation) can take 30–60s
  maxDuration: 300,   // 5 minutes

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
    },
  },

  // Build config — ensures Node.js native modules work
  build: {
    external: ["twilio"],    // twilio uses native bindings
  },
});
