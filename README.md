# create-mainz

Create a new Mainz project.

## Requirements

- Node.js `>= 20.19.0`
- For Deno projects, `deno` must also be installed

## Quick start

Create a new project with the default runtime:

```bash
npm create mainz my-app
```

Create a starter project:

```bash
npm create mainz my-app -- --template starter
```

Create a Deno project:

```bash
npm create mainz my-app -- --runtime deno
```

Create a Deno starter project:

```bash
npm create mainz my-app -- --runtime deno --template starter
```

Use the alpha release:

```bash
npm create mainz@alpha my-app
```

## Options

- `--runtime <node|deno|bun>`
- `--template <empty|starter>`
- `--mainz <specifier>`

Examples:

```bash
npm create mainz my-app -- --template starter
npm create mainz my-app -- --runtime deno --template starter
npm create mainz my-app -- --mainz jsr:@mainz/mainz@0.1.0-alpha.73
```

## Runtime selection

If you do not pass `--runtime`, `create-mainz` checks installed runtimes in this
order:

1. `node`
2. `deno`
3. `bun`

When multiple runtimes are available, `node` is chosen by default.

`bun` is detected, but Mainz project bootstrap is not published for Bun yet.

## After scaffolding

The generated project includes the Mainz tasks/scripts you need, but `dev`,
`build`, `preview`, and `diagnose` still require an explicit target.

Starter templates already include an `app` target:

Node starter projects:

```bash
cd my-app
npm install
npm run dev -- --target app
```

Deno starter projects:

```bash
cd my-app
deno task dev --target app
```

Empty templates start with no targets. Create one first, then pass it to the
command:

Node empty projects:

```bash
cd my-app
npm install
npm run mainz -- app create my-app
npm run dev -- --target my-app
```

Deno empty projects:

```bash
cd my-app
deno task mainz app create my-app
deno task dev --target my-app
```
