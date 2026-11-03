import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { DndClient } from '@dndworldapp/dnd-client';
import type { NodeDetail, NodeSummary } from '@dndworldapp/schema';

export function NodeDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  
  const nodeId = route.params?.nodeId;
  
  const client = navigation.getState()?.routes?.[navigation.getState().index - 1]?.params?.client;

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadNode() {
      if (!client || !nodeId) {
        setError('Missing node or client');
        setLoading(false);
        return;
      }

      try {
        const { node } = await client.getNode(nodeId);
        setNode(node);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load node');
      } finally {
        setLoading(false);
      }
    }

    loadNode();
  }, [client, nodeId]);

  function handleBack() {
    navigation.goBack();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error || !node) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Node not found'}</Text>
        <TouchableOpacity style={styles.button} onPress={handleBack}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const visibilityColor =
    node.visibility === 'dm' ? '#f59e0b' :
    node.visibility === 'private' ? '#ef4444' :
    node.visibility === 'members' ? '#3b82f6' :
    '#10b981';

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{node.title}</Text>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: visibilityColor + '33' }]}>
            <Text style={[styles.badgeText, { color: visibilityColor }]}>
              {node.visibility.toUpperCase()}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#374151' }]}>
            <Text style={styles.badgeText}>{node.kind.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Metadata */}
      <View style={styles.metadata}>
        <Text style={styles.metaText}>
          Updated: {new Date(node.updatedAt).toLocaleDateString()}
        </Text>
        {node.tags.length > 0 && (
          <View style={styles.tags}>
            {node.tags.map((tag) => (
              <View key={tag.id} style={styles.tagBadge}>
                <Text style={styles.tagText}>#{tag.title}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.contentText}>{node.bodyMd}</Text>
      </View>

      {/* Backlinks */}
      {node.backlinks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Backlinks</Text>
          {node.backlinks.map((link) => (
            <Text key={link.nodeId} style={styles.linkText}>• {link.title}</Text>
          ))}
        </View>
      )}

      {/* Children */}
      {node.children.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Children ({node.children.length})</Text>
          {node.children.map((child) => (
            <TouchableOpacity key={child.id} style={styles.childItem}>
              <Text style={styles.childText}>
                {child.icon} {child.title} ({child.kind})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
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
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  backButtonText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metadata: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  metaText: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 8,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    color: '#d1d5db',
    fontSize: 12,
  },
  content: {
    padding: 16,
  },
  contentText: {
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  section: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  sectionTitle: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  linkText: {
    color: '#6b7280',
    fontSize: 14,
    marginBottom: 4,
  },
  childItem: {
    paddingVertical: 4,
  },
  childText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
  },
});
