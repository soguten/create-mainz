# create-mainz

Simple unscoped npm package to create Mainz projects from the templates owned by
[`soguten/mainz`](https://github.com/soguten/mainz).

## Usage

```bash
npm create mainz my-app
```

Starter template:

```bash
npx create-mainz my-app --template starter
```

Deno runtime:

```bash
npx create-mainz my-app --runtime deno
```

## Development

Sync templates from the `main` branch of [`soguten/mainz`](https://github.com/soguten/mainz):

```bash
node ./scripts/sync-templates.mjs
```

Run tests:

```bash
node --test
```