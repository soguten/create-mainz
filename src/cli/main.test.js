import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { __testables, main } from "./main.js";

test("delegates to the published Mainz bootstrap CLI with node as the default runtime", async () => {
  const calls = [];

  const exitCode = await main(["demo-app"], {
    async detectInstalledRuntimes() {
      return ["node", "deno", "bun"];
    },
    async loadBootstrapCli() {
      return {
        async main(args, options) {
          calls.push({ args, options });
          return 0;
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    args: ["init", "demo-app", "--runtime", "node"],
    options: { hostRuntime: "node" },
  }]);
});

test("forwards template, runtime, and mainz overrides to the published bootstrap CLI", async () => {
  const calls = [];

  const exitCode = await main([
    "demo-app",
    "--runtime",
    "deno",
    "--template",
    "starter",
    "--mainz",
    "jsr:@mainz/mainz@0.1.0-alpha.72",
  ], {
    async detectInstalledRuntimes() {
      return ["node", "deno"];
    },
    async loadBootstrapCli() {
      return {
        async main(args, options) {
          calls.push({ args, options });
          return 0;
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    args: [
      "init",
      "demo-app",
      "--template",
      "starter",
      "--runtime",
      "deno",
      "--mainz",
      "jsr:@mainz/mainz@0.1.0-alpha.72",
    ],
    options: { hostRuntime: "node" },
  }]);
});

test("rejects runtimes that are not installed", async () => {
  const exitCode = await main(["demo-app", "--runtime", "deno"], {
    async detectInstalledRuntimes() {
      return ["node"];
    },
    async loadBootstrapCli() {
      throw new Error("bootstrap CLI should not load");
    },
  });

  assert.equal(exitCode, 1);
});

test("rejects bun until the published Mainz bootstrap supports it", async () => {
  const exitCode = await main(["demo-app", "--runtime", "bun"], {
    async detectInstalledRuntimes() {
      return ["node", "bun"];
    },
    async loadBootstrapCli() {
      throw new Error("bootstrap CLI should not load");
    },
  });

  assert.equal(exitCode, 1);
});

test("normalizes absolute project paths before delegating to the bootstrap CLI", async () => {
  const calls = [];
  const initialCwd = process.cwd();
  const absoluteProjectPath = join(initialCwd, "demo-app");

  const exitCode = await main([absoluteProjectPath, "--template", "starter"], {
    cwd: initialCwd,
    async detectInstalledRuntimes() {
      return ["node"];
    },
    async loadBootstrapCli() {
      return {
        async main(args, options) {
          calls.push({ args, options, cwd: process.cwd() });
          return 0;
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(process.cwd(), initialCwd);
  assert.deepEqual(calls, [{
    args: ["init", "demo-app", "--template", "starter", "--runtime", "node"],
    options: { hostRuntime: "node" },
    cwd: initialCwd,
  }]);
});

test("creates the parent directory before delegating an absolute path", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "create-mainz-test-"));
  const projectParentDir = join(sandboxDir, "nested", "workspace");
  const projectDir = join(projectParentDir, "demo-app");

  try {
    const calls = [];
    const exitCode = await main([projectDir], {
      async detectInstalledRuntimes() {
        return ["node"];
      },
      async loadBootstrapCli() {
        return {
          async main(args, options) {
            calls.push({ args, options, cwd: process.cwd() });
            return 0;
          },
        };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(existsSync(projectParentDir), true);
    assert.deepEqual(calls, [{
      args: ["init", "demo-app", "--runtime", "node"],
      options: { hostRuntime: "node" },
      cwd: projectParentDir,
    }]);
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("rewires deno projects to a local Mainz repo when requested", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "create-mainz-local-deno-"));
  const localMainzRepo = join(sandboxDir, "mainz");
  __testables.ensureLocalMainzFixture(localMainzRepo);

  try {
    const exitCode = await main(["demo-app", "--runtime", "deno"], {
      cwd: sandboxDir,
      localMainzRepo,
      async detectInstalledRuntimes() {
        return ["node", "deno"];
      },
      async loadBootstrapCli(receivedLocalMainzRepo) {
        assert.equal(receivedLocalMainzRepo, localMainzRepo);

        return {
          async main() {
            const projectDir = resolve(sandboxDir, "demo-app");
            mkdirSync(projectDir, { recursive: true });
            writeFileSync(
              join(projectDir, "deno.json"),
              `${JSON.stringify({ imports: {}, tasks: {} }, null, 2)}\n`,
            );
            return 0;
          },
        };
      },
    });

    assert.equal(exitCode, 0);
    const denoConfig = JSON.parse(
      readFileSync(join(sandboxDir, "demo-app", "deno.json"), "utf8"),
    );
    assert.equal(
      denoConfig.imports.mainz,
      pathToFileURL(join(localMainzRepo, "mod.ts")).href,
    );
    assert.equal(
      denoConfig.tasks.mainz,
      `deno run -A --config deno.json ${
        pathToFileURL(join(localMainzRepo, "src", "public", "tooling-cli.ts"))
          .href
      }`,
    );
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("rewires node projects to a local Mainz repo when requested", async () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "create-mainz-local-node-"));
  const localMainzRepo = join(sandboxDir, "mainz");
  __testables.ensureLocalMainzFixture(localMainzRepo);

  try {
    const exitCode = await main(["demo-app", "--runtime", "node"], {
      cwd: sandboxDir,
      localMainzRepo,
      async detectInstalledRuntimes() {
        return ["node", "deno"];
      },
      async loadBootstrapCli(receivedLocalMainzRepo) {
        assert.equal(receivedLocalMainzRepo, localMainzRepo);

        return {
          async main() {
            const projectDir = resolve(sandboxDir, "demo-app");
            mkdirSync(join(projectDir, "scripts"), { recursive: true });
            writeFileSync(
              join(projectDir, "package.json"),
              `${JSON.stringify(
                {
                  name: "demo-app",
                  private: true,
                  type: "module",
                  scripts: {
                    mainz: "node ./scripts/mainz.mjs",
                  },
                  dependencies: {
                    mainz: "npm:@jsr/mainz__mainz@0.1.0-alpha.72",
                  },
                  devDependencies: {
                    vite: "^8.0.16",
                  },
                },
                null,
                2,
              )}\n`,
            );
            return 0;
          },
        };
      },
    });

    assert.equal(exitCode, 0);

    const packageJson = JSON.parse(
      readFileSync(join(sandboxDir, "demo-app", "package.json"), "utf8"),
    );
    assert.equal(packageJson.dependencies.mainz, "file:.mainz-local/mainz");
    assert.equal(packageJson.scripts.mainz, "tsx ./scripts/mainz.mjs");
    assert.equal(packageJson.devDependencies.tsx, "4.22.4");
    assert.equal(packageJson.devDependencies.typescript, "5.9.3");
    assert.equal(packageJson.devDependencies["happy-dom"], "20.9.0");
    assert.equal(
      existsSync(join(sandboxDir, "demo-app", ".mainz-local", "mainz", "mod.ts")),
      true,
    );
    assert.equal(
      existsSync(
        join(
          sandboxDir,
          "demo-app",
          ".mainz-local",
          "mainz",
          "src",
          "public",
          "tooling-cli.ts",
        ),
      ),
      true,
    );
    assert.match(
      readFileSync(
        join(
          sandboxDir,
          "demo-app",
          ".mainz-local",
          "mainz",
          "src",
          "tooling",
          "runtime",
          "node.ts",
        ),
        "utf8",
      ),
      /"tsx\/esm\/api"/,
    );
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
