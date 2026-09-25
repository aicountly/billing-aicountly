# billing-aicountly — mobile

The iOS/Android app for Billing, built with [Expo](https://expo.dev) (React Native +
TypeScript) and [Expo Router](https://docs.expo.dev/router/introduction/). It talks to
the same PHP API as `../web` and signs in through the same AICOUNTLY portal SSO — see
`../docs/auth/AICOUNTLY_AUTH_WORKFLOW.md` for the shared flow, and "Auth on mobile" below
for what's different here.

This is a scaffold, but the core loop is complete end to end and audited: sign in → pick a
company → land on the right dashboard tab → switch company or sign out from any of them.
Most of `web/`'s screens beyond the five dashboards (sales, purchases, parties, reports,
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
  index.tsx               Post-auth landing — the company picker, then redirects into
                           the right dashboard tab once a company is chosen.
  (dashboards)/           The tab bar and the five dashboard screens. Every tab's header
                           carries "Switch" (back to the company picker) and "Sign out".
auth/                 Portal SSO — token storage, sign-in/out, the ses_key lifecycle.
services/             Typed API client (api.ts), API response shapes (types.ts), and the
                       Manage company/branch/financial-year reads (manage.ts).
company/              manageShapes.ts — pure parsers for Manage's several payload shapes.
context/              BillingContext — company/branch/financial-year scope and session.
config.ts             Build-time config, read from EXPO_PUBLIC_* env vars.
components/, constants/  Expo template leftovers: themed Text/View, color tokens.
```

`auth/`, `services/api.ts`, `services/manage.ts`, `company/manageShapes.ts` and `context/`
are deliberate ports of `web/src/auth`, `web/src/services/api.ts`, `web/src/services/manage.ts`,
`web/src/company/manageShapes.ts` and `web/src/context/BillingContext.tsx` — same shapes and
behavior, adapted where React Native forces a difference (below). `app/index.tsx`'s company
picker is a simplified `web/src/shell/ScopeBar.tsx`: picking a company opens it at its latest
financial year, all branches — switching branch or year afterward isn't built yet (see
"What's not built yet").

## Versioning

App version and build number are deliberately decoupled, and every `eas build` follows
this policy automatically — nothing to remember by hand:

- **`expo.version`** in `app.json` (currently `1.0.0`) is the user-facing app version —
  the one shown in the App Store / Play Store listing. It **never changes on its own**.
  Bump it only when explicitly asked to, by editing `app.json`'s `"version"` field
  (that one field drives both platforms).
- **The build number** — `ios.buildNumber` / `android.versionCode` — **auto-increments on
  every `eas build`**, independent of the app version. `eas.json` sets
  `"cli": { "appVersionSource": "remote" }` plus `"autoIncrement": true` on every build
  profile, so EAS tracks and bumps the next build number on its own servers rather than
  by writing a new value into `app.json` (and needing a commit) before each build. The
  `buildNumber: "1"` / `versionCode: 1` checked into `app.json` are only the seed values
  for the very first build.

So: build 1 → `1.0.0 (1)`, build 2 → `1.0.0 (2)`, build 3 → `1.0.0 (3)`, and so on — for
both `eas build --platform ios` and `--platform android` — until someone deliberately
bumps `"version"` in `app.json`, at which point the next build starts a new version with
its build number continuing to climb from wherever EAS's remote counter is (it does not
reset on a version bump unless you reset it in the EAS dashboard).

**Local (non-EAS) builds** — `npx expo prebuild` / `expo run:android` / `expo run:ios` —
read `ios.buildNumber` / `android.versionCode` straight from `app.json` and do **not**
auto-increment them (there's no EAS server involved to track a counter). Bump those two
fields by hand before a local release build if you're not going through `eas build`.

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

- **Branch / financial-year switching after the initial pick.** The company picker
  (`app/index.tsx`) opens a company at its latest FY, all branches — matching what web
  does automatically for a single-company account. Changing branch or year afterward,
  or re-opening a different FY on the same company, needs web's full `ScopeBar` (three
  selects) ported; today that means using "Switch" to go back to the company picker,
  which only re-opens at the latest FY again.
- Everything beyond the five dashboards — sales, purchases, receipts/payments, credit
  and debit notes, Parties, Money to Collect/Pay, Reports, Settings. There is also no
  Settings/Account screen yet, which is why "Switch company" and "Sign out" live directly
  in the dashboard tabs' header instead of a proper account menu.
- App icons/splash are still the generic Expo template placeholders — swap
  `assets/images/icon.png`, the `android-icon-*` set and `splash-icon.png` for real
  AICOUNTLY Billing artwork before a store submission.
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
