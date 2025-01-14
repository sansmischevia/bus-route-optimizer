import type { Stop, BusRoute, School, OptimizationResult, RouteSegment, StartLocation, Location } from '../types/route';
import { MorningOptimizationStrategy } from '../types/route';
import { getTravelEstimate } from './trafficService';

function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function getDateWithTime(timeMinutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(timeMinutes / 60));
  date.setMinutes(timeMinutes % 60);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

interface OptimizationOptions {
  includeReturn: boolean;
  reverseReturnOrder?: boolean;
  prioritizeDirection?: boolean;
  stopDuration?: number;
  morningStrategy?: MorningOptimizationStrategy;
  customStartLocation?: StartLocation;
}

// Utility function to get travel estimates from all stops to a destination
async function getTravelEstimatesToDestination(stops: Stop[], destination: Location): Promise<{ [key: string]: number }> {
  const estimates = await Promise.all(
    stops.map(stop => getTravelEstimate(stop.location, destination, new Date()))
  );
  
  return stops.reduce((acc, stop, index) => {
    acc[stop.address] = estimates[index].duration;
    return acc;
  }, {} as { [key: string]: number });
}

// Utility function to calculate pairwise metrics between stops
async function calculatePairwiseMetrics(stops: Stop[], metric: 'duration' | 'distance'): Promise<{ [key: string]: number }> {
  const metrics: { [key: string]: number } = {};
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const estimate = await getTravelEstimate(
        stops[i].location,
        stops[j].location,
        new Date()
      );
      metrics[`${i}-${j}`] = estimate[metric];
      metrics[`${j}-${i}`] = estimate[metric];
    }
  }
  return metrics;
}

