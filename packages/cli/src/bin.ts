#!/usr/bin/env node
import { parseConfig } from "./config.js";
import { runScan } from "./scan.js";

const config = parseConfig(process.argv.slice(2));
runScan(config).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
