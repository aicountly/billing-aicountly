import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBilling } from '@/context/BillingContext';
import type { BillingSession } from '@/services/types';

/**
 * Route filenames don't all match the server's dashboard `key` 1:1 — the
 * `'biller'` dashboard lives at app/(dashboards)/biller-desk.tsx, named for
 * clarity — so a redirect target is looked up through this table rather than
 * built from the key directly. Must stay in sync with the Tabs.Screen names
 * in app/(dashboards)/_layout.tsx.
 */
const DASHBOARD_ROUTE_NAMES: Record<string, string> = {
  overview: 'overview',
  biller: 'biller-desk',
  receivables: 'receivables',
  payables: 'payables',
  'cash-compliance': 'cash-compliance',
};

function lastSegment(path: string): string | undefined {
  return path.split('/').filter(Boolean).pop();
}

function landingRouteName(session: BillingSession): string | null {
  const target = lastSegment(session.landing);
  const entry =
    session.dashboards.find((candidate) => lastSegment(candidate.path) === target) ?? session.dashboards[0];

  if (!entry) return null;
  return DASHBOARD_ROUTE_NAMES[entry.key] ?? entry.key;
}

export default function Index() {
  const { session, scope, loading, error } = useBilling();

  if (loading && !session) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!scope) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Choose a company</Text>
        <Text style={styles.message}>Pick the company and financial year to work in.</Text>
        {/*
          TODO: a real company/financial-year picker (mirroring web's ScopeBar
          / company switcher) is not built yet in this scaffold — follow-up.
        */}
      </View>
    );
  }

  if (session) {
    if (session.dashboards.length === 0) {
      return (
        <View style={styles.container}>
          <Text style={styles.message}>No dashboards available for this profile.</Text>
        </View>
      );
    }

    const routeName = landingRouteName(session);
    if (routeName) {
      return <Redirect href={`/(dashboards)/${routeName}`} />;
    }
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      {error ? <Text style={styles.message}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.7,
  },
});
