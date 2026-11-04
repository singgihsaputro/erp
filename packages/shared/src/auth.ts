import { z } from 'zod';

/** Every role the ERP knows. Only the super admin exists until user management ships. */
export const ROLES = ['super_admin', 'owner', 'admin', 'cashier', 'warehouse'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  admin: 'Admin',
  cashier: 'Cashier',
  warehouse: 'Warehouse',
};

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required').max(200),
    new_password: z.string().min(8, 'Use at least 8 characters').max(200),
  })
  .refine((v) => v.current_password !== v.new_password, {
    path: ['new_password'],
    message: 'The new password must differ from the current one',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** The signed-in user, as the API returns it. Never carries the password hash. */
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}
