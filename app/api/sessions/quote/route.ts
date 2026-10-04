import { apiError, createQuote, parseJson } from '@/lib/server/session-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try { return Response.json(await createQuote(request, await parseJson(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return apiError(error); }
}
