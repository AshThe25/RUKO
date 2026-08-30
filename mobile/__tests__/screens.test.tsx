/**
 * Smoke tests: every screen must mount, in every state it can be in —
 * including the empty, offline and failed ones.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import {ServicesProvider} from '@/services/ServicesContext';
import {createServices} from '@/services/createServices';
import {Router} from '@/navigation/Router';
import {useProtectionStore} from '@/store/protectionStore';
import type {RouteName} from '@/types';

/**
 * Every tree mounted by this file, so each one can be unmounted again.
 *
 * Screens start entrance animations on mount. Left mounted, those animations
 * keep scheduling timers after the test that created them has finished, and
 * eventually fire against a torn-down Jest environment — which crashed the
 * worker outright rather than failing an assertion, so the whole suite was
 * reported as "failed to run" while every test in it actually passed.
 */
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function mount(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  mounted.push(tree!);
  return tree!;
}

function renderAt(route: RouteName) {
  // Rehydration is async; screens under test are past it by definition.
  useProtectionStore.setState({route, stack: [route], hydrated: true});
  // The stub path, so a machine that happens to have a .env does not point
  // these smoke tests at the real Supabase project.
  const runtime = createServices({forceStubs: true});
  return mount(
    <ServicesProvider runtime={runtime}>
      <Router />
    </ServicesProvider>,
  );
}

const ROUTES: RouteName[] = [
  'onboarding',
  'permissions',
  'home',
  'investigation',
  'intervention',
  'guardian',
  'history',
  'engineering',
  'paydemo',
];

describe('screens', () => {
  afterEach(() => {
    ReactTestRenderer.act(() => {
      while (mounted.length) {
        mounted.pop()!.unmount();
      }
    });
    useProtectionStore.setState({
      route: 'home',
      stack: ['home'],
      history: [],
      result: null,
      trace: [],
      revealed: 0,
      status: 'idle',
      error: null,
      hydrated: true,
    });
  });

  it.each(ROUTES)('renders %s', route => {
    expect(() => renderAt(route)).not.toThrow();
  });

  it('shows nothing until the persisted state has been read back', () => {
    useProtectionStore.setState({route: 'home', stack: ['home'], hydrated: false});
    const runtime = createServices({forceStubs: true});
    const tree = mount(
      <ServicesProvider runtime={runtime}>
        <Router />
      </ServicesProvider>,
    );
    // A returning user must never flash past onboarding on their way to home.
    expect(JSON.stringify(tree.toJSON())).not.toContain('Checks today');
  });

  it('renders the app shell', () => {
    useProtectionStore.setState({route: 'onboarding', stack: ['onboarding'], hydrated: true});
    mount(<App />);
  });

  it('renders the investigation screen in its error state', () => {
    useProtectionStore.setState({status: 'error', error: 'Tool unavailable'});
    const tree = renderAt('investigation');
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Ruko could not finish checking');
  });

  it('renders the intervention screen with no result rather than crashing', () => {
    useProtectionStore.setState({result: null});
    const tree = renderAt('intervention');
    expect(JSON.stringify(tree.toJSON())).toContain('no active check');
  });

  it('shows an empty history rather than a blank screen', () => {
    const tree = renderAt('history');
    expect(JSON.stringify(tree.toJSON())).toContain('No checks yet');
  });
});
