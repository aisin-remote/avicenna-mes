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
import type { Principal } from './auth.types';

export const IS_PUBLIC = 'isPublic';
/** Menandai endpoint yang boleh diakses tanpa token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

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
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Token tidak ditemukan');

    try {
      req.principal = await this.jwt.verifyAsync<Principal>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
  }
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // EventSource di browser tidak bisa mengirim header, jadi SSE memakai query.
  const q = req.query?.token;
  return typeof q === 'string' ? q : undefined;
}
