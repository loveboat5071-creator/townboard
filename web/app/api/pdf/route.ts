/**
 * 견적서 PDF 생성 API
 * HTML → 브라우저 인쇄용 PDF 페이지 반환
 * Vercel 서버리스에서는 Puppeteer 없이 HTML 방식이 가장 안정적
 */
import { NextRequest, NextResponse } from 'next/server';
import { appendActivityLog, getClientIp } from '@/lib/activityLog';
import { buildCreativePlan } from '@/lib/creativePlan';
import { escapeHtml, serializeForInlineScript } from '@/lib/escape';
import { searchNearby, searchByDistrict } from '@/lib/masterData';
import type { CreativeAssetKind, SearchResponse } from '@/lib/types';
import { parseCampaignDate, parseCoordinatePair, parseDistricts, parseRadii, parseSortBy } from '@/lib/requestValidation';

function fmt(n: number | null | undefined): string {
  return n != null ? n.toLocaleString('ko-KR') : '-';
}

function fmtM(n: number | null | undefined): string {
  if (n == null) return '-';
  const m = n / 1_000_000;
  return m >= 1 ? m.toFixed(0) : n.toLocaleString('ko-KR');
}

/** 건물유형 약어 */
function shortType(t: string): string {
  if (!t) return '-';
  if (/아파트/.test(t)) return '아';
  if (/오피스텔/.test(t)) return '오';
  return t.charAt(0) || '-';
}

function formatAddressWithSpaces(addr: string): string {
  if (!addr) return '';
  if (addr.includes(' ')) return addr;
  return addr
    .replace(/^(서울특별시|인천광역시|경기도|부산광역시|대구광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|북한)/, '$1 ')
    .replace(/(시|군|구)(?! )/g, '$1 ')
    .replace(/(읍|면|동|리|가|로|길)(?! )/g, '$1 ')
    .trim();
}

function formatPyeong(p: string | number | null): string {
  if (p == null) return '-';
  const s = String(p).trim();
  if (!s || s === '-') return '-';
  if (s.includes(',')) return s;
  if (/^\d{4,}$/.test(s) && s.length % 2 === 0) {
    const chunks = [];
    for (let i = 0; i < s.length; i += 2) {
      chunks.push(s.slice(i, i + 2));
    }
    return chunks.join(', ');
  }
  return s;
}

