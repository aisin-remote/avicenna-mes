import { Body, Controller, Get, Post, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { loginSchema, deviceLoginSchema } from '@avicenna/contracts';
import type { LoginInput, DeviceLoginInput } from '@avicenna/contracts';
import { AuthService } from './auth.service';
import { Public } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: LoginInput) {
    return this.auth.login(body);
  }

  @Public()
  @Post('device')
  @UsePipes(new ZodValidationPipe(deviceLoginSchema))
  deviceLogin(@Body() body: DeviceLoginInput) {
    return this.auth.deviceLogin(body);
  }

  @Get('me')
  me(@Req() req: Request) {
    return req.principal;
  }
}
