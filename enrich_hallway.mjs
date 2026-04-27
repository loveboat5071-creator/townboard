import ExcelJS from 'exceljs';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// 공공데이터포털 설정
const SERVICE_KEY = '500c1df5c162639d9a9dd87f3b8bc4f5c81d57d7331eadb7c8e38bcf77f05215';
const BASE_URL = 'http://apis.data.go.kr/1613000/AptBasisInfoService1';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 1단계: 단지 코드를 조회합니다.
 */
async function getKaptCode(kaptNm) {
  try {
    const url = `${BASE_URL}/getAptList`;
    const res = await axios.get(url, {
      params: {
        serviceKey: SERVICE_KEY,
        kaptNm: kaptNm,
        pageNo: 1,
        numOfRows: 10
      }
    });
    
    // API 응답 구조: <response><body><items><item><kaptCode>...
    // axios는 기본적으로 XML을 문자열로 반환하거나 라이브러리가 필요할 수 있음
    // 여기선 간단한 정규표현식으로 추출 시도 (복잡한 파서 설치 방지)
    const data = res.data;
    const match = data.match(/<kaptCode>([^<]+)<\/kaptCode>/);
    return match ? match[1] : null;
  } catch (e) {
    console.error(`Error finding kaptCode for ${kaptNm}:`, e.message);
    return null;
  }
}

/**
 * 2단계: 단지 코드로 상세 정보(복도유형)를 조회합니다.
 */
async function getHallwayType(kaptCode) {
  try {
    const url = `${BASE_URL}/getAptBasisInfo`;
    const res = await axios.get(url, {
      params: {
        serviceKey: SERVICE_KEY,
        kaptCode: kaptCode
      }
    });
    
    const data = res.data;
    const match = data.match(/<kaptRtTypeNm>([^<]+)<\/kaptRtTypeNm>/);
    return match ? match[1] : '정보없음';
  } catch (e) {
    console.error(`Error finding hallwayType for ${kaptCode}:`, e.message);
    return '오류';
  }
}

async function main() {
  const inputPath = './타운보드 가동리스트(로컬상품)_260413_수정.xlsx';
  const outputPath = './타운보드 가동리스트_복도유형_업데이트.xlsx';

  console.log('Reading Excel file...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const ws = workbook.worksheets[0];

  // 헤더 찾기 및 새 컬럼 추가
  const headerRow = ws.getRow(1);
  let nameCol = -1;
  let addrCol = -1;
  
  headerRow.eachCell((cell, col) => {
    const val = String(cell.value || '');
    if (val.includes('단지명') || val.includes('아파트명')) nameCol = col;
    if (val.includes('주소') || val.includes('도로명')) addrCol = col;
  });

  if (nameCol === -1) {
    console.error('Could not find mandatory columns!');
    return;
  }

  const hallwayTypeCol = ws.actualColumnCount + 1;
  ws.getCell(1, hallwayTypeCol).value = '복도유형';
  ws.getCell(1, hallwayTypeCol).font = { bold: true };

  const totalRows = ws.rowCount;
  console.log(`Initial processing for ${totalRows - 1} complexes...`);

  for (let i = 2; i <= totalRows; i++) {
    const row = ws.getRow(i);
    const complexName = String(row.getCell(nameCol).value || '').trim();
    if (!complexName) continue;

    process.stdout.write(`[${i}/${totalRows}] Analyzing ${complexName}... `);

    // 1. 단지코드 찾기
    const kaptCode = await getKaptCode(complexName);
    if (!kaptCode) {
      row.getCell(hallwayTypeCol).value = '단지미발견';
      console.log('Not Found');
    } else {
      // 2. 복도유형 찾기
      const hallwayType = await getHallwayType(kaptCode);
      row.getCell(hallwayTypeCol).value = hallwayType;
      console.log(`Done (${hallwayType})`);
    }

    // API 과부하 방지 및 Rate Limit 준수
    await delay(300);
  }

  console.log('Saving updated Excel file...');
  await workbook.xlsx.writeFile(outputPath);
  console.log('Successfully completed! File saved as:', outputPath);
}

main().catch(console.error);
