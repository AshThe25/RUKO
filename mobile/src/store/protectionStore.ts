/**
 * Application state. Pure state and setters only — all orchestration lives in
 * `useProtectionController`, so the store stays trivially testable and no
 * screen can accidentally drive the pipeline from a render.
 */
import {create} from 'zustand';
import type {
  GuardianAlert,
  GuardianConnectionState,
  GuardianDecision,
  InvestigationResult,
  InvestigationState,
  PolicyAction,
  RiskLevel,
  RiskReason,
  TraceEntry,
} from '@contracts';
import type {AsyncStatus, PermissionKey, PermissionState, RouteName} from '@/types';
import {newId, now} from '@/utils/id';

/** What the user did after Ruko spoke up. Part of the audit trail (spec §49). */
export type InterventionOutcome =
  | 'NO_INTERRUPTION'
  | 'USER_STOPPED'
  | 'USER_CONTINUED'
  | 'GUARDIAN_BLOCKED'
  | 'GUARDIAN_ALLOWED'
  | 'GUARDIAN_TIMED_OUT';

export interface RiskEventRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  amountMinor: number | null;
  payeeDisplayName: string | null;
  score: number;
  level: RiskLevel;
  policyAction: PolicyAction;
  reasons: RiskReason[];
  degraded: boolean;
  outcome: InterventionOutcome;
  modelVersion: string;
  weightsVersion: string;
  policyVersion: string;
  engineVersion: string;
}

const PERMISSION_KEYS: PermissionKey[] = ['microphone', 'notifications', 'accessibility'];

const initialPermissions = (): Record<PermissionKey, PermissionState> =>
  PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = {key, granted: false, explained: false};
    return acc;
  }, {} as Record<PermissionKey, PermissionState>);

interface ProtectionStore {
  /* routing — a stack, so back always works */
  route: RouteName;
  stack: RouteName[];
  navigate: (route: RouteName) => void;
  replace: (route: RouteName) => void;
  back: () => void;

  /* onboarding + permissions */
  onboarded: boolean;
  permissions: Record<PermissionKey, PermissionState>;
  setOnboarded: (value: boolean) => void;
  setPermission: (key: PermissionKey, patch: Partial<PermissionState>) => void;

  /* protection */
  protectionEnabled: boolean;
  setProtectionEnabled: (value: boolean) => void;
  machineState: InvestigationState;
  setMachineState: (state: InvestigationState) => void;

  /* the current investigation */
  status: AsyncStatus;
  error: string | null;
  trace: TraceEntry[];
  /** How many trace entries the investigation screen has revealed so far. */
  revealed: number;
  result: InvestigationResult | null;
  setStatus: (status: AsyncStatus, error?: string | null) => void;
  pushTrace: (entry: TraceEntry) => void;
  setRevealed: (n: number) => void;
  setResult: (result: InvestigationResult | null) => void;
  resetInvestigation: () => void;

  /* guardian */
  guardianState: GuardianConnectionState;
  guardianAlert: GuardianAlert | null;
  guardianDecision: GuardianDecision | null;
  setGuardianState: (state: GuardianConnectionState) => void;
  setGuardianAlert: (alert: GuardianAlert | null) => void;
  setGuardianDecision: (decision: GuardianDecision | null) => void;

  /* local audit log */
  history: RiskEventRecord[];
  recordEvent: (record: Omit<RiskEventRecord, 'id' | 'timestamp'>) => void;
  updateOutcome: (sessionId: string, outcome: InterventionOutcome) => void;
}

export const useProtectionStore = create<ProtectionStore>(set => ({
  route: 'onboarding',
  stack: ['onboarding'],
  navigate: route =>
    set(s => ({route, stack: s.stack[s.stack.length - 1] === route ? s.stack : [...s.stack, route]})),
  replace: route => set(s => ({route, stack: [...s.stack.slice(0, -1), route]})),
  back: () =>
    set(s => {
      if (s.stack.length <= 1) {
        return s;
      }
      const stack = s.stack.slice(0, -1);
      return {stack, route: stack[stack.length - 1]!};
    }),

  onboarded: false,
  permissions: initialPermissions(),
  setOnboarded: value => set({onboarded: value}),
  setPermission: (key, patch) =>
    set(s => ({permissions: {...s.permissions, [key]: {...s.permissions[key], ...patch}}})),

  protectionEnabled: true,
  setProtectionEnabled: value => set({protectionEnabled: value}),
  machineState: 'IDLE',
  setMachineState: state => set({machineState: state}),

  status: 'idle',
  error: null,
  trace: [],
  revealed: 0,
  result: null,
  setStatus: (status, error = null) => set({status, error}),
  pushTrace: entry => set(s => ({trace: [...s.trace, entry]})),
  setRevealed: n => set({revealed: n}),
  setResult: result => set({result}),
  resetInvestigation: () =>
    set({status: 'idle', error: null, trace: [], revealed: 0, result: null, guardianDecision: null, guardianAlert: null}),

  guardianState: 'UNPAIRED',
  guardianAlert: null,
  guardianDecision: null,
  setGuardianState: state => set({guardianState: state}),
  setGuardianAlert: alert => set({guardianAlert: alert}),
  setGuardianDecision: decision => set({guardianDecision: decision}),

  history: [],
  recordEvent: record =>
    set(s => ({history: [{...record, id: newId('evt'), timestamp: now()}, ...s.history].slice(0, 50)})),
  updateOutcome: (sessionId, outcome) =>
    set(s => ({
      history: s.history.map(h => (h.sessionId === sessionId ? {...h, outcome} : h)),
    })),
}));

/** Selector helpers, so components subscribe to the narrowest slice possible. */
export const selectTodayEvents = (state: {history: RiskEventRecord[]}) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return state.history.filter(h => h.timestamp >= startOfDay.getTime());
};

export const useCheckedToday = () =>
  useProtectionStore(s => selectTodayEvents(s).length);

export const useInterventionsToday = () =>
  useProtectionStore(
    s => selectTodayEvents(s).filter(e => e.policyAction === 'BLOCK_WARNING' || e.policyAction === 'STRONG_WARNING').length,
  );

export {PERMISSION_KEYS};
