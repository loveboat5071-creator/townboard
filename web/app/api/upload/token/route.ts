import { generateClientTokenFromReadWriteToken } from '@vercel/blob';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다' }, { status: 500 });
  }

  // 클라이언트에서 업로드를 허용하는 토큰 생성
  const clientToken = await generateClientTokenFromReadWriteToken({
    returnPayload: {},
    token,
  });

  return NextResponse.json({ clientToken });
}
