import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  
  if (!token) {
    return NextResponse.json({ 
      error: '서버 설정 오류: BLOB_READ_WRITE_TOKEN이 없습니다. Vercel Storage 설정을 확인해주세요.' 
    }, { status: 500 });
  }

  try {
    // 다시 @vercel/blob/client에서 시도 (최신 가이드 기준)
    // 타입 정의 충돌 방지를 위해 any 사용
    const clientToken = await (generateClientTokenFromReadWriteToken as any)({
      payload: JSON.stringify({}),
      token,
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    console.error('Token generation error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ 
      error: `클라이언트 토큰 생성 실패: ${errorMessage}` 
    }, { status: 500 });
  }
}
