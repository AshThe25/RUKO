/**
 * Ruko — on-device protection against social-engineering payment fraud.
 */
import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Router} from '@/navigation/Router';
import {ServicesProvider} from '@/services/ServicesContext';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <Router />
      </ServicesProvider>
    </SafeAreaProvider>
  );
}

export default App;
