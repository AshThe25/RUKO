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

function renderAt(route: RouteName) {
  useProtectionStore.setState({route, stack: [route]});
  const runtime = createServices();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ServicesProvider runtime={runtime}>
        <Router />
      </ServicesProvider>,
    );
  });
  return tree!;
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
    useProtectionStore.setState({
      route: 'home',
      stack: ['home'],
      history: [],
      result: null,
      trace: [],
      revealed: 0,
      status: 'idle',
      error: null,
    });
  });

  it.each(ROUTES)('renders %s', route => {
    expect(() => renderAt(route)).not.toThrow();
  });

  it('renders the app shell', () => {
    useProtectionStore.setState({route: 'onboarding', stack: ['onboarding']});
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<App />);
    });
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
