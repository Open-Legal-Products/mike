import { NextRequest } from 'next/server';

/**
 * Extract and validate user from Supabase JWT token
 * Returns user info if valid, null if invalid or missing
 * 
 * @param request NextRequest with Authorization header
 * @returns User object with email and id, or null
 */
export async function getUserFromRequest(request: NextRequest): Promise<{
  email: string;
  id: string;
} | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return null;
    }
    
    // Validate with Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.warn('[Auth] Invalid or expired token:', error?.message);
      return null;
    }

    if (!user.email) {
      console.warn('[Auth] User has no email');
      return null;
    }

    console.log(`[Auth] User authenticated: ${user.email}`);
    return {
      email: user.email,
      id: user.id
    };
  } catch (error) {
    console.error('[Auth] Error validating token:', error);
    return null;
  }
}

