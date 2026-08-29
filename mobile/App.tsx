/**
 * Ruko — on-device protection against social-engineering payment fraud.
 */
import React, {useEffect} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Router} from '@/navigation/Router';
import {ServicesProvider} from '@/services/ServicesContext';
import {listenForOAuth} from '@/services/cloud/auth';

function App(): React.JSX.Element {
  // App-wide, not per-screen. The browser round trip can outlive any single
  // screen -- Android may restore the app anywhere, or cold-start it from the
  // link -- and a dropped authorisation code is unrecoverable without asking
  // the user to sign in again.
  useEffect(
    () =>
      listenForOAuth(result => {
        if (result.error) console.warn('[ruko-auth] ' + result.error);
      }),
    [],
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
