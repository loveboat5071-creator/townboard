import { NextRequest, NextResponse } from 'next/server';
import { saveToBlob, loadMasterDataAsync } from '@/lib/masterData';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { url, fileName } = await req.json();
    if (!url) {
      return NextResponse.json({ error: '파일 URL이 없습니다' }, { status: 400 });
    }

    // 업로드된 엑셀 파일을 URL로부터 가져오기
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('업로드된 파일을 읽을 수 없습니다.');
    const arrBuf = await resp.arrayBuffer();

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(arrBuf as any);
    
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('시트를 찾을 수 없습니다.');

    // ── 데이터 파싱 ────────────────
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value || '').trim();
    });

    const colMap: Record<string, number> = {};
    const mapping: Record<string, string[]> = {
      name: ['단지명', '아파트명', 'name', '명칭'],
      city: ['도시', '시도', '시', 'city'],
      district: ['시군구', '구군', '구', 'district'],
      dong: ['동', '법정동', 'dong'],
      addr_parcel: ['지번주소', '주소(지번)', 'addr_parcel'],
      addr_road: ['도로명주소', '주소(도로명)', 'addr_road'],
      households: ['총세대수', '세대수', 'households'],
      units: ['판매수량', '판매'],
      unit_price: ['대당단가', '단가'],
      price_4w: ['4주금액', '4주 금액'],
      r1_industry: ['구좌1업종'],
      r2_industry: ['구좌2업종'],
      lat: ['위도', 'lat'],
      lng: ['경도', 'lng'],
    };

    for (const [field, aliases] of Object.entries(mapping)) {
      for (let i = 1; i < headers.length; i++) {
        const h = (headers[i] || '').replace(/\s+/g, '').toLowerCase();
        if (aliases.some(a => a.replace(/\s+/g, '').toLowerCase() === h)) {
          colMap[field] = i;
          break;
        }
      }
    }

    const records: any[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: any = {};
      let hasData = false;
      for (const [field, col] of Object.entries(colMap)) {
        const cellValue = row.getCell(col).value;
        if (cellValue != null && cellValue !== '') hasData = true;
        if (['households', 'units', 'unit_price', 'price_4w', 'lat', 'lng'].includes(field)) {
          const n = Number(cellValue);
          record[field] = isNaN(n) ? null : n;
        } else {
          record[field] = cellValue != null ? String(cellValue).trim() : null;
        }
      }
      if (hasData && record.name) {
        // ID 생성
        record.id = [record.name, record.addr_road || record.addr_parcel || ''].map(v => String(v).replace(/\s/g, '')).join('__');
        records.push(record);
      }
    });

    // 기존 데이터와 병합
    const existingData = await loadMasterDataAsync();
    const dataMap = new Map<string, any>();
    for (const item of existingData) { if (item && item.id) dataMap.set(item.id, item); }
    for (const item of records) { if (item && item.id) dataMap.set(item.id, item); }
    
    const finalData = Array.from(dataMap.values());

    // 최종 Blob 저장
    const saveResult = await saveToBlob(finalData as any[], {
      displayName: fileName || 'direct_upload.xlsx',
      uploadedAt: new Date().toISOString(),
      rowCount: finalData.length,
    });

    return NextResponse.json({
      success: true,
      message: `✅ 총 ${finalData.length}건 데이터 반영 완료`,
      count: finalData.length,
      url: saveResult.url
    });

  } catch (error) {
    console.error('Process blob error:', error);
    return NextResponse.json({ error: `파일 처리 오류: ${error}` }, { status: 500 });
  }
}
