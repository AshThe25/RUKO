import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Button, Card, Screen, Txt} from '@/components';
import {colors, radius, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import type {PermissionInfo, PermissionKey} from '@/types';

/**
 * Every permission is explained before it is asked for, and each one says what
 * Ruko will *not* do with it. Dumping a user into Android settings with no
 * context is how a safety app ends up looking like spyware.
 */
const PERMISSIONS: PermissionInfo[] = [
  {
    key: 'microphone',
    title: 'Microphone',
    rationale:
      'Used only during a protected session, to notice when a caller is pressuring you into a payment.',
    limit: 'Audio is processed on this phone and discarded. It is never recorded, stored or uploaded.',
    required: true,
  },
  {
    key: 'notifications',
    title: 'Notification access',
    rationale:
      'Lets Ruko see payment-related messages — "account will be blocked", "complete KYC now" — as extra context.',
    limit: 'A suspicious message alone never triggers a warning. It only counts alongside a suspicious call.',
    required: false,
  },
  {
    key: 'accessibility',
    title: 'Accessibility service',
    rationale:
      'Lets Ruko tell that you are on a payment confirmation screen, and read the amount and recipient shown on it.',
    limit: 'Ruko reads payment screens only. It cannot and does not act on your behalf.',
    required: false,
  },
];

export function PermissionsScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  const setOnboarded = useProtectionStore(s => s.setOnboarded);
  const permissions = useProtectionStore(s => s.permissions);
  const setPermission = useProtectionStore(s => s.setPermission);

  const micGranted = permissions.microphone.granted;

  const toggle = (key: PermissionKey) => {
    // In the app today this records the user's intent. When the native layer
    // lands this is where the real Android request is made — the screen does
    // not change, only what sits behind it.
    setPermission(key, {granted: !permissions[key].granted, explained: true});
  };

  return (
    <Screen
      footer={
        <>
          <Button
            label={micGranted ? 'Continue' : 'Continue without microphone'}
            onPress={() => {
              setOnboarded(true);
              navigate('home');
            }}
            variant={micGranted ? 'primary' : 'secondary'}
            hint={
              micGranted
                ? undefined
                : 'Ruko can still check recipients and amounts, but it will not hear pressure on a call.'
            }
            testID="permissions-continue"
          />
        </>
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        Permissions
      </Txt>
      <Txt variant="title" style={styles.headline}>
        What Ruko needs, and what it does with it.
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        You can turn any of these off later. Ruko keeps working with whatever
        you allow — it just sees less.
      </Txt>

      <View style={styles.list}>
        {PERMISSIONS.map(p => (
          <PermissionCard
            key={p.key}
            info={p}
            granted={permissions[p.key].granted}
            onToggle={() => toggle(p.key)}
          />
        ))}
      </View>
    </Screen>
  );
}

function PermissionCard({
  info,
  granted,
  onToggle,
}: {
  info: PermissionInfo;
  granted: boolean;
  onToggle: () => void;
}) {
  return (
    <Card style={styles.card} borderColor={granted ? colors.borderStrong : colors.border}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitle}>
          <Txt variant="bodyStrong">{info.title}</Txt>
          {info.required ? (
            <Txt variant="label" tone="tertiary" uppercase style={styles.req}>
              Recommended
            </Txt>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{checked: granted}}
          accessibilityLabel={`${info.title} ${granted ? 'allowed' : 'not allowed'}`}
          onPress={onToggle}
          testID={`permission-${info.key}`}
          style={[styles.toggle, granted && styles.toggleOn]}>
          <View style={[styles.knob, granted && styles.knobOn]} />
        </Pressable>
      </View>

      <Txt variant="caption" tone="secondary" style={styles.rationale}>
        {info.rationale}
      </Txt>
      <Txt variant="caption" tone="tertiary" style={styles.limit}>
        {info.limit}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  sub: {marginTop: space.md},
  list: {marginTop: space.xl},
  card: {marginBottom: space.md},
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardTitle: {flex: 1},
  req: {marginTop: 4},
  rationale: {marginTop: space.md},
  limit: {marginTop: space.sm},
  toggle: {
    width: 46,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfacePressed,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {backgroundColor: colors.safe},
  knob: {width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textTertiary},
  knobOn: {backgroundColor: colors.bg, alignSelf: 'flex-end'},
});
