#!/usr/bin/env bash
# Usage: scripts-new-app.sh <slug> <Display Name> <subdomain> <proxy-subpath>
set -euo pipefail
SLUG=$1; NAME=$2; SUB=$3; PROXY=$4
ROOT=/home/claude/upwise; SRC=$ROOT/apps/cart-upsell; DST=$ROOT/apps/$SLUG
mkdir -p $DST/app/routes $DST/app/lib $DST/workers $DST/test $DST/extensions $DST/public
cp $SRC/react-router.config.ts $SRC/vite.config.ts $SRC/tsconfig.json $SRC/tsconfig.node.json $SRC/tsconfig.cloudflare.json $SRC/vitest.config.ts $DST/
cp $SRC/public/favicon.ico $DST/public/
cp $SRC/app/root.tsx $SRC/app/globals.d.ts $SRC/app/routes.ts $DST/app/
cat > $DST/package.json <<EOF
{
  "name": "@upwise/$SLUG",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "react-router dev",
    "build": "react-router build",
    "deploy": "react-router build && wrangler deploy",
    "cf-typegen": "wrangler types --strict-vars=false",
    "typecheck": "wrangler types --strict-vars=false && react-router typegen && tsc -p tsconfig.node.json && tsc -p tsconfig.cloudflare.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@shopify/app-bridge-react": "^4.2.13",
    "@shopify/shopify-api": "^15.0.0",
    "@shopify/shopify-app-react-router": "^3.0.1",
    "@shopify/shopify-app-session-storage-drizzle": "^6.0.0",
    "@upwise/platform": "*",
    "@upwise/shopify-app": "*",
    "drizzle-orm": "^0.45.3",
    "isbot": "^5.1.31",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router": "7.18.2"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.62.3",
    "@cloudflare/workers-types": "^5.20261001.1",
    "@react-router/dev": "7.18.2",
    "@react-router/fs-routes": "7.18.2",
    "@shopify/app-bridge-types": "^0.7.2",
    "@shopify/polaris-types": "^1.1.0",
    "@types/node": "^22",
    "@types/react": "^18.3.25",
    "@types/react-dom": "^18.3.7",
    "typescript": "^5.9.3",
    "vite": "^7.3.1",
    "vitest": "^4.1.0",
    "wrangler": "^4.145.0"
  }
}
EOF
cat > $DST/app/env.d.ts <<'EOF'
// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  SHOPIFY_API_SECRET: string;
}
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_SECRET: string;
  }
}
EOF
cat > $DST/app/entry.server.tsx <<'EOF'
import { createHandleRequest } from "@upwise/shopify-app";
import { getShopify } from "./shopify.server";

export default createHandleRequest(getShopify as never);
EOF
cat > $DST/app/routes/auth.\$.tsx <<'EOF'
import type { Route } from "./+types/auth.$";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  await getShopify(context.cloudflare.env).authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
EOF
cat > $DST/app/routes/auth.login.tsx <<EOF
import type { Route } from "./+types/auth.login";
import { getShopify } from "../shopify.server";

/** App Store rule: merchants never type their shop domain. */
export const loader = async ({ request, context }: Route.LoaderArgs) => {
  if (new URL(request.url).searchParams.get("shop")) {
    await getShopify(context.cloudflare.env).login(request);
  }
  return null;
};

export default function Login() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>Open $NAME from Shopify</h1>
      <p>Go to your Shopify admin, open <strong>Apps</strong>, and select $NAME.</p>
    </main>
  );
}
EOF
cat > $DST/app/routes/_index.tsx <<EOF
import type { Route } from "./+types/_index";
import { redirect } from "react-router";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(\`/app?\${url.searchParams.toString()}\`);
  return null;
};

export default function Index() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>$NAME</h1>
      <p>Install from the Shopify App Store to get started.</p>
    </main>
  );
}
EOF
for r in healthz webhooks.app.uninstalled webhooks.app.scopes_update webhooks.compliance; do
  case $r in
    healthz) kind=loader; fn=healthz;;
    webhooks.app.uninstalled) kind=action; fn=uninstalled;;
    webhooks.app.scopes_update) kind=action; fn=scopesUpdate;;
    webhooks.compliance) kind=action; fn=compliance;;
  esac
  cat > $DST/app/routes/$r.tsx <<EOF
import type { Route } from "./+types/$r";
import { shared } from "../shopify.server";

export const $kind = (args: Route.$( [ $kind = loader ] && echo LoaderArgs || echo ActionArgs )) => shared.$fn(args as never);
EOF
done
cat > $DST/workers/app.ts <<'EOF'
import { createRequestHandler } from "react-router";
import { ensureMigrated, platformMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const migrations = [...platformMigrations, ...appMigrations];
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    await ensureMigrated(env.DB, migrations);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
EOF
# legal layout (shared look)
cp $SRC/app/routes/legal.tsx $DST/app/routes/legal.tsx
echo "scaffolded $DST"
