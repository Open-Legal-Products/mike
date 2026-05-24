# Development

Install workspace dependencies:

```bash
npm install
```

Run checks:

```bash
npm test --prefix apps/api
./apps/api/node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit
./apps/api/node_modules/.bin/tsc -p packages/api-client/tsconfig.json --noEmit
./apps/api/node_modules/.bin/tsc -p packages/sdk-js/tsconfig.json --noEmit
npm run lint --prefix apps/web
```

Start local development:

```bash
npm run dev --prefix apps/api
npm run dev --prefix apps/web
```
