import { apiError, parseJson, stopSession } from '@/lib/server/session-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try { const { sessionId } = await context.params; return Response.json(await stopSession(request, sessionId, await parseJson(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return apiError(error); }
}
