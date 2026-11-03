import { useState, useEffect, useRef } from "react";
import { DndClient } from "@dndworldapp/dnd-client";
import type { MapDto, MapMarkerDto } from "@dndworldapp/schema";

interface MapViewerProps {
  nodeId: string;
  client: DndClient;
}

export function MapViewer({ nodeId, client }: MapViewerProps) {
  const [map, setMap] = useState<MapDto | null>(null);
  const [markers, setMarkers] = useState<MapMarkerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadMap() {
      try {
        const [mapResult, markersResult] = await Promise.all([
          client.getMap(nodeId),
          client.listMarkers(nodeId),
        ]);
        setMap(mapResult.map);
        setMarkers(markersResult.markers);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load map");
      } finally {
        setLoading(false);
      }
    }
    loadMap();
  }, [nodeId, client]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading map...</div>
      </div>
    );
  }

  if (error || !map) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">
          <p>{error || "No map data"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full h-full bg-gray-800 rounded-lg overflow-hidden"
        style={{
          backgroundImage: `url(${map.assetUrl})`,
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Render markers overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {markers.map((marker) => (
            <div
              key={marker.id}
              className="absolute transform -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(marker.x / map.width) * 100}%`,
                top: `${(marker.y / map.height) * 100}%`,
              }}
            >
              <div className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                marker.visibility === 'dm' ? 'bg-yellow-900/80 text-yellow-300' :
                marker.visibility === 'members' ? 'bg-blue-900/80 text-blue-300' :
                'bg-gray-900/80 text-gray-300'
              }`}>
                {marker.label || marker.shape}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Map info */}
      <div className="absolute bottom-4 left-4 right-4 bg-gray-900/90 backdrop-blur p-3 rounded-lg">
        <div className="flex items-center justify-between text-sm">
          <div>
            <p className="font-medium text-white">Map</p>
            <p className="text-gray-400 text-xs">
              {markers.length} markers • {map.width}×{map.height}px
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {map.tilingStatus}
          </div>
        </div>
      </div>
    </div>
  );
}
