import { Controller, Sse, Param, Query, MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { TokenDariCookie } from '../auth/jwt-auth.guard';

/*
 * Aliran SSE dibaca EventSource, yang TIDAK BISA memasang header Authorization.
 * Satu-satunya kredensial yang ikut terkirim sendiri adalah cookie sesi — dan
 * di produksi itu memang satu origin dengan web (nginx meneruskan /realtime/ ke
 * API). Tanpa izin ini monitor menjawab 401 selamanya, dan EventSource mencoba
 * ulang tiap beberapa detik tanpa satu pun pesan yang terlihat di layar.
 */
@TokenDariCookie()
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * Contoh pemakaian dari browser:
   *   const es = new EventSource('/realtime/line:DC-01');
   *   es.onmessage = (e) => console.log(JSON.parse(e.data));
   *
   * Nama channel yang dipakai sekarang:
   *   line:<kode line>   - event scan & produksi satu line
   *   plant:<kode plant> - ringkasan sepabrik
   *   machine:<kode>     - status mesin dari MQTT
   */
  @Sse(':channel')
  stream(@Param('channel') channel: string): Observable<MessageEvent> {
    return this.realtime.subscribe(channel).pipe(
      map((e) => ({ data: e.data }) as MessageEvent),
    );
  }

  /** Alias supaya klien bisa memakai ?channel= alih-alih path param. */
  @Sse()
  streamQuery(@Query('channel') channel = '*'): Observable<MessageEvent> {
    return this.realtime.subscribe(channel).pipe(
      map((e) => ({ data: e.data }) as MessageEvent),
    );
  }
}
