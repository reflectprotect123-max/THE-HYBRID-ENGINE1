import { useEffect, useState } from 'react';
import { NavigationContainer, DarkTheme, type NavigatorScreenParams, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccessibilityInfo, Text } from 'react-native';
import { useFonts } from 'expo-font';
/* One weight per import, from the per-weight subpath: the package root
   re-exports every weight AND every italic, and Metro bundles whatever is
   required — importing the root would ship ~36 font files for the 6 used. */
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';
import { color, radius } from '@hybrid/design';
import { font } from './ui';
import './global.css';

import { DbProvider } from './store/db';
import { RestProvider } from './store/rest';
import { SetTimerProvider } from './store/setTimer';
import { SyncProvider } from './cloud/sync';
import { WhoopProvider } from './cloud/whoop';
import { Concept2Provider } from './cloud/concept2';
import { HomeScreen } from './screens/Home';
import { TrainingScreen } from './screens/Training';
import { LoggerScreen } from './screens/Logger';
import { SettingsScreen } from './screens/Settings';
import { LibraryScreen } from './screens/Library';
import { ProgressScreen } from './screens/Progress';
import { HistoryScreen } from './screens/History';
import { CalendarScreen } from './screens/Calendar';
import { ExerciseScreen } from './screens/Exercise';
import { DayScreen } from './screens/Day';
import { RecapScreen } from './screens/Recap';
import { PlannerScreen } from './screens/Planner';
import { GuidedBuilderScreen } from './screens/guided/GuidedBuilder';
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
   `navigate('Tabs')` only ever lands on whichever tab was last open, rather
   than on the one holding the thing you just did. */
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
  GuidedBuilder: { id: string };
  Recap: { id: string };
  /* Optional sink: which block of the live session this run belongs to. Absent
     when conditioning is started standalone from Home. */
  Conditioning: { bi?: number; bid?: string } | undefined;
  History: undefined;
  Calendar: undefined;
  /** One movement's whole history. No param = the movement picker. */
  Exercise: { name?: string } | undefined;
  /* Only the date — see Day.tsx's own doc comment for why a workoutId is
     deliberately NOT threaded through navigation params here. */
  Day: { date: string };
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
  /* Whatever chrome the navigator draws itself renders in Inter too. The
     weights are 'normal' on purpose: each Inter file IS its weight, and a
     fontWeight on top invites Android to fake-bold an already-bold face. */
  fonts: {
    regular: { fontFamily: font.reg, fontWeight: 'normal' },
    medium: { fontFamily: font.med, fontWeight: 'normal' },
    bold: { fontFamily: font.semi, fontWeight: 'normal' },
    heavy: { fontFamily: font.bold, fontWeight: 'normal' },
  },
};

/* Glyph tabs rather than an icon dependency — five shapes do not justify
   pulling in a vector-icon package and its font assets. Deliberately raw
   Text, NOT the ui.tsx <T>: these are unicode symbols the system font
   carries and Inter's static files may not. */
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
        /* The active tab per 04-athlete-03: gold ink over a soft gold wash,
           rounded like every other selected surface in the app. */
        tabBarActiveBackgroundColor: color.goldWash,
        tabBarItemStyle: { borderRadius: radius.sm, marginHorizontal: 4, marginVertical: 3 },
        tabBarStyle: { backgroundColor: color.panel3, borderTopColor: color.line },
        tabBarLabelStyle: { fontSize: 11, fontFamily: font.med },
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

/**
 * Whether the OS has been asked to cut animation.
 *
 * Worth honouring for a reason beyond compliance: "Remove animations" is
 * usually switched on by people who get motion sick or who find movement
 * distracting, and this app is used mid-set with a heart rate of 160. A screen
 * that slides in while you are trying to read a target is the exact case that
 * setting exists for.
 *
 * Subscribed rather than read once, because it can be toggled while the app is
 * running and a stale value would be wrong for the rest of the session.
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(!!v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function App() {
  /* Inter is the app's voice — the same family the design cards and both web
     apps set first in their stacks. Rendering before it loads would flash
     every screen in system Roboto, so the app holds on a blank frame for the
     few ms the six weights take. If loading ever ERRORS the app proceeds on
     the system fallback instead: an ugly launch beats no launch. */
  const reduceMotion = useReduceMotion();
  const [fontsReady, fontsError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  if (!fontsReady && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <DbProvider>
        <SyncProvider>
          <WhoopProvider>
            <Concept2Provider>
            <RestProvider>
            <SetTimerProvider>
          <NavigationContainer theme={theme}>
            <StatusBar style="light" />
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.bg },
                /* 'fade', not 'none'. A screen that simply appears reads as a
                   glitch — the eye cannot tell a navigation from a redraw — so
                   the calm version still marks the transition, it just does not
                   travel. */
                animation: reduceMotion ? 'fade' : 'slide_from_right',
                gestureEnabled: true,
              }}
            >
              <Stack.Screen name="Tabs" component={TabNav} />
              <Stack.Screen name="Logger" component={LoggerScreen} />
              <Stack.Screen name="Planner" component={PlannerScreen} />
              <Stack.Screen name="GuidedBuilder" component={GuidedBuilderScreen} />
              <Stack.Screen name="Recap" component={RecapScreen} />
              <Stack.Screen name="Conditioning" component={ConditioningScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="Calendar" component={CalendarScreen} />
              <Stack.Screen name="Exercise" component={ExerciseScreen} />
              <Stack.Screen name="Day" component={DayScreen} />
            </Stack.Navigator>
              </NavigationContainer>
            </SetTimerProvider>
            </RestProvider>
            </Concept2Provider>
          </WhoopProvider>
        </SyncProvider>
      </DbProvider>
    </SafeAreaProvider>
  );
}
