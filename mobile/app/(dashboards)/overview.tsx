import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { api } from '@/services/api';

const ENDPOINT = 'v1/dashboards/overview';

function titleCase(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function OverviewScreen() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const scheme = useColorScheme();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .one<Record<string, unknown>>(ENDPOINT, undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response.data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={[styles.retryButton, { backgroundColor: Colors[scheme].tint }]} onPress={retry}>
          <Text style={styles.retryText} lightColor="#fff" darkColor="#000">
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  // Object/array fields are richer panels this scaffold doesn't attempt to render.
  const rows = Object.entries(data ?? {}).filter(
    ([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={retry} />}>
      {rows.map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={styles.label}>{titleCase(key)}</Text>
          <Text style={styles.value}>{String(value)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  error: {
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryText: {
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  label: {
    fontSize: 15,
    opacity: 0.7,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
  },
});
