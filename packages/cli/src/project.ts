import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

export interface ProjectInfo {
  root: string;
  framework: string;
  devCommand: string;
  port: number;
  url: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectProject(dir: string): Promise<ProjectInfo | null> {
  try {
    await access(join(dir, "package.json"));
  } catch {
    return null;
  }

  const pkg: PackageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const port = await findFreePort();
  let framework = "unknown";
  let devCommand = "";

  // Detect framework and appropriate dev command
  if (allDeps["next"]) {
    framework = "next";
    devCommand = `npx next dev -p ${port}`;
  } else if (allDeps["vite"] || allDeps["@vitejs/plugin-react"] || allDeps["@vitejs/plugin-vue"]) {
    framework = "vite";
    devCommand = `npx vite --port ${port}`;
  } else if (allDeps["react-scripts"]) {
    framework = "create-react-app";
    devCommand = `npx react-scripts start`;
  } else if (allDeps["nuxt"]) {
    framework = "nuxt";
    devCommand = `npx nuxt dev --port ${port}`;
  } else if (allDeps["@sveltejs/kit"]) {
    framework = "sveltekit";
    devCommand = `npx vite dev --port ${port}`;
  } else if (allDeps["astro"]) {
    framework = "astro";
    devCommand = `npx astro dev --port ${port}`;
  } else if (pkg.scripts?.["dev"]) {
    framework = "custom";
    devCommand = `npm run dev -- --port ${port}`;
  } else if (pkg.scripts?.["start"]) {
    framework = "custom";
    devCommand = `npm run start`;
  } else {
    return null;
  }

  return {
    root: dir,
    framework,
    devCommand,
    port,
    url: `http://localhost:${port}`,
  };
}

export async function startDevServer(project: ProjectInfo): Promise<{ process: ChildProcess; url: string }> {
  const [cmd, ...args] = project.devCommand.split(" ");

  const child = spawn(cmd, args, {
    cwd: project.root,
    stdio: "pipe",
    shell: true,
    env: { ...process.env, PORT: String(project.port), BROWSER: "none" },
  });

  await waitForPort(project.port, 60_000);

  return { process: child, url: project.url };
}

export function stopDevServer(child: ChildProcess): void {
  child.kill("SIGTERM");
  // Force kill after 3s if it doesn't exit
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 3000);
}

export interface ClonedProject {
  root: string;
  cleanup: () => Promise<void>;
}

/**
 * Parse a GitHub shorthand and clone the repo.
 * Supports: github:user/repo, github.com/user/repo, https://github.com/user/repo
 */
export function parseGitHubTarget(target: string): { repo: string; url: string } | null {
  // github:user/repo
  if (target.startsWith("github:")) {
    const repo = target.slice(7);
    return { repo, url: `https://github.com/${repo}.git` };
  }
  // https://github.com/user/repo or github.com/user/repo
  const match = target.match(/(?:https?:\/\/)?github\.com\/([^/]+\/[^/\s]+)/);
  if (match) {
    const repo = match[1].replace(/\.git$/, "");
    return { repo, url: `https://github.com/${repo}.git` };
  }
  return null;
}

export async function cloneAndInstall(
  gitUrl: string,
  onProgress?: (msg: string) => void,
): Promise<ClonedProject> {
  const tmpBase = await mkdtemp(join(tmpdir(), "recast-"));
  const projectDir = join(tmpBase, "repo");

  onProgress?.("Cloning repository");
  execSync(`git clone --depth 1 ${gitUrl} "${projectDir}"`, {
    stdio: "pipe",
    timeout: 60_000,
  });

  onProgress?.("Installing dependencies");
  // Detect package manager
  const hasYarnLock = await access(join(projectDir, "yarn.lock")).then(() => true, () => false);
  const hasPnpmLock = await access(join(projectDir, "pnpm-lock.yaml")).then(() => true, () => false);

  const installCmd = hasPnpmLock ? "pnpm install --frozen-lockfile"
    : hasYarnLock ? "yarn install --frozen-lockfile"
    : "npm install";

  try {
    execSync(installCmd, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch {
    // Frozen lockfile might fail — retry without
    const fallback = hasPnpmLock ? "pnpm install --no-frozen-lockfile"
      : hasYarnLock ? "yarn install"
      : "npm install";
    execSync(fallback, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 120_000,
    });
  }

  return {
    root: projectDir,
    cleanup: async () => { await rm(tmpBase, { recursive: true, force: true }); },
  };
}

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const connected = await tryConnect(port);
    if (connected) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Dev server did not start within ${timeoutMs / 1000}s on port ${port}`);
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