function buildPdfHtml(
  data: SearchResponse,
  advertiserName: string,
  campaignName: string,
  creativePlan: ReturnType<typeof buildCreativePlan>,
  customNotes: string,
  excludedColumns: Set<string> = new Set(),
  includeCreative: boolean = true,
): string {
  const col = (key: string) => !excludedColumns.has(key);
  const colD = (key: string) => !excludedColumns.has(key) && (key !== 'distance' || (data.radii && data.radii.length > 0));
  const dateStr = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const kakaoJsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';
  const safeAddress = escapeHtml(data.center.address);
  const safeAdvertiserName = escapeHtml(advertiserName || '미정');
  const safeCampaignName = escapeHtml(campaignName || '미 정 (15초)');
  const safeDateStr = escapeHtml(dateStr);
  const safeCustomNotes = customNotes
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `■ ${escapeHtml(line)}`)
    .join('<br>');

  const summaryRows = data.summaries.map(s =>
    `<tr>
      <td>동네상권</td>
      <td>${escapeHtml(`${s.city.replace(/특별시|광역시/g, '')} ${s.district}`)}</td>
      <td class="num">${fmt(s.total_units)}</td>
      <td class="num">${fmt(s.total_households)}</td>
      <td class="num">${fmt(s.avg_unit_price)}</td>
      <td class="num">${fmt(s.total_price_4w)}</td>
      <td>-</td>
      <td></td>
    </tr>`
  ).join('');

  const available = data.results.filter(r => r.restriction_status === 'available');

  const listRows = available.map((c, i) => {
    const cells: string[] = [`<td class="center">${i + 1}</td>`];
    if (col('name')) cells.push(`<td><div class="cell-clamp">${escapeHtml(c.name)}</div></td>`);
    if (col('city')) cells.push(`<td class="center">${escapeHtml(c.city || '')}</td>`);
    if (col('district')) cells.push(`<td class="center">${escapeHtml(c.district || '')}</td>`);
    if (col('dong')) cells.push(`<td class="center">${escapeHtml(c.dong || '')}</td>`);
    if (col('addr_road')) cells.push(`<td class="addr"><div class="cell-clamp">${escapeHtml(formatAddressWithSpaces(c.addr_road || c.addr_parcel || ''))}</div></td>`);
    if (col('building_type')) cells.push(`<td class="center">${escapeHtml(shortType(c.building_type))}</td>`);
    if (col('built_year')) cells.push(`<td class="center">${c.built_year || '-'}</td>`);
    if (col('area_pyeong')) cells.push(`<td class="center">${escapeHtml(formatPyeong(c.area_pyeong))}</td>`);
    if (col('households')) cells.push(`<td class="center">${fmt(c.households)}</td>`);
    if (col('units')) cells.push(`<td class="center">${fmt(c.units)}</td>`);
    if (col('unit_price')) cells.push(`<td class="num">${fmt(c.unit_price)}</td>`);
    if (col('price_4w')) cells.push(`<td class="num">${fmt(c.price_4w)}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  const hCells: string[] = ['<th>No</th>'];
  if (col('name')) hCells.push('<th>아파트명</th>');
  if (col('city')) hCells.push('<th>지역1</th>');
  if (col('district')) hCells.push('<th>지역2</th>');
  if (col('dong')) hCells.push('<th>지역3</th>');
  if (col('addr_road')) hCells.push('<th>주소</th>');
  if (col('building_type')) hCells.push('<th>구분</th>');
  if (col('built_year')) hCells.push('<th>입주년도</th>');
  if (col('area_pyeong')) hCells.push('<th>평형</th>');
  if (col('households')) hCells.push('<th>세대수</th>');
  if (col('units')) hCells.push('<th>가동수량</th>');
  if (col('unit_price')) hCells.push('<th>개별단가</th>');
  if (col('price_4w')) hCells.push('<th>단지총단가</th>');
  const listHeaderHtml = hCells.join('');

  const sCells: string[] = ['<td>합  계</td>'];
  if (col('name')) sCells.push('<td></td>');
  if (col('city')) sCells.push('<td></td>');
  if (col('district')) sCells.push('<td></td>');
  if (col('dong')) sCells.push('<td></td>');
  if (col('addr_road')) sCells.push('<td></td>');
  if (col('building_type')) sCells.push('<td></td>');
  if (col('built_year')) sCells.push('<td></td>');
  if (col('area_pyeong')) sCells.push('<td></td>');
  if (col('households')) sCells.push(`<td class="num">${fmt(available.reduce((s, c) => s + (c.households || 0), 0))}</td>`);
  if (col('units')) sCells.push(`<td class="num">${fmt(available.reduce((s, c) => s + (c.units || 0), 0))}</td>`);
  if (col('unit_price')) sCells.push('<td></td>');
  if (col('price_4w')) sCells.push(`<td class="num">${fmt(available.reduce((s, c) => s + (c.price_4w || 0), 0))}</td>`);
  if (colD('distance')) sCells.push('<td></td>');
  const sumRowHtml = sCells.join('');

  // 지도용 마커 데이터 (JSON)
  const markerData = available.map(c => ({
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    addr_road: c.addr_road,
    addr_parcel: c.addr_parcel,
    city: c.city,
    district: c.district,
    units: c.units,
    households: c.households,
    distance: c.distance_km.toFixed(1),
  }));

  const radiiArr = data.radii || [1, 1.5, 3];
  const safeMarkerData = serializeForInlineScript(markerData);
  const safeRadii = serializeForInlineScript(radiiArr);
  const creativeImageRows = creativePlan.image_package.scenes.map(scene =>
    `<tr>
      <td>${escapeHtml(scene.title)}</td>
      <td class="num">${scene.duration_sec}</td>
      <td>${escapeHtml(scene.visual)}</td>
      <td>${escapeHtml(scene.copy)}</td>
    </tr>`
  ).join('');
  const creativeVideoRows = creativePlan.video_package.beats.map(beat =>
    `<tr>
      <td>${escapeHtml(beat.time_range)}</td>
      <td>${escapeHtml(beat.visual)}</td>
      <td>${escapeHtml(beat.copy)}</td>
    </tr>`
  ).join('');
  const creativeAssets = creativePlan.required_assets.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const creativeChecklist = creativePlan.production_checklist.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const creativeNarration = creativePlan.audio.narration_lines.map(line => `<li>${escapeHtml(line)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>포커스미디어 견적서 - ${safeAddress}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; font-size: 11px; color: #1a1a1a; padding: 20px 30px; }
  
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 22px; font-weight: 700; border-bottom: 3px double #333; display: inline-block; padding-bottom: 4px; }
  
  .info-box { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #666; margin-bottom: 20px; }
  .info-box .section-title { grid-column: 1 / -1; background: #f0f0f0; padding: 6px 10px; font-weight: 700; font-size: 12px; border-bottom: 1px solid #666; }
  .info-row { display: flex; border-bottom: 1px solid #ddd; }
  .info-row:last-child { border-bottom: none; }
  .info-label { background: #fafafa; padding: 5px 10px; font-weight: 600; width: 90px; border-right: 1px solid #ddd; }
  .info-value { padding: 5px 10px; flex: 1; }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead { display: table-header-group; }
  th { background: #4472C4; color: white; font-weight: 600; padding: 4px 4px; text-align: center; font-size: 8px; }
  td { padding: 3px 4px; border: 1px solid #ddd; font-size: 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .addr { max-width: 140px; }
  /* 셀 텍스트 최대 2줄 → 넘치면 말줄임 */
  td, th { max-height: 2.4em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; }
  .cell-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: keep-all; }
  .sum-row { background: #D9E2F3; font-weight: 700; }
  
  .notes { background: #fafafa; border: 1px solid #ddd; padding: 10px 14px; font-size: 10px; line-height: 1.6; margin-bottom: 16px; }
  .closing { text-align: center; font-style: italic; margin-top: 20px; font-size: 12px; }
  .creative-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .creative-card { border: 1px solid #d9e2f3; border-radius: 10px; padding: 12px; background: #fbfcff; }
  .creative-card h3 { font-size: 13px; margin-bottom: 8px; color: #1b2a4a; }
  .creative-card p { font-size: 10px; line-height: 1.6; margin-bottom: 8px; }
  .creative-card ul { padding-left: 16px; font-size: 10px; line-height: 1.6; }
  .creative-subtitle { font-size: 11px; color: #4472C4; font-weight: 700; margin: 10px 0 6px; }
  .prompt-box { border: 1px solid #dfe6f3; border-radius: 8px; background: #ffffff; padding: 8px; font-size: 9.5px; line-height: 1.65; word-break: break-word; }
  
  .page-break { page-break-before: always; }
  
  .map-page { page-break-inside: avoid; }
  .map-page h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; text-align: center; }
  #pdfMap { width: 680px; height: 500px; margin: 0 auto; border: 1px solid #ccc; border-radius: 4px; }
  
  @media print {
    body { padding: 10px; }
    .no-print { display: none; }
    @page { size: A4 landscape; margin: 10mm; }
    /* 지도: 인쇄에서도 동일 크기 유지 → relayout 시 뷰포트 변동 방지 */
    #pdfMap { width: 680px; height: 500px; }
    /* 가동리스트: 셀이 페이지 경계에서 잘리지 않도록 */
    table { page-break-inside: auto; font-size: 8px; }
    th { font-size: 8px; padding: 4px 5px; }
    td { font-size: 8px; padding: 3px 5px; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    td, th { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; } /* 각 페이지마다 헤더 반복 */
    tbody { page-break-inside: auto; }
    /* orphans/widows 최소화 → 페이지 끝에 빈 공간 제거 */
    table, tr { orphans: 1; widows: 1; }
  }

  .print-btn { position: fixed; top: 20px; right: 20px; background: #4472C4; color: white; border: none; padding: 12px 24px; font-size: 14px; border-radius: 8px; cursor: pointer; font-family: inherit; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .print-btn:hover { background: #3961a8; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ PDF 저장 / 인쇄</button>

<div class="header">
  <h1>제  안  서</h1>
</div>

<div class="info-box">
  <div class="section-title">주 관 사</div>
  <div class="info-row">
    <div class="info-label">법 인 명</div>
    <div class="info-value">㈜더블유에스미디어</div>
  </div>
  <div class="info-row">
    <div class="info-label">사업자번호</div>
    <div class="info-value">595 - 81 - 00716</div>
  </div>
  <div class="info-row">
    <div class="info-label">주     소</div>
    <div class="info-value">서울시 서초구 방배중앙로 175, 302호</div>
  </div>
  <div class="info-row">
    <div class="info-label">담 당 자</div>
    <div class="info-value">이 영 주 (010-2241-5071)</div>
  </div>
</div>

<div class="info-box">
  <div class="section-title">견 적 내 역</div>
  <div class="info-row">
    <div class="info-label">광 고 주</div>
    <div class="info-value">${safeAdvertiserName}</div>
  </div>
  <div class="info-row">
    <div class="info-label">세대 수</div>
    <div class="info-value">${fmt(data.total_households)}</div>
  </div>
  <div class="info-row">
    <div class="info-label">캠페인명</div>
    <div class="info-value">${safeCampaignName}</div>
  </div>
  <div class="info-row">
    <div class="info-label">가동 수</div>
    <div class="info-value">${fmt(data.total_units)}</div>
  </div>
  <div class="info-row">
    <div class="info-label">광고상품</div>
    <div class="info-value">포커스미디어</div>
  </div>
  <div class="info-row">
    <div class="info-label">집행기간</div>
    <div class="info-value">4주 기준</div>
  </div>
  <div class="info-row">
    <div class="info-label">청약금액</div>
    <div class="info-value">${fmt(data.total_price_4w)}원</div>
  </div>
  <div class="info-row">
    <div class="info-label">송출지역</div>
    <div class="info-value">${safeAddress}</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>광고상품</th><th>타겟</th><th>가동수량</th><th>세대 수</th>
      <th>개별단가</th><th>단지총단가</th><th>할인률</th><th>비고</th>
    </tr>
  </thead>
  <tbody>
    ${summaryRows}
    <tr class="sum-row">
      <td>합  계</td><td></td>
      <td class="num">${fmt(data.total_units)}</td>
      <td class="num">${fmt(data.total_households)}</td>
      <td></td>
      <td class="num">${fmt(data.total_price_4w)}</td>
      <td></td><td></td>
    </tr>
  </tbody>
</table>

<div class="notes">
  ■ 노출방식 : 18시간(06:00~24:00) Rolling방식으로 송출<br>
  ■ ${safeDateStr} 기준(APT List) 작성 된 견적입니다.<br>
  ■ 실 청약 가능 구좌는 온에어 일정에 맞춰 확인필
  ${safeCustomNotes ? `<br>${safeCustomNotes}` : ''}
</div>

<p class="closing">위와 같이 견적합니다.</p>

${includeCreative ? `
<div class="page-break"></div>
<div class="header">
  <h1 style="font-size:16px">광고 소재 제작 제안</h1>
</div>

<div class="notes" style="margin-bottom:10px;">
  <strong>${escapeHtml(creativePlan.concept_title)}</strong><br>
  ${escapeHtml(creativePlan.concept_summary)}<br>
  추천 키워드: ${escapeHtml(creativePlan.recommended_keywords.join(' · '))}
</div>

<div class="creative-wrap">
  <div class="creative-card">
    <h3>이미지형 편집안</h3>
    <p><strong>${escapeHtml(creativePlan.image_package.composition)}</strong><br>${escapeHtml(creativePlan.image_package.recommendation)}<br>소스 전략: ${escapeHtml(creativePlan.image_package.source_strategy)}</p>
    <table>
      <thead>
        <tr><th>컷</th><th>초</th><th>비주얼</th><th>문구</th></tr>
      </thead>
      <tbody>
        ${creativeImageRows}
      </tbody>
    </table>
  </div>
  <div class="creative-card">
    <h3>동영상형 편집안</h3>
    <p><strong>${escapeHtml(creativePlan.video_package.style)}</strong><br>${escapeHtml(creativePlan.video_package.recommendation)}</p>
    <table>
      <thead>
        <tr><th>구간</th><th>비주얼</th><th>문구</th></tr>
      </thead>
      <tbody>
        ${creativeVideoRows}
      </tbody>
    </table>
  </div>
</div>

<div class="creative-wrap">
  <div class="creative-card">
    <h3>오디오 가이드</h3>
    <p><strong>${escapeHtml(creativePlan.audio.mode_label)}</strong><br>BGM: ${escapeHtml(creativePlan.audio.bgm)}</p>
    <div class="creative-subtitle">멘트 방향</div>
    <ul>${creativeNarration}</ul>
  </div>
  <div class="creative-card">
    <h3>필수 자료 / 체크리스트</h3>
    <div class="creative-subtitle">필수 자료</div>
    <ul>${creativeAssets}</ul>
    <div class="creative-subtitle">제작 체크리스트</div>
    <ul>${creativeChecklist}</ul>
  </div>
</div>
` : ''}

<!-- 가동리스트 -->
<div class="page-break"></div>
<div class="header">
  <h1 style="font-size:16px">${safeAddress} — 가동리스트 (${available.length}건)</h1>
</div>

<table>
  <thead>
    <tr>${listHeaderHtml}</tr>
  </thead>
  <tbody>
    ${listRows}
    <tr class="sum-row">${sumRowHtml}</tr>
  </tbody>
</table>

<!-- 지도 페이지 (별도 마지막 페이지) -->
<div class="page-break"></div>
<div class="map-page">
  <div class="header">
    <h1 style="font-size:16px">📍 송출지역 지도</h1>
  </div>
  <p style="text-align:center;color:#666;margin-bottom:12px;">
    ${safeAddress} — ${radiiArr.length > 0 ? `반경 ${escapeHtml(radiiArr.join(', '))}km` : '지역별 조회 기준'}
  </p>
  <div id="pdfMap" style="width:680px;height:500px;border:1px solid #ccc;border-radius:4px;margin:0 auto;"></div>
  <p style="font-size:11px;color:#999;margin-top:8px;text-align:center;">※ 인쇄 전 지도가 완전히 로드된 것을 확인한 후 인쇄해주세요.</p>
</div>

<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoJsKey}&autoload=false&libraries=services"></script>
<script>
kakao.maps.load(function() {
  var centerLat = ${data.center.lat};
  var centerLng = ${data.center.lng};
  var hasCenter = centerLat !== 0 || centerLng !== 0;
  var center = new kakao.maps.LatLng(centerLat || 37.5665, centerLng || 126.978);
  var radii = ${safeRadii};

  var map = new kakao.maps.Map(document.getElementById('pdfMap'), {
    center: center,
    level: 7,
  });

  var bounds = new kakao.maps.LatLngBounds();
  var geocoder = new kakao.maps.services.Geocoder();
  var markerImage = new kakao.maps.MarkerImage(
    'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
    new kakao.maps.Size(24, 35)
  );

  function updateBounds() {
    map.relayout();
    setTimeout(function() {
      if (!bounds.isEmpty()) {
        map.setBounds(bounds, 50, 50, 50, 50);
      }
    }, 200);
  }

  // 하벨사인 거리 계산기 (필터링용)
  function getDist(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  // 반경 원 및 중앙 마커
  if (hasCenter && radii.length > 0) {
    var colors = ['#3182f6','#00c471','#f59e0b','#f04452','#8b5cf6','#06b6d4'];
    var maxR = Math.max.apply(null, radii);
    radii.slice().sort(function(a,b){return a-b;}).forEach(function(r, i) {
      new kakao.maps.Circle({
        center: center,
        radius: r * 1000,
        strokeWeight: 2,
        strokeColor: colors[i % colors.length],
        fillOpacity: 0.06, fillColor: colors[i % colors.length],
        strokeOpacity: 0.8, strokeStyle: 'dash',
      }).setMap(map);
    });
    new kakao.maps.Marker({ position: center, map: map });
    
    if (maxR > 0) {
      var latDelta = maxR / 111;
      var lngDelta = maxR / (111 * Math.cos(centerLat * Math.PI / 180));
      bounds.extend(new kakao.maps.LatLng(centerLat - latDelta, centerLng - lngDelta));
      bounds.extend(new kakao.maps.LatLng(centerLat + latDelta, centerLng + lngDelta));
    }
  } else if (hasCenter) {
    bounds.extend(center);
  }

  // 단지별 별표 마커 (좌표 복구 로직 포함 + 반경 필터링)
  var complexes = ${safeMarkerData};
  var pendingCount = 0;
  var maxR = Math.max.apply(null, radii || [0]);

  complexes.forEach(function(c) {
    if (c.lat && c.lng && c.lat > 0) {
      if (hasCenter && maxR > 0) {
        var d = getDist(centerLat, centerLng, c.lat, c.lng);
        if (d > maxR) return;
      }
      var pos = new kakao.maps.LatLng(c.lat, c.lng);
      bounds.extend(pos);
      new kakao.maps.Marker({ position: pos, map: map, image: markerImage, title: c.name });
    } else {
      var query = (c.addr_road || c.addr_parcel || ((c.city || '') + ' ' + (c.district || '') + ' ' + c.name)).trim();
      if (!query) return;
      pendingCount++;
      geocoder.addressSearch(query, function(res, status) {
        if (status === kakao.maps.services.Status.OK && res[0]) {
          var plat = parseFloat(res[0].y), plng = parseFloat(res[0].x);
          if (hasCenter && maxR > 0) {
            var pd = getDist(centerLat, centerLng, plat, plng);
            if (pd > maxR) { pendingCount--; if (pendingCount === 0) updateBounds(); return; }
          }
          var ppos = new kakao.maps.LatLng(plat, plng);
          bounds.extend(ppos);
          new kakao.maps.Marker({ position: ppos, map: map, image: markerImage, title: c.name });
        } else {
          // 최후의 수단: 단순히 이름으로만 한 번 더 시도
          geocoder.addressSearch(c.name, function(res2, status2) {
            if (status2 === kakao.maps.services.Status.OK && res2[0]) {
              var plat2 = parseFloat(res2[0].y), plng2 = parseFloat(res2[0].x);
              if (hasCenter && maxR > 0) {
                var pd2 = getDist(centerLat, centerLng, plat2, plng2);
                if (pd2 > maxR) return;
              }
              var ppos2 = new kakao.maps.LatLng(plat2, plng2);
              bounds.extend(ppos2);
              new kakao.maps.Marker({ position: ppos2, map: map, image: markerImage, title: c.name });
            }
          });
        }
        pendingCount--;
        if (pendingCount === 0) updateBounds();
      });
    }
  });

  if (pendingCount === 0) updateBounds();
  
  // 기타 제어 로직 (인쇄 버튼 등)
  var printBtn = document.querySelector('.print-btn');
  if (printBtn) {
    printBtn.onclick = function(e) {
      e.preventDefault();
      updateBounds();
      setTimeout(function() { window.print(); }, 800);
    };
  }
});
</script>

</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return await generatePdfResponse(body, req);
  } catch (e) {
    return NextResponse.json({ error: `PDF 생성 실패: ${e}` }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lat = sp.get('lat');
    const lng = sp.get('lng');
    const districtsParam = (sp.get('districts') || '').split(',').map(s => s.trim()).filter(Boolean);
    const coords = parseCoordinatePair(lat, lng, false);
    const districts = parseDistricts(districtsParam, false);
    const radii = parseRadii((sp.get('radii') || '').split(',').filter(Boolean), false);
    const sortBy = parseSortBy(sp.get('sort_by'));
    const campaignDate = parseCampaignDate(sp.get('campaign_date'));

    if (!coords && districts.length === 0) {
      return NextResponse.json({ error: '좌표 또는 지역이 필요합니다' }, { status: 400 });
    }

    return await generatePdfResponse({
      lat: lat || '0',
      lng: lng || '0',
      address: sp.get('address') || '',
      radii,
      districts,
      require_ev: sp.get('require_ev') === 'true',
      sort_by: sortBy,
      advertiser_name: sp.get('advertiser_name') || '',
      campaign_name: sp.get('campaign_name') || '',
      advertiser_industry: sp.get('advertiser_industry') || '',
      notes: sp.get('notes') || '',
      creative_message: sp.get('creative_message') || '',
      creative_format: sp.get('creative_format') || 'both',
      creative_audio_mode: sp.get('creative_audio_mode') || 'bgm_narration',
      creative_asset_kinds: (sp.get('creative_asset_kinds') || '').split(',').filter(Boolean),
      include_creative: sp.get('include_creative') !== 'false',
      campaign_date: campaignDate,
      excluded_ids: (sp.get('excluded_ids') || '').split(',').filter(Boolean),
      excluded_columns: (sp.get('excluded_columns') || '').split(',').filter(Boolean),
    }, req);
  } catch (e) {
    return NextResponse.json({ error: `PDF 생성 실패: ${e}` }, { status: 500 });
  }
}

async function generatePdfResponse(body: Record<string, unknown>, req: NextRequest) {
  const {
    lat, lng, address,
    radii = [],
    districts = [],
    require_ev = false,
    sort_by = 'distance',
    advertiser_industry,
    campaign_date,
    advertiser_name = '',
    campaign_name = '',
    notes = '',
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
    // 반경 조회
    searchResult = await searchNearby({
      address: (address as string) || '',
      lat: coords.lat,
      lng: coords.lng,
      radii: radiiList,
      districts: districtsList,
      require_ev: Boolean(require_ev),
      sort_by: normalizedSortBy,
      advertiser_industry: advertiser_industry as string,
      campaign_date: parsedCampaignDate,
      advertiser_name: advertiser_name as string,
      campaign_name: campaign_name as string,
    });
  } else if (districtsList.length > 0) {
    // 지역별 조회
    searchResult = await searchByDistrict({
      districts: districtsList,
      require_ev: Boolean(require_ev),
      sort_by: normalizedSortBy,
      advertiser_industry: advertiser_industry as string,
      campaign_date: parsedCampaignDate,
    });
  } else {
    return NextResponse.json({ error: '좌표+반경 또는 지역을 지정해주세요' }, { status: 400 });
  }

  // excluded_ids 필터링
  const excludedRaw = body.excluded_ids;
  const excludedIds = Array.isArray(excludedRaw) ? new Set(excludedRaw.map(String).filter(Boolean)) : new Set<string>();
  if (excludedIds.size > 0) {
    searchResult.results = searchResult.results.filter(r => !excludedIds.has(r.id));
    const avail = searchResult.results.filter(r => r.restriction_status === 'available');
    searchResult.total_count = avail.length;
    searchResult.total_households = avail.reduce((s, c) => s + (c.households || 0), 0);
    searchResult.total_units = avail.reduce((s, c) => s + (c.units || 0), 0);
    searchResult.total_price_4w = avail.reduce((s, c) => s + (c.price_4w || 0), 0);
  }

  void appendActivityLog({
    action: 'pdf',
    address: String(address || searchResult.center.address || ''),
    radii: radiiList,
    resultCount: searchResult.total_count,
    advertiserName: String(advertiser_name || ''),
    campaignName: String(campaign_name || ''),
    ip: getClientIp(req.headers),
  }).catch(() => {});

  const creativePlan = buildCreativePlan({
    advertiser_name: String(advertiser_name || ''),
    advertiser_industry: String(advertiser_industry || ''),
    campaign_name: String(campaign_name || ''),
    message: String(creative_message || ''),
    notes: String(notes || ''),
    preferred_format: String(creative_format || 'both') as 'image' | 'video' | 'both',
    audio_mode: String(creative_audio_mode || 'bgm_narration') as 'bgm_narration' | 'bgm_only' | 'narration_only',
    asset_kinds: Array.isArray(creative_asset_kinds)
      ? creative_asset_kinds.map(String) as CreativeAssetKind[]
      : [],
  });

  const excludedColumnsArr = Array.isArray(body.excluded_columns) ? body.excluded_columns.map(String).filter(Boolean) : [];
  const excludedColumns: Set<string> = new Set(excludedColumnsArr);

  const html = buildPdfHtml(
    searchResult,
    String(advertiser_name),
    String(campaign_name),
    creativePlan,
    String(notes || ''),
    excludedColumns,
    body.include_creative !== false,
  );

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
