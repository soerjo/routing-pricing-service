import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersRepository } from '../users/users.repository.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let findById: jest.Mock;
  let findByEmail: jest.Mock;
  let verify: jest.Mock;
  let sign: jest.Mock;

  const activeUser = {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'ADMIN',
    organizationId: 'org-1',
    isActive: true,
  };

  const expectedAuthUser = {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'ADMIN',
    organizationId: 'org-1',
  };

  beforeEach(() => {
    findById = jest.fn();
    findByEmail = jest.fn();
    verify = jest.fn();
    sign = jest
      .fn()
      .mockReturnValueOnce('new-access')
      .mockReturnValueOnce('new-refresh');

    const configService = {
      get: jest.fn((key: string) =>
        key === 'JWT_REFRESH_SECRET'
          ? 'refresh-secret'
          : key === 'JWT_REFRESH_EXPIRATION'
            ? '7d'
            : undefined,
      ),
    };

    service = new AuthService(
      { findById, findByEmail } as unknown as UsersRepository,
      { verify, sign } as unknown as JwtService,
      configService as unknown as ConfigService,
      {} as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('refreshTokens', () => {
    it('issues a new token pair for a valid refresh token', async () => {
      verify.mockReturnValue({ id: 'user-1' });
      findById.mockResolvedValue(activeUser);

      const tokens = await service.refreshTokens('valid-refresh-token');

      expect(verify).toHaveBeenCalledWith('valid-refresh-token', {
        secret: 'refresh-secret',
      });
      expect(tokens).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
    });

    it('rejects an expired or tampered refresh token', async () => {
      verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshTokens('bad-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(findById).not.toHaveBeenCalled();
    });

    it('rejects when the user no longer exists', async () => {
      verify.mockReturnValue({ id: 'user-1' });
      findById.mockResolvedValue(null);

      await expect(service.refreshTokens('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an inactive user', async () => {
      verify.mockReturnValue({ id: 'user-1' });
      findById.mockResolvedValue({ ...activeUser, isActive: false });

      await expect(service.refreshTokens('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('validateUser (login path)', () => {
    it('rejects an inactive user', async () => {
      findByEmail.mockResolvedValue({ ...activeUser, isActive: false });

      await expect(
        service.validateUser('user@example.com', 'secret'),
      ).resolves.toBeNull();
    });

    it('returns the auth user for an active user with valid credentials', async () => {
      const password = await bcrypt.hash('secret', 4);
      findByEmail.mockResolvedValue({ ...activeUser, password });

      await expect(
        service.validateUser('user@example.com', 'secret'),
      ).resolves.toEqual(expectedAuthUser);
    });

    it('rejects an active user with invalid credentials', async () => {
      const password = await bcrypt.hash('secret', 4);
      findByEmail.mockResolvedValue({ ...activeUser, password });

      await expect(
        service.validateUser('user@example.com', 'wrong'),
      ).resolves.toBeNull();
    });
  });

  describe('validateUserById (jwt path)', () => {
    it('rejects an inactive user', async () => {
      findById.mockResolvedValue({ ...activeUser, isActive: false });

      await expect(service.validateUserById('user-1')).resolves.toBeNull();
    });

    it('returns the auth user for an active user', async () => {
      findById.mockResolvedValue(activeUser);

      await expect(service.validateUserById('user-1')).resolves.toEqual(
        expectedAuthUser,
      );
    });
  });
});
