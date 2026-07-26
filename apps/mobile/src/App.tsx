import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { color } from '@hybrid/design';
import './global.css';

import { DbProvider } from './store/db';
import { RestProvider } from './store/rest';
import { HomeScreen } from './screens/Home';
import { TrainingScreen } from './screens/Training';
import { LoggerScreen } from './screens/Logger';
import { SettingsScreen } from './screens/Settings';

/*
 * The Android app, for real this time.
 *
 * What shipped before was a WebView pointed at the PWA with four
 * @JavascriptInterface bridges bolted on. This is a native app that shares the
 * web app's ENGINE rather than its DOM — same maths, same contracts, real
 * navigation, real BLE.
 *
 * The logger is a stack screen above the tabs, not a tab, for the same reason
 * it is full-screen on the web: nothing should compete with the set in front of
 * you while you are under a bar.
 */

export type RootStackParams = {
  Tabs: undefined;
  Logger: { bi: number; ei: number };
};

const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator();

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.gold2,
    background: color.bg,
    card: color.panel3,
    text: color.text,
    border: color.line,
    notification: color.gold,
  },
};

function TabNav() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.gold2,
        tabBarInactiveTintColor: color.dim,
        tabBarStyle: { backgroundColor: color.panel3, borderTopColor: color.line },
        // React Native only accepts the nine standard weights, so the design
        // system's 650/750 steps round to the nearest real one here. The web
        // app keeps the intermediate weights because a variable font can
        // render them.
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Training" component={TrainingScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <DbProvider>
        <RestProvider>
          <NavigationContainer theme={theme}>
            <StatusBar style="light" />
            <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
              <Stack.Screen name="Tabs" component={TabNav} />
              <Stack.Screen
                name="Logger"
                component={LoggerScreen}
                options={{ animation: 'slide_from_right', gestureEnabled: true }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </RestProvider>
      </DbProvider>
    </SafeAreaProvider>
  );
}
