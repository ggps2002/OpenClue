import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/error';
import type { SignInInput, SignUpInput } from './auth.schema';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  workspaces: { id: string; name: string; role: string }[];
}

const BCRYPT_ROUNDS = 10;
// Compared against when the email is unknown so response timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('openclue-timing-guard', BCRYPT_ROUNDS);

export class AuthService {
  /** Creates the user together with a personal workspace they own. */
  async signUp(input: SignUpInput): Promise<PublicUser> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        memberships: {
          create: { role: 'owner', workspace: { create: { name: `${input.name}'s workspace` } } },
        },
      },
    });
    return this.getUser(user.id);
  }

  async signIn(input: SignInInput): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, 'Email or password is incorrect');
    return this.getUser(user.id);
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { workspace: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!user) throw new HttpError(401, 'Not signed in');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      workspaces: user.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
    };
  }
}
