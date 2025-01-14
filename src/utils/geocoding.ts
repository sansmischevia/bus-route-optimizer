import { loadGoogleMaps } from './googleMapsLoader';

interface Location {
  lat: number;
  lng: number;
}

interface GeocodeResult {
  location: Location;
  formattedAddress: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  await loadGoogleMaps();
  const geocoder = new window.google.maps.Geocoder();
  
  try {
    const result = await geocoder.geocode({ address });
    
    if (!result.results || result.results.length === 0) {
      throw new Error(`No results found for address: ${address}`);
    }

    const location = result.results[0].geometry.location;
    return {
      location: {
        lat: location.lat(),
        lng: location.lng()
      },
      formattedAddress: result.results[0].formatted_address
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error(`Failed to geocode address: ${address}`);
  }
}

export async function batchGeocodeAddresses(addresses: string[]): Promise<GeocodeResult[]> {
  await loadGoogleMaps();
  // Add delay between requests to respect rate limits
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const results: GeocodeResult[] = [];

  for (const address of addresses) {
    try {
      const result = await geocodeAddress(address);
      results.push(result);
      // Wait 200ms between requests to avoid hitting rate limits
      await delay(200);
    } catch (error) {
      console.error(`Error geocoding address "${address}":`, error);
      throw error;
    }
  }

  return results;
} 