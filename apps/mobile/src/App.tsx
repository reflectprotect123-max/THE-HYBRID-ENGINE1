import { NavigationContainer, DarkTheme, type NavigatorScreenParams, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { color } from '@hybrid/design';
import './global.css';

import { DbProvider } from './store/db';
import { RestProvider } from './store/rest';
import { SyncProvider } from './cloud/sync';
import { WhoopProvider } from './cloud/whoop';
import { HomeScreen } from './screens/Home';
import { TrainingScreen } from './screens/Training';
import { LoggerScreen } from './screens/Logger';
import { SettingsScreen } from './screens/Settings';
import { LibraryScreen } from './screens/Library';
import { ProgressScreen } from './screens/Progress';
import { HistoryScreen } from './screens/History';
import { CalendarScreen } from './screens/Calendar';
import { ImportScreen } from './screens/Import';
import { RecapScreen } from './screens/Recap';
import { PlannerScreen } from './screens/Planner';
import { ConditioningScreen } from './screens/Conditioning';

/*
 * The Android app.
 *
 * What shipped before was a WebView pointed at the PWA with four
 * @JavascriptInterface bridges bolted on. This is a native app that shares the
 * web app's ENGINE rather than its DOM — same maths, same contracts, real
 * navigation, real BLE.
 *
 * Five tabs carry the things you open repeatedly. Everything you enter to do
 * ONE thing and then leave — the logger, the plan editor, the recap, a
 * conditioning session — is a stack screen above them, so nothing competes with
 * the work in front of you and the back gesture means what it looks like.
 */

/* Named so a stack screen can send you back to a SPECIFIC tab. Without this
   `navigate('Tabs')` only ever lands on whichever tab was last open, which is
   how a freshly imported session appeared to vanish. */
export type TabParams = {
  Home: undefined;
  Train: undefined;
  Library: undefined;
  Progress: undefined;
  Settings: undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  Logger: { bi: number; ei: number };
  Planner: { id: string };
  Recap: { id: string };
  Conditioning: undefined;
  History: undefined;
  Calendar: undefined;
  Import: undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<TabParams>();

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

/* Glyph tabs rather than an icon dependency — five shapes do not justify
   pulling in a vector-icon package and its font assets. */
const tabIcon = (glyph: string) =>
  function Icon({ color: c, focused }: { color: string; focused: boolean }) {
    return <Text style={{ color: c, fontSize: focused ? 19 : 17 }}>{glyph}</Text>;
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
        // system's 650/750 steps round to the nearest real one here.
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon('⌂') }} />
      <Tabs.Screen name="Train" component={TrainingScreen} options={{ tabBarIcon: tabIcon('⊟') }} />
      <Tabs.Screen name="Library" component={LibraryScreen} options={{ tabBarIcon: tabIcon('▤') }} />
      <Tabs.Screen name="Progress" component={ProgressScreen} options={{ tabBarIcon: tabIcon('◱') }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: tabIcon('⚙') }} />
    </Tabs.Navigator>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <DbProvider>
        <SyncProvider>
          <WhoopProvider>
            <RestProvider>
          <NavigationContainer theme={theme}>
            <StatusBar style="light" />
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.bg },
                animation: 'slide_from_right',
                gestureEnabled: true,
              }}
            >
              <Stack.Screen name="Tabs" component={TabNav} />
              <Stack.Screen name="Logger" component={LoggerScreen} />
              <Stack.Screen name="Planner" component={PlannerScreen} />
              <Stack.Screen name="Recap" component={RecapScreen} />
              <Stack.Screen name="Conditioning" component={ConditioningScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="Calendar" component={CalendarScreen} />
              <Stack.Screen name="Import" component={ImportScreen} />
            </Stack.Navigator>
              </NavigationContainer>
            </RestProvider>
          </WhoopProvider>
        </SyncProvider>
      </DbProvider>
    </SafeAreaProvider>
  );
}
