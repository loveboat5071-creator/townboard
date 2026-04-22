import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  console.log('--- Upload Handshake Started ---');
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    console.error('Error: BLOB_READ_WRITE_TOKEN is missing!');
    return NextResponse.json({ error: '서버 설정 오류: 토큰이 없습니다.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    console.log('Request body:', JSON.stringify(body));

    const jsonResponse = await handleUpload({
      body,
      request,
      token, // 토큰을 명시적으로 전달
      onBeforeGenerateToken: async (pathname) => {
        console.log('Generating token for:', pathname);
        return {
          allowedContentTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/json',
            'text/csv'
          ],
          tokenPayload: JSON.stringify({
            timestamp: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Upload completed:', blob.url);
      },
    });

    console.log('Handshake response generated successfully');
    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Handshake error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

// GET 요청은 무시하거나 에러 처리
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
