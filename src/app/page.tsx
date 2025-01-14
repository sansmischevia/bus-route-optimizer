'use client';

import { useState, useEffect, useCallback } from 'react';
import { optimizeRoutes } from '../utils/routeOptimizer';
import { batchGeocodeAddresses, geocodeAddress } from '../utils/geocoding';
import RouteMap from '../components/RouteMap';
import type { Stop, School, OptimizationResult, StartLocation } from '../types/route';
import { MorningOptimizationStrategy } from '../types/route';
import sampleRouteData from '../data/sample-route-addresses.json';

interface AddressInput {
  school: {
    name: string;
    address: string;
    arrivalTime: string;
    departureTime: string;
  };
  stops: {
    address: string;
    numKids: number;
  }[];
  busCapacities: number[];
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export default function Home() {
  const [school, setSchool] = useState<School>({
    name: '',
    location: { lat: 0, lng: 0 },
    arrivalTime: '08:00'
  });

  const [stops, setStops] = useState<Stop[]>([]);
  const [busCapacities, setBusCapacities] = useState<number[]>([]);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [jsonInput, setJsonInput] = useState(JSON.stringify(sampleRouteData, null, 2));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeReturn, setIncludeReturn] = useState(false);
  const [reverseReturnOrder, setReverseReturnOrder] = useState(true);
  const [prioritizeDirection, setPrioritizeDirection] = useState(false);
  const [stopDuration, setStopDuration] = useState(1);
  const [morningStrategy, setMorningStrategy] = useState<MorningOptimizationStrategy>(
    MorningOptimizationStrategy.DISTANCE_FROM_SCHOOL
  );
  const [customStartAddress, setCustomStartAddress] = useState('');
  const [customStartLocation, setCustomStartLocation] = useState<StartLocation | undefined>();
  const [isGeocodingStart, setIsGeocodingStart] = useState(false);

  const handleJsonSubmit = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data: AddressInput = JSON.parse(jsonInput);
      
      // Geocode school address
      const schoolResult = await geocodeAddress(data.school.address);
      setSchool({
        name: data.school.name,
        location: schoolResult.location,
        arrivalTime: data.school.arrivalTime,
        departureTime: data.school.departureTime
      });

      // Geocode all stop addresses
      const stopResults = await batchGeocodeAddresses(
        data.stops.map(stop => stop.address)
      );

      // Combine geocoded locations with stop data
      const geocodedStops: Stop[] = data.stops.map((stop, index) => ({
        address: stopResults[index].formattedAddress,
        numKids: stop.numKids,
        location: stopResults[index].location
      }));

