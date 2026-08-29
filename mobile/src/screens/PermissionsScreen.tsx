import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Linking, PermissionsAndroid, Platform, StyleSheet, View} from 'react-native';
import {Button, Card, Pill, Screen, Txt} from '@/components';
import {colors, space} from '@/theme';
import {getNativeModule, safeNative} from '@/services/native/RukoNative';
import {useProtectionStore} from '@/store/protectionStore';
import {permissionStatus} from '@/types';
import type {PermissionInfo, PermissionKey, PermissionStatus} from '@/types';

/**
 * Every permission is explained before it is asked for, says what Ruko will
 * *not* do with it, and — the part that matters — says what still works if the
 * answer is no.
 *
 * A denied permission is never a dead end. Android only shows its own dialog
 * once; after that the toggle in this screen is useless and the only route
 * back is Settings, so a refusal here always offers that route rather than
 * leaving a switch that silently does nothing.
 */
const PERMISSIONS: PermissionInfo[] = [
  {
    key: 'microphone',
    title: 'Microphone',
    rationale:
      'Used only during a protected session, to notice when a caller is pressuring you into a payment.',
    limit:
      'Audio is processed in memory for one short window and discarded. It is never recorded, stored or uploaded, and no transcript leaves this phone.',
    unlocks: 'Detecting authority, urgency and threats in a live conversation.',
    withoutIt:
      'Ruko still checks recipients and amounts. It cannot hear the person creating the pressure.',
    required: true,
  },
  {
    key: 'accessibility',
    title: 'Accessibility service',
    rationale:
      'Lets Ruko tell that you are on a payment confirmation screen, and read the amount and recipient shown on it.',
    limit:
      'Payment screens only. Ruko cannot tap, type or act on your behalf, anywhere.',
    unlocks: 'Naming the exact payment in the warning, and pausing before you confirm.',
    withoutIt:
      'Ruko still warns you about the conversation, but it will not know what you are about to pay.',
    required: false,
  },
  {
    key: 'notifications',
    title: 'Notification access',
    rationale:
      'Lets Ruko see payment-related messages — "account will be blocked", "complete KYC now" — as extra context.',
    limit:
      'A suspicious message on its own never triggers a warning. It only ever adds to a suspicious call.',
    unlocks: 'Spotting the phishing message that set the call up.',
    withoutIt: 'Everything else works. Ruko just has one fewer corroborating signal.',
    required: false,
  },
];

const STATUS_LABEL: Record<PermissionStatus, string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  unasked: 'Not asked yet',
};

const STATUS_TONE: Record<PermissionStatus, string> = {
  granted: colors.safe,
  denied: colors.high,
  unasked: colors.textTertiary,
};

