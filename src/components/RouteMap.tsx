import { useCallback, useState, useEffect } from 'react';
import { GoogleMap, Marker, Polyline } from '@react-google-maps/api';
import type { BusRoute, School } from '../types/route';
import { loadGoogleMaps } from '../utils/googleMapsLoader';

interface RouteMapProps {
  routes: BusRoute[];
  school: School;
  center?: { lat: number; lng: number };
}

const RouteMap: React.FC<RouteMapProps> = ({ routes, school, center }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGoogleMaps()
      .then(() => setIsLoaded(true))
      .catch((err) => {
        console.error('Failed to load Google Maps:', err);
        setError('Failed to load Google Maps. Please check your API key and try again.');
      });
  }, []);

  const onLoad = useCallback(() => {
    // Map loaded callback if needed
  }, []);

  const onUnmount = useCallback(() => {
    // Cleanup if needed
  }, []);

  const defaultCenter = center || school.location;

  const colors = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF',
    '#00FFFF', '#FFA500', '#800080', '#008000', '#FFC0CB'
  ];

  if (error) return <div className="text-red-600">{error}</div>;
  if (!isLoaded) return <div>Loading maps...</div>;

  return (
    <div style={{ height: '600px', width: '100%' }}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={defaultCenter}
        zoom={12}
        onLoad={onLoad}
        onUnmount={onUnmount}
      >
        {/* School Marker */}
        <Marker
          position={school.location}
          icon={{
            url: '/school.png',
            scaledSize: new window.google.maps.Size(40, 40)
          }}
          title={school.name}
          label={{
            text: "S",
            color: "white",
            fontWeight: "bold"
          }}
        />

        {/* Route Markers and Lines */}
        {routes.map((route, routeIndex) => (
          <div key={route.id}>
            {/* Draw route lines */}
            <Polyline
              path={[
                ...route.stops.map(stop => stop.location),
                school.location,
              ]}
              options={{
                strokeColor: colors[routeIndex % colors.length],
                strokeWeight: 3,
                strokeOpacity: 0.8,
                geodesic: true
              }}
            />

            {/* Stop markers */}
            {route.stops.map((stop, stopIndex) => (
              <Marker
                key={`${route.id}-${stopIndex}`}
                position={stop.location}
                label={{
                  text: `${stopIndex + 1}`,
                  color: "white",
                  fontWeight: "bold"
                }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  fillColor: colors[routeIndex % colors.length],
                  fillOpacity: 1,
                  strokeWeight: 1,
                  strokeColor: '#FFFFFF',
                  scale: 12,
                }}
                title={`${stop.address} (${stop.numKids} kids)`}
              />
            ))}
          </div>
        ))}
      </GoogleMap>
    </div>
  );
};

export default RouteMap; 