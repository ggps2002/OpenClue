import { Router, type Request, type Response } from 'express';
import { clearSessionCookie, currentUserId, requireAuth, setSessionCookie } from '../../middleware/auth';
import { signInSchema, signUpSchema } from './auth.schema';
import type { AuthService } from './auth.service';

export class AuthController {
  readonly router = Router();

  constructor(private readonly auth: AuthService) {
    this.router.post('/signup', this.signUp);
    this.router.post('/signin', this.signIn);
    this.router.post('/signout', this.signOut);
    this.router.get('/me', requireAuth, this.me);
  }

  private signUp = async (req: Request, res: Response) => {
    const user = await this.auth.signUp(signUpSchema.parse(req.body));
    setSessionCookie(res, user.id);
    res.status(201).json({ user });
  };

  private signIn = async (req: Request, res: Response) => {
    const user = await this.auth.signIn(signInSchema.parse(req.body));
    setSessionCookie(res, user.id);
    res.json({ user });
  };

  private signOut = (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.status(204).end();
  };

  private me = async (req: Request, res: Response) => {
    res.json({ user: await this.auth.getUser(currentUserId(req)) });
  };
}
