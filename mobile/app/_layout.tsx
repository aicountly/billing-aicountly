import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { View } from '@/components/Themed';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { BillingProvider } from '@/context/BillingContext';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Gate />
    </ThemeProvider>
  );
}

function Gate() {
  const { status } = useAuth();

  if (status === 'loading') {
    // Fonts might already be loaded but auth is still booting — keep this a
    // plain spinner, not a navigator, since there is nothing to route to yet.
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  const navigator = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(dashboards)" />
      </Stack.Protected>
      <Stack.Protected guard={status !== 'authenticated'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );

  if (status === 'authenticated') {
    // Nothing before sign-in needs a billing session, and mounting this
    // provider with no company scope yet would just fail its first read.
    return <BillingProvider>{navigator}</BillingProvider>;
  }

  return navigator;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
