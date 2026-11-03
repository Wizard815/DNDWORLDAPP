import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { WorldDto, NodeSummary } from '@dndworldapp/schema';

export function WorldListScreen() {
  const navigation = useNavigation<any>();
  const [worlds, setWorlds] = useState<WorldDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const client = navigation.getState()?.routes?.[navigation.getState().index - 1]?.params?.client;

  useEffect(() => {
    if (!client) {
      setError('No client available. Please log in again.');
      setLoading(false);
      return;
    }

    async function loadWorlds() {
      try {
        const { worlds } = await client.listWorlds();
        setWorlds(worlds);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load worlds');
      } finally {
        setLoading(false);
      }
    }

    loadWorlds();
  }, [client]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (worlds.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No worlds found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={worlds}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.worldCard}
          onPress={() => navigation.navigate('NodeList', { world: item })}
        >
          <Text style={styles.worldName}>{item.name}</Text>
          <Text style={styles.worldRole}>Role: {item.role}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 14,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  worldCard: {
    backgroundColor: '#1f2937',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  worldName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  worldRole: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
});
