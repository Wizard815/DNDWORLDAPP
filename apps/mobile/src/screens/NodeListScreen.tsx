import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NodeSummary, WorldDto } from '@dndworldapp/schema';

export function NodeListScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  
  const world = route.params?.world as WorldDto;
  
  const client = navigation.getState()?.routes?.[navigation.getState().index - 1]?.params?.client;

  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NodeSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!client || !world) {
      setError('Missing world or client');
      setLoading(false);
      return;
    }

    async function loadNodes() {
      try {
        const { nodes } = await client.tree(world.id);
        setNodes(nodes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load nodes');
      } finally {
        setLoading(false);
      }
    }

    loadNodes();
  }, [client, world]);

  async function handleSearch() {
    if (!searchQuery.trim() || !client || !world) return;

    setIsSearching(true);
    try {
      const { hits } = await client.search(world.id, searchQuery.trim());
      setSearchResults(hits.map((hit: any) => ({
        id: hit.nodeId,
        parentId: null,
        title: hit.title,
        slug: hit.slug,
        icon: null,
        kind: hit.kind,
        visibility: hit.visibility,
        sortKey: '',
        childCount: 0,
        isArchived: false,
        updatedAt: 0,
      })));
    } catch (err) {
      Alert.alert('Search failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSearching(false);
    }
  }

  function handleNodePress(nodeId: string) {
    navigation.navigate('NodeDetail' as never, { nodeId, client });
  }

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

  const displayNodes = isSearching ? searchResults : nodes;

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search nodes..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
        {isSearching && (
          <ActivityIndicator size="small" color="#2563eb" style={styles.searchSpinner} />
        )}
      </View>

      {/* Node list */}
      <FlatList
        data={displayNodes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const visibilityColor =
            item.visibility === 'dm' ? '#f59e0b' :
            item.visibility === 'private' ? '#ef4444' :
            item.visibility === 'members' ? '#3b82f6' :
            '#10b981';

          const kindIcon =
            item.kind === 'map' ? '🗺️' :
            item.kind === 'document' ? '📄' :
            '📝';

          return (
            <TouchableOpacity
              style={styles.nodeCard}
              onPress={() => handleNodePress(item.id)}
            >
              <View style={styles.nodeHeader}>
                <Text style={styles.nodeTitle}>{kindIcon} {item.title}</Text>
                <View style={[styles.visibilityBadge, { backgroundColor: visibilityColor + '33' }]}>
                  <Text style={[styles.visibilityText, { color: visibilityColor }]}>
                    {item.visibility.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.nodeKind}>{item.kind}</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {isSearching ? 'No results found.' : 'No nodes in this world.'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
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
  searchContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: '#ffffff',
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: '#2563eb',
    padding: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  searchSpinner: {
    position: 'absolute',
    right: 60,
    top: 8,
  },
  listContent: {
    padding: 12,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  nodeCard: {
    backgroundColor: '#1f2937',
    padding: 14,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  nodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nodeTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  visibilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  visibilityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  nodeKind: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
    textTransform: 'uppercase',
  },
});
