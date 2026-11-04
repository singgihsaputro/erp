import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role, SessionUser } from '@erp/shared';
import { api, ApiError } from '../../lib/api';

/** The signed-in user, or null when nobody is. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<SessionUser>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Null first, so the app swaps to the sign-in screen; then forget the signed-in data.
      // (queryClient.clear() would drop the 'me' query without telling the screen showing it.)
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

/** Who may use the invoice inbox. The API enforces the same list. */
export const INVOICE_ROLES: Role[] = ['super_admin', 'owner', 'admin'];
