import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

const runtimePriority = ["node", "deno", "bun"];
const nodeLocalMainzPackageDir = ".mainz-local/mainz";

export async function main(args = process.argv.slice(2), hooks = {}) {
  try {
    return await runCli(args, {
      cwd: hooks.cwd ?? process.cwd(),
      detectInstalledRuntimes:
        hooks.detectInstalledRuntimes ?? detectInstalledRuntimes,
      loadBootstrapCli: hooks.loadBootstrapCli ?? loadBootstrapCli,
      localMainzRepo: hooks.localMainzRepo ?? process.env.MAINZ_LOCAL_REPO,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[create-mainz] ${error.message}`);
      console.error('[create-mainz] Run "create-mainz --help" for usage.');
      return 1;
    }

    throw error;
  }
}

async function runCli(args, hooks) {
  if (
    args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args[0] === "help"
  ) {
    printHelp();
    return 0;
  }

  const options = parseInitOptions(args);
  const installedRuntimes = await hooks.detectInstalledRuntimes();
  const runtime = resolveRequestedRuntime(options.runtime, installedRuntimes);
  const localMainzRepo = resolveLocalMainzRepo(hooks.localMainzRepo, hooks.cwd);
  if (runtime === "bun") {
    throw new CliUsageError(
      'Runtime "bun" is not supported by the published Mainz bootstrap yet. Use "node" or "deno".',
    );
  }

  const bootstrapCli = await hooks.loadBootstrapCli(localMainzRepo);
  const invocation = resolveBootstrapInvocation(options, runtime, hooks.cwd);
  const exitCode = await runBootstrapCli(
    bootstrapCli,
    invocation.args,
    invocation.cwd,
    hooks.cwd,
  );
  if (exitCode === 0) {
    const projectDir = resolveGeneratedProjectDir(
      options,
      invocation.cwd ?? hooks.cwd,
    );
    writeProjectAgentsGuide(projectDir, runtime);

    if (localMainzRepo) {
      rewireGeneratedProjectForLocalMainz(
        projectDir,
        runtime,
        localMainzRepo,
      );
    }
  }

  return exitCode;
}

function parseInitOptions(args) {
  const options = {
    name: undefined,
    mainzSpecifier: undefined,
    runtime: undefined,
    template: undefined,
  };
  let positionalName;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--mainz") {
      options.mainzSpecifier = readOptionValue(current, args[index + 1]);
      index += 1;
      continue;
    }

    if (current === "--runtime") {
      const runtime = readOptionValue(current, args[index + 1]);
      if (runtime !== "node" && runtime !== "deno" && runtime !== "bun") {
        throw new CliUsageError(
          `Unsupported runtime "${runtime}". Use "node", "deno", or "bun".`,
        );
      }

      options.runtime = runtime;
      index += 1;
      continue;
    }

    if (current === "--template") {
      const template = readOptionValue(current, args[index + 1]);
      if (template !== "empty" && template !== "starter") {
        throw new CliUsageError(
          `Unsupported template "${template}". Use "empty" or "starter".`,
        );
      }

      options.template = template;
      index += 1;
      continue;
    }

    if (current.startsWith("--")) {
      throw new CliUsageError(`Unknown option "${current}".`);
    }

    if (positionalName) {
      throw new CliUsageError(
        `Received multiple project names "${positionalName}" and "${current}".`,
      );
    }

    positionalName = current;
  }

  options.name = positionalName;
  return options;
}

function readOptionValue(option, value) {
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`Option "${option}" requires a value.`);
  }

  return value;
}

function buildBootstrapArgs(options, runtime, cwd) {
  const args = ["init"];

  if (options.name) {
    args.push(options.name);
  } else if (!cwd) {
    throw new CliUsageError("Could not resolve the current working directory.");
  }

  if (options.template) {
    args.push("--template", options.template);
  }

  args.push("--runtime", runtime);

  if (options.mainzSpecifier) {
    args.push("--mainz", options.mainzSpecifier);
  }

  return args;
}

function resolveBootstrapInvocation(options, runtime, cwd) {
  if (!options.name || !isAbsolute(options.name)) {
    return {
      args: buildBootstrapArgs(options, runtime, cwd),
      cwd,
    };
  }

  return {
    args: buildBootstrapArgs(
      { ...options, name: basename(options.name) },
      runtime,
      dirname(options.name),
    ),
    cwd: dirname(options.name),
  };
}

async function runBootstrapCli(bootstrapCli, args, bootstrapCwd, fallbackCwd) {
  const previousCwd = process.cwd();
  const nextCwd = bootstrapCwd ?? fallbackCwd;

  if (nextCwd && nextCwd !== previousCwd) {
    mkdirSync(nextCwd, { recursive: true });
    process.chdir(nextCwd);
  }

  try {
    return await bootstrapCli.main(args, { hostRuntime: "node" });
  } finally {
    if (process.cwd() !== previousCwd) {
      process.chdir(previousCwd);
    }
  }
}

function resolveRequestedRuntime(requestedRuntime, installedRuntimes) {
  if (requestedRuntime) {
    if (!installedRuntimes.includes(requestedRuntime)) {
      throw new CliUsageError(
        `Runtime "${requestedRuntime}" is not installed on this machine.`,
      );
    }

    return requestedRuntime;
  }

  const detectedRuntime = runtimePriority.find((runtime) =>
    installedRuntimes.includes(runtime)
  );
  if (!detectedRuntime) {
    throw new CliUsageError(
      'Could not detect an installed runtime. Install "node", "deno", or "bun", or pass --runtime explicitly.',
    );
  }

  return detectedRuntime;
}

async function detectInstalledRuntimes() {
  return runtimePriority.filter((runtime) => isRuntimeInstalled(runtime));
}

function isRuntimeInstalled(runtime) {
  if (runtime === "node") {
    return true;
  }

  const result = spawnSync(runtime, ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function resolveLocalMainzRepo(localMainzRepo, cwd) {
  if (!localMainzRepo) {
    return undefined;
  }

  return isAbsolute(localMainzRepo) ? localMainzRepo : resolve(cwd, localMainzRepo);
}

function resolveGeneratedProjectDir(options, cwd) {
  if (!options.name) {
    return cwd;
  }

  if (isAbsolute(options.name)) {
    return options.name;
  }

  return resolve(cwd, options.name);
}

async function loadBootstrapCli(localMainzRepo) {
  if (!localMainzRepo) {
    return await import("@jsr/mainz__mainz/tooling/bootstrap-cli");
  }

  return {
    async main(args) {
      const result = spawnSync(resolveDenoCommand(), [
        "run",
        "-A",
        "--config",
        resolve(localMainzRepo, "jsr.json"),
        resolve(localMainzRepo, "src", "public", "tooling-bootstrap-cli.ts"),
        ...args,
      ], {
        stdio: "inherit",
      });

      if (result.error) {
        throw result.error;
      }

      return result.status ?? 1;
    },
  };
}

function resolveDenoCommand() {
  return "deno";
}

function rewireGeneratedProjectForLocalMainz(projectDir, runtime, localMainzRepo) {
  if (runtime === "deno") {
    rewireDenoProjectToLocalMainz(projectDir, localMainzRepo);
    return;
  }

  rewireNodeProjectToLocalMainz(projectDir, localMainzRepo);
}

function rewireDenoProjectToLocalMainz(projectDir, localMainzRepo) {
  const denoJsonPath = resolve(projectDir, "deno.json");
  const denoConfig = JSON.parse(readFileSync(denoJsonPath, "utf8"));

  denoConfig.imports = {
    ...(denoConfig.imports ?? {}),
    "@deno/loader": "npm:@jsr/deno__loader@^0.5.0",
    "@std/jsonc": "npm:@jsr/std__jsonc@^1",
    "happy-dom": "npm:happy-dom@20.9.0",
    mainz: toFileSpecifier(resolve(localMainzRepo, "mod.ts")),
    "mainz/config": toFileSpecifier(
      resolve(localMainzRepo, "src", "public", "config.ts"),
    ),
    "mainz/jsx-runtime": toFileSpecifier(
      resolve(localMainzRepo, "src", "jsx-runtime.ts"),
    ),
    "mainz/jsx-dev-runtime": toFileSpecifier(
      resolve(localMainzRepo, "src", "jsx-dev-runtime.ts"),
    ),
  };
  denoConfig.tasks = {
    ...(denoConfig.tasks ?? {}),
    mainz: `deno run -A --config deno.json ${
      toFileSpecifier(resolve(localMainzRepo, "src", "public", "tooling-cli.ts"))
    }`,
  };

  writeFileSync(denoJsonPath, `${JSON.stringify(denoConfig, null, 4)}\n`);
}

function rewireNodeProjectToLocalMainz(projectDir, localMainzRepo) {
  const packageJsonPath = resolve(projectDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const localPackageDir = resolve(projectDir, nodeLocalMainzPackageDir);

  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    mainz: `file:${nodeLocalMainzPackageDir}`,
  };
  packageJson.devDependencies = {
    ...(packageJson.devDependencies ?? {}),
    "happy-dom": "20.9.0",
    "tsx": "4.22.4",
    "typescript": "5.9.3",
  };
  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    mainz: "tsx ./scripts/mainz.mjs",
  };

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  rmSync(localPackageDir, { recursive: true, force: true });
  mkdirSync(localPackageDir, { recursive: true });
  cpSync(resolve(localMainzRepo, "src"), resolve(localPackageDir, "src"), {
    recursive: true,
  });
  copyFileSync(resolve(localMainzRepo, "mod.ts"), resolve(localPackageDir, "mod.ts"));
  rewriteLocalNodeMainzPackageForNode(localPackageDir);
  writeFileSync(
    resolve(localPackageDir, "src", "compiler", "typescript.ts"),
    'export { default as ts } from "typescript";\n',
  );
  writeFileSync(
    resolve(localPackageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "mainz",
        private: true,
        type: "module",
        exports: {
          ".": "./mod.ts",
          "./config": "./src/public/config.ts",
          "./jsx-runtime": "./src/jsx-runtime.ts",
          "./jsx-dev-runtime": "./src/jsx-dev-runtime.ts",
          "./tooling/cli": "./src/public/tooling-cli.ts",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function rewriteLocalNodeMainzPackageForNode(localPackageDir) {
  const nodeRuntimePath = resolve(localPackageDir, "src", "tooling", "runtime", "node.ts");
  if (existsSync(nodeRuntimePath)) {
    const nodeRuntime = readFileSync(nodeRuntimePath, "utf8").replace(
      '"npm:tsx@4.22.4/esm/api"',
      '"tsx/esm/api"',
    );
    writeFileSync(nodeRuntimePath, nodeRuntime);
  }
}

function toFileSpecifier(path) {
  return pathToFileURL(path).href;
}

function ensureParentDir(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function writeTextFile(path, content) {
  ensureParentDir(path);
  writeFileSync(path, content);
}

function writeProjectAgentsGuide(projectDir, runtime) {
  writeTextFile(resolve(projectDir, "AGENTS.md"), buildProjectAgentsGuide(runtime));
}

function buildProjectAgentsGuide(runtime) {
  return [
    "# AGENTS.md",
    "",
    "Guidance for contributors working in this Mainz application.",
    "",
    "## General",
    "",
    "- Use English for all code, UI copy, comments, docs, and commit messages.",
    "- Keep the UI intentionally simple unless the task explicitly asks for richer design.",
    "- Prefer predictable page flows over clever abstractions.",
    "- Treat this project as a Mainz app first. Follow Mainz page, route, and app conventions before introducing custom runtime patterns.",
    "",
    "## Runtime",
    "",
    `- This project was scaffolded for the \`${runtime}\` runtime.`,
    runtime === "node"
      ? "- Use `npm run mainz -- ...` for Mainz CLI commands."
      : "- Use `deno task mainz ...` for Mainz CLI commands.",
    "- Run `mainz diagnose` before handing work off when routes, auth, or render modes changed.",
    "",
    "## App structure",
    "",
    "- Keep app composition in `app/src/app.ts`.",
    "- Keep startup wiring in `app/src/main.tsx`.",
    "- Put route-owning pages in `app/src/pages`.",
    "- Put reusable view pieces in `app/src/components`.",
    "- Put integration helpers, auth helpers, and runtime-facing utilities in `app/src/lib`.",
    "",
    "## Mainz routing",
    "",
    "- Every routed page should declare `@Route(...)`.",
    "- Use `@RenderMode(\"ssg\")` for public, stable pages.",
    "- Use `@RenderMode(\"ssr\")` for request-time HTML that depends on authenticated or request-scoped data.",
    "- Leave a page undecorated only when `csr` is truly the right default.",
    "- Keep navigation mode in `defineApp({ navigation })` and render mode on the page via decorators.",
    "",
    "## Mainz authorization",
    "",
    "- Put route protection on the owning page with `@Authorize()` or `@Authorize({ roles, policy })`.",
    "- Use `@AllowAnonymous()` when a public page should stay explicitly public.",
    "- Register runtime auth in `startApp(app, { auth: { ... } })`.",
    "- Keep `auth.loginPath` aligned with the real login route.",
    "- When a page uses named policies, also register `authorization.policyNames` in `defineApp(...)` so `mainz diagnose` can validate them.",
    "",
    "## Backend integration",
    "",
    "- Keep backend communication in small helpers under `app/src/lib`.",
    "- Prefer one integration helper per backend concern, for example auth, CMS data, or account/session state.",
    "- Do not spread backend URLs and storage keys across pages and components.",
    "- For authenticated SSR routes, make sure the chosen auth mechanism is visible to the server runtime, not only to browser-local storage.",
    "",
    "## UI guidance",
    "",
    "- Start with semantic HTML and simple page copy.",
    "- Use forms, links, headings, and sections before introducing custom styling or client state.",
    "- Add stateful components only when the flow truly needs browser interaction.",
    "",
    "## Before finishing",
    "",
    "- Run the local diagnose command for the app target.",
    "- If build output changed, also run the local build command when practical.",
    "- Mention any runtime limitation clearly, especially around SSR, auth, or local-only assumptions.",
    "",
  ].join("\n");
}

function ensureLocalMainzFixture(repoDir) {
  writeTextFile(resolve(repoDir, "jsr.json"), "{\n  \"version\": \"0.0.0-local\"\n}\n");
  writeTextFile(resolve(repoDir, "mod.ts"), "export const mainz = true;\n");
  writeTextFile(resolve(repoDir, "src", "public", "config.ts"), "export {};\n");
  writeTextFile(resolve(repoDir, "src", "public", "tooling-cli.ts"), "export {};\n");
  writeTextFile(resolve(repoDir, "src", "jsx-runtime.ts"), "export {};\n");
  writeTextFile(resolve(repoDir, "src", "jsx-dev-runtime.ts"), "export {};\n");
  writeTextFile(resolve(repoDir, "src", "compiler", "typescript.ts"), "export {};\n");
  writeTextFile(
    resolve(repoDir, "src", "tooling", "runtime", "node.ts"),
    'import { register } from "npm:tsx@4.22.4/esm/api";\nexport { register };\n',
  );
}

export const __testables = {
  ensureLocalMainzFixture,
};

function printHelp() {
  console.log(
    [
      "create-mainz",
      "",
      "Usage:",
      "  create-mainz [<name>] [--template <empty|starter>] [--runtime <node|deno|bun>] [--mainz <specifier>]",
      "",
      "Options:",
      "  --template <empty|starter>  Choose the project template. Defaults to empty.",
      "  --runtime <node|deno|bun>   Choose which Mainz runtime to bootstrap.",
      "  --mainz <specifier>         Override the Mainz package specifier written to the project.",
      "",
      "Local development:",
      "  Set MAINZ_LOCAL_REPO to a local Mainz repository checkout to rewire",
      "  the generated project for local validation without publishing first.",
      "",
      "Runtime selection:",
      "  Auto-detects installed runtimes in this order: node, deno, bun.",
      "  When multiple runtimes are installed, node wins by default.",
      "",
      "Examples:",
      "  npm create mainz@latest my-app",
      "  npm create mainz@latest my-app -- --template starter",
      "  npm create mainz@latest my-deno-app -- --runtime deno",
    ].join("\n"),
  );
}
