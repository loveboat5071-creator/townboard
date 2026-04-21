import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  
  if (!token) {
    return NextResponse.json({ 
      error: '서버 설정 오류: BLOB_READ_WRITE_TOKEN이 없습니다. Vercel Storage 설정을 확인해주세요.' 
    }, { status: 500 });
  }

  try {
    // 유효 기간을 24시간으로 대폭 늘려봅니다.
    const clientToken = await (generateClientTokenFromReadWriteToken as any)({
      token,
      expiresIn: 86400,
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
// 혹은 GET도 일단 열어둡니다 (디버깅용)
export async function GET() {
  return POST();
}
