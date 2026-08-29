// Supabase's client builds URLs; React Native has no complete URL global.
import 'react-native-url-polyfill/auto';
/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
