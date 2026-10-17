import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from '../users/users.repository.js';
import * as bcrypt from 'bcryptjs';
// import type { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';
import type { RegisterDto } from './dto/register.dto.js';
import { $Enums, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { parseDurationToSeconds } from '../../common/utils/token-expiry.util.js';

@Injectable()
export class AuthService {
  constructor(
    private usersRepository: UsersRepository,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    const user = await this.usersRepository.findByEmail(email);
    if (
      user &&
      user.isActive &&
      (await bcrypt.compare(password, user.password))
    ) {
      // const { password, ...result } = user;
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      };
    }

    return null;
  }

  async validateUserById(id: string): Promise<AuthUser | null> {
    const user = await this.usersRepository.findById(id);
    if (!user || !user.isActive) return null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
    };
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: `Organization of ${dto.email}`,
          slug: `org-${dto.email}`,
        },
      });

      return tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName ?? '',
          lastName: dto.lastName ?? '',
          organizationId: organization.id,
          role: $Enums.RoleName.ADMIN,
        },
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;
    return result;
  }

  async validateGoogleUser(
    email: string,
    firstName: string,
    lastName: string,
    organizationId: string,
  ): Promise<AuthUser> {
    let user: User = (await this.usersRepository.findByEmail(email)) as User;
    if (!user) {
      user = await this.usersRepository.create({
        email,
        password: '',
        firstName,
        lastName,
        organizationId,
        // roleId,
      });
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
    };
  }

  login(payload: AuthUser) {
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        expiresIn: parseDurationToSeconds(
          this.configService.get<string>('JWT_REFRESH_EXPIRATION')!,
        ),
      }),
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: AuthUser;
    try {
      payload = this.jwtService.verify<AuthUser>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepository
      .findById(payload.id)
      .catch(() => null);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
    };

    return this.login(authUser);
  }

  async setPassword(userId: string, newPassword: string) {
    const user = await this.usersRepository.findByEmail(
      (await this.usersRepository.findById(userId)).email,
    );
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.password) {
      throw new BadRequestException(
        'Password already set. Use change password instead.',
      );
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.updatePassword(userId, hashedPassword);
    return { message: 'Password set successfully' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersRepository.findByEmail(
      (await this.usersRepository.findById(userId)).email,
    );
    if (!user || !user.password) {
      throw new BadRequestException(
        'No password set. Use set password instead.',
      );
    }
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.updatePassword(userId, hashedPassword);
    return { message: 'Password changed successfully' };
  }
}
