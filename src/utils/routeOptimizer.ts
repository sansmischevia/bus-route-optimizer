import type { Stop, BusRoute, School, OptimizationResult, RouteSegment, Location, StartLocation } from '../types/route';
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

async function calculateDistanceMatrix(stops: Stop[], school: School): Promise<number[][]> {
  const allPoints = [...stops.map(s => s.location), school.location];
  const matrix: number[][] = Array(allPoints.length).fill(0).map(() => Array(allPoints.length).fill(0));
  
  for (let i = 0; i < allPoints.length; i++) {
    for (let j = 0; j < allPoints.length; j++) {
      if (i !== j) {
        const estimate = await getTravelEstimate(allPoints[i], allPoints[j], new Date());
        matrix[i][j] = estimate.distance;
      }
    }
  }
  
  return matrix;
}

function findNearestNeighbor(current: Location, unvisited: Stop[], matrix: number[][]): number {
  let minDistance = Infinity;
  let nearestIndex = -1;
  const currentIndex = unvisited.length; // Current point is always last in the matrix
  
  for (let i = 0; i < unvisited.length; i++) {
    const distance = matrix[currentIndex][i];
    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }
  
  return nearestIndex;
}

async function optimizeByDistanceMatrix(stops: Stop[], school: School, startLocation?: StartLocation): Promise<Stop[]> {
  const allPoints = [...stops.map(s => s.location)];
  const startPoint = startLocation ? startLocation.location : school.location;
  const matrix: number[][] = Array(allPoints.length + 1).fill(0).map(() => Array(allPoints.length + 1).fill(0));
  
  // Calculate distances between all points including start point
  for (let i = 0; i <= allPoints.length; i++) {
    for (let j = 0; j <= allPoints.length; j++) {
      if (i !== j) {
        const fromPoint = i === allPoints.length ? startPoint : allPoints[i];
        const toPoint = j === allPoints.length ? startPoint : allPoints[j];
        const estimate = await getTravelEstimate(fromPoint, toPoint, new Date());
        matrix[i][j] = estimate.distance;
      }
    }
  }
  
  const optimizedStops: Stop[] = [];
  const unvisited = [...stops];
  
  while (unvisited.length > 0) {
    let minDistance = Infinity;
    let nextStopIndex = -1;
    
    for (let i = 0; i < unvisited.length; i++) {
      const distance = matrix[optimizedStops.length][i];
      if (distance < minDistance) {
        minDistance = distance;
        nextStopIndex = i;
      }
    }
    
    const nextStop = unvisited[nextStopIndex];
    optimizedStops.push(nextStop);
    unvisited.splice(nextStopIndex, 1);
  }
  
  return optimizedStops;
}

async function optimizeByNearestNeighbor(stops: Stop[], school: School, startLocation?: StartLocation): Promise<Stop[]> {
  const optimizedStops: Stop[] = [];
  const unvisited = [...stops];
  let currentLocation = startLocation ? startLocation.location : school.location;
  
  while (unvisited.length > 0) {
    let minDistance = Infinity;
    let nextStopIndex = -1;
    
    for (let i = 0; i < unvisited.length; i++) {
      const estimate = await getTravelEstimate(currentLocation, unvisited[i].location, new Date());
      if (estimate.distance < minDistance) {
        minDistance = estimate.distance;
        nextStopIndex = i;
      }
    }
    
    const nextStop = unvisited[nextStopIndex];
    optimizedStops.push(nextStop);
    currentLocation = nextStop.location;
    unvisited.splice(nextStopIndex, 1);
  }
  
  return optimizedStops;
}

async function optimizeByDistanceFromSchool(stops: Stop[], school: School): Promise<Stop[]> {
  const travelEstimates = await Promise.all(
    stops.map(stop => 
      getTravelEstimate(
        stop.location,
        school.location,
        new Date()
      )
    )
  );

  return [...stops].sort((a, b) => {
    const indexA = stops.indexOf(a);
    const indexB = stops.indexOf(b);
    return travelEstimates[indexB].duration - travelEstimates[indexA].duration;
  });
}

