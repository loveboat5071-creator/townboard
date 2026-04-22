import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  console.log('--- Upload Handshake Started ---');
  try {
    const body = (await request.json()) as HandleUploadBody;
    console.log('Request body:', JSON.stringify(body));

    const jsonResponse = await handleUpload({
      body,
      request,
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
