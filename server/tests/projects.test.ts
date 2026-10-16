import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ProjectService } from '../src/modules/projects/projects.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();

describe('ProjectService', () => {
  const service = new ProjectService();
  let owner: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
  });

  it('creates, lists, renames and deletes projects', async () => {
    const first = await service.create(owner.id, owner.workspaceId, 'Onboarding tour');
    const second = await service.create(owner.id, owner.workspaceId, 'Release notes');
    expect((await service.list(owner.id, owner.workspaceId)).map((p) => p.id)).toEqual([second.id, first.id]);

    const renamed = await service.rename(owner.id, first.id, 'Onboarding tour v2');
    expect(renamed.name).toBe('Onboarding tour v2');
    expect((await service.list(owner.id, owner.workspaceId))[0].id).toBe(first.id);

    await service.delete(owner.id, first.id);
    expect((await service.list(owner.id, owner.workspaceId)).map((p) => p.id)).toEqual([second.id]);
  });

  it('hides other workspaces and their projects', async () => {
    const project = await service.create(owner.id, owner.workspaceId, 'Private');
    await expect(service.list(outsider.id, owner.workspaceId)).rejects.toMatchObject({ status: 404 });
    await expect(service.get(outsider.id, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.rename(outsider.id, project.id, 'Hacked')).rejects.toMatchObject({ status: 404 });
    await expect(service.delete(outsider.id, project.id)).rejects.toMatchObject({ status: 404 });
  });

  it('lets viewers read but not change projects', async () => {
    const project = await service.create(owner.id, owner.workspaceId, 'Shared');
    await prisma.membership.create({ data: { userId: outsider.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    await expect(service.get(outsider.id, project.id)).resolves.toMatchObject({ name: 'Shared', role: 'viewer' });
    await expect(service.rename(outsider.id, project.id, 'Nope')).rejects.toMatchObject({ status: 403 });
    await expect(service.create(outsider.id, owner.workspaceId, 'Nope')).rejects.toMatchObject({ status: 403 });
  });
});

describe('project routes', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
  });

  it('requires a session', async () => {
    await request(app).get(`/api/workspaces/${owner.workspaceId}/projects`).expect(401);
  });

  it('supports the full CRUD flow', async () => {
    const created = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/projects`)
      .set('Cookie', owner.cookie)
      .send({ name: '  Product launch  ' })
      .expect(201);
    const id = created.body.project.id as string;
    expect(created.body.project).toMatchObject({ name: 'Product launch', mediaCount: 0 });

    const list = await request(app)
      .get(`/api/workspaces/${owner.workspaceId}/projects`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(list.body.projects).toHaveLength(1);

    await request(app).patch(`/api/projects/${id}`).set('Cookie', owner.cookie).send({ name: 'Launch' }).expect(200);
    const detail = await request(app).get(`/api/projects/${id}`).set('Cookie', owner.cookie).expect(200);
    expect(detail.body.project).toMatchObject({ name: 'Launch', role: 'owner', media: [] });

    await request(app).delete(`/api/projects/${id}`).set('Cookie', owner.cookie).expect(204);
    await request(app).get(`/api/projects/${id}`).set('Cookie', owner.cookie).expect(404);
  });

  it('validates the project name', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/projects`)
      .set('Cookie', owner.cookie)
      .send({ name: '   ' })
      .expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: 'name', message: 'Name is required' });
  });
});
