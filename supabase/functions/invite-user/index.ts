import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'

// FIX: Se declara la variable global Deno para que TypeScript la reconozca, ya que este código se ejecuta en un entorno Deno.
declare const Deno: any;

Deno.serve(async (req) => {
  // Manejar la solicitud pre-vuelo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, role } = await req.json()

    // Basic email validation (defense in depth; Supabase also validates).
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Email inválido.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Allow-list of role values that an admin can assign during invitation.
    // Even an admin must NOT be able to mint another platform_owner via this
    // public-facing endpoint — that role should only be set manually in DB.
    const ASSIGNABLE_ROLES = new Set(['user', 'org_member', 'org_owner', 'agency_admin'])
    const requestedRole = ASSIGNABLE_ROLES.has(role) ? role : 'user'

    const sbUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const sbServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sbAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // Service-role admin client (used for both the role lookup AND the
    // inviteUserByEmail call). Reading the role via service role means we
    // never depend on profiles RLS for the authorization decision.
    const supabaseAdmin = createClient(sbUrl, sbServiceKey)

    // Auth-only client just to verify the JWT belongs to a real user.
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'No autenticado.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }
    const supabaseClient = createClient(sbUrl, sbAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'No autenticado.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Verify caller's role through SERVICE-ROLE client (bypasses RLS).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'No se pudo verificar el rol.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    const allowedRoles = ['platform_owner', 'agency_admin', 'superadmin']
    if (!allowedRoles.includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'No tienes permiso para invitar usuarios.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    // Only a platform_owner can promote someone to agency_admin
    if (requestedRole === 'agency_admin' && profile.role !== 'platform_owner') {
      return new Response(JSON.stringify({ error: 'Solo platform_owner puede asignar agency_admin.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://derbix.co'

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role: requestedRole },
      redirectTo: `${frontendUrl}/app`
    })

    if (error) {
      console.error('[invite-user] inviteUserByEmail error:', error.message)
      return new Response(JSON.stringify({ error: 'No se pudo enviar la invitación.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    return new Response(JSON.stringify({ success: true, user: { id: data.user?.id, email: data.user?.email } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('[invite-user] Unhandled error:', error)
    return new Response(JSON.stringify({ error: 'Error interno.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})