import React, {useEffect} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {colors} from '@/theme';
import {
  EngineeringScreen,
  GuardianScreen,
  HistoryScreen,
  HomeScreen,
  InterventionScreen,
  InvestigationScreen,
  OnboardingScreen,
  PayDemoScreen,
  PermissionsScreen,
  SignInScreen,
} from '@/screens';
import {useProtectionStore} from '@/store/protectionStore';
import type {RouteName} from '@/types';

const SCREENS: Record<RouteName, React.ComponentType> = {
  onboarding: OnboardingScreen,
  signin: SignInScreen,
  permissions: PermissionsScreen,
  home: HomeScreen,
  investigation: InvestigationScreen,
  intervention: InterventionScreen,
  guardian: GuardianScreen,
  history: HistoryScreen,
  engineering: EngineeringScreen,
  paydemo: PayDemoScreen,
};

/**
 * A state-driven router rather than a navigation library.
 *
 * Ruko's screens are not a browsing hierarchy — they are the protection state
 * machine made visible. An intervention has to be able to take the screen from
 * anywhere, and the back button must not be able to dismiss it, which is
 * simpler to guarantee here than to fight a navigator over.
 */
export function Router() {
  const route = useProtectionStore(s => s.route);
  const back = useProtectionStore(s => s.back);
  const stack = useProtectionStore(s => s.stack);
  const hydrated = useProtectionStore(s => s.hydrated);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // An intervention is dismissed by making a decision, not by going back.
      if (route === 'intervention' || route === 'investigation') {
        return true;
      }
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [back, route, stack.length]);

  // Reading the persisted slice is async. Showing nothing for that frame is
  // better than flashing onboarding at someone who onboarded weeks ago.
  if (!hydrated) {
    return <View style={styles.splash} />;
  }

  const Screen = SCREENS[route] ?? HomeScreen;
  return <Screen />;
}

const styles = StyleSheet.create({
  splash: {flex: 1, backgroundColor: colors.bg},
});
