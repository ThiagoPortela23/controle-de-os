export type Role = 'REQUESTER' | 'TECHNICIAN' | 'ADMIN';
export interface User {
  id: string; name: string; email: string; role: Role;
  active: boolean; must_change_password: boolean;
}
export interface Order {
  id: string; number: number; requester_id: string; requester_name: string; requester_email: string;
  title: string; description: string; status: 'OPEN' | 'ASSIGNED' | 'RESOLVED';
  technician_id: string | null; technician_name: string | null;
  resolved_by_id: string | null; resolved_by_name: string | null; solution: string | null;
  resolution_version: number; acceptance: 'NOT_REQUESTED' | 'PENDING' | 'CONFIRMED' | 'REJECTED';
  created_at: Date; updated_at: Date; resolved_at: Date | null;
}
export interface OrderEvent { id: string; actor_name: string; kind: string; message: string; created_at: Date }
export interface Confirmation {
  id: string; order_id: string; version: number; token_hash: string;
  requester_name: string; requester_email: string; expires_at: Date;
  invalidated_at: Date | null; responded_at: Date | null;
  response: 'CONFIRMED' | 'REJECTED' | null; reason: string | null;
  email_status: 'PENDING' | 'SENT' | 'FAILED'; created_at: Date;
}
export interface Delivery { confirmation: Confirmation; order: Order; token: string }
declare module 'express-session' {
  interface SessionData { userId: string; csrf: string }
}
declare global {
  namespace Express { interface Request { user?: User } }
}
