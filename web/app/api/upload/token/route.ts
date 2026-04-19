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
    const clientToken = await generateClientTokenFromReadWriteToken({
      returnPayload: {},
      token,
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json({ 
      error: '클라이언트 접속 권한 생성 실패. 서버 로그를 확인해주세요.' 
    }, { status: 500 });
  }
}
