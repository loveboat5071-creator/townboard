import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

export const maxDuration = 300; // 5분으로 연장 (많은 데이터 처리용)

const SERVICE_KEY = '500c1df5c162639d9a9dd87f3b8bc4f5c81d57d7331eadb7c8e38bcf77f05215';
const BASE_URL = 'http://apis.data.go.kr/1613000/AptBasisInfoService1';

async function getKaptCode(kaptNm: string) {
  try {
    const res = await axios.get(`${BASE_URL}/getAptList`, {
      params: { serviceKey: SERVICE_KEY, kaptNm, pageNo: 1, numOfRows: 5 }
    });
    const match = String(res.data).match(/<kaptCode>([^<]+)<\/kaptCode>/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function getHallwayType(kaptCode: string) {
  try {
    const res = await axios.get(`${BASE_URL}/getAptBasisInfo`, {
      params: { serviceKey: SERVICE_KEY, kaptCode }
    });
    const match = String(res.data).match(/<kaptRtTypeNm>([^<]+)<\/kaptRtTypeNm>/);
    return match ? match[1] : '정보없음';
  } catch { return '오류'; }
}

export async function GET() {
  const rootDir = path.join(process.cwd(), '..');
  const inputPath = path.join(rootDir, 'input.xlsx');
  const outputPath = path.join(rootDir, 'output.xlsx');

  if (!fs.existsSync(inputPath)) {
    return NextResponse.json({ error: 'input.xlsx 파일을 찾을 수 없습니다.' }, { status: 404 });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);
    const ws = workbook.worksheets[0];

    // 컬럼 찾기
    let nameCol = -1;
    ws.getRow(1).eachCell((cell, col) => {
      const val = String(cell.value || '');
      if (val.includes('단지명') || val.includes('아파트명')) nameCol = col;
    });

    if (nameCol === -1) {
      return NextResponse.json({ error: '단지명 컬럼을 찾을 수 없습니다.' }, { status: 400 });
    }

    const hallwayTypeCol = ws.actualColumnCount + 1;
    ws.getCell(1, hallwayTypeCol).value = '복도유형';

    const maxRows = Math.min(ws.rowCount, 100); // 테스트를 위해 우선 100행만
    
    for (let i = 2; i <= maxRows; i++) {
        const row = ws.getRow(i);
        const complexName = String(row.getCell(nameCol).value || '').trim();
        if (!complexName) continue;

        const kaptCode = await getKaptCode(complexName);
        if (kaptCode) {
            row.getCell(hallwayTypeCol).value = await getHallwayType(kaptCode);
        } else {
            row.getCell(hallwayTypeCol).value = '미발견';
        }
        // 간격 조절
        await new Promise(r => setTimeout(r, 200));
    }

    await workbook.xlsx.writeFile(outputPath);

    return NextResponse.json({ 
      success: true, 
      message: `상위 ${maxRows-1}개 단지 분석 완료. output.xlsx 저장됨.`,
      outputPath 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