export function PermissionsScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  const setOnboarded = useProtectionStore(s => s.setOnboarded);
  const permissions = useProtectionStore(s => s.permissions);
  const setPermission = useProtectionStore(s => s.setPermission);
  const [busy, setBusy] = useState<PermissionKey | null>(null);

  /**
   * Ask the device, rather than trusting what we recorded last time. The user
   * can revoke any of these in Settings while the app is backgrounded, and a
   * screen that kept showing "Allowed" after that would be lying.
   */
  const refresh = useCallback(async () => {
    const native = getNativeModule();
    if (!native) {
      return;
    }
    const state = await safeNative(() => native.getPermissionState());
    if (!state) {
      return;
    }
    setPermission('microphone', {granted: state.microphone});
    setPermission('accessibility', {granted: state.accessibility});
    setPermission('notifications', {granted: state.notifications});
  }, [setPermission]);

  useEffect(() => {
    void refresh();
    // Returning from the Settings app is the main way these change, and that
    // arrives as a foreground transition, not as a result callback.
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  async function request(key: PermissionKey) {
    setBusy(key);
    try {
      if (key === 'microphone' && Platform.OS === 'android') {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
        setPermission(key, {
          granted: result === PermissionsAndroid.RESULTS.GRANTED,
          explained: true,
          requested: true,
        });
        return;
      }

      // Accessibility and notification access cannot be granted by a dialog —
      // both live behind a Settings screen the user has to walk through.
      setPermission(key, {explained: true, requested: true});
      await openSettings(key);
    } finally {
      setBusy(null);
    }
  }

  async function openSettings(key: PermissionKey) {
    const native = getNativeModule();
    if (native && key !== 'microphone') {
      const opened = await safeNative(() => native.openSettingsFor(key));
      if (opened) {
        return;
      }
    }
    // The app's own settings page is the right fallback: it is where a
    // previously refused runtime permission is turned back on.
    await Linking.openSettings().catch(() => {
      /* Nothing else to try; the card still explains what is lost. */
    });
  }

  const micGranted = permissions.microphone.granted;

  return (
    <Screen
      testID="permissions-screen"
      footer={
        <Button
          label={micGranted ? 'Continue' : 'Continue without the microphone'}
          onPress={() => {
            setOnboarded(true);
            navigate('home');
          }}
          variant={micGranted ? 'primary' : 'secondary'}
          hint={
            micGranted
              ? undefined
              : 'Ruko will still check recipients and amounts. You can allow this later.'
          }
          testID="permissions-continue"
        />
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        Permissions
      </Txt>
      <Txt variant="title" style={styles.headline} accessibilityRole="header">
        What Ruko needs, and what it does with it.
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        You can change any of these later, in here or in Android settings. Ruko
        keeps working with whatever you allow — it just sees less.
      </Txt>

      <View style={styles.list}>
        {PERMISSIONS.map(info => (
          <PermissionCard
            key={info.key}
            info={info}
            status={permissionStatus(permissions[info.key])}
            busy={busy === info.key}
            onRequest={() => void request(info.key)}
            onOpenSettings={() => void openSettings(info.key)}
          />
        ))}
      </View>
    </Screen>
  );
}

function PermissionCard({
  info,
  status,
  busy,
  onRequest,
  onOpenSettings,
}: {
  info: PermissionInfo;
  status: PermissionStatus;
  busy: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Card
      testID={`permission-${info.key}`}
      style={styles.card}
      borderColor={status === 'granted' ? colors.borderStrong : colors.border}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitle}>
          <Txt variant="bodyStrong">{info.title}</Txt>
          {info.required ? (
            <Txt variant="label" tone="tertiary" uppercase style={styles.req}>
              Recommended
            </Txt>
          ) : null}
        </View>
        <Pill
          label={STATUS_LABEL[status]}
          dotColor={STATUS_TONE[status]}
          fg={STATUS_TONE[status]}
        />
      </View>

      <Txt variant="caption" tone="secondary" style={styles.rationale}>
        {info.rationale}
      </Txt>
      <Txt variant="caption" tone="tertiary" style={styles.limit}>
        {info.limit}
      </Txt>

      <View style={styles.consequence}>
        <Txt variant="label" tone="tertiary" uppercase>
          {status === 'granted' ? 'This is what it gives you' : 'What you get by allowing it'}
        </Txt>
        <Txt variant="caption" tone="secondary" style={styles.consequenceText}>
          {info.unlocks}
        </Txt>
        {status !== 'granted' ? (
          <>
            <Txt variant="label" tone="tertiary" uppercase style={styles.without}>
              If you leave it off
            </Txt>
            <Txt variant="caption" tone="secondary" style={styles.consequenceText}>
              {info.withoutIt}
            </Txt>
          </>
        ) : null}
      </View>

      {status === 'unasked' ? (
        <Button
          label={`Allow ${info.title.toLowerCase()}`}
          variant="quiet"
          loading={busy}
          onPress={onRequest}
          style={styles.action}
          testID={`permission-${info.key}-allow`}
        />
      ) : null}

      {status === 'denied' ? (
        <Button
          label="Open Settings"
          variant="quiet"
          onPress={onOpenSettings}
          hint="Android only shows its own prompt once — this is the way back."
          style={styles.action}
          testID={`permission-${info.key}-settings`}
        />
      ) : null}

      {status === 'granted' ? (
        <Button
          label="Manage in Settings"
          variant="ghost"
          onPress={onOpenSettings}
          style={styles.action}
          testID={`permission-${info.key}-manage`}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  sub: {marginTop: space.md},
  list: {marginTop: space.xl},
  card: {marginBottom: space.md},
  cardHead: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between'},
  cardTitle: {flex: 1, paddingRight: space.md},
  req: {marginTop: 4},
  rationale: {marginTop: space.md},
  limit: {marginTop: space.sm},
  consequence: {marginTop: space.lg},
  consequenceText: {marginTop: 3},
  without: {marginTop: space.md},
  action: {marginTop: space.lg},
});