// Generic 2-opt local search optimization
function optimizeSequenceWith2Opt<T>(
  sequence: T[],
  calculateMetric: (seq: T[]) => number,
  maxIterations: number = 100
): T[] {
  let bestSequence = [...sequence];
  let bestMetric = calculateMetric(bestSequence);
  
  let improved = true;
  let iterations = 0;
  
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    
    for (let i = 0; i < bestSequence.length - 1; i++) {
      for (let j = i + 1; j < bestSequence.length; j++) {
        const newSequence = [...bestSequence];
        const subarray = newSequence.slice(i, j + 1);
        newSequence.splice(i, subarray.length, ...subarray.reverse());
        
        const newMetric = calculateMetric(newSequence);
        if (newMetric < bestMetric) {
          bestSequence = newSequence;
          bestMetric = newMetric;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  
  return bestSequence;
}

// Utility function to calculate route segments
async function calculateRouteSegments(
  stops: Stop[],
  school: School,
  currentTime: number,
  stopDuration: number = 0,
  isReturn: boolean = false
): Promise<{
  segments: RouteSegment[];
  estimatedTimes: { [key: string]: number };
  routeDistance: number;
  routeTime: number;
  maxRideTime: number;
  minRideTime: number;
}> {
  const segments: RouteSegment[] = [];
  const estimatedTimes: { [key: string]: number } = {};
  let routeDistance = 0;
  let routeTime = 0;
  let maxRideTime = 0;
  let minRideTime = Infinity;

  // For morning routes:
  // 1. Calculate all segments and times going forward
  // 2. Then calculate pickup times going backward from school arrival
  const workingStops = [...stops];
  let time = currentTime;

  // First, calculate segments and total distance/time
  for (let i = 0; i < workingStops.length; i++) {
    const currentStop = workingStops[i];
    const nextStop = i < workingStops.length - 1 ? workingStops[i + 1] : null;
    const destination = nextStop ? nextStop.location : school.location;
    const destinationName = nextStop ? nextStop.address : school.name;

    const estimate = await getTravelEstimate(
      currentStop.location,
      destination,
      getDateWithTime(time)
    );

    segments.push({
      from: currentStop.address,
      to: destinationName,
      duration: estimate.duration,
      distance: estimate.distance
    });

    routeDistance += estimate.distance;
    routeTime += estimate.duration + (nextStop ? stopDuration : 0);
  }

  // For morning routes, calculate pickup times backwards from school arrival
  if (!isReturn) {
    time = currentTime; // School arrival time
    for (let i = workingStops.length - 1; i >= 0; i--) {
      const currentStop = workingStops[i];
      const segment = segments[i];
      time -= (segment.duration + stopDuration);
      estimatedTimes[currentStop.address] = time;
      
      const rideTime = currentTime - time;
      maxRideTime = Math.max(maxRideTime, rideTime);
      minRideTime = Math.min(minRideTime, rideTime);
    }
  } else {
    // For return routes, calculate drop-off times forward from school departure
    time = currentTime; // School departure time
    for (let i = 0; i < workingStops.length; i++) {
      const currentStop = workingStops[i];
      const segment = segments[i];
      time += (segment.duration + stopDuration);
      estimatedTimes[currentStop.address] = time;
      
      const rideTime = time - currentTime;
      maxRideTime = Math.max(maxRideTime, rideTime);
      minRideTime = Math.min(minRideTime, rideTime);
    }
  }

  return {
    segments,
    estimatedTimes,
    routeDistance,
    routeTime,
    maxRideTime,
    minRideTime
  };
}

async function optimizeByDistanceFromSchool(stops: Stop[], school: School): Promise<Stop[]> {
  const travelEstimates = await getTravelEstimatesToDestination(stops, school.location);
  
  return [...stops].sort((a, b) => travelEstimates[b.address] - travelEstimates[a.address]);
}

async function optimizeByMinimizeRideTime(stops: Stop[], school: School): Promise<Stop[]> {
  const schoolEstimates = await getTravelEstimatesToDestination(stops, school.location);
  const travelTimes = await calculatePairwiseMetrics(stops, 'duration');

  function calculateWeightedRideTime(sequence: Stop[]): number {
    let totalWeightedTime = 0;
    for (let i = 0; i < sequence.length; i++) {
      const timeToSchool = schoolEstimates[sequence[i].address];
      
      let additionalTime = 0;
      for (let j = i + 1; j < sequence.length; j++) {
        const prevStop = sequence[j-1];
        const currStop = sequence[j];
        const key = `${stops.indexOf(prevStop)}-${stops.indexOf(currStop)}`;
        additionalTime += travelTimes[key];
      }
      
      const totalRideTime = timeToSchool + additionalTime;
      totalWeightedTime += totalRideTime * sequence[i].numKids;
    }
    return totalWeightedTime;
  }

  // Start with stops sorted by weighted time from school
  const initialSequence = [...stops].sort((a, b) => 
    (schoolEstimates[b.address] * b.numKids) - (schoolEstimates[a.address] * a.numKids)
  );

  return optimizeSequenceWith2Opt(initialSequence, calculateWeightedRideTime);
}

async function optimizeByMinimizeTotalDistance(stops: Stop[], school: School): Promise<Stop[]> {
  const schoolEstimates = await getTravelEstimatesToDestination(stops, school.location);
  const distances = await calculatePairwiseMetrics(stops, 'distance');

  function calculateTotalDistance(sequence: Stop[]): number {
    let totalDistance = 0;
    
    if (sequence.length > 0) {
      totalDistance += schoolEstimates[sequence[0].address];
      
      for (let i = 0; i < sequence.length - 1; i++) {
        const currentStop = sequence[i];
        const nextStop = sequence[i + 1];
        const key = `${stops.indexOf(currentStop)}-${stops.indexOf(nextStop)}`;
        totalDistance += distances[key];
      }
      
      totalDistance += schoolEstimates[sequence[sequence.length - 1].address];
    }
    
    return totalDistance;
  }

  // Start with stops sorted by distance from school
  const initialSequence = [...stops].sort((a, b) => 
    schoolEstimates[b.address] - schoolEstimates[a.address]
  );

  return optimizeSequenceWith2Opt(initialSequence, calculateTotalDistance);
}

function calculateStudentMinutes(stops: Stop[], estimatedTimes: { [key: string]: number }, schoolArrivalTime: number): number {
  let totalStudentMinutes = 0;
  
  for (const stop of stops) {
    const pickupTime = estimatedTimes[stop.address];
    const rideTime = schoolArrivalTime - pickupTime;
    totalStudentMinutes += rideTime * stop.numKids;
  }
  
  return totalStudentMinutes;
}

export async function optimizeRoutes(
  stops: Stop[],
  school: School,
  busCapacities: number[],
  options: OptimizationOptions = { 
    includeReturn: false, 
    reverseReturnOrder: true, 
    prioritizeDirection: false,
    stopDuration: 1,
    morningStrategy: MorningOptimizationStrategy.DISTANCE_FROM_SCHOOL
  }
): Promise<OptimizationResult> {
  if (options.includeReturn && !school.departureTime) {
    throw new Error('Departure time is required for return trips');
  }

  const schoolArrivalTime = parseTime(school.arrivalTime);
  const schoolDepartureTime = school.departureTime ? parseTime(school.departureTime) : schoolArrivalTime + 420;

  // Sort stops based on selected strategy
  let sortedStops: Stop[];
  switch (options.morningStrategy) {
    case MorningOptimizationStrategy.MINIMIZE_RIDE_TIME:
      sortedStops = await optimizeByMinimizeRideTime(stops, school);
      break;
    case MorningOptimizationStrategy.MINIMIZE_TOTAL_DISTANCE:
      sortedStops = await optimizeByMinimizeTotalDistance(stops, school);
      break;
    case MorningOptimizationStrategy.DISTANCE_FROM_SCHOOL:
    default:
      sortedStops = await optimizeByDistanceFromSchool(stops, school);
  }

  // Initialize stop groups for each bus
  const numBuses = busCapacities.length;
  const stopGroups: Stop[][] = Array(numBuses).fill([]).map(() => []);

  // Assign stops to buses based on distance and capacity
  sortedStops.forEach((stop, index) => {
    const busIndex = index % numBuses;
    const currentBusStops = stopGroups[busIndex];
    const currentCapacity = busCapacities[busIndex];
    
    const totalKidsOnBus = currentBusStops.reduce((sum, s) => sum + s.numKids, 0);
    
    if (totalKidsOnBus + stop.numKids <= currentCapacity) {
      stopGroups[busIndex].push(stop);
    } else {
      // Find next bus with capacity
      for (let i = 0; i < numBuses; i++) {
        if (i !== busIndex) {
          const alternateBusStops = stopGroups[i];
          const alternateBusCapacity = busCapacities[i];
          const alternateBusKids = alternateBusStops.reduce((sum, s) => sum + s.numKids, 0);
          
          if (alternateBusKids + stop.numKids <= alternateBusCapacity) {
            stopGroups[i].push(stop);
            break;
          }
        }
      }
    }
  });

  // Create optimized routes for each bus
  const routes: BusRoute[] = [];
  let totalDistance = 0;
  let totalTime = 0;
  let globalMaxRideTime = 0;
  let globalMinRideTime = Infinity;

  for (let busIndex = 0; busIndex < stopGroups.length; busIndex++) {
    const busStops = stopGroups[busIndex];
    if (busStops.length === 0) continue;

    // Calculate morning route segments
    const morningRoute = await calculateRouteSegments(
      busStops,
      school,
      schoolArrivalTime,
      options.stopDuration,
      false // isReturn = false
    );

    // Calculate return route if needed
    let returnRoute = null;
    if (options.includeReturn) {
      let returnStops: Stop[];

      if (options.reverseReturnOrder) {
        returnStops = [...busStops].reverse();
      } else if (options.prioritizeDirection) {
        returnStops = [...busStops].sort((a, b) => b.location.lat - a.location.lat);
      } else {
        returnStops = [...busStops].sort((a, b) => {
          const distA = Math.sqrt(
            Math.pow(a.location.lat - school.location.lat, 2) + 
            Math.pow(a.location.lng - school.location.lng, 2)
          );
          const distB = Math.sqrt(
            Math.pow(b.location.lat - school.location.lat, 2) + 
            Math.pow(b.location.lng - school.location.lng, 2)
          );
          return distA - distB;
        });
      }

      returnRoute = await calculateRouteSegments(
        returnStops,
        school,
        schoolDepartureTime,
        options.stopDuration,
        true // isReturn = true
      );
    }

    // Update global metrics
    globalMaxRideTime = Math.max(globalMaxRideTime, morningRoute.maxRideTime);
    globalMinRideTime = Math.min(globalMinRideTime, morningRoute.minRideTime);
    totalDistance += morningRoute.routeDistance + (returnRoute?.routeDistance || 0);
    totalTime += morningRoute.routeTime + (returnRoute?.routeTime || 0);

    // Create the route object
    routes.push({
      id: `bus-${busIndex + 1}`,
      busCapacity: busCapacities[busIndex],
      currentKids: busStops.reduce((sum, stop) => sum + stop.numKids, 0),
      stops: busStops,
      estimatedTimes: morningRoute.estimatedTimes,
      segments: morningRoute.segments,
      returnSegments: returnRoute?.segments,
      returnTimes: returnRoute?.estimatedTimes,
      maxRideTime: morningRoute.maxRideTime,
      minRideTime: morningRoute.minRideTime,
      rideTimeEquity: morningRoute.maxRideTime - morningRoute.minRideTime,
      totalStudentMinutes: calculateStudentMinutes(busStops, morningRoute.estimatedTimes, schoolArrivalTime),
      totalRideTime: options.includeReturn ? 
        // For return trips: time from first pickup to school + time from school to last dropoff
        (schoolArrivalTime - Math.min(...Object.values(morningRoute.estimatedTimes))) + 
        (Math.max(...Object.values(returnRoute?.estimatedTimes || {})) - schoolDepartureTime)
        : 
        // For morning only: time from first pickup to school arrival
        schoolArrivalTime - Math.min(...Object.values(morningRoute.estimatedTimes))
    });
  }

  const result: OptimizationResult = {
    routes,
    totalTime,
    totalDistance,
    maxRideTime: globalMaxRideTime,
    minRideTime: globalMinRideTime,
    rideTimeEquity: globalMaxRideTime - globalMinRideTime,
    averageRideTime: routes.reduce((sum, route) => 
      sum + (route.maxRideTime || 0) + (route.minRideTime || 0), 0) / (2 * routes.length)
  };

  return result;
} 