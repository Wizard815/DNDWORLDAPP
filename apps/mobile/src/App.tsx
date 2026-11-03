import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from './screens/LoginScreen';
import { WorldListScreen } from './screens/WorldListScreen';
import { NodeListScreen } from './screens/NodeListScreen';
import { NodeDetailScreen } from './screens/NodeDetailScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Connect' }} />
        <Stack.Screen name="WorldList" component={WorldListScreen} options={{ title: 'Select World' }} />
        <Stack.Screen name="NodeList" component={NodeListScreen} options={{ title: 'Nodes' }} />
        <Stack.Screen name="NodeDetail" component={NodeDetailScreen} options={{ title: 'Node Detail' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
