import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 처리 시간을 60초로 확보

/**
 * 4.5MB 제한을 우회하기 위한 스트리밍 업로드 API
 */
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('filename') || 'upload.xlsx';

    console.log(`Starting server-side streaming upload for: ${filename}`);

    // req.body(ReadableStream)를 Vercel Blob으로 바로 파이핑(Piping)
    // 이 방식은 전체 파일을 서버 메모리에 담지 않으므로 4.5MB 제한을 넘을 수 있음
    if (!req.body) {
      return NextResponse.json({ error: '요청 본문이 비어있습니다.' }, { status: 400 });
    }

    const blob = await put(filename, req.body, {
      access: 'public',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    console.log(`Streaming upload successful! URL: ${blob.url}`);

    // 업로드가 완료되면, 다시 기존의 분석 API(/api/upload)를 호출하여 DB를 갱신
    return NextResponse.json({ 
      success: true, 
      url: blob.url,
      message: '파일 전송 완료. 이제 DB를 분석합니다...'
    });

  } catch (error) {
    console.error('Streaming upload error:', error);
    return NextResponse.json({ error: `전송 실패: ${(error as Error).message}` }, { status: 500 });
  }
}
