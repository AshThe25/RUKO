import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import type {RukoServices} from '@contracts';
import {useProtectionStore} from '@/store/protectionStore';
import {createServices, type DemoControls, type RukoRuntime} from './createServices';

const RuntimeContext = createContext<RukoRuntime | null>(null);

export function ServicesProvider({
  children,
  runtime,
}: {
  children: React.ReactNode;
  /** Tests inject their own runtime; the app builds the default one. */
  runtime?: RukoRuntime;
}) {
  const noteModelReady = useProtectionStore(st => st.noteModelReady);
  const [value] = useState<RukoRuntime>(
    () => runtime ?? createServices({onModelReady: noteModelReady}),
  );

  useEffect(() => {
    // Loading the classifier is async and can fail. Nothing is thrown at the
    // user: the diagnostics screen reports whatever actually happened, which
    // for a failed load is `loaded: false`, not a crash.
    value.demo.bus.init().catch(() => {});
  }, [value]);

  const memo = useMemo(() => value, [value]);
  return <RuntimeContext.Provider value={memo}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RukoRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error('useRuntime must be used inside <ServicesProvider>');
  }
  return runtime;
}

export function useServices(): RukoServices {
  return useRuntime().services;
}

export function useDemo(): DemoControls {
  return useRuntime().demo;
}
