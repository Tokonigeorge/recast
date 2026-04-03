#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
loadEnv();

import { parseConfig } from "./config.js";
import { run } from "./commands/run.js";

const config = parseConfig(process.argv.slice(2));

run(config).catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
