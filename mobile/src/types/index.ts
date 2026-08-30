/** Screens are addressed by name; the router is driven by the protection store. */
export type RouteName =
  | 'onboarding'
  | 'signin'
  | 'circle'
  | 'hold'
  | 'permissions'
  | 'home'
  | 'investigation'
  | 'intervention'
  | 'guardian'
  | 'history'
  | 'engineering'
  | 'paydemo';

export type PermissionKey = 'microphone' | 'notifications' | 'accessibility';

export interface PermissionInfo {
  key: PermissionKey;
  title: string;
  /** Why Ruko needs it, in the user's terms. Shown before the OS prompt. */
  rationale: string;
  /** What Ruko does NOT do with it. Being explicit is the point. */
  limit: string;
  /** What this permission makes possible, in one line. */
  unlocks: string;
  /** What still works without it. A refusal must never be a dead end. */
  withoutIt: string;
  required: boolean;
}

export interface PermissionState {
  key: PermissionKey;
  granted: boolean;
  /** True once the user has seen the rationale screen for this permission. */
  explained: boolean;
  /**
   * True once the OS prompt has actually been shown for this permission.
   *
   * Optional so state persisted before this field existed still rehydrates.
   * It is what separates "refused" from "nobody has asked yet" — a screen that
   * cannot tell those apart either nags someone who already said no, or leaves
   * a permission looking rejected when it was never requested.
   */
  requested?: boolean;
}

/** What the permissions screen shows for one permission. */
export type PermissionStatus = 'granted' | 'denied' | 'unasked';

export function permissionStatus(state: PermissionState): PermissionStatus {
  if (state.granted) {
    return 'granted';
  }
  return state.requested ? 'denied' : 'unasked';
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';
