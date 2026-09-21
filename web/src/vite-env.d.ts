/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_ENV: string
  /** Portal authentication_jump key. Defaults to the hostname's product. */
  readonly VITE_PRODUCT_KEY: string
  /** Overrides the login portal origin. For local development only. */
  readonly VITE_PORTAL_LOGIN_URL: string
  /** GA4 measurement ID for this product. Analytics is disabled when unset. */
  readonly VITE_GA4_SAAS_BILLING_MEASUREMENT_ID?: string
  /** Generic GA4 measurement ID fallback, checked when the product-specific one is unset. */
  readonly VITE_GA4_MEASUREMENT_ID?: string
  /** Reports: offer scheduling. Off until an endpoint books a schedule. */
  readonly VITE_FEATURE_REPORT_SCHEDULE?: string
  /** Reports: offer the custom report builder. Off until one exists. */
  readonly VITE_FEATURE_REPORT_BUILDER?: string
  /** Reports: offer a list of past exports. Off until the API serves one. */
  readonly VITE_FEATURE_REPORT_EXPORT_HISTORY?: string
  /** Reports: offer the intelligence panel, which opens AI Pulse. On by default. */
  readonly VITE_FEATURE_REPORT_AI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
