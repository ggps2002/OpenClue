import { HttpError } from '../middleware/error';
import { prisma } from './prisma';

export type Role = 'owner' | 'editor' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

function isRole(value: string): value is Role {
  return value in ROLE_RANK;
}

/**
 * Ensures the user belongs to the workspace with at least `minRole`.
 * Non-members get 404 so workspace ids can't be probed; members with too little access get 403.
 */
export async function requireWorkspaceRole(userId: string, workspaceId: string, minRole: Role): Promise<Role> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership || !isRole(membership.role)) throw new HttpError(404, 'Workspace not found');
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new HttpError(403, 'You do not have permission to do that');
  }
  return membership.role;
}
