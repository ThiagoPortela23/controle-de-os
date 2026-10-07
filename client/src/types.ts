export type Role = 'REQUESTER' | 'TECHNICIAN' | 'ADMIN';
export interface User { id: string; name: string; email: string; role: Role; active: boolean; must_change_password: boolean }
export interface Order {
  id: string; number: number; title: string; description: string;
  requester_name: string; requester_email: string; requester_id: string;
  status: 'OPEN' | 'ASSIGNED' | 'RESOLVED'; technician_id: string | null; technician_name: string | null;
  resolved_by_name: string | null; solution: string | null; resolution_version: number;
  acceptance: 'NOT_REQUESTED' | 'PENDING' | 'CONFIRMED' | 'REJECTED';
  created_at: string; updated_at: string; resolved_at: string | null;
}
export interface Detail extends Order {
  events: { id: string; actor_name: string; kind: string; message: string; created_at: string }[];
  confirmations: { id: string; version: number; requester_name: string; expires_at: string; invalidated_at: string | null;
    responded_at: string | null; response: 'CONFIRMED' | 'REJECTED' | null; reason: string | null;
    email_status: 'PENDING' | 'SENT' | 'FAILED'; created_at: string }[];
}
export interface List { items: Order[]; total: number; page: number; pageSize: number }
