import { Tabs } from 'expo-router';

import { useBilling } from '@/context/BillingContext';

/**
 * Route filenames don't all match the server's dashboard `key` 1:1 — the
 * `'biller'` dashboard lives at biller-desk.tsx, named for clarity — so each
 * Tabs.Screen is registered under its route name, looked up from the key.
 * Must stay in sync with app/index.tsx's landing redirect.
 */
const ROUTE_NAMES: Record<string, string> = {
  overview: 'overview',
  biller: 'biller-desk',
  receivables: 'receivables',
  payables: 'payables',
  'cash-compliance': 'cash-compliance',
};

export default function DashboardsLayout() {
  const { session } = useBilling();
  const dashboards = session?.dashboards ?? [];

  return (
    <Tabs>
      {dashboards.map((entry) => (
        <Tabs.Screen
          key={entry.key}
          name={ROUTE_NAMES[entry.key] ?? entry.key}
          options={{ title: entry.label }}
        />
      ))}
    </Tabs>
  );
}