async function optimizeByMinimizeRideTime(stops: Stop[], school: School): Promise<Stop[]> {
  // Get travel times from all stops to school
  const schoolEstimates = await Promise.all(
    stops.map(stop => 
      getTravelEstimate(
        stop.location,
        school.location,
        new Date()
      )
    )
  );

  // Calculate all pairwise travel times between stops
  const travelTimes: { [key: string]: number } = {};
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const estimate = await getTravelEstimate(
        stops[i].location,
        stops[j].location,
        new Date()
      );
      travelTimes[`${i}-${j}`] = estimate.duration;
      travelTimes[`${j}-${i}`] = estimate.duration;
    }
  }

  // Helper function to calculate weighted total ride time for a given sequence
  function calculateWeightedRideTime(sequence: Stop[]): number {
    let totalWeightedTime = 0;
    for (let i = 0; i < sequence.length; i++) {
      const stopIndex = stops.indexOf(sequence[i]);
      const timeToSchool = schoolEstimates[stopIndex].duration;
      
      // Add cumulative time from previous stops
      let additionalTime = 0;
      for (let j = i + 1; j < sequence.length; j++) {
        const prevStopIndex = stops.indexOf(sequence[j-1]);
        const currStopIndex = stops.indexOf(sequence[j]);
        additionalTime += travelTimes[`${prevStopIndex}-${currStopIndex}`];
      }
      
      // Weight the total ride time by number of kids at this stop
      const totalRideTime = timeToSchool + additionalTime;
      totalWeightedTime += totalRideTime * sequence[i].numKids;
    }
    return totalWeightedTime;
  }

  // Start with stops sorted by weighted time from school
  let bestSequence = [...stops].sort((a, b) => {
    const indexA = stops.indexOf(a);
    const indexB = stops.indexOf(b);
    // Weight the time by number of kids
    const weightedTimeA = schoolEstimates[indexA].duration * a.numKids;
    const weightedTimeB = schoolEstimates[indexB].duration * b.numKids;
    return weightedTimeB - weightedTimeA;
  });

  let bestWeightedTime = calculateWeightedRideTime(bestSequence);

  // Try to improve the sequence using 2-opt local search
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Prevent infinite loops
  
  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;
    
    for (let i = 0; i < bestSequence.length - 1; i++) {
      for (let j = i + 1; j < bestSequence.length; j++) {
        // Create new sequence by reversing subarray from i to j
        const newSequence = [...bestSequence];
        const subarray = newSequence.slice(i, j + 1);
        newSequence.splice(i, subarray.length, ...subarray.reverse());
        
        const newWeightedTime = calculateWeightedRideTime(newSequence);
        if (newWeightedTime < bestWeightedTime) {
          bestSequence = newSequence;
          bestWeightedTime = newWeightedTime;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return bestSequence;
}

async function optimizeByMinimizeTotalDistance(stops: Stop[], school: School): Promise<Stop[]> {
  // Get distances from all stops to school
  const schoolEstimates = await Promise.all(
    stops.map(stop => 
      getTravelEstimate(
        stop.location,
        school.location,
        new Date()
      )
    )
  );

  // Calculate all pairwise distances between stops
  const distances: { [key: string]: number } = {};
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const estimate = await getTravelEstimate(
        stops[i].location,
        stops[j].location,
        new Date()
      );
      distances[`${i}-${j}`] = estimate.distance;
      distances[`${j}-${i}`] = estimate.distance;
    }
  }

  // Helper function to calculate total distance for a given sequence
  function calculateTotalDistance(sequence: Stop[]): number {
    let totalDistance = 0;
    
    // Add distance from first stop to school
    if (sequence.length > 0) {
      const firstStopIndex = stops.indexOf(sequence[0]);
      totalDistance += schoolEstimates[firstStopIndex].distance;
    }
    
    // Add distances between consecutive stops
    for (let i = 0; i < sequence.length - 1; i++) {
      const currentStopIndex = stops.indexOf(sequence[i]);
      const nextStopIndex = stops.indexOf(sequence[i + 1]);
      totalDistance += distances[`${currentStopIndex}-${nextStopIndex}`];
    }
    
    // Add distance from last stop to school
    if (sequence.length > 0) {
      const lastStopIndex = stops.indexOf(sequence[sequence.length - 1]);
      totalDistance += schoolEstimates[lastStopIndex].distance;
    }
    
    return totalDistance;
  }

  // Start with stops sorted by distance from school
  let bestSequence = [...stops].sort((a, b) => {
    const indexA = stops.indexOf(a);
    const indexB = stops.indexOf(b);
    return schoolEstimates[indexB].distance - schoolEstimates[indexA].distance;
  });

  let bestTotalDistance = calculateTotalDistance(bestSequence);

  // Try to improve the sequence using 2-opt local search
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Prevent infinite loops
  
  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;
    
    for (let i = 0; i < bestSequence.length - 1; i++) {
      for (let j = i + 1; j < bestSequence.length; j++) {
        // Create new sequence by reversing subarray from i to j
        const newSequence = [...bestSequence];
        const subarray = newSequence.slice(i, j + 1);
        newSequence.splice(i, subarray.length, ...subarray.reverse());
        
        const newTotalDistance = calculateTotalDistance(newSequence);
        if (newTotalDistance < bestTotalDistance) {
          bestSequence = newSequence;
          bestTotalDistance = newTotalDistance;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return bestSequence;
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
    case MorningOptimizationStrategy.DISTANCE_MATRIX:
      sortedStops = await optimizeByDistanceMatrix(stops, school, options.customStartLocation);
      break;
    case MorningOptimizationStrategy.NEAREST_NEIGHBOR:
      sortedStops = await optimizeByNearestNeighbor(stops, school, options.customStartLocation);
      break;
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

    // Start from the furthest stop and work towards school
    const optimizedStops: Stop[] = [];
    const segments: RouteSegment[] = [];
    let routeDistance = 0;
    let routeTime = 0;

    let currentTime = schoolArrivalTime;
    const estimatedTimes: { [key: string]: number } = {};
    let maxRideTime = 0;
    let minRideTime = Infinity;

    // Work backwards from school to calculate pickup times
    for (let i = busStops.length - 1; i >= 0; i--) {
      const currentStop = busStops[i];
      const nextStop = i < busStops.length - 1 ? busStops[i + 1] : null;
      const destination = nextStop ? nextStop.location : school.location;
      const destinationName = nextStop ? nextStop.address : school.name;

      const estimate = await getTravelEstimate(
        currentStop.location,
        destination,
        getDateWithTime(currentTime)
      );

      segments.push({
        from: currentStop.address,
        to: destinationName,
        duration: estimate.duration,
        distance: estimate.distance
      });

      // Add stop duration to the timing calculations
      currentTime -= (estimate.duration + (options.stopDuration || 0));
      estimatedTimes[currentStop.address] = currentTime;
      
      const rideTime = schoolArrivalTime - currentTime;
      maxRideTime = Math.max(maxRideTime, rideTime);
      minRideTime = Math.min(minRideTime, rideTime);
      
      if (nextStop) {
        routeDistance += estimate.distance;
        routeTime += estimate.duration + (options.stopDuration || 0);
      } else {
        routeDistance += estimate.distance;
        routeTime += estimate.duration;
      }
      
      optimizedStops.push(currentStop);
    }

    // Calculate return trip if needed
    const returnSegments: RouteSegment[] = [];
    const returnTimes: { [key: string]: number } = {};

    if (options.includeReturn) {
      const returnTime = schoolDepartureTime;
      let returnStops: Stop[];

      if (options.reverseReturnOrder) {
        // Reverse morning route exactly
        returnStops = [...optimizedStops].reverse();
      } else if (options.prioritizeDirection) {
        // Sort stops by latitude (north to south), assuming school is north of SF
        returnStops = [...optimizedStops].sort((a, b) => {
          return b.location.lat - a.location.lat;
        });
      } else {
        // Use proximity-based ordering from school
        returnStops = [...optimizedStops].sort((a, b) => {
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

      // Calculate all travel segments first
      const returnEstimates = await Promise.all([
        // First segment: school to first stop
        getTravelEstimate(
          school.location,
          returnStops[0].location,
          getDateWithTime(returnTime)
        ),
        // Remaining segments: between stops
        ...returnStops.slice(1).map((stop, i) => 
          getTravelEstimate(
            returnStops[i].location,
            stop.location,
            getDateWithTime(returnTime)
          )
        )
      ]);

      // Calculate cumulative times by adding travel times and stop durations
      let currentTime = returnTime;
      
      // First stop: departure time + travel from school + stop duration
      returnSegments.push({
        from: school.name,
        to: returnStops[0].address,
        duration: returnEstimates[0].duration,
        distance: returnEstimates[0].distance
      });
      
      currentTime += returnEstimates[0].duration + (options.stopDuration || 0);
      returnTimes[returnStops[0].address] = currentTime;
      routeDistance += returnEstimates[0].distance;
      routeTime += returnEstimates[0].duration + (options.stopDuration || 0);

      // Remaining stops
      for (let i = 1; i < returnStops.length; i++) {
        const estimate = returnEstimates[i];
        
        returnSegments.push({
          from: returnStops[i-1].address,
          to: returnStops[i].address,
          duration: estimate.duration,
          distance: estimate.distance
        });

        currentTime += estimate.duration + (options.stopDuration || 0);
        returnTimes[returnStops[i].address] = currentTime;
        
        routeDistance += estimate.distance;
        routeTime += estimate.duration + (options.stopDuration || 0);
      }
    }

    // Reverse the arrays since we built them backwards
    optimizedStops.reverse();
    segments.reverse();

    globalMaxRideTime = Math.max(globalMaxRideTime, maxRideTime);
    globalMinRideTime = Math.min(globalMinRideTime, minRideTime);

    routes.push({
      id: `bus-${busIndex + 1}`,
      busCapacity: busCapacities[busIndex],
      currentKids: optimizedStops.reduce((sum, stop) => sum + stop.numKids, 0),
      stops: optimizedStops,
      estimatedTimes,
      segments,
      returnSegments: options.includeReturn ? returnSegments : undefined,
      returnTimes: options.includeReturn ? returnTimes : undefined,
      maxRideTime,
      minRideTime,
      rideTimeEquity: maxRideTime - minRideTime,
      totalStudentMinutes: calculateStudentMinutes(optimizedStops, estimatedTimes, schoolArrivalTime),
      totalRideTime: options.includeReturn ? 
        // For return trips: time from first pickup to school + time from school to last dropoff
        (schoolArrivalTime - Math.min(...Object.values(estimatedTimes))) + 
        (Math.max(...Object.values(returnTimes || {})) - schoolDepartureTime)
        : 
        // For morning only: time from first pickup to school arrival
        schoolArrivalTime - Math.min(...Object.values(estimatedTimes))
    });

    totalDistance += routeDistance;
    totalTime += routeTime;
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