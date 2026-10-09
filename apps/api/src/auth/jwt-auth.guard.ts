import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { NAMA_COOKIE_SESI } from '@avicenna/contracts';
import type { Principal } from './auth.types';

export const IS_PUBLIC = 'isPublic';
/** Menandai endpoint yang boleh diakses tanpa token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const IZIN_COOKIE = 'izinCookie';
/**
 * Menandai endpoint yang boleh memakai COOKIE SESI sebagai sumber token.
 *
 * ── Kenapa tidak untuk semua endpoint ───────────────────────────────────────
 *
 * Token yang hanya diterima lewat header kebal CSRF: halaman jahat mana pun
 * bisa membuat browser mengirim cookie, tetapi tidak bisa menyuruhnya memasang
 * header Authorization. Begitu cookie diterima di SELURUH endpoint, satu tab
 * lain yang terbuka cukup untuk memicu POST yang sah atas nama operator yang
 * sedang masuk.
 *
 * Jadi izinnya diberikan satu per satu, dan hanya pantas untuk aliran yang
 * MEMBACA saja — sekarang: SSE realtime, yang memang tidak punya cara lain.
 * EventSource di browser tidak bisa memasang header, dan menaruh token di
 * query string berarti token itu tercatat di access log nginx sepanjang
 * usianya (token perangkat berlaku setahun).
 */
export const TokenDariCookie = () => SetMetadata(IZIN_COOKIE, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const bolehCookie =
      this.reflector.getAllAndOverride<boolean>(IZIN_COOKIE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const token = extractToken(req, bolehCookie);
    if (!token) throw new UnauthorizedException('Token tidak ditemukan');

    try {
      req.principal = await this.jwt.verifyAsync<Principal>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
  }
}

function extractToken(req: Request, bolehCookie: boolean): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // EventSource di browser tidak bisa mengirim header, jadi SSE memakai query.
  const q = req.query?.token;
  if (typeof q === 'string') return q;
  return bolehCookie ? cookieSesi(req.headers.cookie) : undefined;
}

/**
 * Membaca satu cookie dari header mentah.
 *
 * Diurai sendiri, tanpa cookie-parser: menambah dependensi berarti menyentuh
 * lockfile dan menjalankan instalasi di jaringan kantor yang memblokir
 * registry — harga yang terlalu besar untuk sepuluh baris ini.
 */
function cookieSesi(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const bagian of header.split(';')) {
    const pisah = bagian.indexOf('=');
    if (pisah < 0) continue;
    if (bagian.slice(0, pisah).trim() !== NAMA_COOKIE_SESI) continue;
    const nilai = bagian.slice(pisah + 1).trim();
    try {
      return decodeURIComponent(nilai);
    } catch {
      // Cookie rusak diperlakukan seperti tidak ada, bukan menggagalkan
      // permintaan dengan galat yang tidak bisa dimengerti operator.
      return undefined;
    }
  }
  return undefined;
}
