import {useEffect, useState} from 'react';
import {AccessibilityInfo} from 'react-native';

/**
 * True when the user has asked the system to reduce motion.
 *
 * Ruko animates for one reason only — to show that something is being worked
 * out — so every animation in the app has a static equivalent. Honouring this
 * flag is not decoration: vestibular sensitivity is real, and a security app
 * that makes someone nauseous during a stressful moment has failed twice.
 *
 * Defaults to `false` and degrades to `false` if the API is unavailable, so a
 * platform that cannot answer still gets a working screen.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(value => {
        if (!cancelled) {
          setReduced(!!value);
        }
      })
      .catch(() => {
        /* An unreadable preference is not an error worth surfacing. */
      });

    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value =>
      setReduced(!!value),
    );

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return reduced;
}
