import { loadGoogleMaps } from './googleMapsLoader';

interface Location {
  lat: number;
  lng: number;
}

interface TravelEstimate {
  duration: number;  // in minutes
  distance: number;  // in kilometers
}

function getNextValidDate(time: Date): Date {
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setHours(time.getHours());
  targetDate.setMinutes(time.getMinutes());
  targetDate.setSeconds(0);
  targetDate.setMilliseconds(0);

  // If the time is in the past for today, set it for tomorrow
  if (targetDate < now) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  return targetDate;
}

export async function getTravelEstimate(
  origin: Location,
  destination: Location,
  arrivalTime: Date
): Promise<TravelEstimate> {
  await loadGoogleMaps();
  const service = new window.google.maps.DistanceMatrixService();

  try {
    const validTime = getNextValidDate(arrivalTime);
    
    const result = await service.getDistanceMatrix({
      origins: [{ lat: origin.lat, lng: origin.lng }],
      destinations: [{ lat: destination.lat, lng: destination.lng }],
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: validTime,
        trafficModel: window.google.maps.TrafficModel.BEST_GUESS
      }
    });

    if (!result.rows[0]?.elements[0]) {
      throw new Error('No route found');
    }

    const element = result.rows[0].elements[0];
    
    if (element.status !== 'OK') {
      throw new Error(`Route calculation failed: ${element.status}`);
    }

    return {
      duration: element.duration_in_traffic 
        ? element.duration_in_traffic.value / 60  // Convert seconds to minutes
        : element.duration.value / 60,
      distance: element.distance.value / 1000  // Convert meters to kilometers
    };
  } catch (error) {
    console.error('Error calculating travel time:', error);
    throw error;
  }
}

export async function batchGetTravelEstimates(
  origins: Location[],
  destinations: Location[],
  arrivalTime: Date
): Promise<TravelEstimate[][]> {
  await loadGoogleMaps();
  const service = new window.google.maps.DistanceMatrixService();

  try {
    const validTime = getNextValidDate(arrivalTime);

    const result = await service.getDistanceMatrix({
      origins: origins.map(o => ({ lat: o.lat, lng: o.lng })),
      destinations: destinations.map(d => ({ lat: d.lat, lng: d.lng })),
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: validTime,
        trafficModel: window.google.maps.TrafficModel.BEST_GUESS
      }
    });

    return result.rows.map(row => 
      row.elements.map(element => ({
        duration: element.duration_in_traffic 
          ? element.duration_in_traffic.value / 60
          : element.duration.value / 60,
        distance: element.distance.value / 1000
      }))
    );
  } catch (error) {
    console.error('Error calculating batch travel times:', error);
    throw error;
  }
} 