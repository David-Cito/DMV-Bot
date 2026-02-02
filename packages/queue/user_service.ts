// User Service for Queue System V2
// See openspec/specs/database/spec.md

import type { User } from '../core/types';
import { getSupabaseClient } from '../db/supabase_client';

// ============================================================================
// USER OPERATIONS
// ============================================================================

export interface CreateUserParams {
  phone: string;
  email?: string;
  name?: string;
  stripe_customer_id?: string;
}

/**
 * Create a new user
 */
export async function createUser(params: CreateUserParams): Promise<User> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .insert({
      phone: params.phone,
      email: params.email || null,
      name: params.name || null,
      stripe_customer_id: params.stripe_customer_id || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return mapUser(data);
}

/**
 * Get a user by ID
 */
export async function getUser(userId: string): Promise<User | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapUser(data);
}

/**
 * Get multiple users by IDs in a single query (batch fetch)
 * Returns a Map for O(1) lookups
 */
export async function getUsersByIds(userIds: string[]): Promise<Map<string, User>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .in('id', userIds);

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }

  const userMap = new Map<string, User>();
  for (const row of data || []) {
    userMap.set(row.id, mapUser(row));
  }

  return userMap;
}

/**
 * Get a user by phone number
 */
export async function getUserByPhone(phone: string): Promise<User | null> {
  const supabase = getSupabaseClient();

  // Normalize phone number
  const normalizedPhone = normalizePhone(phone);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  if (error || !data) {
    return null;
  }

  return mapUser(data);
}

/**
 * Get or create a user by phone number
 */
export async function getOrCreateUser(phone: string, name?: string): Promise<User> {
  const normalizedPhone = normalizePhone(phone);

  // Try to find existing user
  const existing = await getUserByPhone(normalizedPhone);
  if (existing) {
    return existing;
  }

  // Create new user
  return createUser({ phone: normalizedPhone, name });
}

/**
 * Update a user's information
 */
export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, 'email' | 'name' | 'stripe_customer_id'>>
): Promise<User> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update user: ${error.message}`);
  }

  return mapUser(data);
}

/**
 * Update a user's Stripe customer ID
 */
export async function setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('users')
    .update({
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to set Stripe customer ID: ${error.message}`);
  }
}

// ============================================================================
// USER WITH QUEUE INFO
// ============================================================================

export interface UserWithQueueInfo extends User {
  queue_entry?: {
    id: string;
    location_id: string;
    location_name: string;
    tier: string;
    state: string;
    position?: number;
  };
}

/**
 * Get a user with their active queue entry info
 */
export async function getUserWithQueueInfo(userId: string): Promise<UserWithQueueInfo | null> {
  const supabase = getSupabaseClient();

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return null;
  }

  // Get active queue entry (not in terminal state)
  const { data: queueEntry } = await supabase
    .from('queue_entries')
    .select(`
      id,
      location_id,
      tier,
      state,
      locations (name)
    `)
    .eq('user_id', userId)
    .not('state', 'in', '("completed","canceled","expired")')
    .single();

  const result: UserWithQueueInfo = mapUser(user);

  if (queueEntry) {
    result.queue_entry = {
      id: queueEntry.id,
      location_id: queueEntry.location_id,
      location_name: (queueEntry.locations as any)?.name || '',
      tier: queueEntry.tier,
      state: queueEntry.state,
    };
  }

  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize phone number to E.164 format
 * Assumes US numbers if no country code provided
 */
function normalizePhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // If starts with 1 and has 11 digits, it's a US number with country code
  if (digits.startsWith('1') && digits.length === 11) {
    return `+${digits}`;
  }

  // If 10 digits, assume US and add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Otherwise, assume it's already in correct format or add +
  if (!phone.startsWith('+')) {
    return `+${digits}`;
  }

  return phone;
}

/**
 * Map database row to User type
 */
function mapUser(row: any): User {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    stripe_customer_id: row.stripe_customer_id,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// FACTORY PATTERN (FOR TESTING)
// ============================================================================

/**
 * User service interface for dependency injection
 */
export interface UserService {
  createUser(params: CreateUserParams): Promise<User>;
  getUser(userId: string): Promise<User | null>;
  getUsersByIds(userIds: string[]): Promise<Map<string, User>>;
  getUserByPhone(phone: string): Promise<User | null>;
  getOrCreateUser(phone: string, name?: string): Promise<User>;
  updateUser(userId: string, updates: Partial<Pick<User, 'email' | 'name' | 'stripe_customer_id'>>): Promise<User>;
  setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  getUserWithQueueInfo(userId: string): Promise<UserWithQueueInfo | null>;
}

/**
 * Create a user service with a custom Supabase client
 * Useful for testing with mocked clients
 *
 * @example
 * // In tests:
 * const mockSupabase = createMockSupabaseClient();
 * const userService = createUserService(mockSupabase);
 * const user = await userService.getUser('123');
 */
export function createUserService(supabase: ReturnType<typeof getSupabaseClient>): UserService {
  return {
    async createUser(params: CreateUserParams): Promise<User> {
      const { data, error } = await supabase
        .from('users')
        .insert({
          phone: params.phone,
          email: params.email || null,
          name: params.name || null,
          stripe_customer_id: params.stripe_customer_id || null,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create user: ${error.message}`);
      }

      return mapUser(data);
    },

    async getUser(userId: string): Promise<User | null> {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return null;
      }

      return mapUser(data);
    },

    async getUsersByIds(userIds: string[]): Promise<Map<string, User>> {
      if (userIds.length === 0) {
        return new Map();
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .in('id', userIds);

      if (error) {
        throw new Error(`Failed to fetch users: ${error.message}`);
      }

      const userMap = new Map<string, User>();
      for (const row of data || []) {
        userMap.set(row.id, mapUser(row));
      }

      return userMap;
    },

    async getUserByPhone(phone: string): Promise<User | null> {
      const normalizedPhone = normalizePhone(phone);

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone', normalizedPhone)
        .single();

      if (error || !data) {
        return null;
      }

      return mapUser(data);
    },

    async getOrCreateUser(phone: string, name?: string): Promise<User> {
      const normalizedPhone = normalizePhone(phone);
      const existing = await this.getUserByPhone(normalizedPhone);
      if (existing) {
        return existing;
      }
      return this.createUser({ phone: normalizedPhone, name });
    },

    async updateUser(userId: string, updates: Partial<Pick<User, 'email' | 'name' | 'stripe_customer_id'>>): Promise<User> {
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update user: ${error.message}`);
      }

      return mapUser(data);
    },

    async setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
      const { error } = await supabase
        .from('users')
        .update({
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        throw new Error(`Failed to set Stripe customer ID: ${error.message}`);
      }
    },

    async getUserWithQueueInfo(userId: string): Promise<UserWithQueueInfo | null> {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return null;
      }

      const { data: queueEntry } = await supabase
        .from('queue_entries')
        .select(`
          id,
          location_id,
          tier,
          state,
          locations (name)
        `)
        .eq('user_id', userId)
        .not('state', 'in', '("completed","canceled","expired")')
        .single();

      const result: UserWithQueueInfo = mapUser(user);

      if (queueEntry) {
        result.queue_entry = {
          id: queueEntry.id,
          location_id: queueEntry.location_id,
          location_name: (queueEntry.locations as any)?.name || '',
          tier: queueEntry.tier,
          state: queueEntry.state,
        };
      }

      return result;
    },
  };
}

/**
 * Default user service instance using the default Supabase client
 */
export const userService = createUserService(getSupabaseClient());
