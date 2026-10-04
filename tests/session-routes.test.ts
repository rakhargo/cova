import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST as quoteRoute } from '../app/api/sessions/quote/route.js';
import { POST as startRoute } from '../app/api/sessions/start/route.js';
import { POST as stopRoute } from '../app/api/sessions/[sessionId]/stop/route.js';
import { apiError } from '../lib/server/session-service.js';

test('quote route rejects malformed JSON with a short no-store response',async()=>{
  const response=await quoteRoute(new Request('http://localhost/api/sessions/quote',{method:'POST',headers:{'content-type':'application/json'},body:'{' }));
  const body=await response.json();assert.equal(response.status,400);assert.equal(body.code,'INVALID_JSON');assert.equal('stack' in body,false);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('start route rejects oversized request before parsing or returning signatures',async()=>{
  const response=await startRoute(new Request('http://localhost/api/sessions/start',{method:'POST',body:'x'.repeat(33_000)}));
  const body=await response.json();assert.equal(response.status,413);assert.equal(body.code,'BODY_TOO_LARGE');assert.equal(JSON.stringify(body).includes('signature'),false);
});

test('stop route rejects invalid session IDs without reading provider or relayer credentials',async()=>{
  const response=await stopRoute(new Request('http://localhost/api/sessions/nope/stop',{method:'POST',body:'{}'}),{params:Promise.resolve({sessionId:'nope'})});
  const body=await response.json();assert.equal(response.status,400);assert.equal(body.code,'INVALID_SESSION');assert.equal('stack' in body,false);
});

test('quote route never returns a successful-looking quote for incomplete fields',async()=>{
  const response=await quoteRoute(new Request('http://localhost/api/sessions/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customer:'bad',serviceId:'unknown',maxAmount:'20',maxDurationSeconds:2400})}));
  const body=await response.json();assert.equal(response.ok,false);assert.notEqual(response.status,200);assert.equal('quote' in body,false);assert.equal('providerSignature' in body,false);
});

test('pending start responses preserve the submitted transaction hash without claiming confirmation',async()=>{
  const hash='0x'+'ab'.repeat(32);const sessionId='0x'+'cd'.repeat(32);const error=Object.assign(new Error('Session start was submitted.'),{status:202,code:'START_PENDING',transactionHash:hash,sessionId});
  const response=apiError(error);const body=await response.json();assert.equal(response.status,202);assert.equal(body.status,'pending');assert.equal(body.transactionHash,hash);assert.equal(body.sessionId,sessionId);assert.equal('stack' in body,false);
});
