import React, {useState} from 'react';
import {StyleSheet, TextInput, View} from 'react-native';
import {Button, Card, Screen, Txt} from '@/components';
import {colors, radius, space, type} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import {
  listenForOAuth,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  upsertProfile,
} from '@/services/cloud/auth';

/**
 * Signing in is not a gate on Ruko.
 *
 * Detection runs on the device and needs no account, so a person who never
 * signs in is still protected. An account buys one thing: the ability to tell
 * someone. The screen says that plainly, because a safety app that demands a
 * login before it will do anything is one people abandon at the login.
 */
export function SignInScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isMinor, setIsMinor] = useState(false);

  const canSubmit = email.includes('@') && password.length >= 8 && !busy;

  // The browser returns through ruko://auth; this catches it whether the app
  // stayed alive or was cold-started by the link.
  React.useEffect(
    () =>
      listenForOAuth(result => {
        if (result.error) return setMessage(result.error);
        if (result.user) {
          void upsertProfile(result.user, isMinor).then(() => navigate('home'));
        }
      }),
    [isMinor, navigate],
  );

  async function google() {
    setBusy(true);
    setMessage(null);
    const {error} = await signInWithGoogle();
    if (error) {
      setMessage(
        error.includes('not enabled')
          ? 'Google sign-in is not switched on for this project yet.'
          : error,
      );
    }
    setBusy(false);
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const result =
      mode === 'in'
        ? await signInWithEmail(email.trim(), password)
        : await signUpWithEmail(email.trim(), password);

    if (result.error) {
      setMessage(result.error);
    } else if (result.needsConfirmation) {
      // Saying "check your email" is the honest answer. Pretending the account
      // is live means the next write fails with a permission error instead.
      setMessage('Check your email to confirm the account, then sign in.');
      setMode('in');
    } else if (result.user) {
      await upsertProfile(result.user, isMinor);
      navigate('home');
    }
    setBusy(false);
  }

  return (
    <Screen
      testID="signin-screen"
      footer={
        <Button
          label="Not now — keep protecting me anyway"
          variant="ghost"
          onPress={() => navigate('home')}
        />
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        Trusted circle
      </Txt>
      <Txt variant="title" style={styles.headline}>
        {mode === 'in' ? 'Welcome back.' : 'So someone can help.'}
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        Ruko protects this phone whether or not you sign in. An account only
        lets it reach someone you trust when a payment looks wrong — they see
        the amount, the recipient and the reasons, never your conversation.
      </Txt>

      <Card style={styles.card}>
        <Button
          label="Continue with Google"
          onPress={google}
          disabled={busy}
          hint="Opens your browser — your Google password never touches this app"
        />
        <Txt variant="caption" tone="tertiary" center style={styles.or}>
          or use an email address
        </Txt>

        <Txt variant="label" tone="tertiary" uppercase>
          Email
        </Txt>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Email address"
        />

        <Txt variant="label" tone="tertiary" uppercase style={styles.spacer}>
          Password
        </Txt>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          placeholder="At least 8 characters"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Password"
        />

        {mode === 'up' ? (
          <View style={styles.minorRow}>
            <Button
              label={isMinor ? 'This phone belongs to a child' : 'This phone is mine'}
              variant="ghost"
              onPress={() => setIsMinor(v => !v)}
              hint="Tap to switch — a child's phone alerts a parent instead"
            />
          </View>
        ) : null}

        {message ? (
          <Txt variant="caption" color={colors.critical} style={styles.message}>
            {message}
          </Txt>
        ) : null}

        <Button
          label={mode === 'in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
          style={styles.submit}
        />
        <Button
          label={
            mode === 'in'
              ? 'No account yet? Create one'
              : 'Already have an account? Sign in'
          }
          variant="ghost"
          onPress={() => {
            setMode(m => (m === 'in' ? 'up' : 'in'));
            setMessage(null);
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.sm},
  sub: {marginTop: space.md},
  card: {marginTop: space.xl},
  spacer: {marginTop: space.lg},
  input: {
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surfacePressed,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: type.body.fontSize,
  },
  or: {marginTop: space.lg, marginBottom: space.lg},
  minorRow: {marginTop: space.lg},
  message: {marginTop: space.lg},
  submit: {marginTop: space.xl},
});
