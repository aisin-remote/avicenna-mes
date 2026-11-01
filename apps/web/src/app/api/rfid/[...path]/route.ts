/**
 * Pintu API untuk reader RFID lewat domain web.
 *
 * Di server, nginx hanya membuka web; API tetap di 127.0.0.1. Reader memanggil
 * https://<host>/api/rfid/<endpoint API> dan diteruskan apa adanya, termasuk
 * header Authorization miliknya sendiri (token perangkat, bukan cookie sesi).
 * Daftar putih supaya endpoint tulis lain (ship, undo, truck, receive) tetap
 * hanya bisa dipanggil web. Endpoint baru untuk perangkat ditambahkan di sini.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const ALLOWED = {
  POST: /^(auth\/(device|login)|loading\/rfid\/batch)$/,
  GET: /^(auth\/me|loading\/resolve|loading\/[1-9]\d*(\/(history|intercompany|delivery-order))?)$/,
};

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(method: keyof typeof ALLOWED, request: Request, { params }: Ctx) {
  const path = (await params).path.join('/');
  if (!ALLOWED[method].test(path))
    return Response.json(
      { statusCode: 404, message: 'Endpoint tidak dibuka untuk perangkat.' },
      { status: 404 },
    );
  const auth = request.headers.get('authorization');
  try {
    const res = await fetch(`${API}/${path}${new URL(request.url).search}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: method === 'POST' ? await request.text() : undefined,
      cache: 'no-store',
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      { statusCode: 503, message: 'Server API belum dapat dihubungi.' },
      { status: 503 },
    );
  }
}

export const GET = (request: Request, ctx: Ctx) => forward('GET', request, ctx);
export const POST = (request: Request, ctx: Ctx) => forward('POST', request, ctx);
