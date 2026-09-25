import { router, Tabs } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/Themed';
import { useAuth } from '@/auth/AuthProvider';
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

/**
 * Every dashboard tab carries the same two escapes, since nothing else in
 * this scaffold offers them yet (there is no Settings/Account screen — see
 * mobile/README.md): switch to a different company, or sign out entirely.
 */
function HeaderActions() {
  const { clearCompanyScope } = useBilling();
  const { signOut } = useAuth();

  return (
    <>
      <Pressable
        onPress={() => {
          clearCompanyScope();
          router.replace('/');
        }}
        hitSlop={8}
        style={styles.headerButton}
      >
        <Text style={styles.headerButtonText}>Switch</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          // Also drop the persisted company/branch/year, not just the auth
          // tokens: without this, whoever signs in next on this device would
          // briefly inherit this profile's scope before picking their own.
          clearCompanyScope();
          signOut();
        }}
        hitSlop={8}
        style={styles.headerButton}
      >
        <Text style={styles.headerButtonText}>Sign out</Text>
      </Pressable>
    </>
  );
}

export default function DashboardsLayout() {
  const { session } = useBilling();
  const dashboards = session?.dashboards ?? [];

  return (
    <Tabs screenOptions={{ headerRight: () => <HeaderActions /> }}>
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

const styles = StyleSheet.create({
  headerButton: {
    paddingHorizontal: 10,
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
