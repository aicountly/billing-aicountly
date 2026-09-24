import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/auth/AuthProvider';
import { APP_NAME } from '@/config';

/**
 * Shown only when the automatic portal jump did not happen: after a
 * deliberate sign-out, or when sign-in failed and bouncing back to the
 * portal would just repeat it. Mirrors web/src/pages/SignIn.tsx.
 */
export default function SignIn() {
  const { message, signIn } = useAuth();
  const scheme = useColorScheme();
  const tint = Colors[scheme].tint;

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>AICOUNTLY {APP_NAME}</Text>
      <Text style={styles.message}>{message ?? 'You have been signed out.'}</Text>
      <Pressable style={[styles.button, { backgroundColor: tint }]} onPress={signIn}>
        <Text style={styles.buttonText} lightColor="#fff" darkColor="#000">
          Sign in
        </Text>
      </Pressable>
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
  eyebrow: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.6,
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
