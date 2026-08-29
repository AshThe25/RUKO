/**
 * Ruko — on-device protection against social-engineering payment fraud.
 */
import React, {useEffect} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Router} from '@/navigation/Router';
import {ServicesProvider} from '@/services/ServicesContext';
import {listenForOAuth, upsertProfile} from '@/services/cloud/auth';
import {useProtectionStore} from '@/store/protectionStore';

function App(): React.JSX.Element {
  // App-wide, not per-screen. The browser round trip can outlive any single
  // screen -- Android may restore the app anywhere, or cold-start it from the
  // link -- and a dropped authorisation code is unrecoverable without asking
  // the user to sign in again.
  const navigate = useProtectionStore(st => st.navigate);
  useEffect(
    () =>
      listenForOAuth(result => {
        if (result.error) {
          console.warn('[ruko-auth] ' + result.error);
          return;
        }
        if (result.user) {
          // isMinor defaults false here; the trusted-circle screen is where a
          // person states the relationship, and it can correct the profile.
          void upsertProfile(result.user, false).then(() => navigate('circle'));
        }
      }),
    [navigate],
  );

  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <Router />
      </ServicesProvider>
    </SafeAreaProvider>
  );
}

export default App;
