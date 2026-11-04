import {z} from 'zod';
const empty = z.object({}).strict();
const confirm = z.object({confirm: z.literal(true)}).strict();
export function providerAccountRoutes(app, account) {
  const prefix = '/api/provider/account';
  app.use(prefix, (req, res, next) => {res.set('Cache-Control', 'no-store'); next();});
  // Reading status never creates a profile, starts a process or opens sign-in.
  app.get(prefix, (req, res) => res.json(account.status()));
  app.post(`${prefix}/prepare`, async (req, res) => {confirm.parse(req.body); res.json(await account.connect());});
  app.post(`${prefix}/refresh`, async (req, res) => {empty.parse(req.body); res.json(await account.refresh());});
  app.post(`${prefix}/login`, async (req, res) => {confirm.parse(req.body); res.json(await account.login());});
  app.post(`${prefix}/cancel`, async (req, res) => {empty.parse(req.body); res.json(await account.cancelLogin());});
  app.post(`${prefix}/logout`, async (req, res) => {confirm.parse(req.body); res.json(await account.logout());});
  app.post(`${prefix}/disconnect`, async (req, res) => {empty.parse(req.body); await account.disconnect(); res.json(account.status());});
}
