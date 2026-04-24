/**
 * 마스터 데이터 로드 + 다중 반경 검색
 * 
 * 데이터 소스 우선순위:
 * 1. Vercel Blob (BLOB_READ_WRITE_TOKEN 있을 때) — 영구 저장
 * 2. 로컬 public/data/master.json — 폴백
 * 
 * ★ 반경 로직: 누적형 (cumulative)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { Complex, MatchedComplex, SearchRequest, SearchResponse, SortBy } from './types';
import { makeComplexId } from './types';
import { classifyByRadius, haversineDistance } from './haversine';
import { checkRestriction } from './restriction';
import { aggregateByRegion } from './aggregator';

async function fetchKakaoLocationInternal(address: string) {
  const apiKey = (process.env.KAKAO_API_KEY || '').trim();
  if (!apiKey) {
    console.error('[InternalGeo] KAKAO_API_KEY is missing! Cannot geocode: ' + address);
    return null;
  }
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` }
    });
    const data = await res.json();
    if (data?.documents?.[0]) {
      const doc = data.documents[0];
      return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
    }
  } catch (e) {
    console.warn('Real-time geocoding failed:', e);
  }
  return null;
}

let _cache: Complex[] | null = null;

const BLOB_MASTER_KEY = 'townboard/master.json';
const BLOB_MASTER_META_KEY = 'townboard/master.meta.json';

// 전국 주요 시/구 중심 좌표 폴백 (지오코딩 실패 시 대비)
const DISTRICT_CENTER_FALLBACK: Record<string, { lat: number; lng: number }> = {
  '남동': { lat: 37.4469, lng: 126.7315 },
  '남동구': { lat: 37.4469, lng: 126.7315 },
  '인천': { lat: 37.4563, lng: 126.7052 },
  '서울': { lat: 37.5665, lng: 126.9780 },
  '강남': { lat: 37.5172, lng: 127.0473 },
  '해운대': { lat: 35.1631, lng: 129.1635 },
  '수성': { lat: 35.8582, lng: 128.6306 },
  '유성': { lat: 36.3622, lng: 127.3563 },
  '수지': { lat: 37.3223, lng: 127.0975 },
  '기흥': { lat: 37.2804, lng: 127.1147 },
  '분당': { lat: 37.3827, lng: 127.1189 },
  '부평': { lat: 37.5071, lng: 126.7219 },
  '미추홀': { lat: 37.4636, lng: 126.6502 },
  '연수': { lat: 37.4101, lng: 126.6783 },
  '강서': { lat: 37.5509, lng: 126.8497 },
};
const BLOB_MASTER_ACCESS = process.env.MASTER_BLOB_ACCESS === 'public' ? 'public' : 'private';
const INVALID_TEXT_VALUES = new Set(['', 'null', 'undefined', 'n/a', 'na', '-']);

export interface MasterDataFileMetadata {
  displayName: string;
  uploadedAt?: string;
  rowCount?: number;
}

export interface MasterDataCoverage {
  count: number;
  withLatLng: number;
  withRestrictions: number;
  withPricing: number;
  withEv: number;
  industries: number;
  districts: number;
}

export interface MasterDataSnapshotStatus {
  storage: 'blob' | 'local';
  available: boolean;
  pathname: string;
  displayName?: string;
  access?: 'public' | 'private';
  uploadedAt?: string;
  size?: number;
  coverage?: MasterDataCoverage;
  error?: string;
}

/** Blob에서 데이터 로드 시도 */
async function loadFromBlob(): Promise<Complex[] | null> {
  try {
    const { get } = await import('@vercel/blob');
    const blob = await get(BLOB_MASTER_KEY, {
      access: BLOB_MASTER_ACCESS,
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200) return null;
    return await new Response(blob.stream).json() as Complex[];
  } catch {
    return null;
  }
}

/** Blob에 데이터 저장 */
export async function saveToBlob(
  data: Complex[],
  metadata?: MasterDataFileMetadata,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const { put } = await import('@vercel/blob');
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = await put(BLOB_MASTER_KEY, jsonStr, {
      access: BLOB_MASTER_ACCESS,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    if (metadata?.displayName) {
      await put(BLOB_MASTER_META_KEY, JSON.stringify(metadata, null, 2), {
        access: BLOB_MASTER_ACCESS,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    }

    // 캐시 갱신
    _cache = data;
    return { success: true, url: blob.url };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** 로컬 JSON 에서 로드 */
function loadFromLocal(): Complex[] {
  const filePath = join(process.cwd(), 'public', 'data', 'master.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Complex[];
}

/** 각 레코드에 결정적 id 부여 */
function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function isValidDistrictName(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text || INVALID_TEXT_VALUES.has(text.toLowerCase())) return false;
  return /(?:시|군|구)$/.test(text);
}

function cleanAddressToken(value: string): string {
  return value.replace(/^[([{'"]+|[)\]}'",.]+$/g, '').trim();
}

function extractCityFromAddress(address: string): string | null {
  const tokens = address.split(/\s+/).filter(Boolean);
  const first = tokens[0] ? cleanAddressToken(tokens[0]) : '';
  if (/(?:특별|광역|자치)시$|도$|시$|군$/.test(first)) return first;
  return first || null;
}

function extractDistrictFromAddress(address: string): string | null {
  const tokens = address.split(/\s+/).map(cleanAddressToken).filter(Boolean);
  if (tokens.length < 2) return null;

  // 패턴 1: '경기도 고양시 일산동구' -> '고양시 일산동구'
  // 패턴 2: '서울시 강남구' -> '강남구'
  // 패턴 3: '인천광역시 남동구' -> '남동구'
  
  for (let i = 0; i < Math.min(tokens.length, 3); i++) {
    const token = tokens[i];
    const next = tokens[i+1];
    
    if (/(?:시)$/.test(token) && next && /(?:구|군)$/.test(next)) {
      return `${token} ${next}`;
    }
    if (/(?:구|군)$/.test(token)) {
      return token;
    }
  }
  return null;
}

function normalizeComplexRecord(complex: Complex): Complex {
  const next = complex;
  const addrRoad = normalizeText(next.addr_road);
  const addrParcel = normalizeText(next.addr_parcel);
  const fallbackAddress = addrRoad || addrParcel;
  const city = normalizeText(next.city);
  const district = normalizeText(next.district);

  if (!city && fallbackAddress) {
    next.city = extractCityFromAddress(fallbackAddress) || next.city;
  } else if (city) {
    next.city = city;
  }

  if (!isValidDistrictName(district) && fallbackAddress) {
    next.district = extractDistrictFromAddress(fallbackAddress) || district || next.district;
  } else if (district) {
    next.district = district;
  }

  if (normalizeText(next.district).toLowerCase() === 'null') {
    next.district = '';
  }

  return next;
}

function ensureIds(data: Complex[]): Complex[] {
  for (const c of data) {
    normalizeComplexRecord(c);
    if (!c.id) {
      c.id = makeComplexId(c.name, c.addr_road, c.addr_parcel);
    }
  }
  return data;
}

/** 서버사이드: 마스터 데이터 로드 (캐시 + Blob 우선) */
export function loadMasterData(): Complex[] {
  if (_cache) return _cache;
  _cache = ensureIds(loadFromLocal());
  return _cache;
}

/** 서버사이드: 마스터 데이터 비동기 로드 (Blob 우선) */
export async function loadMasterDataAsync(): Promise<Complex[]> {
  if (_cache) return _cache;
  
  // Blob에서 시도
  const blobData = await loadFromBlob();
  if (blobData && blobData.length > 0) {
    _cache = ensureIds(blobData);
    return _cache;
  }

  // 로컬 폴백
  _cache = ensureIds(loadFromLocal());
  return _cache;
}

/** 캐시 무효화 (업로드 후 호출) */
export function invalidateCache() {
  _cache = null;
}

export async function getMasterDataStatus(): Promise<{
  effectiveSource: 'blob' | 'local';
  blob: MasterDataSnapshotStatus;
  local: MasterDataSnapshotStatus;
}> {
  const [blob, local] = await Promise.all([
    readBlobMasterStatus(),
    readLocalMasterStatus(),
  ]);

  return {
    effectiveSource: blob.available && blob.coverage && blob.coverage.count > 0 ? 'blob' : 'local',
    blob,
    local,
  };
}

function summarizeMasterData(data: Complex[]): MasterDataCoverage {
  const industries = new Set<string>();
  const districts = new Set<string>();

  let withLatLng = 0;
  let withRestrictions = 0;
  let withPricing = 0;
  let withEv = 0;

  for (const row of data) {
    if (typeof row.lat === 'number' && Number.isFinite(row.lat) && typeof row.lng === 'number' && Number.isFinite(row.lng)) {
      withLatLng += 1;
    }
    if (row.r1_industry || row.r2_industry) {
      withRestrictions += 1;
    }
    if (row.public_price_median != null || row.rt_price_per_m2_median != null) {
      withPricing += 1;
    }
    if (row.ev_charger_installed != null) {
      withEv += 1;
    }
    if (row.r1_industry) industries.add(row.r1_industry);
    if (row.r2_industry) industries.add(row.r2_industry);
    if (row.district) districts.add(row.district);
  }

  return {
    count: data.length,
    withLatLng,
    withRestrictions,
    withPricing,
    withEv,
    industries: industries.size,
    districts: districts.size,
  };
}

async function readBlobMasterStatus(): Promise<MasterDataSnapshotStatus> {
  try {
    const { head, get } = await import('@vercel/blob');
    const meta = await head(BLOB_MASTER_KEY);
    const fileMeta = await loadBlobMasterMetadata();
    const blob = await get(BLOB_MASTER_KEY, {
      access: BLOB_MASTER_ACCESS,
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200) {
      return {
        storage: 'blob',
        available: false,
        pathname: BLOB_MASTER_KEY,
        access: BLOB_MASTER_ACCESS,
        error: 'Blob 본문을 읽지 못했습니다.',
      };
    }

    const data = ensureIds(await new Response(blob.stream).json() as Complex[]);
    return {
      storage: 'blob',
      available: true,
      pathname: meta.pathname,
      displayName: fileMeta?.displayName || getPathBasename(meta.pathname),
      access: BLOB_MASTER_ACCESS,
      uploadedAt: fileMeta?.uploadedAt || meta.uploadedAt.toISOString(),
      size: meta.size,
      coverage: summarizeMasterData(data),
    };
  } catch (error) {
    return {
      storage: 'blob',
      available: false,
      pathname: BLOB_MASTER_KEY,
      access: BLOB_MASTER_ACCESS,
      error: String(error),
    };
  }
}

async function readLocalMasterStatus(): Promise<MasterDataSnapshotStatus> {
  try {
    const filePath = join(process.cwd(), 'public', 'data', 'master.json');
    const fileMeta = loadLocalMasterMetadata();
    const data = ensureIds(loadFromLocal());
    return {
      storage: 'local',
      available: true,
      pathname: filePath,
      displayName: fileMeta?.displayName || getPathBasename(filePath),
      uploadedAt: fileMeta?.uploadedAt,
      coverage: summarizeMasterData(data),
    };
  } catch (error) {
    return {
      storage: 'local',
      available: false,
      pathname: join(process.cwd(), 'public', 'data', 'master.json'),
      error: String(error),
    };
  }
}

async function loadBlobMasterMetadata(): Promise<MasterDataFileMetadata | null> {
  try {
    const { get } = await import('@vercel/blob');
    const blob = await get(BLOB_MASTER_META_KEY, {
      access: BLOB_MASTER_ACCESS,
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200) return null;
    const data = await new Response(blob.stream).json() as MasterDataFileMetadata;
    if (!data || typeof data.displayName !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

function loadLocalMasterMetadata(): MasterDataFileMetadata | null {
  try {
    const filePath = join(process.cwd(), 'public', 'data', 'master.meta.json');
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as MasterDataFileMetadata;
    if (!data || typeof data.displayName !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

function getPathBasename(pathname: string): string {
  const normalized = pathname.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || pathname;
}

function normalizeFilterText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, '').trim();
}

function compareNullableNumberDesc(
  a: number | null | undefined,
  b: number | null | undefined
): number {
  const leftMissing = a == null;
  const rightMissing = b == null;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return b - a;
}

function sortMatched(a: MatchedComplex, b: MatchedComplex, sortBy: SortBy): number {
  if (sortBy === 'public_price_desc') {
    const diff = compareNullableNumberDesc(a.public_price_median, b.public_price_median);
    if (diff !== 0) return diff;
  } else if (sortBy === 'public_price_per_m2_desc') {
    const diff = compareNullableNumberDesc(
      a.public_price_per_m2_median,
      b.public_price_per_m2_median
    );
    if (diff !== 0) return diff;
  } else if (sortBy === 'rt_price_per_m2_desc') {
    const diff = compareNullableNumberDesc(a.rt_price_per_m2_median, b.rt_price_per_m2_median);
    if (diff !== 0) return diff;
  }

  const distanceDiff = a.distance_km - b.distance_km;
  if (distanceDiff !== 0) return distanceDiff;

  return a.name.localeCompare(b.name, 'ko');
}

/**
 * 핵심 검색 파이프라인:
 * 1) 중심 좌표로부터 거리 계산
 * 2) 최대 반경 이내 필터링
 * 3) 영업제한 체크
 * 4) 지역별 집계 (최대 반경 기준)
 * 
 * ★ Blob 우선: cold start에서도 최신 데이터 사용
 */
export async function searchNearby(req: SearchRequest): Promise<SearchResponse> {
  // Blob 우선 로드 (cold start 대응)
  const data = await loadMasterDataAsync();
  const {
    lat,
    lng,
    radii,
    districts = [],
    require_ev = false,
    sort_by = 'distance',
    advertiser_industry,
    campaign_date,
    address,
  } = req;

  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new Error('좌표가 필요합니다. geocode API를 먼저 호출하세요.');
  }

  const campaignDateObj = campaign_date ? new Date(campaign_date) : new Date();
  if (Number.isNaN(campaignDateObj.getTime())) {
    throw new Error('campaign_date 형식이 잘못되었습니다.');
  }

  if (!Array.isArray(radii) || radii.length === 0) {
    throw new Error('반경이 필요합니다.');
  }
  const maxRadius = Math.max(...radii);
  const districtSet = new Set(
    districts.map((district) => normalizeFilterText(district)).filter(Boolean)
  );
  const matched: MatchedComplex[] = [];

  // [Smart Radius Search] 검색 주소에서 구(District)를 추출하여 해당 지역 아파트 좌표 우선 복구
  const targetDistrictMatch = address.match(/(\S+(?:시|군|구))/);
  const targetDistrict = targetDistrictMatch ? normalizeFilterText(targetDistrictMatch[1]) : '';

  for (const complex of data) {
    if (require_ev && !complex.ev_charger_installed) continue;

    const complexDistrict = normalizeFilterText(complex.district || '');

    // 구 단위 필터가 있는 경우 (반경 조회에서는 생략하는 경우가 많지만 안전장치로 유지)
    if (districtSet.size > 0 && !districtSet.has(complexDistrict)) {
      continue;
    }

    const complexCity = normalizeFilterText(complex.city || '');
    const searchCity = address.split(/\s+/)[0] ? normalizeFilterText(address.split(/\s+/)[0]) : '';

    // [Optimized Geocoding] 좌표가 없는데 반경 내에 있을 가능성이 있는 경우 복구
    if (complex.lat == null || complex.lat === 0 || complex.lat === 37.5665) {
      
      // 검색 주소의 도시(예: 인천)와 아파트의 도시가 일치하는 경우에만 추진
      if (complexCity && searchCity && (complexCity.includes(searchCity) || searchCity.includes(complexCity))) {
        // 행정구역 명칭 변경 대응 (미추홀-남구 등) 또는 같은 구인 경우 우선 복구
        const isSameDistrict = complexDistrict && targetDistrict && (complexDistrict.includes(targetDistrict) || targetDistrict.includes(complexDistrict));
        const isNearByGu = (targetDistrict === '미추홀구' && complexDistrict === '남구') || (targetDistrict === '남구' && complexDistrict === '미추홀구');
        
        if (isSameDistrict || isNearByGu) {
          const addr = complex.addr_road || complex.addr_parcel || `${complex.city} ${complex.district} ${complex.name}`;
          const geo = await fetchKakaoLocationInternal(addr);
          if (geo) {
            complex.lat = geo.lat;
            complex.lng = geo.lng;
          }
        }
      }
    }

    // 좌표가 없더라도 선택한 행정구역(targetDistrict)에 속한다면 일단 포함 (클라이언트에서 복구할 기회를 줌)
    const isTargetDistrict = complexDistrict && targetDistrict && (complexDistrict.includes(targetDistrict) || targetDistrict.includes(complexDistrict));
    
    if (
      (typeof complex.lat !== 'number' ||
      typeof complex.lng !== 'number' ||
      !Number.isFinite(complex.lat) ||
      !Number.isFinite(complex.lng) ||
      complex.lat === 0) && !isTargetDistrict
    ) continue;

    // 좌표가 있는 경우에만 거리 계산. 없으면 0으로 일단 처리
    const hasLat = !!(complex.lat && complex.lat !== 0 && complex.lat !== 37.5665 && complex.lng);
    const dist = hasLat ? haversineDistance(lat, lng, complex.lat as number, complex.lng as number) : 0;
    
    // 좌표가 있는 경우에만 반경 필터링 수행. 좌표 없으면 일단 통과(클라이언트가 나중에 거름)
    if (hasLat && dist > maxRadius) continue;

    const restrictionStatus = checkRestriction(complex, advertiser_industry, campaignDateObj);
    const classified = classifyByRadius(dist, radii);
    if (!classified) continue;

    // 단지총단가 실시간 복구
    let finalPrice = Number(complex.price_4w || 0);
    if (finalPrice <= 0) {
      finalPrice = Number(complex.units || 0) * Number(complex.unit_price || 0);
    }

    matched.push({
      ...complex,
      price_4w: finalPrice,
      distance_km: parseFloat(dist.toFixed(2)),
      radius_band: classified.radius_band,
      restriction_status: restrictionStatus,
    });
  }

  matched.sort((a, b) => sortMatched(a, b, sort_by));

  const available = matched.filter(m => m.restriction_status === 'available');
  const summaries = aggregateByRegion(available);

  return {
    center: { lat, lng, address },
    radii,
    results: matched,
    summaries,
    applied_filters: {
      districts: [...districtSet],
      require_ev,
      sort_by,
    },
    total_count: available.length,
    total_households: available.reduce((s, c) => s + (c.households || 0), 0),
    total_units: available.reduce((s, c) => s + (c.units || 0), 0),
    total_price_4w: available.reduce((s, c) => s + (c.price_4w || 0), 0),
  };
}

/**
 * 지역(구/군) 기반 검색 — 반경 없이 구 이름만으로 필터링
 */
export async function searchByDistrict(req: {
  districts: string[];
  require_ev?: boolean;
  sort_by?: SortBy;
  advertiser_industry?: string;
  campaign_date?: string;
}): Promise<SearchResponse> {
  const data = await loadMasterDataAsync();
  const {
    districts,
    require_ev = false,
    sort_by = 'distance',
    advertiser_industry,
    campaign_date,
  } = req;

  if (!districts || districts.length === 0) {
    throw new Error('최소 하나의 지역을 선택해주세요.');
  }

  const campaignDateObj = campaign_date ? new Date(campaign_date) : new Date();
  if (Number.isNaN(campaignDateObj.getTime())) {
    throw new Error('campaign_date 형식이 잘못되었습니다.');
  }
  const districtSet = new Set(
    districts.map((d) => normalizeFilterText(d)).filter(Boolean)
  );
  const matched: MatchedComplex[] = [];

  for (const complex of data) {
    const complexCity = normalizeFilterText(complex.city || '');
    const complexDistrict = normalizeFilterText(complex.district || '');
    
    const isMatched = Array.from(districtSet).some(d => 
      complexCity.includes(d) || 
      complexDistrict.includes(d) ||
      (d === '미추홀구' && complexDistrict === '남구') ||
      (d === '남구' && complexDistrict === '미추홀구')
    );
    if (!isMatched) continue;
    if (require_ev && !complex.ev_charger_installed) continue;

    const restrictionStatus = checkRestriction(complex, advertiser_industry, campaignDateObj);

    // 단지총단가 실시간 복구 (누락된 경우 계산)
    let finalPrice = Number(complex.price_4w || 0);
    if (finalPrice <= 0) {
      finalPrice = Number(complex.units || 0) * Number(complex.unit_price || 0);
    }

    matched.push({
      ...complex,
      price_4w: finalPrice,
      distance_km: 0,
      radius_band: 0,
      restriction_status: restrictionStatus,
    });
  }

  // 지역별 조회 시 distance 정렬은 이름순으로 대체
  if (sort_by === 'distance') {
    matched.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  } else {
    matched.sort((a, b) => sortMatched(a, b, sort_by));
  }

  const available = matched.filter(m => m.restriction_status === 'available');
  const summaries = aggregateByRegion(available);

  // 구 단위 검색 시 지도가 해당 지역을 비추도록 마커들의 평균 좌표 계산
  let avgLat = 0;
  let avgLng = 0;
  if (matched.length > 0) {
    const withGeo = matched.filter(c => c.lat && c.lat !== 0);
    if (withGeo.length > 0) {
      avgLat = withGeo.reduce((s, c) => s + (c.lat || 0), 0) / withGeo.length;
      avgLng = withGeo.reduce((s, c) => s + (c.lng || 0), 0) / withGeo.length;
    } else {
      // 모든 좌표가 0인 경우 폴백 (선택된 지역 중 첫 번째 알려진 좌표 사용)
      for (const d of districts) {
        const cleanD = normalizeFilterText(d);
        if (DISTRICT_CENTER_FALLBACK[cleanD]) {
          avgLat = DISTRICT_CENTER_FALLBACK[cleanD].lat;
          avgLng = DISTRICT_CENTER_FALLBACK[cleanD].lng;
          break;
        }
      }
      if (!avgLat) {
        avgLat = 37.5665; // 최후의 보루
        avgLng = 126.9780;
      }
    }
  }

  return {
    center: { lat: avgLat, lng: avgLng, address: districts.join(', ') },
    radii: [],
    results: matched,
    summaries,
    applied_filters: {
      districts: [...districtSet],
      require_ev,
      sort_by,
    },
    total_count: available.length,
    total_households: available.reduce((s, c) => s + (c.households || 0), 0),
    total_units: available.reduce((s, c) => s + (c.units || 0), 0),
    total_price_4w: available.reduce((s, c) => s + (c.price_4w || 0), 0),
  };
}