      setStops(geocodedStops);
      setBusCapacities(data.busCapacities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process input');
      console.error('Error processing input:', err);
    } finally {
      setIsLoading(false);
    }
  }, [jsonInput]);

  // Load sample data on component mount
  useEffect(() => {
    handleJsonSubmit();
  }, [handleJsonSubmit]);

  const handleOptimize = async () => {
    if (!school || stops.length === 0 || busCapacities.length === 0) {
      setError('Please provide all required data first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await optimizeRoutes(stops, school, busCapacities, {
        includeReturn,
        reverseReturnOrder,
        prioritizeDirection,
        stopDuration,
        morningStrategy,
        customStartLocation
      });
      setOptimizationResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error during route optimization');
      console.error('Optimization error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-8">MTS School Bus Route Optimizer</h1>
      <p>This tool helps you optimize bus routes for MTS (Mount Tamalpais School) by considering the distance, time, and number of kids at each stop. It uses Google Maps API to calculate travel times and distances using traffic data. The time at each stop is configurable. If selecting return trip, it will show various routing options. The app will optimize the routes based on the number of buses available, and the list of stops specified.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-4">Input Data (JSON)</h2>
            <textarea
              className="w-full h-64 p-4 border rounded-lg"
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />
            <button
              onClick={handleJsonSubmit}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Processing...' : 'Load Data'}
            </button>
          </div>

          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center space-x-2">
              <span>Stop Duration:</span>
              <input
                type="number"
                min="0"
                max="10"
                value={stopDuration}
                onChange={(e) => setStopDuration(Math.max(0, parseInt(e.target.value) || 0))}
                className="form-input w-16 px-2 py-1 border rounded"
              />
              <span>min</span>
            </div>

            <div className="flex flex-col space-y-2">
              <div className="text-sm font-medium">Morning Route Strategy:</div>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={morningStrategy === MorningOptimizationStrategy.MINIMIZE_RIDE_TIME}
                  onChange={() => {
                    setMorningStrategy(MorningOptimizationStrategy.MINIMIZE_RIDE_TIME);
                    setCustomStartLocation(undefined);
                  }}
                  className="form-radio h-4 w-4 text-blue-600"
                />
                <span>Minimize Ride Time</span>
                <span className="text-xs text-gray-500">(recommended for student comfort)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={morningStrategy === MorningOptimizationStrategy.MINIMIZE_TOTAL_DISTANCE}
                  onChange={() => {
                    setMorningStrategy(MorningOptimizationStrategy.MINIMIZE_TOTAL_DISTANCE);
                    setCustomStartLocation(undefined);
                  }}
                  className="form-radio h-4 w-4 text-blue-600"
                />
                <span>Minimize Total Distance</span>
                <span className="text-xs text-gray-500">(best for fuel efficiency)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={morningStrategy === MorningOptimizationStrategy.DISTANCE_FROM_SCHOOL}
                  onChange={() => {
                    setMorningStrategy(MorningOptimizationStrategy.DISTANCE_FROM_SCHOOL);
                    setCustomStartLocation(undefined);
                  }}
                  className="form-radio h-4 w-4 text-blue-600"
                />
                <span>Distance from School</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={morningStrategy === MorningOptimizationStrategy.DISTANCE_MATRIX}
                  onChange={() => setMorningStrategy(MorningOptimizationStrategy.DISTANCE_MATRIX)}
                  className="form-radio h-4 w-4 text-blue-600"
                />
                <span>Distance Matrix</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={morningStrategy === MorningOptimizationStrategy.NEAREST_NEIGHBOR}
                  onChange={() => setMorningStrategy(MorningOptimizationStrategy.NEAREST_NEIGHBOR)}
                  className="form-radio h-4 w-4 text-blue-600"
                />
                <span>Nearest Neighbor</span>
              </label>

              {(morningStrategy === MorningOptimizationStrategy.DISTANCE_MATRIX || 
                morningStrategy === MorningOptimizationStrategy.NEAREST_NEIGHBOR) && (
                <div className="mt-2 space-y-2">
                  <div className="text-sm">Custom Start Location (optional):</div>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={customStartAddress}
                      onChange={(e) => setCustomStartAddress(e.target.value)}
                      placeholder="Enter start address"
                      className="flex-1 px-2 py-1 border rounded text-sm"
                    />
                    <button
                      onClick={async () => {
                        if (!customStartAddress) {
                          setCustomStartLocation(undefined);
                          return;
                        }
                        setIsGeocodingStart(true);
                        try {
                          const result = await geocodeAddress(customStartAddress);
                          setCustomStartLocation({
                            address: result.formattedAddress,
                            location: result.location
                          });
                        } catch (error: unknown) {
                          console.error('Geocoding error:', error);
                          setError('Failed to geocode start address');
                        } finally {
                          setIsGeocodingStart(false);
                        }
                      }}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
                      disabled={isGeocodingStart}
                    >
                      {isGeocodingStart ? 'Setting...' : 'Set'}
                    </button>
                  </div>
                  {customStartLocation && (
                    <div className="text-sm text-green-600">
                      Start: {customStartLocation.address}
                    </div>
                  )}
                </div>
              )}
            </div>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={includeReturn}
                onChange={(e) => setIncludeReturn(e.target.checked)}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span>Include Return Trip</span>
            </label>

            {includeReturn && (
              <div className="flex flex-col space-y-2 ml-4">
                <div className="text-sm font-medium">Return Route Strategy:</div>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    checked={reverseReturnOrder}
                    onChange={() => {
                      setReverseReturnOrder(true);
                      setPrioritizeDirection(false);
                    }}
                    className="form-radio h-4 w-4 text-blue-600"
                  />
                  <span>Reverse Morning Route</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    checked={!reverseReturnOrder && prioritizeDirection}
                    onChange={() => {
                      setReverseReturnOrder(false);
                      setPrioritizeDirection(true);
                    }}
                    className="form-radio h-4 w-4 text-blue-600"
                  />
                  <span>Follow Bus Direction</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    checked={!reverseReturnOrder && !prioritizeDirection}
                    onChange={() => {
                      setReverseReturnOrder(false);
                      setPrioritizeDirection(false);
                    }}
                    className="form-radio h-4 w-4 text-blue-600"
                  />
                  <span>Optimize by Distance from School</span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-100 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          <button
            onClick={handleOptimize}
            className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            disabled={isLoading || !school || stops.length === 0 || busCapacities.length === 0}
          >
            {isLoading ? 'Optimizing...' : 'Optimize Routes'}
          </button>

          {optimizationResult && (
            <div className="mt-6">
              <h2 className="text-2xl font-semibold mb-4">Results</h2>
              <div className="space-y-2">
                <p>Total Distance: {optimizationResult.totalDistance.toFixed(2)} km</p>
                <p>Total Time: {formatDuration(optimizationResult.totalTime)}</p>
                {optimizationResult.averageRideTime && (
                  <>
                    <p>Average Ride Time: {formatDuration(optimizationResult.averageRideTime)}</p>
                    <p>Time Equity (Max-Min): {formatDuration(optimizationResult.rideTimeEquity || 0)}</p>
                  </>
                )}
                <div className="space-y-4">
                  {optimizationResult.routes.map((route, index) => (
                    <div key={route.id} className="p-4 border rounded">
                      <h3 className="font-semibold">Route {index + 1}</h3>
                      <p>Bus Capacity: {route.busCapacity}</p>
                      <p>Current Kids: {route.currentKids}</p>
                      <p>Stops: {route.stops.length}</p>
                      {route.maxRideTime && (
                        <p>Ride Time Range: {formatDuration(route.minRideTime || 0)} - {formatDuration(route.maxRideTime)}</p>
                      )}
                      <p>Total Student Minutes: {formatDuration(route.totalStudentMinutes)} ({route.totalStudentMinutes} minutes)</p>
                      <p>Total Bus Time: {formatDuration(route.totalRideTime)} ({route.totalRideTime} minutes)</p>
                      
                      <div className="mt-4">
                        <h4 className="font-medium mb-2">Morning Pickup</h4>
                        <div className="space-y-2">
                          {route.stops.map((stop, stopIndex) => (
                            <div key={stopIndex}>
                              <div className="ml-4 flex justify-between items-center">
                                <div>
                                  {stopIndex + 1}. {stop.address} ({stop.numKids} kids)
                                </div>
                                <div className="text-blue-600 font-medium">
                                  {formatTime(route.estimatedTimes[stop.address])}
                                </div>
                              </div>
                              {stopIndex < route.stops.length && route.segments[stopIndex] && (
                                <div className="ml-8 text-sm text-gray-500">
                                  ↳ {formatDuration(route.segments[stopIndex].duration)} to {route.segments[stopIndex].to} 
                                  ({route.segments[stopIndex].distance.toFixed(1)} km)
                                </div>
                              )}
                            </div>
                          ))}
                          <div className="ml-4 flex justify-between items-center text-green-600 font-medium">
                            <div>Arrival at {school.name}</div>
                            <div>{school.arrivalTime}</div>
                          </div>
                        </div>
                      </div>

                      {route.returnSegments && route.returnTimes && (
                        <div className="mt-4">
                          <h4 className="font-medium mb-2">Afternoon Return</h4>
                          <div className="ml-4 flex justify-between items-center text-green-600 font-medium">
                            <div>Departure from {school.name}</div>
                            <div>{school.departureTime}</div>
                          </div>
                          <div className="space-y-2">
                            {[...route.stops]
                              .sort((a, b) => (route.returnTimes?.[a.address] || 0) - (route.returnTimes?.[b.address] || 0))
                              .map((stop, stopIndex) => {
                                const returnSegment = route.returnSegments?.[stopIndex];
                                const returnTime = route.returnTimes?.[stop.address];
                                
                                return (
                                  <div key={stopIndex}>
                                    <div className="ml-4 flex justify-between items-center">
                                      <div>
                                        {stopIndex + 1}. {stop.address} ({stop.numKids} kids)
                                      </div>
                                      {returnTime !== undefined && (
                                        <div className="text-blue-600 font-medium">
                                          {formatTime(returnTime)}
                                        </div>
                                      )}
                                    </div>
                                    {returnSegment && (
                                      <div className="ml-8 text-sm text-gray-500">
                                        ↳ {formatDuration(returnSegment.duration)} from {returnSegment.from} 
                                        ({returnSegment.distance.toFixed(1)} km)
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-[600px]">
          {school && stops.length > 0 && (
            <RouteMap
              routes={optimizationResult?.routes || []}
              school={school}
              center={school.location}
            />
          )}
        </div>
    </div>
    </main>
  );
}
