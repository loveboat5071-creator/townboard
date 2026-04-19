import { NextRequest, NextResponse } from 'next/server';
import { saveToBlob, loadMasterDataAsync } from '@/lib/masterData';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * 대용량 데이터 분할 업로드를 위한 일시적 메모리 버퍼
 * (실제 운영 환경에서는 Redis 등을 권장하지만, 단일 유저 관리자용이므로 간단히 메모리 사용)
 */
const uploadBuffers: Record<string, any[]> = {};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { uploadId, chunk, isFinal, totalRows, fileName } = body;

    if (!uploadId) {
      return NextResponse.json({ error: '유효한 업로드 ID가 없습니다' }, { status: 400 });
    }

    // 버퍼 초기화 및 데이터 추가
    if (!uploadBuffers[uploadId]) {
      uploadBuffers[uploadId] = [];
    }
    
    if (chunk && Array.isArray(chunk)) {
      uploadBuffers[uploadId].push(...chunk);
    }

    // 마지막 조각인 경우 최종 저장
    if (isFinal) {
      const allNewData = uploadBuffers[uploadId];
      delete uploadBuffers[uploadId];

      if (allNewData.length === 0) {
        return NextResponse.json({ error: '저장할 데이터가 없습니다' }, { status: 400 });
      }

      // 기존 데이터와 병합
      const existingData = await loadMasterDataAsync();
      const dataMap = new Map<string, any>();
      
      for (const item of existingData) {
        if (item && item.id) dataMap.set(item.id, item);
      }
      for (const item of allNewData) {
        if (item && item.id) dataMap.set(item.id, item);
      }

      const finalData = Array.from(dataMap.values());

      // Vercel Blob에 저장
      const result = await saveToBlob(finalData as any[], {
        displayName: fileName || 'chunked_upload.xlsx',
        uploadedAt: new Date().toISOString(),
        rowCount: finalData.length,
      });

      return NextResponse.json({
        success: true,
        message: `✅ 총 ${finalData.length}건 데이터 반영 완료 (신규 ${allNewData.length}건 병합됨)`,
        count: finalData.length,
        storage: 'vercel-blob',
        url: result.url
      });
    }

    return NextResponse.json({ success: true, message: '조각 수신 완료', currentCount: uploadBuffers[uploadId].length });

  } catch (error) {
    console.error('Chunked upload error:', error);
    return NextResponse.json({ error: `데이터 조립 오류: ${error}` }, { status: 500 });
  }
}
