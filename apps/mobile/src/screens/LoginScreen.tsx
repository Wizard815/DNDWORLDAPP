import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { DndClient } from '@dndworldapp/dnd-client';

interface LoginScreenProps {
  navigation: any;
}

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!serverUrl || !token) {
      Alert.alert('Error', 'Please enter both server URL and token');
      return;
    }

    setLoading(true);
    try {
      const client = new DndClient({ baseUrl: serverUrl, token });
      await client.whoami();
      
      // Store credentials
      await SecureStore.setItemAsync('dnd_server_url', serverUrl);
      await SecureStore.setItemAsync('dnd_token', token);
      
      // Navigate to world list
      navigation.navigate('WorldList', { client });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DNDWORLDAPP</Text>
      <Text style={styles.subtitle}>Mobile Companion</Text>
      
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Server URL (e.g., http://homelab.local:8080)"
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        
        <TextInput
          style={styles.input}
          placeholder="Bearer Token (dwa_...)"
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        
        <Text style={styles.hint}>
          Generate token from web app → Sidebar → Tokens
        </Text>
        
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 40,
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: '#1f2937',
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#374151',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
