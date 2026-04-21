import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (
        pathname,
        /* partOfNextjsAPIExample */
      ) => {
        // 실제 운영 환경에서는 여기서 세션 체크 등을 수행할 수 있습니다.
        return {
          allowedContentTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/json',
            'text/csv'
          ],
          tokenPayload: JSON.stringify({
            // 필요 시 추가 정보를 전달할 수 있습니다.
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // 업로드 완료 시 수행할 로직 (필요 시)
        console.log('blob upload completed', blob, tokenPayload);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }, // 서버 에러 시 400으로 응답하여 SDK가 다시 시도하도록 함
    );
  }
}

// GET 요청은 무시하거나 에러 처리
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
