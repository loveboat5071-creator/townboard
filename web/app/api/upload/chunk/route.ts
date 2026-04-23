import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 메모리에 청크를 임시 저장 (Vercel 인스턴스가 요청 간에 유지될 때 사용)
// 주의: 여러 인스턴스가 뜰 경우를 대비해 실제 운영환경에서는 Redis 등을 쓰는 게 좋으나,
// 간단한 단일 사용자 환경에서는 메모리로도 충분히 작동할 확률이 높습니다.
const chunkStore = new Map<string, { chunks: Buffer[], totalChunks: number }>();

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('filename') || 'upload.xlsx';
    const chunkIndex = parseInt(searchParams.get('index') || '0');
    const totalChunks = parseInt(searchParams.get('total') || '1');
    const uploadId = searchParams.get('id') || 'default';

    console.log(`Receiving chunk ${chunkIndex + 1}/${totalChunks} for ${filename} (ID: ${uploadId})`);

    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!chunkStore.has(uploadId)) {
      chunkStore.set(uploadId, { chunks: [], totalChunks });
    }

    const state = chunkStore.get(uploadId)!;
    state.chunks[chunkIndex] = buffer;

    // 모든 조각이 다 모였는지 확인
    const receivedCount = state.chunks.filter(Boolean).length;
    if (receivedCount === totalChunks) {
      console.log(`All ${totalChunks} chunks received. Combining...`);
      const finalBuffer = Buffer.concat(state.chunks);
      
      // Vercel Blob에 최종 업로드
      const blob = await put(filename, finalBuffer, {
        access: 'public',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      console.log(`Chunked upload successful! URL: ${blob.url}`);
      
      // 청크 저장소 비우기
      chunkStore.delete(uploadId);

      return NextResponse.json({ 
        success: true, 
        url: blob.url,
        completed: true 
      });
    }

    return NextResponse.json({ 
      success: true, 
      received: receivedCount, 
      total: totalChunks,
      completed: false 
    });

  } catch (error) {
    console.error('Chunked upload error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
