/** Screens are addressed by name; the router is driven by the protection store. */
export type RouteName =
  | 'onboarding'
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
  required: boolean;
}

export interface PermissionState {
  key: PermissionKey;
  granted: boolean;
  /** True once the user has seen the rationale screen for this permission. */
  explained: boolean;
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';
