import { apiError, parseJson, startSession } from '@/lib/server/session-service';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try { return Response.json(await startSession(request, await parseJson(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return apiError(error); }
}
