import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {Button, Card, Screen, Txt} from '@/components';
import {colors, radius, space, type} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import {currentUser, signOut, type AuthUser} from '@/services/cloud/auth';
import {
  DEFAULT_SPEND_LIMIT_MINOR,
  acceptInvite,
  inviteGuardian,
  inviterLabel,
  listLinks,
  setSpendLimit,
  type Relationship,
  type TrustedLink,
} from '@/services/cloud/trustedCircle';

const RELATIONSHIPS: Relationship[] = [
  'parent', 'child', 'spouse', 'sibling', 'friend', 'caregiver',
];

/**
 * Who is watching, and who this phone watches for.
 *
 * Before this screen a person could sign in and be told nothing: the invite
 * existed only as a row in Postgres and an email from Google. Someone trusting
 * an app to protect their family has to be able to see who it would actually
 * reach, and revoke it, without being asked to take that on faith.
 */
export function CircleScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [links, setLinks] = useState<TrustedLink[]>([]);
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('parent');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const user = await currentUser();
    setMe(user);
    if (user) setLinks(await listLinks());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Rows this person created: the people who would be told about them.
  const guarding = links.filter(l => l.subject_id === me?.id);
  // Rows addressed to this person: people who asked them to watch.
  const watchingFor = links.filter(l => l.subject_id !== me?.id);

  async function invite() {
    setBusy(true);
    setMessage(null);
    try {
      const {error} = await inviteGuardian(email, relationship);
      if (error) setMessage(error);
      else {
        setEmail('');
        setMessage('Invited. They appear as accepted once they sign in and confirm.');
        await refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Only offered on links this person guards. The database refuses it either
   * way, but showing a control that will be rejected is its own failure.
   */
  async function changeLimit(id: string, rupees: number) {
    setBusy(true);
    const {error} = await setSpendLimit(id, rupees * 100);
    if (error) setMessage(error);
    await refresh();
    setBusy(false);
  }

  async function accept(id: string) {
    setBusy(true);
    const {error} = await acceptInvite(id);
    if (error) setMessage(error);
    await refresh();
    setBusy(false);
  }

  if (loaded && !me) {
    return (
      <Screen testID="circle-screen" footer={<Button label="Back" variant="ghost" onPress={() => navigate('home')} />}>
        <Txt variant="title">Not signed in.</Txt>
        <Txt variant="body" tone="secondary" style={styles.gap}>
          Ruko still protects this phone. Signing in only lets it reach someone.
        </Txt>
        <Button label="Sign in" onPress={() => navigate('signin')} style={styles.gap} />
      </Screen>
    );
  }

  return (
    <Screen
      testID="circle-screen"
      footer={<Button label="Back" variant="ghost" onPress={() => navigate('home')} />}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Txt variant="label" tone="tertiary" uppercase>Trusted circle</Txt>
        <Txt variant="title" style={styles.gap}>Who gets told.</Txt>
        {me ? (
          <Txt variant="caption" tone="tertiary" style={styles.small}>
            Signed in as {me.email}
          </Txt>
        ) : null}

        {/* People who would be told about me */}
        <Card style={styles.card}>
          <Txt variant="label" tone="tertiary" uppercase>They watch out for me</Txt>
          {guarding.length === 0 ? (
            <Txt variant="body" tone="secondary" style={styles.small}>
              Nobody yet. Add someone below and Ruko can reach them if a payment
              looks wrong — they see the amount, the recipient and the reasons,
              never your conversation.
            </Txt>
          ) : (
            guarding.map(l => (
              <View key={l.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Txt variant="bodyStrong">{l.guardian_email ?? 'Linked account'}</Txt>
                  <Txt variant="caption" tone="tertiary">
                    {l.relationship} · {l.status === 'accepted' ? 'Active' : 'Waiting for them to confirm'}
                  </Txt>
                </View>
                <View
                  style={[
                    styles.dot,
                    {backgroundColor: l.status === 'accepted' ? colors.safe : colors.textTertiary},
                  ]}
                />
              </View>
            ))
          )}
        </Card>

        {/* People who asked me to watch out for them */}
        {watchingFor.length > 0 ? (
          <Card style={styles.card}>
            <Txt variant="label" tone="tertiary" uppercase>I watch out for them</Txt>
            {watchingFor.map(l => (
              <View key={l.id} style={styles.row}>
                <View style={styles.rowMain}>
                  {inviterLabel(l) ? (
                    <Txt variant="bodyStrong">
                      {inviterLabel(l)} added you as their {l.relationship}
                    </Txt>
                  ) : (
                    // Naming the person is the whole basis for deciding whether
                    // to accept — you cannot judge an anonymous request to
                    // become someone's parent. If the account cannot be
                    // resolved, say so plainly rather than papering over it
                    // with "Someone".
                    <Txt variant="bodyStrong">
                      An account we cannot identify added you as their {l.relationship}
                    </Txt>
                  )}
                  <Txt variant="caption" tone="tertiary">
                    {l.status === 'accepted'
                      ? 'Active — you receive their alerts'
                      : inviterLabel(l)
                        ? 'Waiting for you'
                        : 'Ruko could not confirm who sent this — only accept if you were expecting it'}
                  </Txt>
                </View>
                {l.status === 'accepted' ? (
                  <View style={styles.limitBox}>
                    <Txt variant="caption" tone="tertiary">
                      Tell me when they spend more than
                    </Txt>
                    <View style={styles.limitChips}>
                      {[500, 1000, 2000, 5000].map(r => {
                        const active = (l.spend_limit_minor ?? DEFAULT_SPEND_LIMIT_MINOR) === r * 100;
                        return (
                          <Button
                            key={r}
                            label={`\u20B9${r}`}
                            variant={active ? 'primary' : 'ghost'}
                            onPress={() => changeLimit(l.id, r)}
                            disabled={busy}
                            style={styles.limitChip}
                          />
                        );
                      })}
                    </View>
                    <Txt variant="caption" tone="tertiary" style={styles.small}>
                      Counted across a few hours, not per payment — six small
                      ones add up to the same money as one large one.
                    </Txt>
                  </View>
                ) : (
                  <Button label="Accept" onPress={() => accept(l.id)} disabled={busy} />
                )}
              </View>
            ))}
          </Card>
        ) : null}

        {/* Add someone */}
        <Card style={styles.card}>
          <Txt variant="label" tone="tertiary" uppercase>Add someone</Txt>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="their@email.com"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Their email address"
          />
          <Txt variant="caption" tone="tertiary" style={styles.small}>
            They are to me my…
          </Txt>
          <View style={styles.chips}>
            {RELATIONSHIPS.map(r => (
              <Button
                key={r}
                label={r}
                variant={relationship === r ? 'primary' : 'ghost'}
                onPress={() => setRelationship(r)}
                style={styles.chip}
              />
            ))}
          </View>
          {message ? (
            <Txt variant="caption" color={colors.critical} style={styles.small}>{message}</Txt>
          ) : null}
          <Button
            label="Send invite"
            onPress={invite}
            disabled={!email.includes('@') || busy}
            loading={busy}
            style={styles.gap}
          />
        </Card>

        <Button
          label="Sign out"
          variant="ghost"
          onPress={() => void signOut().then(refresh)}
          style={styles.gap}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: {marginTop: space.lg},
  small: {marginTop: space.sm},
  card: {marginTop: space.xl, gap: space.md},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm},
  rowMain: {flex: 1},
  dot: {width: 8, height: 8, borderRadius: 4},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm},
  chip: {flexGrow: 0},
  limitBox: {marginTop: space.sm, gap: space.sm},
  limitChips: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  limitChip: {flexGrow: 0, minWidth: 78},
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
});
