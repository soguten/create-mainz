# create-mainz

Thin npm bootstrap wrapper for the published Mainz tooling package.

`create-mainz` does not own template copies or scaffold logic. It delegates
project creation to the published Mainz bootstrap CLI from
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

Runtime selection:

- explicit `--runtime` wins
- otherwise installed runtimes are checked in this order: `node`, `deno`, `bun`
- when multiple runtimes are installed, `node` is the default
- `bun` detection exists, but Mainz bootstrap is not published for Bun yet

## Development

Run tests:

```bash
node --test
```
