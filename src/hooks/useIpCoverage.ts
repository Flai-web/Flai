import { useState, useEffect } from 'react';
import { getDistance } from 'geolib';
import { supabase } from '../utils/supabase';

interface CoverageState {
  loading: boolean;
  covered: boolean;
  cityName: string | null;
  error: Error | null;
}

interface IpLocation {
  lat: number;
  lon: number;
  city: string;
}

const fetchWithTimeout = async (url: string, timeoutMs = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

async function isCoordinateWithinRange(lat: number, lon: number): Promise<boolean> {
  try {
    const { data: zones, error } = await supabase
      .from('address_zones')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;
    if (!zones || zones.length === 0) return false;

    const targetLocation = { latitude: lat, longitude: lon };

    for (const zone of zones) {
      const zoneResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(zone.center_address)}`
      );
      const zoneData = await zoneResponse.json();
      if (!zoneData || zoneData.length === 0) continue;

      const zoneCenter = {
        latitude: parseFloat(zoneData[0].lat),
        longitude: parseFloat(zoneData[0].lon),
      };

      const distance = getDistance(zoneCenter, targetLocation);
      if (distance <= zone.radius_km * 1000) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('Error checking coordinate range:', err);
    return false;
  }
}

async function fetchIpLocation(): Promise<IpLocation> {
  const cachedLocation = sessionStorage.getItem('user_ip_location');
  if (cachedLocation) {
    try {
      const parsed = JSON.parse(cachedLocation);
      if (parsed.lat && parsed.lon && parsed.city) {
        return parsed;
      }
    } catch (e) {
      sessionStorage.removeItem('user_ip_location');
    }
  }

  const saveAndReturn = (loc: IpLocation) => {
    sessionStorage.setItem('user_ip_location', JSON.stringify(loc));
    return loc;
  };

  // Primary: ipgeolocation.io — best accuracy (~200m), 30k req/month free
  try {
    const res = await fetchWithTimeout(
      'https://api.ipgeolocation.io/ipgeo?apiKey=c8e8ac2b70214f34a563fdd79a7ce297&fields=city,latitude,longitude',
      4000
    );
    if (res.ok) {
      const d = await res.json();
      if (d.city && d.latitude != null && d.longitude != null) {
        return saveAndReturn({ lat: parseFloat(d.latitude), lon: parseFloat(d.longitude), city: d.city });
      }
    }
  } catch { }

  // Fallback 1: ip-api.com — MaxMind GeoIP2 City, ~1–5 km, no key needed
  try {
    const res = await fetchWithTimeout('http://ip-api.com/json/?fields=status,city,lat,lon', 4000);
    if (res.ok) {
      const d = await res.json();
      if (d.status === 'success' && d.city && d.lat != null && d.lon != null) {
        return saveAndReturn({ lat: d.lat, lon: d.lon, city: d.city });
      }
    }
  } catch { }

  // Fallback 2: ipinfo.io — ~5–20 km, no key needed
  try {
    const res = await fetchWithTimeout('https://ipinfo.io/json', 4000);
    if (res.ok) {
      const d = await res.json();
      if (d.city && d.loc) {
        const [lat, lon] = d.loc.split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lon)) return saveAndReturn({ lat, lon, city: d.city });
      }
    }
  } catch { }

  // Fallback 3: ipwho.is — last resort
  try {
    const res = await fetchWithTimeout('https://ipwho.is/', 4000);
    if (res.ok) {
      const d = await res.json();
      if (d.success && d.city && d.latitude != null && d.longitude != null)
        return saveAndReturn({ lat: d.latitude, lon: d.longitude, city: d.city });
    }
  } catch { }

  throw new Error('All IP geolocation APIs failed or rate limited');
}

export function useIpCoverage() {
  const [state, setState] = useState<CoverageState>({
    loading: true,
    covered: false,
    cityName: null,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function checkCoverage() {
      try {
        const { lat, lon, city } = await fetchIpLocation();
        const isCovered = await isCoordinateWithinRange(lat, lon);

        if (mounted) {
          setState({
            loading: false,
            covered: isCovered,
            cityName: city,
            error: null,
          });
        }
      } catch (error) {
        if (mounted) {
          setState({
            loading: false,
            covered: false,
            cityName: null,
            error: error instanceof Error ? error : new Error('Unknown error'),
          });
        }
      }
    }

    checkCoverage();

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
