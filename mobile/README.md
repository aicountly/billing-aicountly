# billing-aicountly — mobile

The iOS/Android app for Billing, built with [Expo](https://expo.dev) (React Native +
TypeScript) and [Expo Router](https://docs.expo.dev/router/introduction/). It talks to
the same PHP API as `../web` and signs in through the same AICOUNTLY portal SSO — see
`../docs/auth/AICOUNTLY_AUTH_WORKFLOW.md` for the shared flow, and "Auth on mobile" below
for what's different here.

This is a scaffold: the foundation (auth, API client, company/session context, a
server-driven tab bar over the five dashboards) is in place and typechecks cleanly, but
most of `web/`'s screens beyond the five dashboards (sales, purchases, parties, reports,
settings, …) are not ported yet. See "What's not built yet" below.

## Getting started

Requires Node.js 22 or newer, and either an iOS Simulator (macOS + Xcode), an Android
emulator (Android Studio), or the [Expo Go](https://expo.dev/go) app on a physical device
for quick iteration. `expo-secure-store` and the portal sign-in flow need a real native
runtime — they will not work in a plain web browser preview.

```bash
cd mobile
npm install
cp .env.example .env
npm start
```

Then press `i` for iOS, `a` for Android, or scan the QR code with Expo Go. `npm run
typecheck` runs `tsc --noEmit` on its own, without starting Metro.

Like `web/`'s `VITE_*` variables, everything in `.env` is inlined into the JS bundle at
build time (Expo's `EXPO_PUBLIC_*` convention — see `.env.example` for what each one
does). `EXPO_PUBLIC_API_BASE_URL` must always be set explicitly: unlike the web app, a
mobile app has no origin of its own to fall back to.

## Layout

```
app/                 Expo Router routes (file-based).
  _layout.tsx           Root layout: boots auth, gates the navigator on sign-in status.
  sign-in.tsx            Shown when signed out.
  index.tsx               Post-auth landing — redirects into the right dashboard tab.
  (dashboards)/           The tab bar and the five dashboard screens.
auth/                 Portal SSO — token storage, sign-in/out, the ses_key lifecycle.
services/             Typed API client (api.ts) and the API response shapes (types.ts).
context/              BillingContext — company/branch/financial-year scope and session.
config.ts             Build-time config, read from EXPO_PUBLIC_* env vars.
components/, constants/  Expo template leftovers: themed Text/View, color tokens.
```

`auth/`, `services/` and `context/` are deliberate ports of `web/src/auth`,
`web/src/services/api.ts` and `web/src/context/BillingContext.tsx` — same shapes and
behavior, adapted where React Native forces a difference (below).

## Auth on mobile — what's different from web

- **No automatic silent SSO bounce.** Web redirects the whole page to the portal the
  moment it has no token, so a user coming from another AICOUNTLY product lands signed
  in without seeing a login screen. That's a jarring full-screen flip on mobile, so
  sign-in here is always an explicit tap: the signed-out screen waits for the user to
  press "Sign in", which opens the portal in an in-app browser
  (`expo-web-browser`'s `openAuthSessionAsync`) and returns via the app's own
  `aicountlybilling://` URL scheme.
- **⚠️ Unverified: the portal's `returnUrl` handling.** `auth/portal.ts` sends
  `returnUrl=aicountlybilling://auth/callback` — a custom scheme, not an https URL. Nobody
  has confirmed yet that `my.aicountly.com` / `sandbox.aicountly.com` accepts that rather
  than rejecting it as an invalid return target. If it doesn't, the fallback is an https
  intermediary page (with iOS Associated Domains / Android App Links) that bounces into
  the app instead — see the `TODO(portal-verify)` comment in `auth/portal.ts`. **Confirm
  this with whoever runs the portal before relying on sign-in in production.**
- **No CORS, so no relay.** web's API client tries its own same-origin `/api/global/*`
  relay before falling back to the portal directly, because a browser enforces CORS and a
  new product domain isn't in the portal's allowlist on day one. Native requests aren't
  subject to CORS at all, so the mobile client always calls the portal directly.
- **No shared-cookie cross-product SSO.** Web can detect "signed in on another AICOUNTLY
  product" via a shared cookie. There's no mobile equivalent of that; each app's sign-in
  is independent.
- **Token storage is async.** `auth_token` is persisted with `expo-secure-store`
  (encrypted keychain/keystore) instead of `localStorage`, so `getAuthToken`/
  `setAuthToken` are `Promise`-returning, unlike web's synchronous versions. `ses_key`
  stays exactly like web: in-memory only, never persisted.

## What's not built yet

- A real company / financial-year picker. Right now, until a scope is chosen, `app/
  index.tsx` shows a plain "Choose a company" placeholder instead of web's `ScopeBar`
  company switcher.
- Everything beyond the five dashboards — sales, purchases, receipts/payments, credit
  and debit notes, Parties, Money to Collect/Pay, Reports, Settings.
- File export/import (`api.download`/`api.upload` were deliberately dropped from
  `services/api.ts` — native file handling needs `expo-file-system` and a share sheet,
  which is its own piece of work).
- The five dashboard screens render their API response as plain `label: value` rows for
  now (top-level primitive fields only); the charts, trends and quick actions web's
  versions have are not ported.
- Typed routes (`app.json`'s `experiments.typedRoutes`) haven't been generated yet in
  this checkout — they're created the first time `expo start` or `expo export` runs. Once
  they exist, `app/index.tsx`'s dynamic `Redirect href` may need a small adjustment; see
  the comment left in that file.
