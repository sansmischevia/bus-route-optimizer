export interface Location {
  lat: number;
  lng: number;
}

export interface StartLocation {
  address: string;
  location: Location;
}

export interface Stop {
  address: string;
  numKids: number;
  location: Location;
}

export interface RouteSegment {
  from: string;
  to: string;
  duration: number;
  distance: number;
}

export interface BusRoute {
  id: string;
  busCapacity: number;
  currentKids: number;
  stops: Stop[];
  estimatedTimes: { [key: string]: number };
  segments: RouteSegment[];
  returnSegments?: RouteSegment[];
  returnTimes?: { [key: string]: number };
  maxRideTime?: number;
  minRideTime?: number;
  rideTimeEquity?: number;
  totalStudentMinutes: number;
  totalRideTime: number;
}

export interface School {
  name: string;
  location: Location;
  arrivalTime: string;
  departureTime?: string;
}

export interface OptimizationResult {
  routes: BusRoute[];
  totalTime: number;
  totalDistance: number;
  maxRideTime?: number;
  minRideTime?: number;
  rideTimeEquity?: number;
  averageRideTime?: number;
}

export interface OptimizationOptions {
  includeReturn: boolean;
  reverseReturnOrder?: boolean;
  prioritizeDirection?: boolean;
  stopDuration?: number;
  morningStrategy?: MorningOptimizationStrategy;
  customStartLocation?: StartLocation;
}

export enum MorningOptimizationStrategy {
  DISTANCE_FROM_SCHOOL = 'DISTANCE_FROM_SCHOOL',
  MINIMIZE_RIDE_TIME = 'MINIMIZE_RIDE_TIME',
  MINIMIZE_TOTAL_DISTANCE = 'MINIMIZE_TOTAL_DISTANCE'
} 