import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBilling } from '@/context/BillingContext';
import { fetchAllCompanies, fetchCompanyInfo, type CompanyOption } from '@/services/manage';
import type { CompanyScope } from '@/services/api';
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

/**
 * Every company the signed-in user can open, read live from Manage —
 * mirrors web/src/shell/ScopeBar.tsx's company step. Picking one opens it at
 * its latest financial year, all branches (bo_id 0); switching branch or year
 * afterward is not built yet in this scaffold — see mobile/README.md.
 */
function CompanyPicker() {
  const { setCompanyScope } = useBilling();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openCompany(cmpId: number) {
    setOpeningId(cmpId);
    setError(null);
    try {
      const info = await fetchCompanyInfo(cmpId);
      // Sorted latest-first by parseCompanyInfo, same as web's openCompany().
      const fyId = info.fyList[0]?.fyId;
      if (fyId === undefined) {
        setError('That company has no financial year set up yet. Add one in Aicountly Manage.');
        return;
      }
      const next: CompanyScope = { cmp_id: cmpId, fy_id: fyId, bo_id: 0 };
      setCompanyScope(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that company's years and branches.");
    } finally {
      setOpeningId(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoadingList(true);

    fetchAllCompanies(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setCompanies(rows);
        setError(null);
        // One company and nothing chosen yet: open it. A list of one is a tap
        // that teaches nobody anything.
        if (rows.length === 1) void openCompany(rows[0].cmpId);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load your companies.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingList(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadingList) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (companies.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No companies yet</Text>
        <Text style={styles.message}>
          {error ?? "You don't have access to any company yet. Ask an owner to add you in Aicountly Manage."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pickerContainer}>
      <Text style={styles.pickerTitle}>Choose a company</Text>
      <FlatList
        data={companies}
        keyExtractor={(company) => String(company.cmpId)}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.companyRow}
            disabled={openingId !== null}
            onPress={() => openCompany(item.cmpId)}
          >
            <Text style={styles.companyName}>
              {item.name}
              {item.ownership === 'shared' ? ' (shared)' : ''}
            </Text>
            {openingId === item.cmpId ? <ActivityIndicator /> : null}
          </Pressable>
        )}
      />
      {error ? <Text style={[styles.message, styles.error]}>{error}</Text> : null}
    </View>
  );
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
    return <CompanyPicker />;
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
  pickerContainer: {
    flex: 1,
    paddingTop: 24,
  },
  pickerTitle: {
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(128,128,128,0.3)',
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  companyName: {
    fontSize: 16,
  },
  error: {
    color: '#dc2626',
    paddingHorizontal: 24,
    marginTop: 12,
  },
});
