/**
 * 견적서 Excel 생성 API
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateExcel } from '@/lib/excelGenerator';
import { searchNearby, searchByDistrict } from '@/lib/masterData';
import { parseCoordinatePair, parseDistricts, parseRadii, parseSortBy, parseCampaignDate } from '@/lib/requestValidation';
import type { CreativeAssetKind } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lat, lng, address,
      radii = [],
      districts = [],
      require_ev = false,
      sort_by = 'distance',
      advertiser_name = '',
      campaign_name = '',
      advertiser_industry = '',
      campaign_date,
      excluded_ids = [],
      excluded_columns = [],
      creative_message = '',
      creative_asset_kinds = [],
      creative_format = 'both',
      creative_audio_mode = 'bgm_narration',
    } = body;

    const coords = parseCoordinatePair(lat, lng, false);
    const districtsList = parseDistricts(districts, false);
    const radiiList = parseRadii(radii, false);
    const normalizedSortBy = parseSortBy(sort_by);
    const parsedCampaignDate = parseCampaignDate(campaign_date);

    let searchResult;
    if (coords && radiiList.length > 0) {
      searchResult = await searchNearby({
        address: String(address || ''),
        lat: coords.lat,
        lng: coords.lng,
        radii: radiiList,
        districts: districtsList,
        require_ev: Boolean(require_ev),
        sort_by: normalizedSortBy,
        advertiser_industry: String(advertiser_industry),
        campaign_date: parsedCampaignDate,
        advertiser_name: String(advertiser_name),
        campaign_name: String(campaign_name),
      });
    } else if (districtsList.length > 0) {
      searchResult = await searchByDistrict({
        districts: districtsList,
        require_ev: Boolean(require_ev),
        sort_by: normalizedSortBy,
        advertiser_industry: String(advertiser_industry),
        campaign_date: parsedCampaignDate,
      });
    } else {
      return NextResponse.json({ error: '좌표 또는 지역이 필요합니다' }, { status: 400 });
    }

    // 제외된 항목 필터링
    const excludedSet = new Set(excluded_ids.map(String));
    if (excludedSet.size > 0) {
      searchResult.results = searchResult.results.filter(r => !excludedSet.has(r.id));
      const avail = searchResult.results.filter(r => r.restriction_status === 'available');
      searchResult.total_count = avail.length;
      searchResult.total_households = avail.reduce((s, c) => s + (c.households || 0), 0);
      searchResult.total_units = avail.reduce((s, c) => s + (c.units || 0), 0);
      searchResult.total_price_4w = avail.reduce((s, c) => s + (c.price_4w || 0), 0);
    }

    const buffer = await generateExcel(
      searchResult,
      String(advertiser_name),
      String(campaign_name),
      {
        message: String(creative_message),
        asset_kinds: creative_asset_kinds as CreativeAssetKind[],
        preferred_format: creative_format as any,
        audio_mode: creative_audio_mode as any,
      },
      new Set(excluded_columns.map(String))
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=proposal.xlsx`,
      },
    });
  } catch (e) {
    console.error('Excel Generation Error:', e);
    return NextResponse.json({ error: `엑셀 생성 중 오류가 발생했습니다: ${e}` }, { status: 500 });
  }
}
