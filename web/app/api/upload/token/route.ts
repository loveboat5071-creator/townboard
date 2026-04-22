import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is missing');

    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      payload: JSON.stringify({ userId: 'admin' }),
      expiresIn: 3600, // 1 hour
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
